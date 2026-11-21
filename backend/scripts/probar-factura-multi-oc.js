/* Prueba de una factura que junta remitos de varias OC (21/11/2026).
 * Corre contra la base de DATABASE_URL pero TODO dentro de una transacción
 * que termina en ROLLBACK: no deja nada escrito.
 *   cd backend && node scripts/probar-factura-multi-oc.js
 */
require('dotenv').config();
const assert = require('assert');
const pool = require('../db');
const { pendientesPorCliente } = require('../services/oc-pendientes');
const { crearEntrega } = require('../services/entregas');
const { crearFacturaDesdeRemitos } = require('../services/facturas-venta');
const { FACTURA_OC_PARTE } = require('../services/factura-oc');
const { facturaConDetalle } = require('../services/cuenta-cliente');
const { vistaPreviaAnulacionOC, vistaPreviaAnulacion, anularFactura } = require('../services/anulaciones');

let ok = 0;
const prueba = (nombre, fn) => Promise.resolve(fn()).then(() => { ok++; console.log('  ✓', nombre); });

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cliente y modelo con stock y pendiente en 2 OC o más (1 unidad en cada una alcanza).
    const stock = new Map((await client.query('SELECT ficha_id, stock_actual FROM stock_actual')).rows
      .map(r => [r.ficha_id, Number(r.stock_actual)]));
    let elegido = null;
    for (const c of (await client.query('SELECT DISTINCT cliente_id FROM ordenes_compra')).rows) {
      const p = (await pendientesPorCliente(c.cliente_id, client))[0];
      const m = p?.modelos.find(x => x.ordenes.length >= 2 && (stock.get(x.ficha_id) || 0) >= 4
        && x.ordenes[0].pendiente >= 2 && x.ordenes[1].pendiente >= 2);
      if (m) { elegido = { cliente_id: c.cliente_id, modelo: m }; break; }
    }
    if (!elegido) {
      console.log('(sin datos locales con 2 OC y stock: se omite la prueba)');
      return;
    }
    const { cliente_id, modelo } = elegido;
    const [ocA, ocB] = modelo.ordenes;
    const reparto = (a, b) => [{ orden_compra_id: ocA.oc_id, cantidad: a }, { orden_compra_id: ocB.oc_id, cantidad: b }];
    const precios = [{ ficha_id: modelo.ficha_id, precio_unitario_usd: 1, precio_unitario_pesos: 1000 }];
    const fecha = '2026-11-21';

    // Un remito que cubre dos OC (1 unidad en cada una) y otro de una sola OC.
    const e1 = await crearEntrega(client, {
      cliente_id, remito_fecha: fecha, tipo_cambio: 1000,
      lineas: [{ ficha_id: modelo.ficha_id, cantidad: 2, reparto: reparto(1, 1) }]
    });
    const e2 = await crearEntrega(client, {
      cliente_id, remito_fecha: fecha, tipo_cambio: 1000,
      lineas: [{ ficha_id: modelo.ficha_id, cantidad: 2, reparto: [{ orden_compra_id: ocA.oc_id, cantidad: 2 }] }]
    });
    const ventaIds = [...e1.ventas, ...e2.ventas].map(v => v.id);   // 3 tramos: A, B (remito 1) y A (remito 2)

    console.log('Factura que junta varias OC (en transacción con ROLLBACK)');
    let factura;
    await prueba('una factura puede juntar remitos de OC distintas', async () => {
      factura = await crearFacturaDesdeRemitos(client, {
        venta_ids: ventaIds, numero_factura: 'PRUEBA-MULTI-1', tipo_factura: 'A', fecha, dias_credito: 30,
        tipo_cambio: 1000, precios
      });
      assert.strictEqual(factura.orden_compra_id, null, 'junta varias OC: el atajo queda vacío');
      const items = (await client.query('SELECT COUNT(*)::int AS n FROM factura_venta_items WHERE factura_id = $1', [factura.id])).rows[0].n;
      assert.strictEqual(items, 3);
    });

    await prueba('cada OC se lleva la parte que cubre de la factura', async () => {
      const partes = (await client.query(
        `SELECT oc_id, ROUND(parte, 4) AS parte FROM (${FACTURA_OC_PARTE}) f WHERE factura_id = $1 ORDER BY oc_id`,
        [factura.id])).rows.map(r => [r.oc_id, Number(r.parte)]);
      // 4 unidades en total: 3 en la OC A y 1 en la B
      assert.deepStrictEqual(partes, [[ocA.oc_id, 0.75], [ocB.oc_id, 0.25]].sort((x, y) => x[0] - y[0]));
      const sum = partes.reduce((a, [, p]) => a + p, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9);
      const totalA = (await client.query(
        `SELECT SUM(fa.total * fop.parte) AS t FROM (${FACTURA_OC_PARTE}) fop JOIN facturas fa ON fa.id = fop.factura_id WHERE fop.oc_id = $1 AND fa.id = $2`,
        [ocA.oc_id, factura.id])).rows[0].t;
      assert.ok(Math.abs(Number(totalA) - Number(factura.total) * 0.75) < 0.01);
    });

    await prueba('el origen de la factura lista las dos OC y los remitos', async () => {
      const d = await facturaConDetalle(client, factura.id);
      assert.strictEqual(d.origen.ordenes.length, 2);
      assert.strictEqual(d.origen.orden_compra_id, null);
      assert.strictEqual(d.origen.remitos.length, 2);
      assert.deepStrictEqual(d.origen.items, [{ modelo: modelo.modelo, cantidad: 4 }]);
    });

    await prueba('no se puede anular una OC mientras una factura vigente la cubre (aunque la junte con otra)', async () => {
      for (const oc of [ocA, ocB]) {
        const prev = await vistaPreviaAnulacionOC(client, oc.oc_id);
        assert.ok(prev.facturas.some(f => f.id === factura.id), `OC ${oc.numero_oc}`);
      }
    });

    await prueba('un remito ya facturado no se puede facturar de nuevo', async () => {
      await client.query('SAVEPOINT s');
      await assert.rejects(() => crearFacturaDesdeRemitos(client, {
        venta_ids: [ventaIds[0]], numero_factura: 'PRUEBA-MULTI-2', tipo_factura: 'A', fecha, precios
      }), /Ya facturado/);
      await client.query('ROLLBACK TO s');
    });

    await prueba('al anular la factura, los remitos vuelven a quedar pendientes de facturar', async () => {
      const prev = await vistaPreviaAnulacion(client, factura.id);
      assert.strictEqual(prev.bloqueos?.length || 0, 0);
      await anularFactura(client, factura.id, {
        motivo: 'prueba automática', confirmar_numero: 'PRUEBA-MULTI-1', acciones_cobros: [], usuario: null
      });
      const libres = (await client.query(
        `SELECT COUNT(*)::int AS n FROM venta_items vi
         WHERE vi.venta_id = ANY($1) AND NOT EXISTS (SELECT 1 FROM factura_venta_items x WHERE x.venta_item_id = vi.id)`,
        [ventaIds])).rows[0].n;
      assert.strictEqual(libres, 3);
    });

    console.log('Factura de una sola OC (mantiene el atajo)');
    await prueba('con remitos de una sola OC, la factura guarda esa OC', async () => {
      const f = await crearFacturaDesdeRemitos(client, {
        venta_ids: [e2.ventas[0].id], numero_factura: 'PRUEBA-MULTI-3', tipo_factura: 'A', fecha, tipo_cambio: 1000, precios
      });
      assert.strictEqual(f.orden_compra_id, ocA.oc_id);
      const d = await facturaConDetalle(client, f.id);
      assert.strictEqual(d.origen.ordenes.length, 1);
      assert.strictEqual(d.origen.orden_compra_id, ocA.oc_id);
    });

    await prueba('remitos de clientes distintos no se pueden juntar', async () => {
      const otra = (await client.query(
        `SELECT v.id FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
         WHERE v.cliente_id <> $1 AND v.anulada_en IS NULL
           AND NOT EXISTS (SELECT 1 FROM factura_venta_items x WHERE x.venta_item_id = vi.id) LIMIT 1`, [cliente_id])).rows[0];
      if (!otra) return;   // sin datos de otro cliente: no se puede armar el caso
      await client.query('SAVEPOINT s');
      await assert.rejects(() => crearFacturaDesdeRemitos(client, {
        venta_ids: [e1.ventas[0].id, otra.id], numero_factura: 'PRUEBA-MULTI-4', tipo_factura: 'A', fecha, precios
      }), /clientes distintos/);
      await client.query('ROLLBACK TO s');
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }

  console.log(`\n${ok} pruebas pasaron.`);
  process.exit(0);
})().catch((e) => { console.error('\n✗ FALLÓ:', e); process.exit(1); });

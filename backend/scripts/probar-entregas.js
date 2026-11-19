/* Prueba de services/entregas.js y services/remitos.js (19/11/2026).
 * Corre contra la base de DATABASE_URL pero TODO dentro de una transacción
 * que termina en ROLLBACK: no deja nada escrito (ni el número de remito).
 *   cd backend && node scripts/probar-entregas.js
 */
require('dotenv').config();
const assert = require('assert');
const pool = require('../db');
const { pendientesPorCliente } = require('../services/oc-pendientes');
const { repartirEntreOC, crearEntrega, proximoNumeroRemito } = require('../services/entregas');
const { agruparTramos, idsDelRemito } = require('../services/remitos');
const { vistaPreviaAnulacionRemito, anularRemito } = require('../services/anulaciones');

let ok = 0;
const prueba = (nombre, fn) => Promise.resolve(fn()).then(() => { ok++; console.log('  ✓', nombre); });

(async () => {
  console.log('Reparto entre OC (sin base)');
  const cli = { modelos: [{
    ficha_id: 1, modelo: 'M1', pedido: 0, entregado: 0, pendiente: 10,
    ordenes: [
      { oc_id: 11, numero_oc: 'A', pendiente: 3 },
      { oc_id: 12, numero_oc: 'B', pendiente: 7 }
    ]
  }] };
  await prueba('liquida primero la más vieja y sigue con la otra', () => {
    const r = repartirEntreOC(cli, [{ ficha_id: 1, cantidad: 5 }]);
    assert.deepStrictEqual([...r], [[11, [{ ficha_id: 1, cantidad: 3 }]], [12, [{ ficha_id: 1, cantidad: 2 }]]]);
  });
  await prueba('la OC prioritaria va primero', () => {
    const r = repartirEntreOC(cli, [{ ficha_id: 1, cantidad: 5 }], 12);
    assert.deepStrictEqual([...r], [[12, [{ ficha_id: 1, cantidad: 5 }]]]);
  });
  await prueba('más que el pendiente total → 400', () => {
    assert.throws(() => repartirEntreOC(cli, [{ ficha_id: 1, cantidad: 11 }]), e => e.status === 400);
  });
  await prueba('modelo que el cliente no pidió → 400', () => {
    assert.throws(() => repartirEntreOC(cli, [{ ficha_id: 99, cantidad: 1 }]), e => e.status === 400);
  });
  await prueba('reparto manual que no cierra → 400', () => {
    assert.throws(() => repartirEntreOC(cli, [{ ficha_id: 1, cantidad: 5, reparto: [{ orden_compra_id: 12, cantidad: 4 }] }]),
      e => e.status === 400);
  });
  await prueba('reparto manual que excede una OC → 400', () => {
    assert.throws(() => repartirEntreOC(cli, [{ ficha_id: 1, cantidad: 5, reparto: [{ orden_compra_id: 11, cantidad: 5 }] }]),
      e => e.status === 400);
  });

  console.log('Agrupado de remitos (sin base)');
  await prueba('dos tramos con el mismo N° son un solo remito', () => {
    const fila = (id, oc, items, sinFact) => ({
      id, cliente_id: 1, orden_compra_id: oc, remito_numero: 'R-1', fecha: '2026-11-19', numero_oc: `OC${oc}`,
      numero_factura: null, items_total: items.length, items_sin_facturar: sinFact,
      unidades: items.reduce((a, i) => a + i.cantidad, 0), items, remito_fecha: '2026-11-19'
    });
    const it = (m, c) => ({ modelo: m, cantidad: c, precio_unitario_usd: 10, precio_unitario_pesos: 1000 });
    const r = agruparTramos([fila(2, 12, [it('M1', 2)], 1), fila(1, 11, [it('M1', 3), it('M2', 1)], 2)]);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].unidades, 6);
    assert.deepStrictEqual(r[0].items.map(i => [i.modelo, i.cantidad]), [['M1', 5], ['M2', 1]]);
    assert.strictEqual(r[0].numero_oc, 'OC12, OC11');
    assert.strictEqual(r[0].estado_facturacion, 'SIN_FACTURAR');
  });

  console.log('Entrega real (en transacción con ROLLBACK)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cliente y modelo con stock y pendiente en 2 OC o más.
    const stock = new Map((await client.query('SELECT ficha_id, stock_actual FROM stock_actual')).rows
      .map(r => [r.ficha_id, Number(r.stock_actual)]));
    let elegido = null;
    for (const c of (await client.query('SELECT DISTINCT cliente_id FROM ordenes_compra')).rows) {
      const p = (await pendientesPorCliente(c.cliente_id, client))[0];
      const m = p?.modelos.find(x => x.ordenes.length >= 2 && (stock.get(x.ficha_id) || 0) >= x.ordenes[0].pendiente + 1);
      if (m) { elegido = { cliente_id: c.cliente_id, modelo: m }; break; }
    }
    if (!elegido) {
      console.log('  (sin datos locales con 2 OC y stock: se omite la prueba con base)');
    } else {
      const { cliente_id, modelo } = elegido;
      const cant = modelo.ordenes[0].pendiente + 1;

      await prueba('entrega que cruza dos OC genera 2 tramos con el mismo N° automático', async () => {
        const antes = await proximoNumeroRemito(client);
        const e = await crearEntrega(client, {
          cliente_id, remito_fecha: '2026-11-19', lineas: [{ ficha_id: modelo.ficha_id, cantidad: cant }]
        });
        assert.strictEqual(e.ventas.length, 2);
        assert.strictEqual(e.remito_numero, antes);
        assert.deepStrictEqual(e.ventas.map(v => v.items[0].cantidad), [modelo.ordenes[0].pendiente, 1]);

        const ids = await idsDelRemito(client, e.ventas[1].id);
        assert.strictEqual(ids.length, 2);

        const despues = await proximoNumeroRemito(client);
        assert.notStrictEqual(despues, antes);

        const prev = await vistaPreviaAnulacionRemito(client, e.ventas[0].id);
        assert.strictEqual(prev.items.length, 2);
        assert.strictEqual(prev.bloqueos.length, 0);

        const nuevo = (await pendientesPorCliente(cliente_id, client))[0].modelos.find(m => m.ficha_id === modelo.ficha_id);
        assert.strictEqual(nuevo.pendiente, modelo.pendiente - cant);

        await anularRemito(client, e.ventas[0].id, { motivo: 'prueba automática', confirmar_numero: e.remito_numero, usuario: null });
        const vuelto = (await pendientesPorCliente(cliente_id, client))[0].modelos.find(m => m.ficha_id === modelo.ficha_id);
        assert.strictEqual(vuelto.pendiente, modelo.pendiente);
      });

      await prueba('repetir un N° de remito ya usado → 400', async () => {
        await client.query('SAVEPOINT s');
        const e = await crearEntrega(client, {
          cliente_id, remito_numero: 'PRUEBA-DUP', remito_fecha: '2026-11-19',
          lineas: [{ ficha_id: modelo.ficha_id, cantidad: 1 }]
        });
        assert.ok(e.ventas.length === 1);
        await assert.rejects(() => crearEntrega(client, {
          cliente_id, remito_numero: 'PRUEBA-DUP', remito_fecha: '2026-11-19',
          lineas: [{ ficha_id: modelo.ficha_id, cantidad: 1 }]
        }), err => err.status === 400);
        await client.query('ROLLBACK TO s');
      });

      await prueba('más que el pendiente total del cliente → 400 y no se gasta N°', async () => {
        const antes = await proximoNumeroRemito(client);
        await assert.rejects(() => crearEntrega(client, {
          cliente_id, remito_fecha: '2026-11-19', lineas: [{ ficha_id: modelo.ficha_id, cantidad: modelo.pendiente + 1 }]
        }), err => err.status === 400);
        assert.strictEqual(await proximoNumeroRemito(client), antes);
      });
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }

  console.log(`\n${ok} pruebas pasaron.`);
  process.exit(0);
})().catch((e) => { console.error('\n✗ FALLÓ:', e); process.exit(1); });

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { getIVA } = require('../services/parametros');
const { FACTURA_OC_PARTE, numerosOcDeFactura } = require('../services/factura-oc');

router.use(verificarToken);

/* ============================
   RESUMEN DE ORDEN DE COMPRA
============================ */
router.get(
  '/orden-compra/:id/resumen',
  soloAdmin,
  async (req, res) => {
    try {
      // hallazgos D1/D2: la versión anterior hacía LEFT JOIN venta_items (N
      // filas) y LEFT JOIN pagos_clientes (M filas) al mismo nivel — el
      // resultado eran N×M filas, así que tanto el facturado como el
      // cobrado salían multiplicados (con una OC de 2 items y 2 cobros,
      // salía el doble de cada lado, y por eso el saldo "parecía" bien).
      // Encima pagos_clientes es la tabla legacy: nadie escribe ahí desde
      // que existe el circuito de Cobros, así que el cobrado daba 0 igual.
      // Acá se agrega cada cosa por separado con subconsultas LATERAL,
      // y el cobrado sale del circuito real (pago_items + aplicacion_pagos).
      //
      // Facturado y cobrado salen de las facturas reales que cubren esta OC
      // (antes: "facturado" era lo entregado valorizado a precio de entrega, y
      // "cobrado" se aproximaba por cliente — D1). Una factura puede juntar
      // varias OC (21/11/2026): a cada una le toca la parte que cubre
      // (services/factura-oc.js).
      const result = await pool.query(
        `SELECT
          oc.id, oc.numero_oc, oc.fecha_oc, oc.estado, oc.cliente_id, c.nombre AS cliente,
          COALESCE(f.total_facturado, 0) AS total_facturado,
          COALESCE(p.total_cobrado, 0)   AS total_cobrado,
          COALESCE(f.total_facturado, 0) - COALESCE(p.total_cobrado, 0) AS saldo
        FROM ordenes_compra oc
        JOIN clientes c ON c.id = oc.cliente_id
        LEFT JOIN LATERAL (
          SELECT SUM(fa.total * fop.parte) AS total_facturado
          FROM (${FACTURA_OC_PARTE}) fop
          JOIN facturas fa ON fa.id = fop.factura_id
          WHERE fop.oc_id = oc.id
            AND upper(COALESCE(fa.estado, 'EMITIDA')) <> 'ANULADA'
        ) f ON true
        LEFT JOIN LATERAL (
          SELECT SUM(ap.monto_aplicado * fop.parte) AS total_cobrado
          FROM (${FACTURA_OC_PARTE}) fop
          JOIN aplicacion_pagos ap ON ap.factura_id = fop.factura_id
          JOIN pago_items pi       ON pi.id = ap.pago_item_id
          WHERE fop.oc_id = oc.id AND pi.estado = 'ACREDITADO'
        ) p ON true
        WHERE oc.id = $1`,
        [req.params.id]
      );

      res.json(result.rows[0] || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* ============================
   DETALLE PEDIDO / ENTREGADO
============================ */
router.get(
  '/orden-compra/:id/detalle',
  soloAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          oci.id,
          ft.id AS ficha_id,
          ft.modelo,
          oci.cantidad_pedida,
          COALESCE(SUM(vi.cantidad),0) AS cantidad_entregada,
          oci.cantidad_pedida - COALESCE(SUM(vi.cantidad),0) AS pendiente,
          COALESCE(sa.stock_actual, 0) AS stock_disponible
          FROM orden_compra_items oci
          JOIN ficha_transformador ft ON ft.id = oci.ficha_id
          LEFT JOIN ventas v ON v.orden_compra_id = oci.orden_compra_id
          LEFT JOIN venta_items vi
          ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
          LEFT JOIN stock_actual sa ON sa.ficha_id = ft.id
          WHERE oci.orden_compra_id = $1
          GROUP BY oci.id, ft.id, ft.modelo, oci.cantidad_pedida, sa.stock_actual`,
        [req.params.id]
      );

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* ============================
   FACTURAS DE LA OC
============================ */
/* ============================
   FACTURAS DE LA OC CON DETALLE
============================ */
router.get(
  '/orden-compra/:id/facturas',
  soloAdmin,
  async (req, res) => {
    try {
      // Una fila por factura (una factura puede agrupar varios remitos).
      // Los items salen de lo FACTURADO (factura_venta_items), agrupados
      // por modelo y precio, no de lo entregado: el precio de la factura
      // puede ser distinto al de la entrega.
      const result = await pool.query(
        `SELECT
          fa.id AS factura_id,
          fa.numero_factura,
          fa.fecha AS fecha_factura,
          fa.tipo_factura,
          fa.estado,
          fa.subtotal_sin_iva,
          fa.iva_21,
          fa.total AS total_factura,
          ROUND(fa.total * fop.parte, 2) AS total_de_esta_oc,
          ${numerosOcDeFactura('fa')} AS ocs,
          COALESCE(items.items, '[]'::json) AS items,
          remitos.remitos,
          COALESCE(pagos.total_cobrado, 0) AS total_cobrado
        FROM facturas fa
        JOIN (${FACTURA_OC_PARTE}) fop ON fop.factura_id = fa.id AND fop.oc_id = $1
        LEFT JOIN LATERAL (
          SELECT json_agg(
            json_build_object(
              'modelo', g.modelo,
              'cantidad', g.cantidad,
              'precio_unitario', g.precio_unitario,
              'subtotal', g.subtotal
            )
            ORDER BY g.modelo
          ) AS items
          FROM (
            SELECT ft.modelo, fvi.precio_unitario,
                   SUM(fvi.cantidad) AS cantidad,
                   SUM(fvi.subtotal) AS subtotal
            FROM factura_venta_items fvi
            JOIN ficha_transformador ft ON ft.id = fvi.ficha_id
            WHERE fvi.factura_id = fa.id
            GROUP BY ft.modelo, fvi.precio_unitario
          ) g
        ) items ON true
        LEFT JOIN LATERAL (
          SELECT string_agg(DISTINCT COALESCE(v.remito_numero, 'venta #' || v.id), ', ') AS remitos
          FROM factura_venta_items fvi
          JOIN venta_items vi ON vi.id = fvi.venta_item_id
          JOIN ventas v ON v.id = vi.venta_id
          WHERE fvi.factura_id = fa.id
        ) remitos ON true
        -- Cobros aplicados a la factura (hallazgo D2: sale del circuito
        -- real de Cobros, no de la tabla legacy pagos_clientes)
        LEFT JOIN LATERAL (
          SELECT SUM(ap.monto_aplicado) AS total_cobrado
          FROM aplicacion_pagos ap
          JOIN pago_items pi ON pi.id = ap.pago_item_id
          WHERE ap.factura_id = fa.id AND pi.estado = 'ACREDITADO'
        ) pagos ON true
        ORDER BY fa.fecha, fa.id`,
        [req.params.id]
      );

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* ============================
   REMITOS PENDIENTES DE FACTURAR
   ----------------------------
   Lo que usa la ventana "Facturar remitos": remitos con ítems sin facturar,
   el precio de lista actual de cada modelo, la cotización del dólar y el IVA
   vigentes. Una factura junta remitos del mismo cliente de cualquier OC
   (la OC y el remito son un control interno), así que la ventana trabaja con
   todos los remitos pendientes del cliente; cada uno trae su OC.
============================ */
async function pendienteDeFacturar({ clienteId }) {
  const cli = await pool.query('SELECT id, nombre FROM clientes WHERE id = $1', [clienteId]);
  if (!cli.rows.length) return null;

  const itemsRes = await pool.query(
    `SELECT
       v.id AS venta_id, v.remito_numero, v.remito_fecha, v.tipo_cambio,
       v.orden_compra_id, oc.numero_oc,
       vi.id AS venta_item_id, vi.ficha_id, ft.modelo, vi.cantidad,
       vi.precio_unitario_usd, vi.precio_unitario_pesos
     FROM ventas v
     JOIN venta_items vi ON vi.venta_id = v.id
     JOIN ficha_transformador ft ON ft.id = vi.ficha_id
     LEFT JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
     WHERE v.cliente_id = $1 AND v.anulada_en IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM factura_venta_items fvi WHERE fvi.venta_item_id = vi.id
       )
     ORDER BY COALESCE(v.remito_fecha, v.fecha), v.id, ft.modelo`,
    [clienteId]
  );

  const remitos = [];
  const porVenta = new Map();
  for (const row of itemsRes.rows) {
    let remito = porVenta.get(row.venta_id);
    if (!remito) {
      remito = {
        venta_id: row.venta_id,
        remito_numero: row.remito_numero,
        remito_fecha: row.remito_fecha,
        tipo_cambio: row.tipo_cambio,
        orden_compra_id: row.orden_compra_id,
        numero_oc: row.numero_oc,
        items: []
      };
      porVenta.set(row.venta_id, remito);
      remitos.push(remito);
    }
    remito.items.push({
      venta_item_id: row.venta_item_id,
      ficha_id: row.ficha_id,
      modelo: row.modelo,
      cantidad: row.cantidad,
      precio_unitario_usd: row.precio_unitario_usd,
      precio_unitario_pesos: row.precio_unitario_pesos
    });
  }

  const fichaIds = [...new Set(itemsRes.rows.map(r => r.ficha_id))];
  const preciosRes = fichaIds.length
    ? await pool.query(
        `SELECT DISTINCT ON (ficha_id) ficha_id, precio
         FROM precios_modelo
         WHERE ficha_id = ANY($1)
         ORDER BY ficha_id, fecha_desde DESC`,
        [fichaIds]
      )
    : { rows: [] };
  const precios_lista = {};
  preciosRes.rows.forEach(p => { precios_lista[p.ficha_id] = Number(p.precio); });

  const dolarRes = await pool.query(
    "SELECT valor FROM parametros WHERE clave = 'dolar_banco'"
  );

  return {
    cliente_id: cli.rows[0].id,
    cliente: cli.rows[0].nombre,
    iva: await getIVA(pool),
    dolar_actual: dolarRes.rows.length ? Number(dolarRes.rows[0].valor) : null,
    remitos,
    precios_lista
  };
}

/* Por cliente, o por OC (se resuelve el cliente de esa OC y se devuelve
 * `orden_compra_foco` para que la ventana deje tildados sus remitos). */
router.get('/pendiente-facturar', soloAdmin, async (req, res) => {
  try {
    let clienteId = Number.parseInt(req.query.cliente_id, 10) || null;
    const ocFoco = Number.parseInt(req.query.orden_compra_id, 10) || null;

    if (ocFoco) {
      const oc = await pool.query(
        'SELECT cliente_id FROM ordenes_compra WHERE id = $1', [ocFoco]);
      if (!oc.rows.length) return res.status(404).json({ error: 'OC no encontrada' });
      clienteId = oc.rows[0].cliente_id;
    }
    if (!clienteId) return res.status(400).json({ error: 'Falta el cliente' });

    const datos = await pendienteDeFacturar({ clienteId });
    if (!datos) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ...datos, orden_compra_foco: ocFoco });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Solo los remitos de una OC (contador y botón de oc_detalle). */
router.get(
  '/orden-compra/:id/pendiente-facturar',
  soloAdmin,
  async (req, res) => {
    try {
      const ocRes = await pool.query(
        'SELECT oc.numero_oc, oc.cliente_id FROM ordenes_compra oc WHERE oc.id = $1',
        [req.params.id]
      );
      if (!ocRes.rows.length) {
        return res.status(404).json({ error: 'OC no encontrada' });
      }
      const datos = await pendienteDeFacturar({ clienteId: ocRes.rows[0].cliente_id });
      res.json({
        ...datos,
        numero_oc: ocRes.rows[0].numero_oc,
        remitos: datos.remitos.filter(r => String(r.orden_compra_id) === String(req.params.id))
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;

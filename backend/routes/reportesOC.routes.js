const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { getIVA } = require('../services/parametros');

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
      // Desde migracion-factura-multi-remito.sql las facturas guardan
      // orden_compra_id, así que facturado y cobrado salen de las facturas
      // reales de esta OC (antes: "facturado" era lo entregado valorizado a
      // precio de entrega, y "cobrado" se aproximaba por cliente — D1).
      const result = await pool.query(
        `SELECT
          oc.id, oc.numero_oc, oc.fecha_oc, oc.estado, c.nombre AS cliente,
          COALESCE(f.total_facturado, 0) AS total_facturado,
          COALESCE(p.total_cobrado, 0)   AS total_cobrado,
          COALESCE(f.total_facturado, 0) - COALESCE(p.total_cobrado, 0) AS saldo
        FROM ordenes_compra oc
        JOIN clientes c ON c.id = oc.cliente_id
        LEFT JOIN LATERAL (
          SELECT SUM(fa.total) AS total_facturado
          FROM facturas fa
          WHERE fa.orden_compra_id = oc.id
            AND upper(COALESCE(fa.estado, 'EMITIDA')) <> 'ANULADA'
        ) f ON true
        LEFT JOIN LATERAL (
          SELECT SUM(ap.monto_aplicado) AS total_cobrado
          FROM facturas fa
          JOIN aplicacion_pagos ap ON ap.factura_id = fa.id
          JOIN pago_items pi      ON pi.id = ap.pago_item_id
          WHERE fa.orden_compra_id = oc.id AND pi.estado = 'ACREDITADO'
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
          COALESCE(items.items, '[]'::json) AS items,
          remitos.remitos,
          COALESCE(pagos.total_cobrado, 0) AS total_cobrado
        FROM facturas fa
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
        WHERE fa.orden_compra_id = $1
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
   Lo que usa la ventana "Facturar remitos" de oc_detalle: remitos de la
   OC con items sin facturar, el precio de lista actual de cada modelo, la
   cotización del dólar y el IVA vigentes.
============================ */
router.get(
  '/orden-compra/:id/pendiente-facturar',
  soloAdmin,
  async (req, res) => {
    try {
      const ocRes = await pool.query(
        `SELECT oc.numero_oc, c.nombre AS cliente
         FROM ordenes_compra oc JOIN clientes c ON c.id = oc.cliente_id
         WHERE oc.id = $1`,
        [req.params.id]
      );
      if (!ocRes.rows.length) {
        return res.status(404).json({ error: 'OC no encontrada' });
      }

      const itemsRes = await pool.query(
        `SELECT
           v.id AS venta_id, v.remito_numero, v.remito_fecha, v.tipo_cambio,
           vi.id AS venta_item_id, vi.ficha_id, ft.modelo, vi.cantidad,
           vi.precio_unitario_usd, vi.precio_unitario_pesos
         FROM ventas v
         JOIN venta_items vi ON vi.venta_id = v.id
         JOIN ficha_transformador ft ON ft.id = vi.ficha_id
         WHERE v.orden_compra_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM factura_venta_items fvi WHERE fvi.venta_item_id = vi.id
           )
         ORDER BY v.id, ft.modelo`,
        [req.params.id]
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

      res.json({
        ...ocRes.rows[0],
        iva: await getIVA(pool),
        dolar_actual: dolarRes.rows.length ? Number(dolarRes.rows[0].valor) : null,
        remitos,
        precios_lista
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;

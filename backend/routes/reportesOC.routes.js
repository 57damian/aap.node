const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');

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
      // OJO — pregunta de diseño sin resolver (ver D1 completo en
      // claude/auditoria-bugs-2026-09-13.md): no existe un vínculo directo
      // entre una factura y la OC que la originó, así que "cobrado de la OC"
      // se aproxima acá como "cobros de facturas del mismo cliente de la
      // OC", lo que puede contar cobros de OTRA OC del mismo cliente si el
      // cliente tiene más de una. El fix de fondo (agregar
      // facturas.orden_compra_id al facturar) es una decisión de producto
      // que hay que consultarle a Damian, no algo para decidir en el código.
      const result = await pool.query(
        `SELECT
          oc.id, oc.numero_oc, oc.fecha_oc, oc.estado, c.nombre AS cliente,
          COALESCE(f.total_facturado, 0) AS total_facturado,
          COALESCE(p.total_cobrado, 0)   AS total_cobrado,
          COALESCE(f.total_facturado, 0) - COALESCE(p.total_cobrado, 0) AS saldo
        FROM ordenes_compra oc
        JOIN clientes c ON c.id = oc.cliente_id
        LEFT JOIN LATERAL (
          SELECT SUM(vi.cantidad * vi.precio_unitario_pesos) AS total_facturado
          FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
          WHERE v.orden_compra_id = oc.id
        ) f ON true
        LEFT JOIN LATERAL (
          SELECT SUM(ap.monto_aplicado) AS total_cobrado
          FROM ventas v
          JOIN facturas fa        ON fa.cliente_id = v.cliente_id
          JOIN aplicacion_pagos ap ON ap.factura_id = fa.id
          JOIN pago_items pi      ON pi.id = ap.pago_item_id
          WHERE v.orden_compra_id = oc.id AND pi.estado = 'ACREDITADO'
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
          oci.cantidad_pedida - COALESCE(SUM(vi.cantidad),0) AS pendiente
          FROM orden_compra_items oci
          JOIN ficha_transformador ft ON ft.id = oci.ficha_id
          LEFT JOIN ventas v ON v.orden_compra_id = oci.orden_compra_id
          LEFT JOIN venta_items vi
          ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
          WHERE oci.orden_compra_id = $1
          GROUP BY oci.id, ft.id, ft.modelo, oci.cantidad_pedida`,
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
      const result = await pool.query(
        `SELECT
          v.id AS venta_id,
          f.numero_factura,
          f.fecha AS fecha_factura,
          f.tipo_factura,
          COALESCE(items.items, '[]'::json) AS items,
          COALESCE(items.total_factura, 0) AS total_factura,
          COALESCE(pagos.total_cobrado, 0) AS total_cobrado
        FROM ventas v
        -- Relacionar la venta con su factura real
        JOIN LATERAL (
          SELECT
            fa.id,
            fa.numero_factura,
            fa.fecha,
            fa.tipo_factura
          FROM venta_items vi
          JOIN factura_venta_items fi ON fi.venta_item_id = vi.id
          JOIN facturas fa ON fa.id = fi.factura_id
          WHERE vi.venta_id = v.id
          ORDER BY fa.id DESC
          LIMIT 1
        ) f ON true
        -- Items/totales de la venta
        LEFT JOIN LATERAL (
          SELECT
            json_agg(
              json_build_object(
                'modelo', ft.modelo,
                'cantidad', vi.cantidad,
                'precio_unitario', vi.precio_unitario_pesos,
                'subtotal', vi.cantidad * vi.precio_unitario_pesos
              )
              ORDER BY ft.modelo
            ) AS items,
            SUM(vi.cantidad * vi.precio_unitario_pesos) AS total_factura
          FROM venta_items vi
          JOIN ficha_transformador ft ON ft.id = vi.ficha_id
          WHERE vi.venta_id = v.id
        ) items ON true
        -- Cobros aplicados a la venta (hallazgo D2: antes leía la tabla
        -- legacy pagos_clientes, que nadie escribe desde que existe el
        -- circuito de Cobros — siempre daba 0. Acá sí hay vínculo directo
        -- vía f.id, que es la factura real de esta venta, así que no tiene
        -- la ambigüedad del endpoint /resumen de arriba.)
        LEFT JOIN LATERAL (
          SELECT SUM(ap.monto_aplicado) AS total_cobrado
          FROM aplicacion_pagos ap
          JOIN pago_items pi ON pi.id = ap.pago_item_id
          WHERE ap.factura_id = f.id AND pi.estado = 'ACREDITADO'
        ) pagos ON true
        WHERE v.orden_compra_id = $1
        ORDER BY v.id`,
        [req.params.id]
      );

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;

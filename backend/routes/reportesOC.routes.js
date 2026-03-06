const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

/* ============================
   RESUMEN DE ORDEN DE COMPRA
============================ */
router.get(
  '/orden-compra/:id/resumen',
  authorize(['admin', 'control']),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          oc.id,
          oc.numero_oc,
          oc.fecha_oc,
          oc.estado,
          c.nombre AS cliente,
          COALESCE(SUM(vi.cantidad * vi.precio_unitario_pesos),0) AS total_facturado,
          COALESCE(SUM(pc.monto),0) AS total_cobrado,
          COALESCE(SUM(vi.cantidad * vi.precio_unitario_pesos),0)
          - COALESCE(SUM(pc.monto),0) AS saldo
        FROM ordenes_compra oc
        JOIN clientes c ON c.id = oc.cliente_id
        LEFT JOIN ventas v ON v.orden_compra_id = oc.id
        LEFT JOIN venta_items vi ON vi.venta_id = v.id
        LEFT JOIN pagos_clientes pc ON pc.venta_id = v.id
        WHERE oc.id = $1
        GROUP BY oc.id, c.nombre`,
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
  authorize(['admin', 'control']),
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
  authorize(['admin', 'control']),
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
          JOIN factura_items fi ON fi.venta_item_id = vi.id
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
        -- Cobros aplicados a la venta
        LEFT JOIN LATERAL (
          SELECT SUM(pc.monto) AS total_cobrado
          FROM pagos_clientes pc
          WHERE pc.venta_id = v.id
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

const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

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
router.get(
  '/orden-compra/:id/facturas',
  authorize(['admin', 'control']),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          v.id AS venta_id,
          v.numero_factura,
          v.fecha_factura,
          v.tipo_factura,
          COALESCE(SUM(vi.cantidad * vi.precio_unitario_pesos), 0) AS total_factura,
          COALESCE(SUM(pc.monto), 0) AS total_cobrado
        FROM ventas v
        LEFT JOIN venta_items vi ON vi.venta_id = v.id
        LEFT JOIN pagos_clientes pc ON pc.venta_id = v.id
        WHERE v.orden_compra_id = $1
        GROUP BY
          v.id,
          v.numero_factura,
          v.fecha_factura,
          v.tipo_factura
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

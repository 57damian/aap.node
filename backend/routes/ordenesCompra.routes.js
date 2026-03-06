const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);
const upload = require('../middlewares/uploadModelo'); // reutilizamos multer


router.get(
  '/',
  authorize(['admin', 'control']),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT oc.id, oc.numero_oc, oc.fecha_oc, oc.estado, c.nombre AS cliente
         FROM ordenes_compra oc
         JOIN clientes c ON c.id = oc.cliente_id
         ORDER BY oc.fecha_oc DESC`
      );

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);


router.post(
  '/',
  authorize(['admin', 'control']),
  upload.single('foto_oc'),
  async (req, res) => {
    const { cliente_id, numero_oc, fecha_oc, observaciones } = req.body;

    if (!cliente_id || !numero_oc || !fecha_oc) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const foto = req.file
      ? `uploads/ordenes_compra/${req.file.filename}`
      : null;

    try {
      const result = await pool.query(
        `INSERT INTO ordenes_compra
         (cliente_id, numero_oc, fecha_oc, foto_oc, observaciones)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [cliente_id, numero_oc, fecha_oc, foto, observaciones]
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);


router.post(
  '/:id/items',
  authorize(['admin', 'control']),
  async (req, res) => {
    const { ficha_id, cantidad_pedida } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO orden_compra_items
          (orden_compra_id, ficha_id, cantidad_pedida)
          VALUES ($1,$2,$3)
          ON CONFLICT (orden_compra_id, ficha_id)
          DO UPDATE SET
          cantidad_pedida = orden_compra_items.cantidad_pedida + EXCLUDED.cantidad_pedida
          RETURNING *;`,
        [req.params.id, ficha_id, cantidad_pedida]
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/:id/estado',
  authorize(['admin', 'control']),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          oci.id,
          ft.modelo,
          oci.cantidad_pedida,
          COALESCE(SUM(vi.cantidad), 0) AS cantidad_entregada,
          oci.cantidad_pedida - COALESCE(SUM(vi.cantidad), 0) AS pendiente
        FROM orden_compra_items oci
        JOIN ficha_transformador ft ON ft.id = oci.ficha_id
        LEFT JOIN ventas v ON v.orden_compra_id = oci.orden_compra_id
        LEFT JOIN venta_items vi
          ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
        WHERE oci.orden_compra_id = $1
        GROUP BY oci.id, ft.modelo, oci.cantidad_pedida`,
        [req.params.id]
      );

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  '/:id/cerrar',
  authorize(['admin', 'control']),
  async (req, res) => {
    try {
      const pendientes = await pool.query(
        `SELECT
          SUM(oci.cantidad_pedida - COALESCE(SUM(vi.cantidad),0)) AS pendiente
         FROM orden_compra_items oci
         LEFT JOIN ventas v ON v.orden_compra_id = oci.orden_compra_id
         LEFT JOIN venta_items vi
           ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
         WHERE oci.orden_compra_id = $1
         GROUP BY oci.orden_compra_id`,
        [req.params.id]
      );

      if (pendientes.rows.length && pendientes.rows[0].pendiente > 0) {
        return res.status(400).json({ error: 'La OC todavía tiene pendiente' });
      }

      await pool.query(
        `UPDATE ordenes_compra SET estado = 'cerrada' WHERE id = $1`,
        [req.params.id]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;

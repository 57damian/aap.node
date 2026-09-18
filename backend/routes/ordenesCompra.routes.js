const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');

router.use(verificarToken);
const upload = require('../middlewares/uploadModelo'); // reutilizamos multer


router.get(
  '/',
  soloAdmin,
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
  soloAdmin,
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
  soloAdmin,
  async (req, res) => {
    const { ficha_id, cantidad_pedida } = req.body;

    // Antes no se validaba nada acá: un ficha_id vacío o una cantidad no
    // numérica llegaban directo al INSERT y salían como 500 (hallazgo C4).
    const cantidad = parseInt(cantidad_pedida, 10);
    if (!ficha_id || !Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Falta el modelo o la cantidad no es un entero positivo' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO orden_compra_items
          (orden_compra_id, ficha_id, cantidad_pedida)
          VALUES ($1,$2,$3)
          ON CONFLICT (orden_compra_id, ficha_id)
          DO UPDATE SET
          cantidad_pedida = orden_compra_items.cantidad_pedida + EXCLUDED.cantidad_pedida
          RETURNING *;`,
        [req.params.id, ficha_id, cantidad]
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  '/:id/estado',
  soloAdmin,
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
  soloAdmin,
  async (req, res) => {
    try {
      // La versión anterior hacía SUM(... - SUM(...)) en el mismo nivel:
      // Postgres no permite anidar funciones de agregación así y tiraba
      // "aggregate function calls cannot be nested" (hallazgo C5). Hay que
      // agregar primero por línea de la OC (subconsulta, agrupando por
      // oci.id) y recién ahí sumar el total pendiente.
      const pendientes = await pool.query(
        `SELECT COALESCE(SUM(d.pendiente), 0) AS pendiente
         FROM (
           SELECT oci.cantidad_pedida - COALESCE(SUM(vi.cantidad), 0) AS pendiente
           FROM orden_compra_items oci
           LEFT JOIN ventas v       ON v.orden_compra_id = oci.orden_compra_id
           LEFT JOIN venta_items vi ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
           WHERE oci.orden_compra_id = $1
           GROUP BY oci.id, oci.cantidad_pedida
         ) d`,
        [req.params.id]
      );

      if (Number(pendientes.rows[0].pendiente) > 0) {
        return res.status(400).json({ error: 'La OC todavía tiene pendiente' });
      }

      // Nota: se deja 'cerrada' en minúscula (no se toca la convención de
      // estado en esta pasada) para no desincronizar con oc.js / oc_detalle.js,
      // que hoy comparan contra minúscula. Migrar a MAYÚSCULAS + CHECK queda
      // pendiente junto con el resto de Órdenes de Compra (ver hallazgo C5
      // completo en claude/auditoria-bugs-2026-09-13.md).
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

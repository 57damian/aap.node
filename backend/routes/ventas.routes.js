const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

/* =========================
   CREAR VENTA
========================= */
router.post(
  '/',
  authorize(['admin', 'control']),
  async (req, res) => {

    const { orden_compra_id, tipo_cambio, numero_factura, fecha_factura, tipo_factura } = req.body;

    if (!orden_compra_id || !tipo_cambio) {
      return res.status(400).json({
        error: 'orden_compra_id y tipo_cambio son obligatorios'
      });
    }

    try {

      /* Obtener cliente desde la OC */
      const oc = await pool.query(
        `SELECT cliente_id
         FROM ordenes_compra
         WHERE id = $1`,
        [orden_compra_id]
      );

      if (!oc.rows.length) {
        return res.status(404).json({ error: 'Orden de compra no encontrada' });
      }

      const cliente_id = oc.rows[0].cliente_id;

      /* Crear venta con tipo de cambio congelado */
      const result = await pool.query(
        `INSERT INTO ventas
         (cliente_id, orden_compra_id, tipo_cambio, numero_factura, fecha_factura, tipo_factura)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [cliente_id, orden_compra_id, tipo_cambio, numero_factura, fecha_factura, tipo_factura]
      );

      res.json(result.rows[0]);

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.post('/:venta_id/items', authorize(['admin', 'control']), async (req, res) => {

  const { ficha_id, cantidad } = req.body;
  const { venta_id } = req.params;

  if (!ficha_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Datos de ítem inválidos' });
  }

  try {

    /* 1️⃣ Verificar venta */
    const ventaRes = await pool.query(
      `SELECT orden_compra_id, tipo_cambio
       FROM ventas
       WHERE id = $1`,
      [venta_id]
    );

    if (!ventaRes.rows.length) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const { orden_compra_id, tipo_cambio } = ventaRes.rows[0];

    /* 2️⃣ Verificar pendiente en OC */
    const ocItemRes = await pool.query(
      `SELECT
         oci.cantidad_pedida,
         COALESCE(SUM(vi.cantidad),0) AS cantidad_entregada
       FROM orden_compra_items oci
       LEFT JOIN ventas v ON v.orden_compra_id = oci.orden_compra_id
       LEFT JOIN venta_items vi
         ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
       WHERE oci.orden_compra_id = $1
         AND oci.ficha_id = $2
       GROUP BY oci.cantidad_pedida`,
      [orden_compra_id, ficha_id]
    );

    if (!ocItemRes.rows.length) {
      return res.status(400).json({
        error: 'El modelo no pertenece a la orden de compra'
      });
    }

    const { cantidad_pedida, cantidad_entregada } = ocItemRes.rows[0];
    const pendiente = cantidad_pedida - cantidad_entregada;

    if (cantidad > pendiente) {
      return res.status(400).json({
        error: `Cantidad supera el pendiente (${pendiente})`
      });
    }

    /* 3️⃣ Buscar precio USD actual */
    const precioRes = await pool.query(
      `SELECT precio
       FROM precios_modelo
       WHERE ficha_id = $1
       ORDER BY fecha_desde DESC
       LIMIT 1`,
      [ficha_id]
    );

    if (!precioRes.rows.length) {
      return res.status(400).json({
        error: 'No hay precio definido para este modelo'
      });
    }

    const precio_usd = precioRes.rows[0].precio;

    /* 4️⃣ Calcular pesos */
    const precio_pesos = precio_usd * tipo_cambio;

    /* 5️⃣ Insertar congelando valores */
    const result = await pool.query(
      `INSERT INTO venta_items
       (venta_id, ficha_id, cantidad, precio_unitario_usd, precio_unitario_pesos)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [venta_id, ficha_id, cantidad, precio_usd, precio_pesos]
    );

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
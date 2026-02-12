const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

/* Saldo por cliente */
router.get('/saldo/cliente/:cliente_id', authorize(['admin', 'control']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.id AS cliente_id,
        c.nombre,
        COALESCE(SUM(vi.cantidad * vi.precio_unitario), 0) AS total_vendido,
        COALESCE(SUM(pc.monto), 0) AS total_pagado,
        COALESCE(SUM(vi.cantidad * vi.precio_unitario), 0)
        - COALESCE(SUM(pc.monto), 0) AS saldo
       FROM clientes c
       LEFT JOIN ventas v ON v.cliente_id = c.id
       LEFT JOIN venta_items vi ON vi.venta_id = v.id
       LEFT JOIN pagos_clientes pc ON pc.venta_id = v.id
       WHERE c.id = $1
       GROUP BY c.id, c.nombre`,
      [req.params.cliente_id]
    );

    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

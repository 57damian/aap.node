const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

/* Registrar producción */
router.post('/', authorize(['admin', 'operario']), async (req, res) => {
  const { ficha_id, cantidad, usuario_id } = req.body;

  if (!ficha_id || !cantidad || !usuario_id) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO produccion (ficha_id, cantidad, usuario_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [ficha_id, cantidad, usuario_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Producción por modelo */
router.get('/modelo/:ficha_id', authorize(['admin', 'operario']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.fecha, p.cantidad, u.usuario
       FROM produccion p
       JOIN usuarios u ON p.usuario_id = u.id
       WHERE p.ficha_id = $1
       ORDER BY p.fecha DESC`,
      [req.params.ficha_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

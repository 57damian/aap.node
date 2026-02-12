const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');



/* =========================
   1️⃣ PRECIOS ACTUALES
========================= */
router.get('/actuales', authorize(['admin', 'control']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        f.id AS ficha_id,
        f.modelo,
        (
          SELECT pm.precio
          FROM precios_modelo pm
          WHERE pm.ficha_id = f.id
          ORDER BY pm.fecha_desde DESC, pm.id DESC
          LIMIT 1
        ) AS precio_usd,
        (
          SELECT pm.fecha_desde
          FROM precios_modelo pm
          WHERE pm.ficha_id = f.id
          ORDER BY pm.fecha_desde DESC, pm.id DESC
          LIMIT 1
        ) AS fecha_desde
      FROM ficha_transformador f
      ORDER BY f.modelo;
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   2️⃣ NUEVO PRECIO MODELO
========================= */
router.post('/modelo', authorize(['admin', 'control']), async (req, res) => {
  const { ficha_id, precio, observaciones } = req.body;

  if (!ficha_id || !precio) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO precios_modelo
       (ficha_id, precio, fecha_desde, observaciones)
       VALUES ($1,$2,NOW(),$3)
       RETURNING *`,
      [ficha_id, precio, observaciones]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   3️⃣ HISTORIAL POR MODELO
========================= */
router.get('/modelo/:ficha_id', authorize(['admin', 'control']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT precio AS precio_usd, fecha_desde, observaciones
       FROM precios_modelo
       WHERE ficha_id = $1
       ORDER BY fecha_desde DESC`,
      [req.params.ficha_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   4️⃣ AUMENTO POR MODELO %
========================= */
router.post('/aumento/:ficha_id', authorize(['admin']), async (req, res) => {
  const porcentaje = Number(req.body.porcentaje);
  const observaciones = req.body.observaciones || null;
  const { ficha_id } = req.params;

  if (isNaN(porcentaje) || porcentaje <= 0) {
    return res.status(400).json({ error: 'Porcentaje inválido' });
  }

  try {
    const insert = await pool.query(`
      INSERT INTO precios_modelo (ficha_id, precio, fecha_desde, observaciones)
      SELECT $1,
             ROUND(precio * (1 + $2/100.0), 2),
             NOW(),
             $3
      FROM precios_modelo
      WHERE ficha_id = $1
      ORDER BY fecha_desde DESC, id DESC
      LIMIT 1
      RETURNING *
    `, [ficha_id, porcentaje, observaciones]);

    if (insert.rows.length === 0) {
      return res.status(404).json({ error: 'No hay precio base' });
    }

    res.json(insert.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../db');

/* LOGIN */
router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT u.id, u.usuario, r.nombre AS rol
       FROM usuarios u
       JOIN roles r ON u.rol_id = r.id
       WHERE u.usuario = $1 AND u.password_hash = $2`,
      [usuario, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    res.json({
      ok: true,
      usuario: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

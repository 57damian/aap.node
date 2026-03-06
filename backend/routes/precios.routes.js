const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

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

/* ============================================
   5️⃣ OBTENER CONFIGURACIÓN DE IVA - AGREGADO
   ============================================ */
router.get('/parametros/iva', authorize(['admin', 'control']), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT valor FROM parametros WHERE clave = 'iva_general'"
    );
    
    if (result.rows.length === 0) {
      // Si no existe, crear con valor por defecto 21%
      const insert = await pool.query(
        `INSERT INTO parametros (clave, valor, descripcion)
         VALUES ('iva_general', '21', 'Alícuota general de IVA en porcentaje')
         RETURNING valor`
      );
      return res.json({ 
        iva: parseInt(insert.rows[0].valor),
        valor: insert.rows[0].valor,
        descripcion: 'Alícuota general de IVA'
      });
    }
    
    res.json({ 
      iva: parseInt(result.rows[0].valor),
      valor: result.rows[0].valor,
      descripcion: 'Alícuota general de IVA'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   6️⃣ ACTUALIZAR CONFIGURACIÓN DE IVA - AGREGADO
   ============================================ */
router.put('/parametros/iva', authorize(['admin']), async (req, res) => {
  const { valor } = req.body;
  
  if (!valor || isNaN(valor) || valor <= 0 || valor > 100) {
    return res.status(400).json({ error: 'Valor de IVA inválido (1-100)' });
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO parametros (clave, valor, descripcion)
       VALUES ('iva_general', $1, 'Alícuota general de IVA en porcentaje')
       ON CONFLICT (clave) 
       DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
       RETURNING *`,
      [valor]
    );
    
    res.json({ 
      ok: true, 
      iva: parseInt(result.rows[0].valor),
      mensaje: `✅ IVA actualizado al ${valor}%` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   7️⃣ OBTENER TIPO DE CAMBIO POR DEFECTO - AGREGADO
   ============================================ */
router.get('/parametros/tipo-cambio', authorize(['admin', 'control']), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT valor FROM parametros WHERE clave = 'tipo_cambio_default'"
    );
    
    if (result.rows.length === 0) {
      return res.json({ 
        tipo_cambio: 1000,
        valor: '1000',
        descripcion: 'Tipo de cambio USD/ARS por defecto'
      });
    }
    
    res.json({ 
      tipo_cambio: parseFloat(result.rows[0].valor),
      valor: result.rows[0].valor,
      descripcion: 'Tipo de cambio USD/ARS por defecto'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   8️⃣ ACTUALIZAR TIPO DE CAMBIO POR DEFECTO - AGREGADO
   ============================================ */
router.put('/parametros/tipo-cambio', authorize(['admin']), async (req, res) => {
  const { valor } = req.body;
  
  if (!valor || isNaN(valor) || valor <= 0) {
    return res.status(400).json({ error: 'Valor de tipo de cambio inválido' });
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO parametros (clave, valor, descripcion)
       VALUES ('tipo_cambio_default', $1, 'Tipo de cambio USD/ARS por defecto')
       ON CONFLICT (clave) 
       DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
       RETURNING *`,
      [valor]
    );
    
    res.json({ 
      ok: true, 
      tipo_cambio: parseFloat(result.rows[0].valor),
      mensaje: `✅ Tipo de cambio por defecto actualizado a $${valor}` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ============================================
   💲 OBTENER TIPO DE CAMBIO ACTUAL (DÓLAR BANCO)
   ============================================ */
router.get('/parametros/dolar', authorize(['admin', 'control', 'operario']), async (req, res) => {
  try {
    // Obtener el valor del dólar del banco
    const dolarRes = await pool.query(
      "SELECT valor, updated_at FROM parametros WHERE clave = 'dolar_banco'"
    );
    
    // Si no existe, crear con valor por defecto
    if (dolarRes.rows.length === 0) {
      const insert = await pool.query(
        `INSERT INTO parametros (clave, valor, descripcion)
         VALUES ('dolar_banco', '1415.00', 'Tipo de cambio USD/ARS - Dólar Banco')
         RETURNING valor, updated_at`
      );
      
      return res.json({
        dolar: parseFloat(insert.rows[0].valor),
        fecha: insert.rows[0].updated_at,
        formato: `ARS ${parseFloat(insert.rows[0].valor).toFixed(2)} por USD 1`
      });
    }
    
    res.json({
      dolar: parseFloat(dolarRes.rows[0].valor),
      fecha: dolarRes.rows[0].updated_at,
      formato: `ARS ${parseFloat(dolarRes.rows[0].valor).toFixed(2)} por USD 1`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   💲 ACTUALIZAR TIPO DE CAMBIO (DÓLAR BANCO) - CORREGIDO
   ============================================ */
router.put('/parametros/dolar', authorize(['admin', 'control']), async (req, res) => {
  const { dolar } = req.body;
  const usuario_id = req.headers['usuario_id'] || req.body.usuario_id || null;
  
  if (!dolar || isNaN(dolar) || parseFloat(dolar) <= 0) {
    return res.status(400).json({ error: 'Valor de dólar inválido' });
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Verificar si el usuario existe (si se proporcionó)
    if (usuario_id) {
      const userCheck = await client.query(
        'SELECT id FROM usuarios WHERE id = $1',
        [usuario_id]
      );
      if (userCheck.rows.length === 0) {
        // Si el usuario no existe, ignorar y seguir sin updated_by
        console.log('Usuario no encontrado, continuando sin updated_by');
      }
    }

    // Actualizar el valor del dólar
    const result = await client.query(
      `INSERT INTO parametros (clave, valor, descripcion, updated_by, updated_at)
       VALUES ('dolar_banco', $1, 'Tipo de cambio USD/ARS - Dólar Banco', $2, NOW())
       ON CONFLICT (clave) 
       DO UPDATE SET 
         valor = EXCLUDED.valor,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING valor, updated_at, updated_by`,
      [dolar, usuario_id]
    );

    // Insertar en historial manualmente (por si el trigger falla)
    await client.query(
      `INSERT INTO historial_dolar (dolar, usuario_id, created_at)
       VALUES ($1, $2, NOW())`,
      [dolar, usuario_id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      dolar: parseFloat(result.rows[0].valor),
      fecha: result.rows[0].updated_at,
      mensaje: `✅ Dólar actualizado a ARS ${parseFloat(dolar).toFixed(2)}`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error actualizando dólar:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ============================================
   💲 HISTORIAL DE TIPO DE CAMBIO - CORREGIDO
   ============================================ */
router.get('/parametros/dolar/historial', authorize(['admin', 'control', 'operario']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        h.dolar,
        h.created_at as fecha,
        COALESCE(u.nombre_usuario, 'Sistema') as usuario
      FROM historial_dolar h
      LEFT JOIN usuarios u ON u.id = h.usuario_id
      ORDER BY h.created_at DESC
      LIMIT 50
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo historial:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);
/* ============================================
   REGISTRAR PRODUCCIÓN
   POST /api/produccion
============================================ */
router.post('/', authorize(['admin', 'operario', 'empleado']), async (req, res) => {
  const { 
    ficha_id, 
    cantidad, 
    fecha_produccion, 
    observaciones 
  } = req.body;
  
  const usuario_id = req.headers['usuario_id'] || req.body.usuario_id;

  if (!ficha_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ 
      error: 'Ficha y cantidad son obligatorios' 
    });
  }

  try {
    // Verificar que la ficha existe
    const fichaCheck = await pool.query(
      'SELECT modelo FROM ficha_transformador WHERE id = $1',
      [ficha_id]
    );

    if (fichaCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo no encontrado' });
    }

    // Insertar producción
    const result = await pool.query(
      `INSERT INTO produccion 
       (ficha_id, cantidad, fecha_produccion, usuario_id, observaciones)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        ficha_id, 
        cantidad, 
        fecha_produccion || new Date().toISOString().split('T')[0],
        usuario_id || null,
        observaciones || null
      ]
    );

    // Obtener stock actualizado
    const stockRes = await pool.query(
      'SELECT * FROM stock_actual WHERE ficha_id = $1',
      [ficha_id]
    );

    res.json({
      ok: true,
      produccion: result.rows[0],
      stock: stockRes.rows[0] || { stock_actual: 0 },
      mensaje: `✅ Registrados ${cantidad} unidades de ${fichaCheck.rows[0].modelo}`
    });

  } catch (err) {
    console.error('Error registrando producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   LISTAR PRODUCCIÓN (CON FILTROS)
   GET /api/produccion?ficha_id=1&desde=2024-01-01&hasta=2024-12-31
============================================ */
router.get('/', authorize(['admin', 'operario', 'control', 'empleado']), async (req, res) => {
  const { ficha_id, desde, hasta, limit = 100 } = req.query;

  try {
    let query = `
      SELECT 
        p.id,
        p.cantidad,
        p.fecha_produccion,
        p.observaciones,
        p.created_at,
        f.id as ficha_id,
        f.modelo,
        u.nombre_usuario as registrado_por
      FROM produccion p
      JOIN ficha_transformador f ON f.id = p.ficha_id
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCounter = 1;

    if (ficha_id) {
      query += ` AND p.ficha_id = $${paramCounter}`;
      params.push(ficha_id);
      paramCounter++;
    }

    if (desde) {
      query += ` AND p.fecha_produccion >= $${paramCounter}`;
      params.push(desde);
      paramCounter++;
    }

    if (hasta) {
      query += ` AND p.fecha_produccion <= $${paramCounter}`;
      params.push(hasta);
      paramCounter++;
    }

    query += ` ORDER BY p.fecha_produccion DESC, p.id DESC LIMIT $${paramCounter}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    console.error('Error listando producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   OBTENER STOCK ACTUAL
   GET /api/produccion/stock
============================================ */
router.get('/stock', authorize(['admin', 'operario', 'control', 'empleado']), async (req, res) => {
  const { con_stock, solo_genericos, cliente_id } = req.query;

  try {
    let query = `SELECT * FROM stock_actual WHERE 1=1`;
    const params = [];
    let paramCounter = 1;

    if (con_stock === 'true') {
      query += ` AND stock_actual > 0`;
    }

    if (solo_genericos === 'true') {
      query += ` AND cliente_id IS NULL`;
    }

    if (cliente_id) {
      query += ` AND (cliente_id = $${paramCounter} OR cliente_id IS NULL)`;
      params.push(cliente_id);
      paramCounter++;
    }

    query += ` ORDER BY modelo`;

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    console.error('Error obteniendo stock:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   OBTENER STOCK DE UN MODELO ESPECÍFICO
   GET /api/produccion/stock/:ficha_id
============================================ */
router.get('/stock/:ficha_id', authorize(['admin', 'operario', 'control', 'empleado']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM stock_actual WHERE ficha_id = $1',
      [req.params.ficha_id]
    );

    if (result.rows.length === 0) {
      // Si no hay en la vista, obtener datos básicos
      const fichaRes = await pool.query(
        'SELECT id as ficha_id, modelo, cliente_id FROM ficha_transformador WHERE id = $1',
        [req.params.ficha_id]
      );

      if (fichaRes.rows.length === 0) {
        return res.status(404).json({ error: 'Modelo no encontrado' });
      }

      return res.json({
        ficha_id: parseInt(req.params.ficha_id),
        modelo: fichaRes.rows[0].modelo,
        producido_total: 0,
        entregado_total: 0,
        stock_actual: 0
      });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('Error obteniendo stock:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   REPORTE DE PRODUCCIÓN VS ENTREGAS
   GET /api/produccion/reporte?desde=&hasta=
============================================ */
router.get('/reporte', authorize(['admin', 'control', 'empleado']), async (req, res) => {
  const { desde, hasta } = req.query;

  try {
    let query = `
      SELECT 
        f.id as ficha_id,
        f.modelo,
        COALESCE((
          SELECT SUM(p.cantidad) 
          FROM produccion p 
          WHERE p.ficha_id = f.id
    `;

    const params = [];
    let paramCounter = 1;

    if (desde || hasta) {
      query += ` AND (`;
      if (desde) {
        query += ` p.fecha_produccion >= $${paramCounter}`;
        params.push(desde);
        paramCounter++;
      }
      if (desde && hasta) {
        query += ` AND`;
      }
      if (hasta) {
        query += ` p.fecha_produccion <= $${paramCounter}`;
        params.push(hasta);
        paramCounter++;
      }
      query += `)`;
    }

    query += `
        ), 0) as producido_periodo,
        COALESCE((
          SELECT SUM(vi.cantidad) 
          FROM venta_items vi
          JOIN ventas v ON v.id = vi.venta_id
          WHERE vi.ficha_id = f.id
    `;

    if (desde || hasta) {
      query += ` AND (`;
      if (desde) {
        query += ` v.fecha >= $${paramCounter}`;
        params.push(desde);
        paramCounter++;
      }
      if (desde && hasta) {
        query += ` AND`;
      }
      if (hasta) {
        query += ` v.fecha <= $${paramCounter}`;
        params.push(hasta);
        paramCounter++;
      }
      query += `)`;
    }

    query += `
        ), 0) as entregado_periodo,
        COALESCE((
          SELECT SUM(p.cantidad) 
          FROM produccion p 
          WHERE p.ficha_id = f.id
        ), 0) as producido_total,
        COALESCE((
          SELECT SUM(vi.cantidad) 
          FROM venta_items vi 
          WHERE vi.ficha_id = f.id
        ), 0) as entregado_total,
        (
          COALESCE((
            SELECT SUM(p.cantidad)
            FROM produccion p
            WHERE p.ficha_id = f.id
          ), 0)
          -
          COALESCE((
            SELECT SUM(vi.cantidad)
            FROM venta_items vi
            WHERE vi.ficha_id = f.id
          ), 0)
        ) as stock_actual
      FROM ficha_transformador f
      ORDER BY f.modelo
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    console.error('Error generando reporte:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

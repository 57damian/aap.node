const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

/**
 * GET /api/stock-produccion
 * Devuelve el stock de PRODUCTOS TERMINADOS (producción)
 * Query params: con_stock, solo_genericos, cliente_id
 */
router.get('/', authorize(['admin', 'operario', 'control', 'empleado']), async (req, res) => {
  const { con_stock, solo_genericos, cliente_id } = req.query;

  try {
    let query = `SELECT * FROM stock_produccion WHERE 1=1`;
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
    console.error('Error obteniendo stock de producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock-produccion/:ficha_id
 * Devuelve el stock de un producto terminado específico
 */
router.get('/:ficha_id', authorize(['admin', 'operario', 'control', 'empleado']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM stock_produccion WHERE ficha_id = $1',
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
    console.error('Error obteniendo stock de producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stock-produccion/ajuste
 * Registra un ajuste manual de stock de productos terminados
 * Body: { ficha_id, cantidad, tipo_ajuste, motivo, fecha_ajuste (opcional) }
 */
router.post('/ajuste', authorize(['admin', 'control']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { ficha_id, cantidad, tipo_ajuste, motivo, fecha_ajuste } = req.body;

    if (!ficha_id || cantidad === undefined || !tipo_ajuste || !motivo) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    if (!['ENTRADA', 'SALIDA', 'CORRECCION'].includes(tipo_ajuste)) {
      return res.status(400).json({ error: 'Tipo de ajuste inválido' });
    }

    if (cantidad <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser positiva' });
    }

    await client.query('BEGIN');

    // Verificar que la ficha existe
    const fichaCheck = await client.query(
      'SELECT modelo FROM ficha_transformador WHERE id = $1',
      [ficha_id]
    );

    if (fichaCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Modelo no encontrado' });
    }

    // Insertar ajuste
    const ajusteResult = await client.query(
      `INSERT INTO stock_produccion_ajustes 
       (ficha_id, fecha_ajuste, tipo_ajuste, cantidad, motivo, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        ficha_id,
        fecha_ajuste || new Date().toISOString().split('T')[0],
        tipo_ajuste,
        cantidad,
        motivo,
        req.usuario.id
      ]
    );

    // Obtener stock actualizado
    const stockRes = await client.query(
      'SELECT * FROM stock_produccion WHERE ficha_id = $1',
      [ficha_id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      ajuste: ajusteResult.rows[0],
      stock: stockRes.rows[0] || { stock_actual: 0 },
      mensaje: `Ajuste de stock registrado para ${fichaCheck.rows[0].modelo}`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en POST /stock-produccion/ajuste:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/stock-produccion/:ficha_id/ajustes
 * Historial de ajustes de stock para un producto terminado
 */
router.get('/:ficha_id/ajustes', authorize(['admin', 'control', 'empleado']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        spa.*,
        u.nombre_usuario as usuario_nombre,
        ft.modelo
       FROM stock_produccion_ajustes spa
       JOIN ficha_transformador ft ON spa.ficha_id = ft.id
       LEFT JOIN usuarios u ON spa.usuario_id = u.id
       WHERE spa.ficha_id = $1
       ORDER BY spa.fecha_ajuste DESC, spa.id DESC`,
      [req.params.ficha_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo ajustes de stock:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock-produccion/resumen
 * Estadísticas generales de stock de producción
 */
router.get('/resumen', authorize(['admin', 'control', 'empleado']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_modelos,
        SUM(stock_actual) as total_unidades,
        COUNT(CASE WHEN stock_actual > 0 THEN 1 END) as modelos_con_stock,
        COUNT(CASE WHEN stock_actual = 0 THEN 1 END) as modelos_sin_stock,
        COUNT(CASE WHEN cliente_id IS NULL THEN 1 END) as modelos_genericos,
        COUNT(CASE WHEN cliente_id IS NOT NULL THEN 1 END) as modelos_especificos
      FROM stock_produccion
    `);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo resumen de stock de producción:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
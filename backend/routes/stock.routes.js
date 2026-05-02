const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

/**
 * GET /api/stock
 * Devuelve el stock de MATERIAS PRIMAS con filtros (compatible con frontend stock.js)
 * Query params: proveedor_id, estado, search
 * NOTA: Este endpoint es solo para materias primas, no para productos terminados
 */
router.get('/', async (req, res) => {
  try {
    const { proveedor_id, estado, search } = req.query;

    let query = `
      SELECT 
        mp.id as articulo_id,
        mp.codigo,
        mp.nombre,
        p.nombre as proveedor_nombre,
        mp.stock_actual,
        mp.stock_minimo,
        mp.ubicacion,
        mp.unidad_medida,
        (SELECT precio_unitario FROM precios_materia_prima 
         WHERE materia_prima_id = mp.id 
         ORDER BY fecha_desde DESC LIMIT 1) as ultimo_precio,
        (SELECT MAX(c.fecha_compra) 
         FROM compras c 
         JOIN compra_items ci ON c.id = ci.compra_id 
         WHERE ci.materia_prima_id = mp.id) as fecha_ultima_compra
      FROM materias_primas mp
      LEFT JOIN (
        SELECT DISTINCT ON (ci.materia_prima_id) ci.materia_prima_id, p.nombre
        FROM compra_items ci
        JOIN compras c ON ci.compra_id = c.id
        JOIN proveedores p ON c.proveedor_id = p.id
        ORDER BY ci.materia_prima_id, c.fecha_compra DESC
      ) p ON mp.id = p.materia_prima_id
      WHERE mp.activo = true
    `;
    const params = [];
    let paramIndex = 1;

    if (proveedor_id) {
      query += ` AND p.materia_prima_id IN (
        SELECT DISTINCT ci.materia_prima_id 
        FROM compra_items ci 
        JOIN compras c ON ci.compra_id = c.id 
        WHERE c.proveedor_id = $${paramIndex}
      )`;
      params.push(proveedor_id);
      paramIndex++;
    }

    if (estado) {
      if (estado === 'CRITICO') {
        query += ` AND mp.stock_actual = 0`;
      } else if (estado === 'BAJO') {
        query += ` AND mp.stock_actual > 0 AND mp.stock_actual <= mp.stock_minimo`;
      } else if (estado === 'NORMAL') {
        query += ` AND mp.stock_actual > mp.stock_minimo`;
      }
    }

    if (search) {
      query += ` AND (mp.codigo ILIKE $${paramIndex} OR mp.nombre ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY mp.nombre`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /stock:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock/actual
 * Devuelve el stock actual de todas las materias primas activas
 * (equivalente a GET /materias-primas?activo=true pero más simple)
 */
router.get('/actual', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        mp.id, mp.codigo, mp.nombre, mp.unidad_medida,
        mp.stock_actual, mp.stock_minimo, mp.ubicacion,
        (SELECT precio_unitario FROM precios_materia_prima 
         WHERE materia_prima_id = mp.id 
         ORDER BY fecha_desde DESC LIMIT 1) as ultimo_precio
      FROM materias_primas mp
      WHERE mp.activo = true
      ORDER BY mp.nombre
    `);

    const rows = result.rows.map(item => ({
      ...item,
      valor_total: (item.stock_actual || 0) * (item.ultimo_precio || 0),
      estado_stock: item.stock_actual === 0 ? 'CRITICO' :
                    item.stock_actual <= item.stock_minimo ? 'BAJO' : 'NORMAL'
    }));

    res.json(rows);
  } catch (err) {
    console.error('Error en GET /stock/actual:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock/movimientos
 * Lista todos los movimientos con filtros opcionales
 * Query params: materia_prima_id, desde, hasta, tipo
 */
router.get('/movimientos', async (req, res) => {
  try {
    const { materia_prima_id, desde, hasta, tipo } = req.query;

    let query = `
      SELECT 
        sm.*,
        u.nombre_usuario as usuario_nombre,
        ci.compra_id,
        c.numero_comprobante,
        c.fecha_compra,
        p.nombre as proveedor_nombre
      FROM stock_movimientos sm
      LEFT JOIN usuarios u ON sm.usuario_id = u.id
      LEFT JOIN compra_items ci ON sm.compra_item_id = ci.id
      LEFT JOIN compras c ON ci.compra_id = c.id
      LEFT JOIN proveedores p ON c.proveedor_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (materia_prima_id) {
      query += ` AND sm.materia_prima_id = $${paramIndex++}`;
      params.push(materia_prima_id);
    }
    if (desde) {
      query += ` AND sm.fecha_movimiento >= $${paramIndex++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND sm.fecha_movimiento <= $${paramIndex++}`;
      params.push(hasta);
    }
    if (tipo) {
      query += ` AND sm.tipo_movimiento = $${paramIndex++}`;
      params.push(tipo);
    }

    query += ` ORDER BY sm.fecha_movimiento DESC, sm.id DESC LIMIT 1000`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /stock/movimientos:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock/materia-prima/:id/movimientos
 * Historial de movimientos de una materia prima específica
 */
router.get('/materia-prima/:id/movimientos', async (req, res) => {
  try {
    const { id } = req.params;
    const { desde, hasta } = req.query;

    let query = `
      SELECT 
        sm.*,
        u.nombre_usuario as usuario_nombre,
        ci.compra_id,
        c.numero_comprobante,
        c.fecha_compra,
        p.nombre as proveedor_nombre
      FROM stock_movimientos sm
      LEFT JOIN usuarios u ON sm.usuario_id = u.id
      LEFT JOIN compra_items ci ON sm.compra_item_id = ci.id
      LEFT JOIN compras c ON ci.compra_id = c.id
      LEFT JOIN proveedores p ON c.proveedor_id = p.id
      WHERE sm.materia_prima_id = $1
    `;
    const params = [id];
    let paramIndex = 2;

    if (desde) {
      query += ` AND sm.fecha_movimiento >= $${paramIndex++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND sm.fecha_movimiento <= $${paramIndex++}`;
      params.push(hasta);
    }

    query += ` ORDER BY sm.fecha_movimiento DESC, sm.id DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /stock/materia-prima/:id/movimientos:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stock/ajuste
 * Registra un ajuste manual de stock
 * Body: { materia_prima_id, cantidad (relativa), tipo_movimiento, observaciones, fecha_movimiento (opcional) }
 * La cantidad puede ser positiva (entrada) o negativa (salida)
 * Para ajuste directo (nuevo stock), se debe calcular la diferencia en el frontend
 */
router.post('/ajuste', authorize(['admin', 'control']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { materia_prima_id, cantidad, tipo_movimiento, observaciones, fecha_movimiento } = req.body;

    if (!materia_prima_id || cantidad === undefined || !tipo_movimiento) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    await client.query('BEGIN');

    // Obtener stock actual y unidad (con lock)
    const stockRes = await client.query(
      'SELECT stock_actual, unidad_medida FROM materias_primas WHERE id = $1 FOR UPDATE',
      [materia_prima_id]
    );
    if (stockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Materia prima no encontrada' });
    }

    const stockAnterior = parseFloat(stockRes.rows[0].stock_actual);
    const unidad = stockRes.rows[0].unidad_medida || 'UNI';
    const stockNuevo = Math.max(0, stockAnterior + parseFloat(cantidad));

    // Insertar movimiento
    await client.query(`
      INSERT INTO stock_movimientos 
        (materia_prima_id, fecha_movimiento, tipo_movimiento, cantidad, unidad,
         stock_anterior, stock_nuevo, observaciones, usuario_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      materia_prima_id,
      fecha_movimiento || new Date(),
      tipo_movimiento,
      cantidad,
      unidad,
      stockAnterior,
      stockNuevo,
      observaciones,
      req.usuario.id
    ]);

    // Actualizar stock en materias_primas
    await client.query(
      'UPDATE materias_primas SET stock_actual = $1 WHERE id = $2',
      [stockNuevo, materia_prima_id]
    );

    // Opcional: actualizar productos_stock si se usa
    await client.query(`
      INSERT INTO productos_stock (materia_prima_id, proveedor_id, stock_actual)
      VALUES ($1, NULL, $2)
      ON CONFLICT (materia_prima_id, proveedor_id) 
      DO UPDATE SET stock_actual = EXCLUDED.stock_actual
    `, [materia_prima_id, stockNuevo]);

    await client.query('COMMIT');

    res.json({
      ok: true,
      stock_anterior: stockAnterior,
      stock_nuevo: stockNuevo,
      mensaje: 'Ajuste registrado correctamente'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en POST /stock/ajuste:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/stock/resumen
 * Estadísticas generales de stock
 */
router.get('/resumen', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_materiales,
        SUM(stock_actual) as total_unidades,
        SUM(stock_actual * COALESCE((
          SELECT precio_unitario FROM precios_materia_prima 
          WHERE materia_prima_id = mp.id 
          ORDER BY fecha_desde DESC LIMIT 1
        ), 0)) as valor_total_stock,
        COUNT(CASE WHEN stock_actual = 0 THEN 1 END) as materiales_sin_stock,
        COUNT(CASE WHEN stock_actual <= stock_minimo AND stock_actual > 0 THEN 1 END) as materiales_stock_bajo
      FROM materias_primas mp
      WHERE mp.activo = true
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /stock/resumen:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
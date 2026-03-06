const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

// GET /api/stock/movimientos
router.get('/movimientos', verificarToken, async (req, res) => {
  try {
    const { materia_prima_id, desde, hasta, tipo } = req.query;
    let query = `
      SELECT 
        sm.*,
        u.nombre_usuario as usuario_nombre,
        ci.compra_id,
        c.numero_comprobante,
        c.proveedor_id,
        p.nombre as proveedor_nombre,
        fp.id as factura_id,
        fp.numero_factura
      FROM stock_movimientos sm
      LEFT JOIN usuarios u ON sm.usuario_id = u.id
      LEFT JOIN compra_items ci ON sm.compra_item_id = ci.id
      LEFT JOIN compras c ON ci.compra_id = c.id
      LEFT JOIN proveedores p ON c.proveedor_id = p.id
      LEFT JOIN facturas_proveedor fp ON c.id = fp.compra_id
      WHERE 1=1
    `;
    const params = [];

    if (materia_prima_id) {
      query += ` AND sm.materia_prima_id = $${params.length+1}`;
      params.push(materia_prima_id);
    }
    if (desde) {
      query += ` AND sm.fecha_movimiento >= $${params.length+1}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND sm.fecha_movimiento <= $${params.length+1}`;
      params.push(hasta);
    }
    if (tipo) {
      query += ` AND sm.tipo_movimiento = $${params.length+1}`;
      params.push(tipo);
    }

    query += ` ORDER BY sm.fecha_movimiento DESC, sm.id DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stock/materia-prima/:id/movimientos
router.get('/materia-prima/:id/movimientos', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { desde, hasta } = req.query;
    let query = `
      SELECT 
        sm.*,
        u.nombre_usuario as usuario_nombre,
        ci.compra_id,
        c.numero_comprobante,
        c.proveedor_id,
        p.nombre as proveedor_nombre,
        fp.id as factura_id,
        fp.numero_factura
      FROM stock_movimientos sm
      LEFT JOIN usuarios u ON sm.usuario_id = u.id
      LEFT JOIN compra_items ci ON sm.compra_item_id = ci.id
      LEFT JOIN compras c ON ci.compra_id = c.id
      LEFT JOIN proveedores p ON c.proveedor_id = p.id
      LEFT JOIN facturas_proveedor fp ON c.id = fp.compra_id
      WHERE sm.materia_prima_id = $1
    `;
    const params = [id];
    if (desde) {
      query += ` AND sm.fecha_movimiento >= $${params.length+1}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND sm.fecha_movimiento <= $${params.length+1}`;
      params.push(hasta);
    }
    query += ` ORDER BY sm.fecha_movimiento DESC, sm.id DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stock/ajuste
router.post('/ajuste', verificarToken, authorize(['admin', 'control']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { materia_prima_id, tipo, cantidad, motivo, fecha, factura_id } = req.body;

    // Validaciones
    if (!materia_prima_id || !tipo || cantidad === undefined || !motivo) {
      throw new Error('Faltan datos obligatorios');
    }
    if (!['ENTRADA', 'SALIDA', 'AJUSTE'].includes(tipo)) {
      throw new Error('Tipo de movimiento inválido');
    }
    const cant = parseFloat(cantidad);
    if (isNaN(cant) || cant <= 0) {
      throw new Error('Cantidad debe ser un número positivo');
    }

    // Obtener stock actual con lock
    const stockRes = await client.query(
      'SELECT stock_actual FROM materias_primas WHERE id = $1 FOR UPDATE',
      [materia_prima_id]
    );
    if (stockRes.rows.length === 0) {
      throw new Error('Materia prima no encontrada');
    }
    const stockAnterior = parseFloat(stockRes.rows[0].stock_actual);

    let cantidadReal;
    let tipoMovimiento;
    if (tipo === 'ENTRADA') {
      cantidadReal = cant;
      tipoMovimiento = 'ENTRADA';
    } else if (tipo === 'SALIDA') {
      cantidadReal = -cant;
      tipoMovimiento = 'SALIDA';
    } else { // AJUSTE: puede ser positivo o negativo, se usa el signo de cantidad
      cantidadReal = cant; // pero el frontend debería enviar positivo para entrada, negativo para salida
      tipoMovimiento = 'AJUSTE';
    }

    const stockNuevo = stockAnterior + cantidadReal;
    if (stockNuevo < 0) {
      throw new Error('El stock no puede quedar negativo');
    }

    // Insertar movimiento
    const movimientoRes = await client.query(
      `INSERT INTO stock_movimientos 
        (materia_prima_id, fecha_movimiento, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, observaciones, usuario_id, factura_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        materia_prima_id,
        fecha || new Date(),
        tipoMovimiento,
        cantidadReal,
        stockAnterior,
        stockNuevo,
        motivo,
        req.usuario.id,
        factura_id || null
      ]
    );

    // Actualizar stock en materias_primas
    await client.query(
      'UPDATE materias_primas SET stock_actual = $1 WHERE id = $2',
      [stockNuevo, materia_prima_id]
    );

    await client.query('COMMIT');
    res.status(201).json(movimientoRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/stock/resumen
router.get('/resumen', verificarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_materiales,
        SUM(stock_actual * COALESCE((
          SELECT precio_unitario FROM precios_materia_prima 
          WHERE materia_prima_id = mp.id 
          ORDER BY fecha_desde DESC LIMIT 1
        ), 0)) as valor_total_stock,
        COUNT(CASE WHEN stock_actual <= 0 THEN 1 END) as materiales_sin_stock,
        COUNT(CASE WHEN stock_actual > 0 AND stock_actual < stock_minimo THEN 1 END) as materiales_con_stock_bajo
      FROM materias_primas mp
      WHERE activo = true
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
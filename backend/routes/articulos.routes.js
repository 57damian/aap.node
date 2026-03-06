const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

// =====================================================
// ARTÍCULOS PROVEEDOR - CRUD
// =====================================================

/**
 * GET /api/articulos
 * Listar artículos con filtros
 * Query params: proveedor_id, activo, search, con_stock
 */
router.get('/articulos', verificarToken, async (req, res) => {
  try {
    const { proveedor_id, activo = true, search, con_stock } = req.query;
    
    let query = `
      SELECT 
        a.id, a.codigo, a.nombre, a.descripcion, a.unidad_medida,
        a.proveedor_id, p.nombre as proveedor_nombre,
        sa.stock_actual, sa.stock_minimo, sa.ultimo_precio, 
        sa.fecha_ultima_compra, a.activo
      FROM articulos_proveedor a
      LEFT JOIN proveedores p ON a.proveedor_id = p.id
      LEFT JOIN stock_articulos sa ON a.id = sa.articulo_id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (activo !== undefined) {
      query += ` AND a.activo = $${params.length + 1}`;
      params.push(activo === 'true' || activo === true);
    }
    
    if (proveedor_id) {
      query += ` AND a.proveedor_id = $${params.length + 1}`;
      params.push(parseInt(proveedor_id));
    }
    
    if (search) {
      query += ` AND (a.nombre ILIKE $${params.length + 1} OR a.codigo ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    
    if (con_stock === 'true') {
      query += ` AND sa.stock_actual > 0`;
    }
    
    query += ` ORDER BY a.nombre ASC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error listando artículos:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/articulos/:id
 * Obtener artículo por ID
 */
router.get('/articulos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        a.id, a.codigo, a.nombre, a.descripcion, a.unidad_medida,
        a.proveedor_id, p.nombre as proveedor_nombre,
        sa.stock_actual, sa.stock_minimo, sa.ultimo_precio, 
        sa.fecha_ultima_compra, a.activo
      FROM articulos_proveedor a
      LEFT JOIN proveedores p ON a.proveedor_id = p.id
      LEFT JOIN stock_articulos sa ON a.id = sa.articulo_id
      WHERE a.id = $1
    `, [parseInt(id)]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artículo no encontrado' });
    }
    
    res.json(result.rows[0]);
    
  } catch (err) {
    console.error('Error obteniendo artículo:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/articulos
 * Crear nuevo artículo
 */
router.post('/articulos', verificarToken, authorize(['admin', 'control']), async (req, res) => {
  try {
    const { codigo, nombre, descripcion, unidad_medida, proveedor_id, stock_minimo } = req.body;
    
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    
    const result = await pool.query(`
      INSERT INTO articulos_proveedor 
      (codigo, nombre, descripcion, unidad_medida, proveedor_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [codigo || null, nombre, descripcion || null, unidad_medida || 'UNI', 
        proveedor_id || null, req.usuario.id]);
    
    const articuloId = result.rows[0].id;
    
    // Crear registro de stock si hay proveedor
    if (proveedor_id) {
      await pool.query(`
        INSERT INTO stock_articulos 
        (articulo_id, proveedor_id, stock_minimo)
        VALUES ($1, $2, $3)
      `, [articuloId, proveedor_id, stock_minimo || 0]);
    }
    
    res.status(201).json({
      ok: true,
      id: articuloId,
      mensaje: 'Artículo creado exitosamente'
    });
    
  } catch (err) {
    console.error('Error creando artículo:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/articulos/:id
 * Actualizar artículo
 */
router.put('/articulos/:id', verificarToken, authorize(['admin', 'control']), async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo, nombre, descripcion, unidad_medida, stock_minimo } = req.body;
    
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    
    await pool.query(`
      UPDATE articulos_proveedor 
      SET codigo = $1, nombre = $2, descripcion = $3, 
          unidad_medida = $4, updated_at = NOW()
      WHERE id = $5
    `, [codigo || null, nombre, descripcion || null, unidad_medida || 'UNI', parseInt(id)]);
    
    // Actualizar stock mínimo si se proporciona
    if (stock_minimo !== undefined) {
      await pool.query(`
        UPDATE stock_articulos 
        SET stock_minimo = $1
        WHERE articulo_id = $2
      `, [stock_minimo, parseInt(id)]);
    }
    
    res.json({
      ok: true,
      mensaje: 'Artículo actualizado exitosamente'
    });
    
  } catch (err) {
    console.error('Error actualizando artículo:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/articulos/:id
 * Desactivar artículo (soft delete)
 */
router.delete('/articulos/:id', verificarToken, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query(`
      UPDATE articulos_proveedor 
      SET activo = false, updated_at = NOW()
      WHERE id = $1
    `, [parseInt(id)]);
    
    res.json({
      ok: true,
      mensaje: 'Artículo desactivado exitosamente'
    });
    
  } catch (err) {
    console.error('Error desactivando artículo:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/articulos/:id/stock
 * Ver stock actual
 */
router.get('/articulos/:id/stock', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        sa.id, sa.articulo_id, sa.proveedor_id, sa.stock_actual,
        sa.stock_minimo, sa.ubicacion, sa.ultimo_precio, sa.fecha_ultima_compra,
        a.nombre as articulo_nombre, p.nombre as proveedor_nombre
      FROM stock_articulos sa
      JOIN articulos_proveedor a ON sa.articulo_id = a.id
      JOIN proveedores p ON sa.proveedor_id = p.id
      WHERE sa.articulo_id = $1
    `, [parseInt(id)]);
    
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error obteniendo stock:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/articulos/:id/historial-precios
 * Ver historial de precios
 */
router.get('/articulos/:id/historial-precios', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { proveedor_id } = req.query;
    
    let query = `
      SELECT 
        hp.id, hp.precio_anterior, hp.precio_nuevo, hp.variacion_porcentaje,
        hp.fecha_cambio, hp.observacion, hp.factura_id,
        fc.numero_factura, p.nombre as proveedor_nombre
      FROM historial_precios_articulos hp
      LEFT JOIN facturas_compra fc ON hp.factura_id = fc.id
      LEFT JOIN proveedores p ON hp.proveedor_id = p.id
      WHERE hp.articulo_id = $1
    `;
    
    const params = [parseInt(id)];
    
    if (proveedor_id) {
      query += ` AND hp.proveedor_id = $2`;
      params.push(parseInt(proveedor_id));
    }
    
    query += ` ORDER BY hp.fecha_cambio DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error obteniendo historial de precios:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/articulos/:id/historial-stock
 * Ver historial de movimientos de stock
 */
router.get('/articulos/:id/historial-stock', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { proveedor_id } = req.query;
    
    let query = `
      SELECT 
        ms.id, ms.tipo_movimiento, ms.cantidad, ms.stock_anterior,
        ms.stock_nuevo, ms.observacion, ms.created_at,
        fc.numero_factura, u.nombre as usuario_nombre
      FROM movimientos_stock ms
      LEFT JOIN facturas_compra fc ON ms.factura_id = fc.id
      LEFT JOIN usuarios u ON ms.created_by = u.id
      WHERE ms.articulo_id = $1
    `;
    
    const params = [parseInt(id)];
    
    if (proveedor_id) {
      query += ` AND ms.proveedor_id = $2`;
      params.push(parseInt(proveedor_id));
    }
    
    query += ` ORDER BY ms.created_at DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error obteniendo historial de stock:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

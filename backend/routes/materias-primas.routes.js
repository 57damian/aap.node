const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

// Todas las rutas requieren autenticación
router.use(verificarToken);

/**
 * GET /api/materias-primas
 * Lista materias primas con filtros opcionales
 * Query params: search, activo, proveedor_id, con_stock
 */
router.get('/', async (req, res) => {
  try {
    const { search, activo = 'true', proveedor_id, con_stock } = req.query;

    let query = `
      SELECT 
        mp.id, mp.codigo, mp.nombre, mp.descripcion, mp.unidad_medida,
        mp.stock_actual, mp.stock_minimo, mp.ubicacion, mp.activo,
        mp.precio_referencia as ultimo_precio
      FROM materias_primas mp
      WHERE mp.activo = $1
    `;
    const params = [activo === 'true'];
    let paramIndex = 2;

    if (search) {
      query += ` AND (mp.codigo ILIKE $${paramIndex} OR mp.nombre ILIKE $${paramIndex} OR mp.descripcion ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (proveedor_id) {
      // Filtrar materias primas que tengan compras a ese proveedor
      query += ` AND EXISTS (SELECT 1 FROM compra_items ci 
                JOIN compras c ON ci.compra_id = c.id 
                WHERE ci.materia_prima_id = mp.id AND c.proveedor_id = $${paramIndex})`;
      params.push(proveedor_id);
      paramIndex++;
    }

    if (con_stock === 'true') {
      query += ` AND mp.stock_actual > 0`;
    }

    query += ` ORDER BY mp.nombre`;

    const result = await pool.query(query, params);
    
    // Agregar campo calculado valor_total y estado_stock
    const rows = result.rows.map(item => ({
      ...item,
      valor_total: (item.stock_actual || 0) * (item.ultimo_precio || 0),
      estado_stock: item.stock_actual === 0 ? 'CRITICO' :
                    item.stock_actual <= item.stock_minimo ? 'BAJO' : 'NORMAL'
    }));

    res.json(rows);
  } catch (err) {
    console.error('Error en GET /materias-primas:', err);
    res.status(500).json({ error: err.message });
  }
});

  /**
   * GET /api/materias-primas/:id
   * Obtener una materia prima por ID
   */
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`
        SELECT 
          mp.*,
          (SELECT json_agg(hpm ORDER BY hpm.fecha_cambio DESC) 
           FROM historial_precios_materias hpm 
           WHERE hpm.materia_prima_id = mp.id) as historial_precios
        FROM materias_primas mp
        WHERE mp.id = $1
      `, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Materia prima no encontrada' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error en GET /materias-primas/:id:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/materias-primas
   * Crear nueva materia prima
   */
  router.post('/', authorize(['admin', 'control']), async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo, nombre, descripcion, unidad_medida, stock_minimo = 0, ubicacion, precio_referencia } = req.body;

      if (!nombre || !unidad_medida) {
        return res.status(400).json({ error: 'Nombre y unidad de medida son obligatorios' });
      }

      await client.query('BEGIN');

      const result = await client.query(`
        INSERT INTO materias_primas 
          (codigo, nombre, descripcion, unidad_medida, stock_minimo, ubicacion, precio_referencia, activo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        RETURNING *
      `, [codigo || null, nombre, descripcion || null, unidad_medida, stock_minimo, ubicacion || null, precio_referencia || null]);

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error en POST /materias-primas:', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  /**
   * PUT /api/materias-primas/:id
   * Actualizar materia prima
   */
  router.put('/:id', authorize(['admin', 'control']), async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { codigo, nombre, descripcion, unidad_medida, stock_minimo, ubicacion, precio_referencia, activo } = req.body;

      // Verificar que existe
      const check = await client.query('SELECT id FROM materias_primas WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'Materia prima no encontrada' });
      }

      await client.query('BEGIN');

      const result = await client.query(`
        UPDATE materias_primas SET
          codigo = COALESCE($1, codigo),
          nombre = COALESCE($2, nombre),
          descripcion = COALESCE($3, descripcion),
          unidad_medida = COALESCE($4, unidad_medida),
          stock_minimo = COALESCE($5, stock_minimo),
          ubicacion = COALESCE($6, ubicacion),
          precio_referencia = COALESCE($7, precio_referencia),
          activo = COALESCE($8, activo),
          actualizado_en = NOW()
        WHERE id = $9
        RETURNING *
      `, [codigo, nombre, descripcion, unidad_medida, stock_minimo, ubicacion, precio_referencia, activo, id]);

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error en PUT /materias-primas/:id:', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

/**
 * DELETE /api/materias-primas/:id
 * Desactivar materia prima (soft delete)
 */
router.delete('/:id', authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE materias_primas SET activo = false WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Materia prima desactivada' });
  } catch (err) {
    console.error('Error en DELETE /materias-primas/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

  /**
   * GET /api/materias-primas/:id/historial-precios
   * Obtener historial de precios de una materia prima
   */
  router.get('/:id/historial-precios', async (req, res) => {
    try {
      const { id } = req.params;
      
      const result = await pool.query(`
        SELECT 
          hpm.id,
          hpm.precio_nuevo,
          hpm.precio_anterior,
          hpm.variacion_porcentaje,
          hpm.fecha_cambio,
          hpm.observaciones,
          fc.numero_factura as factura_numero,
          p.nombre as proveedor_nombre,
          u.nombre_completo as usuario_nombre
        FROM historial_precios_materias hpm
        LEFT JOIN facturas_compra fc ON hpm.factura_id = fc.id
        LEFT JOIN proveedores p ON hpm.proveedor_id = p.id
        LEFT JOIN usuarios u ON hpm.created_by = u.id
        WHERE hpm.materia_prima_id = $1
        ORDER BY hpm.fecha_cambio DESC, hpm.created_at DESC
      `, [id]);

      res.json(result.rows);
    } catch (err) {
      console.error('Error en GET /materias-primas/:id/historial-precios:', err);
      res.status(500).json({ error: err.message });
    }
  });

module.exports = router;

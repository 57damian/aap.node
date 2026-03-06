const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

// =====================================================
// FACTURAS DE COMPRA - CRUD Y LÓGICA COMPLEJA
// =====================================================

/**
 * GET /api/facturas-compra
 * Listar facturas con filtros
 * Query params: proveedor_id, fecha_desde, fecha_hasta, estado
 */
router.get('/facturas-compra', verificarToken, async (req, res) => {
  try {
    const { proveedor_id, fecha_desde, fecha_hasta, estado } = req.query;
    
    let query = `
      SELECT 
        fc.id, fc.proveedor_id, p.nombre as proveedor_nombre,
        fc.fecha_emision, fc.fecha_recepcion, fc.tipo_factura,
        fc.punto_venta, fc.numero_factura, fc.numero_comprobante,
        fc.subtotal, fc.iva, fc.total, fc.percepciones, fc.retenciones,
        fc.neto_pagado, fc.condicion_pago, fc.estado, fc.created_at
      FROM facturas_compra fc
      JOIN proveedores p ON fc.proveedor_id = p.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (proveedor_id) {
      query += ` AND fc.proveedor_id = $${params.length + 1}`;
      params.push(parseInt(proveedor_id));
    }
    
    if (fecha_desde) {
      query += ` AND fc.fecha_emision >= $${params.length + 1}`;
      params.push(fecha_desde);
    }
    
    if (fecha_hasta) {
      query += ` AND fc.fecha_emision <= $${params.length + 1}`;
      params.push(fecha_hasta);
    }
    
    if (estado) {
      query += ` AND fc.estado = $${params.length + 1}`;
      params.push(estado);
    }
    
    query += ` ORDER BY fc.fecha_emision DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error listando facturas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/facturas-compra/:id
 * Obtener factura completa con items
 */
router.get('/facturas-compra/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener factura
    const facturaResult = await pool.query(`
      SELECT 
        fc.id, fc.proveedor_id, p.nombre as proveedor_nombre,
        fc.fecha_emision, fc.fecha_recepcion, fc.tipo_factura,
        fc.punto_venta, fc.numero_factura, fc.numero_comprobante,
        fc.subtotal, fc.iva, fc.total, fc.percepciones, fc.retenciones,
        fc.neto_pagado, fc.condicion_pago, fc.observaciones, fc.estado,
        fc.created_at, u.nombre as creado_por
      FROM facturas_compra fc
      JOIN proveedores p ON fc.proveedor_id = p.id
      LEFT JOIN usuarios u ON fc.created_by = u.id
      WHERE fc.id = $1
    `, [parseInt(id)]);
    
    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    
    const factura = facturaResult.rows[0];
    
    // Obtener items
    const itemsResult = await pool.query(`
      SELECT 
        fi.id, fi.articulo_id, a.nombre as articulo_nombre,
        fi.descripcion, fi.cantidad, fi.precio_unitario,
        fi.iva_porcentaje, fi.subtotal, fi.iva, fi.total
      FROM factura_items fi
      LEFT JOIN articulos_proveedor a ON fi.articulo_id = a.id
      WHERE fi.factura_id = $1
      ORDER BY fi.id
    `, [parseInt(id)]);
    
    factura.items = itemsResult.rows;
    
    res.json(factura);
    
  } catch (err) {
    console.error('Error obteniendo factura:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/facturas-compra
 * Registrar nueva factura con toda la lógica
 */
router.post('/facturas-compra', verificarToken, authorize(['admin', 'control']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const facturaData = req.body;
    
    // 1. Validar datos obligatorios
    if (!facturaData.proveedor_id || !facturaData.fecha_emision || !facturaData.numero_factura) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    
    // 2. Validar factura duplicada
    const duplicada = await client.query(
      `SELECT id FROM facturas_compra 
       WHERE proveedor_id = $1 AND tipo_factura = $2 
         AND punto_venta = $3 AND numero_factura = $4`,
      [facturaData.proveedor_id, facturaData.tipo_factura, 
       facturaData.punto_venta, facturaData.numero_factura]
    );
    
    if (duplicada.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Factura ya registrada' });
    }
    
    // 3. Insertar factura
    const facturaResult = await client.query(
      `INSERT INTO facturas_compra 
       (proveedor_id, fecha_emision, fecha_recepcion, tipo_factura, 
        punto_venta, numero_factura, numero_comprobante, subtotal, iva,
        percepciones, retenciones, total, neto_pagado, condicion_pago, 
        observaciones, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [facturaData.proveedor_id, facturaData.fecha_emision, 
       facturaData.fecha_recepcion || null, facturaData.tipo_factura,
       facturaData.punto_venta || null, facturaData.numero_factura,
       facturaData.numero_comprobante || null, facturaData.subtotal,
       facturaData.iva, facturaData.percepciones || 0, 
       facturaData.retenciones || 0, facturaData.total,
       facturaData.neto_pagado || facturaData.total,
       facturaData.condicion_pago || 'CONTADO', 
       facturaData.observaciones || null, req.usuario.id]
    );
    
    const facturaId = facturaResult.rows[0].id;
    const variacionesRegistradas = [];
    
    // 4. Procesar items
    for (const item of facturaData.items) {
      // Insertar item
      await client.query(
        `INSERT INTO factura_items
         (factura_id, articulo_id, descripcion, cantidad, precio_unitario,
          iva_porcentaje, subtotal, iva, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [facturaId, item.articulo_id, item.descripcion || null, item.cantidad,
         item.precio_unitario, item.iva_porcentaje || 21, item.subtotal,
         item.iva || 0, item.total]
      );
      
      // 5. Actualizar stock
      const stockResult = await client.query(
        `SELECT stock_actual FROM stock_articulos 
         WHERE articulo_id = $1 AND proveedor_id = $2`,
        [item.articulo_id, facturaData.proveedor_id]
      );
      
      const stockAnterior = stockResult.rows[0]?.stock_actual || 0;
      const stockNuevo = parseFloat(stockAnterior) + parseFloat(item.cantidad);
      
      await client.query(
        `INSERT INTO stock_articulos (articulo_id, proveedor_id, stock_actual, ultimo_precio, fecha_ultima_compra)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (articulo_id, proveedor_id) 
         DO UPDATE SET 
            stock_actual = $3,
            ultimo_precio = $4,
            fecha_ultima_compra = $5,
            updated_at = NOW()`,
        [item.articulo_id, facturaData.proveedor_id, stockNuevo,
         item.precio_unitario, facturaData.fecha_emision]
      );
      
      // 6. Registrar movimiento de stock
      await client.query(
        `INSERT INTO movimientos_stock
         (articulo_id, proveedor_id, tipo_movimiento, cantidad,
          stock_anterior, stock_nuevo, factura_id, created_by)
         VALUES ($1, $2, 'ENTRADA', $3, $4, $5, $6, $7)`,
        [item.articulo_id, facturaData.proveedor_id, item.cantidad,
         stockAnterior, stockNuevo, facturaId, req.usuario.id]
      );
      
      // 7. Verificar variación de precio
      const ultimoPrecioResult = await client.query(
        `SELECT precio_nuevo FROM historial_precios_articulos
         WHERE articulo_id = $1 AND proveedor_id = $2
         ORDER BY fecha_cambio DESC LIMIT 1`,
        [item.articulo_id, facturaData.proveedor_id]
      );
      
      const precioAnterior = ultimoPrecioResult.rows[0]?.precio_nuevo || 0;
      
      // Si hay variación de precio
      if (precioAnterior !== 0 && precioAnterior !== item.precio_unitario) {
        const variacion = ((item.precio_unitario - precioAnterior) / precioAnterior * 100).toFixed(2);
        
        // Verificar si este artículo está en la lista de precios a actualizar
        const actualizar = facturaData.actualizar_precios?.find(
          p => p.articulo_id === item.articulo_id
        );
        
        // Guardar en historial si se debe actualizar
        if (actualizar) {
          await client.query(
            `INSERT INTO historial_precios_articulos
             (articulo_id, proveedor_id, precio_anterior, precio_nuevo,
              variacion_porcentaje, factura_id, fecha_cambio, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [item.articulo_id, facturaData.proveedor_id, precioAnterior,
             item.precio_unitario, variacion, facturaId,
             facturaData.fecha_emision, req.usuario.id]
          );
          
          variacionesRegistradas.push({
            articulo_id: item.articulo_id,
            precio_anterior: precioAnterior,
            precio_nuevo: item.precio_unitario,
            variacion: parseFloat(variacion)
          });
        }
      } else if (precioAnterior === 0) {
        // Primera compra del artículo, registrar precio inicial
        await client.query(
          `INSERT INTO historial_precios_articulos
           (articulo_id, proveedor_id, precio_anterior, precio_nuevo,
            variacion_porcentaje, factura_id, fecha_cambio, created_by)
           VALUES ($1, $2, NULL, $3, 0, $4, $5, $6)`,
          [item.articulo_id, facturaData.proveedor_id, item.precio_unitario,
           facturaId, facturaData.fecha_emision, req.usuario.id]
        );
      }
    }
    
    // 8. Actualizar totales en proveedor
    await client.query(
      `UPDATE proveedores SET 
          total_compras = COALESCE(total_compras, 0) + $1,
          ultima_compra = $2,
          updated_at = NOW()
       WHERE id = $3`,
      [facturaData.total, facturaData.fecha_emision, facturaData.proveedor_id]
    );
    
    await client.query('COMMIT');
    
    res.status(201).json({
      ok: true,
      factura_id: facturaId,
      variaciones_registradas: variacionesRegistradas,
      mensaje: variacionesRegistradas.length > 0 
        ? `Factura registrada con ${variacionesRegistradas.length} variaciones de precio`
        : 'Factura registrada correctamente'
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error registrando factura:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/facturas-compra/:id
 * Actualizar factura (solo si está PENDIENTE)
 */
router.put('/facturas-compra/:id', verificarToken, authorize(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { observaciones, condicion_pago } = req.body;
    
    // Verificar que esté PENDIENTE
    const facturaResult = await pool.query(
      `SELECT estado FROM facturas_compra WHERE id = $1`,
      [parseInt(id)]
    );
    
    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    
    if (facturaResult.rows[0].estado !== 'PENDIENTE') {
      return res.status(400).json({ error: 'Solo se pueden editar facturas PENDIENTE' });
    }
    
    await pool.query(
      `UPDATE facturas_compra 
       SET observaciones = $1, condicion_pago = $2, updated_at = NOW()
       WHERE id = $3`,
      [observaciones || null, condicion_pago || null, parseInt(id)]
    );
    
    res.json({
      ok: true,
      mensaje: 'Factura actualizada exitosamente'
    });
    
  } catch (err) {
    console.error('Error actualizando factura:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/facturas-compra/:id
 * Anular factura
 */
router.delete('/facturas-compra/:id', verificarToken, authorize(['admin']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Verificar que esté PENDIENTE
    const facturaResult = await client.query(
      `SELECT estado, proveedor_id, total FROM facturas_compra WHERE id = $1`,
      [parseInt(id)]
    );
    
    if (facturaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    
    if (facturaResult.rows[0].estado !== 'PENDIENTE') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se pueden anular facturas PENDIENTE' });
    }
    
    const factura = facturaResult.rows[0];
    
    // Obtener items para revertir stock
    const itemsResult = await client.query(
      `SELECT articulo_id, cantidad FROM factura_items WHERE factura_id = $1`,
      [parseInt(id)]
    );
    
    // Revertir stock
    for (const item of itemsResult.rows) {
      const stockResult = await client.query(
        `SELECT stock_actual FROM stock_articulos 
         WHERE articulo_id = $1 AND proveedor_id = $2`,
        [item.articulo_id, factura.proveedor_id]
      );
      
      const stockAnterior = stockResult.rows[0]?.stock_actual || 0;
      const stockNuevo = Math.max(0, parseFloat(stockAnterior) - parseFloat(item.cantidad));
      
      await client.query(
        `UPDATE stock_articulos 
         SET stock_actual = $1, updated_at = NOW()
         WHERE articulo_id = $2 AND proveedor_id = $3`,
        [stockNuevo, item.articulo_id, factura.proveedor_id]
      );
      
      // Registrar movimiento de anulación
      await client.query(
        `INSERT INTO movimientos_stock
         (articulo_id, proveedor_id, tipo_movimiento, cantidad,
          stock_anterior, stock_nuevo, factura_id, observacion, created_by)
         VALUES ($1, $2, 'AJUSTE', $3, $4, $5, $6, 'Anulación de factura', $7)`,
        [item.articulo_id, factura.proveedor_id, -item.cantidad,
         stockAnterior, stockNuevo, parseInt(id), req.usuario.id]
      );
    }
    
    // Marcar factura como ANULADA
    await client.query(
      `UPDATE facturas_compra 
       SET estado = 'ANULADA', updated_at = NOW()
       WHERE id = $1`,
      [parseInt(id)]
    );
    
    // Revertir total en proveedor
    await client.query(
      `UPDATE proveedores 
       SET total_compras = COALESCE(total_compras, 0) - $1,
           updated_at = NOW()
       WHERE id = $2`,
      [factura.total, factura.proveedor_id]
    );
    
    await client.query('COMMIT');
    
    res.json({
      ok: true,
      mensaje: 'Factura anulada exitosamente'
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error anulando factura:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/facturas-compra/:id/pagar
 * Registrar pago de factura
 */
router.post('/facturas-compra/:id/pagar', verificarToken, authorize(['admin', 'control']), async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query(
      `UPDATE facturas_compra 
       SET estado = 'PAGADA', updated_at = NOW()
       WHERE id = $1`,
      [parseInt(id)]
    );
    
    res.json({
      ok: true,
      mensaje: 'Factura marcada como pagada'
    });
    
  } catch (err) {
    console.error('Error pagando factura:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/facturas-compra/:id/variaciones
 * Obtener variaciones de precio de la factura
 */
router.get('/facturas-compra/:id/variaciones', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        hp.id, hp.articulo_id, a.nombre as articulo_nombre,
        hp.precio_anterior, hp.precio_nuevo, hp.variacion_porcentaje,
        hp.fecha_cambio
      FROM historial_precios_articulos hp
      JOIN articulos_proveedor a ON hp.articulo_id = a.id
      WHERE hp.factura_id = $1
      ORDER BY hp.variacion_porcentaje DESC
    `, [parseInt(id)]);
    
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error obteniendo variaciones:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

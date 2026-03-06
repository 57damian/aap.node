const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

// =============================
// RESUMEN FINANCIERO DE PROVEEDOR
// GET /api/proveedores/:id/resumen
// =============================
router.get('/:id/resumen', authorize(['admin', 'control', 'operario']), async (req, res) => {
  try {
    const proveedorId = req.params.id;
    
    // Obtener datos básicos del proveedor
    const proveedor = await pool.query(
      'SELECT * FROM proveedores WHERE id = $1',
      [proveedorId]
    );
    
    if (proveedor.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    
    // Estadísticas de compras
    const statsCompras = await pool.query(`
      SELECT 
        COUNT(*) as total_compras,
        COALESCE(SUM(total), 0) as total_compras_monto,
        COALESCE(AVG(total), 0) as promedio_compra,
        MAX(fecha_compra) as ultima_compra
      FROM compras 
      WHERE proveedor_id = $1
    `, [proveedorId]);
    
    // Deuda actual
    const deuda = await pool.query(`
      SELECT 
        COALESCE(SUM(saldo_pendiente), 0) as deuda_actual,
        COUNT(*) as facturas_pendientes
      FROM facturas_proveedor 
      WHERE proveedor_id = $1 AND estado = 'PENDIENTE'
    `, [proveedorId]);
    
    // Pagos realizados
    const pagos = await pool.query(`
      SELECT 
        COALESCE(SUM(monto), 0) as total_pagado,
        COUNT(*) as total_pagos
      FROM pagos_proveedores 
      WHERE proveedor_id = $1
    `, [proveedorId]);
    
    // Stock por producto
    const stockProductos = await pool.query(`
      SELECT 
        mp.nombre as producto,
        ps.stock_actual,
        ps.stock_minimo,
        ps.ultimo_precio,
        ps.fecha_ultima_actualizacion
      FROM productos_stock ps
      JOIN materias_primas mp ON ps.materia_prima_id = mp.id
      WHERE ps.proveedor_id = $1 AND ps.stock_actual > 0
      ORDER BY ps.stock_actual DESC
    `, [proveedorId]);
    
    // Compras últimos 6 meses
    const comprasMeses = await pool.query(`
      SELECT 
        TO_CHAR(fecha_compra, 'YYYY-MM') as mes,
        COUNT(*) as cantidad,
        COALESCE(SUM(total), 0) as monto
      FROM compras 
      WHERE proveedor_id = $1 
        AND fecha_compra >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY TO_CHAR(fecha_compra, 'YYYY-MM')
      ORDER BY mes
    `, [proveedorId]);
    
    res.json({
      proveedor: proveedor.rows[0],
      estadisticas: {
        ...statsCompras.rows[0],
        ...deuda.rows[0],
        ...pagos.rows[0]
      },
      stock_productos: stockProductos.rows,
      compras_ultimos_6_meses: comprasMeses.rows
    });
    
  } catch (err) {
    console.error('Error obteniendo resumen de proveedor:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// CUENTA CORRIENTE DE PROVEEDOR
// GET /api/proveedores/:id/cuenta-corriente
// =============================
router.get('/:id/cuenta-corriente', authorize(['admin', 'control', 'operario']), async (req, res) => {
  try {
    const proveedorId = req.params.id;
    
    // Facturas pendientes
    const facturasPendientes = await pool.query(`
      SELECT 
        fp.*,
        DATEDIFF('day', CURRENT_DATE, fp.fecha_vto) as dias_vencimiento
      FROM facturas_proveedor fp
      WHERE fp.proveedor_id = $1 AND fp.estado = 'PENDIENTE'
      ORDER BY fp.fecha_vto ASC
    `, [proveedorId]);
    
    // Pagos recientes
    const pagosRecientes = await pool.query(`
      SELECT 
        pp.*,
        u.usuario as nombre_usuario
      FROM pagos_proveedores pp
      LEFT JOIN usuarios u ON pp.created_by = u.id
      WHERE pp.proveedor_id = $1
      ORDER BY pp.fecha_pago DESC
      LIMIT 20
    `, [proveedorId]);
    
    // Resumen por vencimiento
    const resumenVencimiento = await pool.query(`
      SELECT 
        CASE 
          WHEN DATEDIFF('day', CURRENT_DATE, fp.fecha_vto) < 0 THEN 'VENCIDO'
          WHEN DATEDIFF('day', CURRENT_DATE, fp.fecha_vto) <= 30 THEN '0-30 dias'
          WHEN DATEDIFF('day', CURRENT_DATE, fp.fecha_vto) <= 60 THEN '31-60 dias'
          ELSE '60+ dias'
        END as rango,
        COUNT(*) as cantidad,
        COALESCE(SUM(fp.saldo_pendiente), 0) as monto
      FROM facturas_proveedor fp
      WHERE fp.proveedor_id = $1 AND fp.estado = 'PENDIENTE'
      GROUP BY rango
      ORDER BY 
        CASE rango
          WHEN 'VENCIDO' THEN 1
          WHEN '0-30 dias' THEN 2
          WHEN '31-60 dias' THEN 3
          ELSE 4
        END
    `, [proveedorId]);
    
    res.json({
      facturas_pendientes: facturasPendientes.rows,
      pagos_recientes: pagosRecientes.rows,
      resumen_vencimiento: resumenVencimiento.rows
    });
    
  } catch (err) {
    console.error('Error obteniendo cuenta corriente:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// STOCK ACUMULADO POR PROVEEDOR
// GET /api/proveedores/:id/productos/stock
// =============================
router.get('/:id/productos/stock', authorize(['admin', 'control', 'operario']), async (req, res) => {
  try {
    const proveedorId = req.params.id;
    
    const stock = await pool.query(`
      SELECT 
        ps.*,
        mp.nombre as materia_prima,
        mp.codigo,
        mp.unidad_medida,
        mp.descripcion,
        CASE 
          WHEN ps.stock_actual <= ps.stock_minimo THEN 'CRITICO'
          WHEN ps.stock_actual <= (ps.stock_minimo * 1.5) THEN 'BAJO'
          ELSE 'NORMAL'
        END as estado_stock
      FROM productos_stock ps
      JOIN materias_primas mp ON ps.materia_prima_id = mp.id
      WHERE ps.proveedor_id = $1
      ORDER BY 
        CASE 
          WHEN ps.stock_actual <= ps.stock_minimo THEN 1
          ELSE 2
        END,
        ps.stock_actual DESC
    `, [proveedorId]);
    
    // Resumen de stock
    const resumen = await pool.query(`
      SELECT 
        COUNT(*) as total_productos,
        COUNT(CASE WHEN stock_actual <= stock_minimo THEN 1 END) as productos_criticos,
        COUNT(CASE WHEN stock_actual > stock_minimo THEN 1 END) as productos_normales,
        COALESCE(SUM(stock_actual), 0) as total_unidades,
        COALESCE(SUM(stock_actual * ultimo_precio), 0) as valor_total_stock
      FROM productos_stock 
      WHERE proveedor_id = $1
    `, [proveedorId]);
    
    res.json({
      productos: stock.rows,
      resumen: resumen.rows[0]
    });
    
  } catch (err) {
    console.error('Error obteniendo stock de productos:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// REPORTES DE PROVEEDOR
// GET /api/proveedores/:id/reportes
// =============================
router.get('/:id/reportes', authorize(['admin', 'control']), async (req, res) => {
  try {
    const proveedorId = req.params.id;
    const { tipo, fecha_desde, fecha_hasta } = req.query;
    
    let query = '';
    let params = [proveedorId];
    
    switch (tipo) {
      case 'compras':
        query = `
          SELECT 
            c.*,
            COUNT(ci.id) as total_items
          FROM compras c
          LEFT JOIN compra_items ci ON c.id = ci.compra_id
          WHERE c.proveedor_id = $1
            ${fecha_desde ? 'AND c.fecha_compra >= $' + (params.length + 1) : ''}
            ${fecha_hasta ? 'AND c.fecha_compra <= $' + (params.length + 1) : ''}
          GROUP BY c.id
          ORDER BY c.fecha_compra DESC
        `;
        if (fecha_desde) params.push(fecha_desde);
        if (fecha_hasta) params.push(fecha_hasta);
        break;
        
      case 'deudas':
        query = `
          SELECT 
            fp.*,
            DATEDIFF('day', CURRENT_DATE, fp.fecha_vto) as dias_vencimiento
          FROM facturas_proveedor fp
          WHERE fp.proveedor_id = $1 AND fp.estado = 'PENDIENTE'
          ORDER BY fp.fecha_vto ASC
        `;
        break;
        
      case 'productos':
        query = `
          SELECT 
            mp.nombre as producto,
            mp.codigo,
            mp.unidad_medida,
            ps.stock_actual,
            ps.ultimo_precio,
            ps.fecha_ultima_actualizacion,
            COUNT(ci.id) as total_compras,
            COALESCE(SUM(ci.cantidad), 0) as total_comprado
          FROM materias_primas mp
          LEFT JOIN productos_stock ps ON mp.id = ps.materia_prima_id AND ps.proveedor_id = $1
          LEFT JOIN compra_items ci ON mp.id = ci.materia_prima_id
          LEFT JOIN compras c ON ci.compra_id = c.id AND c.proveedor_id = $1
          GROUP BY mp.id, ps.id
          ORDER BY mp.nombre
        `;
        break;
        
      default:
        return res.status(400).json({ error: 'Tipo de reporte no válido' });
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      tipo_reporte: tipo,
      datos: result.rows,
      parametros: { proveedor_id: proveedorId, fecha_desde, fecha_hasta }
    });
    
  } catch (err) {
    console.error('Error generando reporte de proveedor:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// ACTUALIZAR PROVEEDOR CON CAMPOS NUEVOS
// PUT /api/proveedores/:id
// =============================
router.put('/:id', authorize(['admin', 'control']), async (req, res) => {
  try {
    const proveedorId = req.params.id;
    const {
      nombre, cuit, direccion, telefono, email, contacto,
      condicion_iva, observaciones, activo, dias_credito, forma_pago_habitual
    } = req.body;
    
    // Verificar si existe
    const existe = await pool.query('SELECT id FROM proveedores WHERE id = $1', [proveedorId]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    
    // Si cambia el CUIT, verificar que no esté duplicado
    if (cuit) {
      const duplicado = await pool.query(
        'SELECT id FROM proveedores WHERE cuit = $1 AND id != $2',
        [cuit, proveedorId]
      );
      if (duplicado.rows.length > 0) {
        return res.status(400).json({ error: 'El CUIT ya está en uso por otro proveedor' });
      }
    }
    
    const result = await pool.query(`
      UPDATE proveedores SET
        nombre = COALESCE($1, nombre),
        cuit = COALESCE($2, cuit),
        direccion = COALESCE($3, direccion),
        telefono = COALESCE($4, telefono),
        email = COALESCE($5, email),
        contacto = COALESCE($6, contacto),
        condicion_iva = COALESCE($7, condicion_iva),
        observaciones = COALESCE($8, observaciones),
        activo = COALESCE($9, activo),
        dias_credito = COALESCE($10, dias_credito),
        forma_pago_habitual = COALESCE($11, forma_pago_habitual),
        updated_at = NOW()
      WHERE id = $12
      RETURNING *
    `, [nombre, cuit, direccion, telefono, email, contacto, condicion_iva, observaciones, activo, dias_credito, forma_pago_habitual, proveedorId]);
    
    res.json({
      ok: true,
      proveedor: result.rows[0]
    });
    
  } catch (err) {
    console.error('Error actualizando proveedor:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

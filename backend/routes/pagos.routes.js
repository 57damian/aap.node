const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

// Aplicar middleware de autenticación a todas las rutas
router.use(verificarToken);

// Obtener pagos a proveedores
router.get('/', async (req, res) => {
  try {
    console.log('GET /api/pagos-proveedores - Query params:', req.query);
    const { proveedor_id, fecha_desde, fecha_hasta, estado, forma_pago, search } = req.query;
    
    let query = `
      SELECT p.*, pr.nombre as proveedor_nombre
      FROM pagos_proveedores p
      LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
      WHERE 1=1
    `;
    const params = [];
    
    if (proveedor_id) {
      query += ` AND p.proveedor_id = $${params.length + 1}`;
      params.push(proveedor_id);
    }
    
    if (fecha_desde) {
      query += ` AND p.fecha >= $${params.length + 1}`;
      params.push(fecha_desde);
    }
    
    if (fecha_hasta) {
      query += ` AND p.fecha <= $${params.length + 1}`;
      params.push(fecha_hasta);
    }
    
    if (estado) {
      query += ` AND p.estado = $${params.length + 1}`;
      params.push(estado);
    }
    
    if (forma_pago) {
      query += ` AND p.forma_pago = $${params.length + 1}`;
      params.push(forma_pago);
    }
    
    if (search) {
      query += ` AND (pr.nombre ILIKE $${params.length + 1} OR p.referencia ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    
    query += ` ORDER BY p.fecha DESC, p.id DESC`;
    
    console.log('Query:', query);
    console.log('Params:', params);
    
    const result = await pool.query(query, params);
    console.log('Result rows:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo pagos:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Crear nuevo pago a proveedor
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const {
      proveedor_id,
      fecha_pago,
      metodo_pago,
      numero_comprobante,
      monto_total,
      observaciones,
      items
    } = req.body;
    
    // Insertar pago
    const pagoResult = await client.query(
      `INSERT INTO pagos_proveedores 
       (proveedor_id, fecha, forma_pago, referencia, monto, observaciones, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendiente')
       RETURNING *`,
      [proveedor_id, fecha_pago, metodo_pago, numero_comprobante, monto_total, observaciones]
    );
    
    const pagoId = pagoResult.rows[0].id;
    
    // Insertar items del pago
    if (items && items.length > 0) {
      for (const item of items) {
        await client.query(
          `INSERT INTO pagos_proveedores_items 
           (pago_id, factura_compra_id, monto_aplicado)
           VALUES ($1, $2, $3)`,
          [pagoId, item.factura_compra_id, item.monto_aplicado]
        );
        
        // Actualizar saldo de la factura
        await client.query(
          `UPDATE facturas_compra 
           SET saldo_pendiente = saldo_pendiente - $1
           WHERE id = $2`,
          [item.monto_aplicado, item.factura_compra_id]
        );
      }
    }
    
    // Actualizar estado del pago
    await client.query(
      `UPDATE pagos_proveedores SET estado = 'aplicado' WHERE id = $1`,
      [pagoId]
    );
    
    await client.query('COMMIT');
    
    const pagoCompleto = await client.query(
      `SELECT p.*, pr.nombre as proveedor_nombre
       FROM pagos_proveedores p
       LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
       WHERE p.id = $1`,
      [pagoId]
    );
    
    res.status(201).json(pagoCompleto.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creando pago:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// ============================================
// RUTAS PARA CHEQUES DE PROVEEDORES
// ============================================

// Obtener cheques emitidos a proveedores
router.get('/cheques', async (req, res) => {
  try {
    const { proveedor_id, estado, desde, hasta } = req.query;
    
    let query = `
      SELECT 
        pi.id,
        pi.cheque_numero,
        pi.cheque_banco,
        pi.monto,
        pi.cheque_fecha_emision,
        pi.cheque_fecha_cobro,
        pi.cheque_fecha_depositado,
        pi.cheque_estado,
        pi.cheque_gasto_comision,
        pi.cheque_motivo_rechazo,
        p.proveedor_id,
        pr.nombre as proveedor_nombre,
        p.fecha as fecha_pago
      FROM pago_items pi
      JOIN pagos_proveedores p ON pi.pago_id = p.id
      JOIN proveedores pr ON p.proveedor_id = pr.id
      WHERE pi.tipo = 'CHEQUE'
    `;
    
    const params = [];
    
    if (proveedor_id) {
      query += ` AND p.proveedor_id = $${params.length + 1}`;
      params.push(proveedor_id);
    }
    
    if (estado) {
      query += ` AND pi.cheque_estado = $${params.length + 1}`;
      params.push(estado);
    }
    
    if (desde) {
      query += ` AND pi.cheque_fecha_cobro >= $${params.length + 1}`;
      params.push(desde);
    }
    
    if (hasta) {
      query += ` AND pi.cheque_fecha_cobro <= $${params.length + 1}`;
      params.push(hasta);
    }
    
    query += ` ORDER BY pi.cheque_fecha_cobro ASC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo cheques:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Obtener cheque específico
router.get('/cheques/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        pi.id,
        pi.cheque_numero,
        pi.cheque_banco,
        pi.monto,
        pi.cheque_fecha_emision,
        pi.cheque_fecha_cobro,
        pi.cheque_fecha_depositado,
        pi.cheque_estado,
        pi.cheque_gasto_comision,
        pi.cheque_motivo_rechazo,
        p.proveedor_id,
        pr.nombre as proveedor_nombre,
        p.fecha as fecha_pago,
        p.id as pago_id
      FROM pago_items pi
      JOIN pagos_proveedores p ON pi.pago_id = p.id
      JOIN proveedores pr ON p.proveedor_id = pr.id
      WHERE pi.id = $1 AND pi.tipo = 'CHEQUE'
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cheque no encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo cheque:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Alertas de cheques próximos a vencer
router.get('/cheques/alertas', async (req, res) => {
  try {
    const { dias = 3 } = req.query;
    const diasNum = Number(dias);
    
    const result = await pool.query(`
      SELECT 
        pi.id,
        pi.cheque_numero,
        pi.cheque_banco,
        pi.monto,
        pi.cheque_fecha_cobro,
        p.proveedor_id,
        pr.nombre as proveedor_nombre,
        EXTRACT(DAY FROM pi.cheque_fecha_cobro - CURRENT_DATE) as dias_restantes
      FROM pago_items pi
      JOIN pagos_proveedores p ON pi.pago_id = p.id
      JOIN proveedores pr ON p.proveedor_id = pr.id
      WHERE pi.tipo = 'CHEQUE'
        AND pi.cheque_estado = 'pendiente'
        AND pi.cheque_fecha_cobro BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 * INTERVAL '1 day')
      ORDER BY pi.cheque_fecha_cobro ASC
    `, [diasNum]);
    
    res.json({
      total: result.rows.length,
      cheques: result.rows,
      dias_alertas: diasNum
    });
  } catch (error) {
    console.error('Error obteniendo alertas de cheques:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Depositar cheque
router.post('/cheques/:id/depositar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { fecha_depositado } = req.body;
    
    const result = await client.query(`
      UPDATE pago_items 
      SET cheque_fecha_depositado = $1, cheque_estado = 'depositado'
      WHERE id = $2 AND tipo = 'CHEQUE'
      RETURNING *
    `, [fecha_depositado || new Date().toISOString().split('T')[0], id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cheque no encontrado' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Cheque depositado correctamente', cheque: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error depositando cheque:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// Rechazar cheque
router.post('/cheques/:id/rechazar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { motivo_rechazo, gasto_comision = 0, nuevo_cheque } = req.body;
    
    // Actualizar cheque rechazado
    const result = await client.query(`
      UPDATE pago_items 
      SET cheque_estado = 'rechazado', 
          cheque_motivo_rechazo = $1,
          cheque_gasto_comision = $2
      WHERE id = $3 AND tipo = 'CHEQUE'
      RETURNING *
    `, [motivo_rechazo, gasto_comision, id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cheque no encontrado' });
    }
    
    // Si hay cheque de reemplazo, crearlo
    if (nuevo_cheque) {
      const { pago_id, numero_cheque, banco, fecha_emision, fecha_cobro, monto, observaciones } = nuevo_cheque;
      
      await client.query(`
        INSERT INTO pago_items 
        (pago_id, tipo, monto, cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro, observaciones, cheque_estado)
        VALUES ($1, 'CHEQUE', $2, $3, $4, $5, $6, $7, 'pendiente')
      `, [pago_id, monto, numero_cheque, banco, fecha_emision, fecha_cobro, observaciones]);
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Cheque rechazado correctamente', cheque: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error rechazando cheque:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// Acreditar cheque depositado
router.put('/cheques/:id/acreditar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    const result = await client.query(`
      UPDATE pago_items 
      SET cheque_estado = 'acreditado'
      WHERE id = $1 AND tipo = 'CHEQUE' AND cheque_estado = 'depositado'
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cheque no encontrado o no está depositado' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Cheque acreditado correctamente', cheque: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error acreditando cheque:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// ============================================
// RUTAS BÁSICAS DE PAGOS (DESPUÉS DE RUTAS ESPECÍFICAS)
// ============================================

// Obtener pago por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const pagoResult = await pool.query(
      `SELECT p.*, pr.nombre as proveedor_nombre
       FROM pagos_proveedores p
       LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
       WHERE p.id = $1`,
      [id]
    );
    
    if (pagoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    const itemsResult = await pool.query(
      `SELECT pi.*, fc.numero_factura, fc.fecha_factura, fc.total
       FROM pagos_proveedores_items pi
       LEFT JOIN facturas_compra fc ON pi.factura_compra_id = fc.id
       WHERE pi.pago_id = $1`,
      [id]
    );
    
    const pago = pagoResult.rows[0];
    pago.items = itemsResult.rows;
    
    res.json(pago);
  } catch (error) {
    console.error('Error obteniendo pago:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Actualizar pago
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const {
      fecha_pago,
      metodo_pago,
      numero_comprobante,
      observaciones
    } = req.body;
    
    const result = await client.query(
      `UPDATE pagos_proveedores 
       SET fecha = $1, forma_pago = $2, referencia = $3, observaciones = $4
       WHERE id = $5
       RETURNING *`,
      [fecha_pago, metodo_pago, numero_comprobante, observaciones, id]
    );
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error actualizando pago:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// Eliminar pago
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Obtener items del pago para revertir saldos
    const itemsResult = await client.query(
      `SELECT factura_compra_id, monto_aplicado 
       FROM pagos_proveedores_items 
       WHERE pago_id = $1`,
      [id]
    );
    
    // Revertir saldos de facturas
    for (const item of itemsResult.rows) {
      await client.query(
        `UPDATE facturas_compra 
         SET saldo_pendiente = saldo_pendiente + $1
         WHERE id = $2`,
        [item.monto_aplicado, item.factura_compra_id]
      );
    }
    
    // Eliminar items del pago
    await client.query('DELETE FROM pagos_proveedores_items WHERE pago_id = $1', [id]);
    
    // Eliminar pago
    const result = await client.query('DELETE FROM pagos_proveedores WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Pago eliminado correctamente' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error eliminando pago:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// Obtener facturas pendientes de un proveedor
router.get('/proveedor/:proveedor_id/facturas-pendientes', async (req, res) => {
  try {
    const { proveedor_id } = req.params;
    
    const result = await pool.query(
      `SELECT fc.*, 
              (fc.total - COALESCE(fc.neto_pagado, 0)) as monto_pagado,
              fc.total - COALESCE(fc.neto_pagado, 0) as saldo_pendiente,
              EXTRACT(DAY FROM fc.fecha_vencimiento - CURRENT_DATE) as dias_vencido
       FROM facturas_compra fc
       WHERE fc.proveedor_id = $1 
         AND fc.estado = 'PENDIENTE'
         AND (fc.total - COALESCE(fc.neto_pagado, 0)) > 0
       ORDER BY fc.fecha_vencimiento ASC`,
      [proveedor_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo facturas pendientes:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Endpoint para alertas de facturas pendientes
router.get('/alertas/facturas-pendientes', async (req, res) => {
  try {
    const { dias_vencimiento = 7 } = req.query;
    
    const result = await pool.query(
      `SELECT fc.*, pr.nombre as proveedor_nombre,
              EXTRACT(DAY FROM CURRENT_DATE - fc.fecha_vencimiento) as dias_vencido,
              CASE 
                WHEN fc.fecha_vencimiento < CURRENT_DATE THEN 'vencida'
                WHEN EXTRACT(DAY FROM fc.fecha_vencimiento - CURRENT_DATE) <= $1 THEN 'por_vencer'
                ELSE 'normal'
              END as estado_alerta
       FROM facturas_compra fc
       LEFT JOIN proveedores pr ON fc.proveedor_id = pr.id
       WHERE fc.estado = 'PENDIENTE'
         AND (fc.total - COALESCE(fc.neto_pagado, 0)) > 0
       ORDER BY fc.fecha_vencimiento ASC`,
      [dias_vencimiento]
    );
    
    // Agrupar por estado de alerta
    const alertas = {
      vencidas: result.rows.filter(f => f.estado_alerta === 'vencida'),
      por_vencer: result.rows.filter(f => f.estado_alerta === 'por_vencer'),
      total: result.rows.length,
      monto_total: result.rows.reduce((sum, f) => sum + parseFloat(f.total) - parseFloat(f.neto_pagado || 0), 0)
    };
    
    res.json(alertas);
  } catch (error) {
    console.error('Error obteniendo alertas:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Endpoint para obtener historial de pagos de una factura
router.get('/factura/:factura_id/historial', async (req, res) => {
  try {
    const { factura_id } = req.params;
    
    const result = await pool.query(
      `SELECT 
        pp.id as pago_id,
        pp.fecha as fecha_pago,
        pp.forma_pago as metodo_pago,
        pp.referencia as numero_comprobante,
        pp.monto as monto_total,
        pp.observaciones,
        pp.estado as estado_pago,
        pr.nombre as proveedor_nombre,
        pi.monto_aplicado,
        pi.fecha_aplicacion
      FROM pagos_proveedores pp
      JOIN pagos_proveedores_items pi ON pp.id = pi.pago_id
      JOIN proveedores pr ON pp.proveedor_id = pr.id
      WHERE pi.factura_compra_id = $1
      ORDER BY pp.fecha DESC, pi.fecha_aplicacion DESC`,
      [factura_id]
    );
    
    // Obtener información de la factura
    const facturaResult = await pool.query(
      `SELECT fc.*, pr.nombre as proveedor_nombre
       FROM facturas_compra fc
       LEFT JOIN proveedores pr ON fc.proveedor_id = pr.id
       WHERE fc.id = $1`,
      [factura_id]
    );
    
    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    
    const factura = facturaResult.rows[0];
    const historial = result.rows;
    
    // Calcular total pagado
    const totalPagado = historial.reduce((sum, pago) => sum + parseFloat(pago.monto_aplicado), 0);
    
    res.json({
      factura,
      historial,
      total_pagado: totalPagado,
      saldo_pendiente: parseFloat(factura.total) - totalPagado
    });
  } catch (error) {
    console.error('Error obteniendo historial de pagos:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Endpoint para búsqueda avanzada de pagos
router.get('/busqueda/avanzada', async (req, res) => {
  try {
    const {
      metodo_pago,
      fecha_desde,
      fecha_hasta,
      proveedor_id,
      monto_min,
      monto_max,
      numero_comprobante
    } = req.query;
    
    let query = `
      SELECT 
        pp.*,
        pr.nombre as proveedor_nombre,
        COUNT(pi.id) as facturas_pagadas,
        SUM(pi.monto_aplicado) as monto_total_aplicado
      FROM pagos_proveedores pp
      LEFT JOIN proveedores pr ON pp.proveedor_id = pr.id
      LEFT JOIN pagos_proveedores_items pi ON pp.id = pi.pago_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (metodo_pago) {
      query += ` AND pp.forma_pago = $${paramCount}`;
      params.push(metodo_pago);
      paramCount++;
    }
    
    if (fecha_desde) {
      query += ` AND pp.fecha >= $${paramCount}`;
      params.push(fecha_desde);
      paramCount++;
    }
    
    if (fecha_hasta) {
      query += ` AND pp.fecha <= $${paramCount}`;
      params.push(fecha_hasta);
      paramCount++;
    }
    
    if (proveedor_id) {
      query += ` AND pp.proveedor_id = $${paramCount}`;
      params.push(proveedor_id);
      paramCount++;
    }
    
    if (monto_min) {
      query += ` AND pp.monto >= $${paramCount}`;
      params.push(parseFloat(monto_min));
      paramCount++;
    }
    
    if (monto_max) {
      query += ` AND pp.monto <= $${paramCount}`;
      params.push(parseFloat(monto_max));
      paramCount++;
    }
    
    if (numero_comprobante) {
      query += ` AND pp.referencia ILIKE $${paramCount}`;
      params.push(`%${numero_comprobante}%`);
      paramCount++;
    }
    
    query += ` GROUP BY pp.id, pr.nombre ORDER BY pp.fecha DESC`;
    
    const result = await pool.query(query, params);
    
    // Obtener estadísticas
    const statsQuery = `
      SELECT 
        COUNT(*) as total_pagos,
        SUM(monto) as monto_total,
        AVG(monto) as promedio_pago,
        forma_pago as metodo_pago,
        COUNT(*) as cantidad_por_metodo
      FROM pagos_proveedores
      WHERE 1=1
    `;
    
    const statsParams = [];
    let statsParamCount = 1;
    
    if (metodo_pago) {
      statsQuery += ` AND forma_pago = $${statsParamCount}`;
      statsParams.push(metodo_pago);
      statsParamCount++;
    }
    
    if (fecha_desde) {
      statsQuery += ` AND fecha >= $${statsParamCount}`;
      statsParams.push(fecha_desde);
      statsParamCount++;
    }
    
    if (fecha_hasta) {
      statsQuery += ` AND fecha <= $${statsParamCount}`;
      statsParams.push(fecha_hasta);
      statsParamCount++;
    }
    
    if (proveedor_id) {
      statsQuery += ` AND proveedor_id = $${statsParamCount}`;
      statsParams.push(proveedor_id);
      statsParamCount++;
    }
    
    statsQuery += ` GROUP BY forma_pago`;
    
    const statsResult = await pool.query(statsQuery, statsParams);
    
    res.json({
      resultados: result.rows,
      estadisticas: statsResult.rows
    });
  } catch (error) {
    console.error('Error en búsqueda avanzada:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// ============================================
// RUTAS PARA ÓRDENES DE PAGO
// ============================================

// Obtener órdenes de pago
router.get('/ordenes', async (req, res) => {
  try {
    const { proveedor_id, fecha_desde, fecha_hasta, estado } = req.query;
    
    let query = `
      SELECT 
        op.*,
        pr.nombre as proveedor_nombre,
        u.nombre_completo as autorizado_por_nombre
      FROM ordenes_pago_proveedores op
      LEFT JOIN proveedores pr ON op.proveedor_id = pr.id
      LEFT JOIN usuarios u ON op.autorizado_por = u.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (proveedor_id) {
      query += ` AND op.proveedor_id = $${params.length + 1}`;
      params.push(proveedor_id);
    }
    
    if (fecha_desde) {
      query += ` AND op.fecha >= $${params.length + 1}`;
      params.push(fecha_desde);
    }
    
    if (fecha_hasta) {
      query += ` AND op.fecha <= $${params.length + 1}`;
      params.push(fecha_hasta);
    }
    
    if (estado) {
      query += ` AND op.estado = $${params.length + 1}`;
      params.push(estado);
    }
    
    query += ` ORDER BY op.fecha DESC, op.id DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo órdenes de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Crear orden de pago
router.post('/ordenes', async (req, res) => {
  try {
    const { proveedor_id, fecha, monto, motivo, observaciones } = req.body;
    
    const result = await pool.query(`
      INSERT INTO ordenes_pago_proveedores 
      (proveedor_id, fecha, monto, motivo, observaciones, estado)
      VALUES ($1, $2, $3, $4, $5, 'pendiente')
      RETURNING *
    `, [proveedor_id, fecha || new Date().toISOString().split('T')[0], monto, motivo, observaciones]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando orden de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Obtener orden de pago específica
router.get('/ordenes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        op.*,
        pr.nombre as proveedor_nombre,
        u.nombre_completo as autorizado_por_nombre
      FROM ordenes_pago_proveedores op
      LEFT JOIN proveedores pr ON op.proveedor_id = pr.id
      LEFT JOIN usuarios u ON op.autorizado_por = u.id
      WHERE op.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden de pago no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo orden de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Autorizar orden de pago
router.put('/ordenes/:id/autorizar', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const usuario_id = req.usuario?.id;
    
    const result = await client.query(`
      UPDATE ordenes_pago_proveedores 
      SET estado = 'autorizada',
          autorizado_por = $1,
          fecha_autorizacion = CURRENT_DATE
      WHERE id = $2 AND estado = 'pendiente'
      RETURNING *
    `, [usuario_id, id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden de pago no encontrada o no está pendiente' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Orden de pago autorizada', orden: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error autorizando orden de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// Cancelar orden de pago
router.put('/ordenes/:id/cancelar', async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    
    const result = await pool.query(`
      UPDATE ordenes_pago_proveedores 
      SET estado = 'cancelada',
          observaciones = COALESCE(observaciones, '') || ' Cancelada: ' || $1
      WHERE id = $2 AND estado IN ('pendiente', 'autorizada')
      RETURNING *
    `, [motivo, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden de pago no encontrada o no puede ser cancelada' });
    }
    
    res.json({ message: 'Orden de pago cancelada', orden: result.rows[0] });
  } catch (error) {
    console.error('Error cancelando orden de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Generar pago desde orden
router.post('/ordenes/:id/generar-pago', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Obtener orden
    const ordenResult = await client.query(`
      SELECT * FROM ordenes_pago_proveedores 
      WHERE id = $1 AND estado = 'autorizada'
    `, [id]);
    
    if (ordenResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden de pago no encontrada o no está autorizada' });
    }
    
    const orden = ordenResult.rows[0];
    
    // Crear pago
    const pagoResult = await client.query(`
      INSERT INTO pagos_proveedores 
      (proveedor_id, fecha, forma_pago, referencia, monto, observaciones, estado)
      VALUES ($1, $2, 'transferencia', 'Desde orden OP-' || $3, $4, $5, 'pendiente')
      RETURNING *
    `, [orden.proveedor_id, new Date().toISOString().split('T')[0], orden.id, orden.monto, orden.motivo]);
    
    const pagoId = pagoResult.rows[0].id;
    
    // Actualizar orden con referencia al pago
    await client.query(`
      UPDATE ordenes_pago_proveedores 
      SET pago_id = $1, estado = 'pagada'
      WHERE id = $2
    `, [pagoId, id]);
    
    await client.query('COMMIT');
    
    res.json({ 
      message: 'Pago generado desde orden correctamente', 
      pago: pagoResult.rows[0],
      orden: { ...orden, pago_id: pagoId, estado: 'pagada' }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error generando pago desde orden:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  } finally {
    client.release();
  }
});

// ============================================
// RUTAS PARA ESTADO DE CUENTA DE PROVEEDORES
// ============================================

// Obtener estado de cuenta de un proveedor
router.get('/estado-cuenta/:proveedor_id', async (req, res) => {
  try {
    const { proveedor_id } = req.params;
    
    // Obtener información del proveedor
    const proveedorResult = await pool.query(
      `SELECT id, nombre, cuit, direccion, telefono, email 
       FROM proveedores WHERE id = $1`,
      [proveedor_id]
    );
    
    if (proveedorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    
    const proveedor = proveedorResult.rows[0];
    
    // Obtener facturas pendientes con saldo
    const facturasPendientesResult = await pool.query(
      `SELECT 
        fc.id,
        fc.numero_factura,
        fc.fecha_emision,
        fc.fecha_vencimiento,
        fc.total,
        fc.total - COALESCE(fc.neto_pagado, 0) as saldo_pendiente,
        EXTRACT(DAY FROM CURRENT_DATE - fc.fecha_vencimiento) as dias_vencido,
        CASE 
          WHEN fc.fecha_vencimiento < CURRENT_DATE THEN 'VENCIDA'
          WHEN EXTRACT(DAY FROM fc.fecha_vencimiento - CURRENT_DATE) <= 7 THEN 'POR VENCER'
          ELSE 'NORMAL'
        END as estado_alerta
       FROM facturas_compra fc
       WHERE fc.proveedor_id = $1 
         AND fc.estado = 'PENDIENTE'
         AND (fc.total - COALESCE(fc.neto_pagado, 0)) > 0
       ORDER BY fc.fecha_vencimiento ASC`,
      [proveedor_id]
    );
    
    // Obtener pagos realizados en los últimos 30 días
    const pagosRecientesResult = await pool.query(
      `SELECT 
        pp.id,
        pp.fecha,
        pp.forma_pago,
        pp.referencia,
        pp.monto,
        pp.observaciones,
        COUNT(pi.id) as facturas_pagadas,
        SUM(pi.monto_aplicado) as monto_total_aplicado
       FROM pagos_proveedores pp
       LEFT JOIN pagos_proveedores_items pi ON pp.id = pi.pago_id
       WHERE pp.proveedor_id = $1 
         AND pp.fecha >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY pp.id
       ORDER BY pp.fecha DESC`,
      [proveedor_id]
    );
    
    // Calcular totales
    const totalFacturasPendientes = facturasPendientesResult.rows.reduce(
      (sum, f) => sum + parseFloat(f.saldo_pendiente), 0
    );
    
    const totalPagadoUltimos30Dias = pagosRecientesResult.rows.reduce(
      (sum, p) => sum + parseFloat(p.monto_total_aplicado || p.monto), 0
    );
    
    // Obtener saldo histórico
    const saldoHistoricoResult = await pool.query(
      `SELECT 
        COALESCE(SUM(fc.total), 0) as total_facturado,
        COALESCE(SUM(fc.total - fc.saldo_pendiente), 0) as total_pagado,
        COALESCE(SUM(fc.saldo_pendiente), 0) as saldo_pendiente
       FROM facturas_compra fc
       WHERE fc.proveedor_id = $1 
         AND fc.estado = 'pendiente'`,
      [proveedor_id]
    );
    
    const saldoHistorico = saldoHistoricoResult.rows[0];
    
    res.json({
      proveedor,
      resumen: {
        total_facturado: parseFloat(saldoHistorico.total_facturado),
        total_pagado: parseFloat(saldoHistorico.total_pagado),
        saldo_pendiente: parseFloat(saldoHistorico.saldo_pendiente),
        facturas_pendientes: facturasPendientesResult.rows.length,
        total_facturas_pendientes: totalFacturasPendientes,
        total_pagado_ultimos_30_dias: totalPagadoUltimos30Dias
      },
      facturas_pendientes: facturasPendientesResult.rows,
      pagos_recientes: pagosRecientesResult.rows,
      consultado_en: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error obteniendo estado de cuenta:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Obtener estado de cuenta para impresión (formato simplificado)
router.get('/estado-cuenta/:proveedor_id/imprimir', async (req, res) => {
  try {
    const { proveedor_id } = req.params;
    
    // Obtener información básica del proveedor
    const proveedorResult = await pool.query(
      `SELECT id, nombre, cuit, direccion, telefono, email 
       FROM proveedores WHERE id = $1`,
      [proveedor_id]
    );
    
    if (proveedorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    
    const proveedor = proveedorResult.rows[0];
    
    // Obtener facturas pendientes con detalles para impresión
    const facturasResult = await pool.query(
      `SELECT 
        fc.id,
        fc.numero_factura,
        fc.fecha_emision,
        fc.fecha_vencimiento,
        fc.total,
        fc.total - COALESCE(fc.neto_pagado, 0) as saldo_pendiente,
        (fc.total - (fc.total - COALESCE(fc.neto_pagado, 0))) as monto_pagado,
        EXTRACT(DAY FROM CURRENT_DATE - fc.fecha_vencimiento) as dias_vencido,
        fc.observaciones
       FROM facturas_compra fc
       WHERE fc.proveedor_id = $1 
         AND fc.estado = 'PENDIENTE'
         AND (fc.total - COALESCE(fc.neto_pagado, 0)) > 0
       ORDER BY fc.fecha_vencimiento ASC`,
      [proveedor_id]
    );
    
    // Calcular totales
    const totalSaldoPendiente = facturasResult.rows.reduce(
      (sum, f) => sum + parseFloat(f.saldo_pendiente), 0
    );
    
    const totalFacturado = facturasResult.rows.reduce(
      (sum, f) => sum + parseFloat(f.total), 0
    );
    
    const totalPagado = totalFacturado - totalSaldoPendiente;
    
    res.json({
      proveedor,
      fecha_consulta: new Date().toISOString().split('T')[0],
      resumen: {
        total_facturas: facturasResult.rows.length,
        total_facturado: totalFacturado,
        total_pagado: totalPagado,
        saldo_pendiente: totalSaldoPendiente
      },
      facturas: facturasResult.rows,
      // Información de la empresa (puede venir de parámetros)
      empresa: {
        nombre: 'Transformadores SA',
        cuit: '30-12345678-9',
        direccion: 'Av. Principal 1234',
        telefono: '(011) 1234-5678'
      }
    });
  } catch (error) {
    console.error('Error obteniendo estado de cuenta para impresión:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

// Obtener detalle completo de estado de cuenta
router.get('/estado-cuenta/:proveedor_id/detalle', async (req, res) => {
  try {
    const { proveedor_id } = req.params;
    const { fecha_desde, fecha_hasta, incluir_pagadas = 'false' } = req.query;
    
    // Obtener información del proveedor
    const proveedorResult = await pool.query(
      `SELECT id, nombre, cuit, direccion, telefono, email 
       FROM proveedores WHERE id = $1`,
      [proveedor_id]
    );
    
    if (proveedorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }
    
    const proveedor = proveedorResult.rows[0];
    
    // Construir consulta base para movimientos
    let query = `
      SELECT 
        'FACTURA' as tipo_movimiento,
        fc.id,
        fc.numero_factura as referencia,
        fc.fecha_emision as fecha,
        fc.total as monto,
        0 as monto_aplicado,
        fc.total as saldo_original,
        fc.saldo_pendiente as saldo_actual,
        fc.observaciones,
        NULL as pago_id,
        NULL as forma_pago,
        'DEBE' as tipo_saldo
      FROM facturas_compra fc
      WHERE fc.proveedor_id = $1
        AND fc.estado = 'pendiente'
      
      UNION ALL
      
      SELECT 
        'PAGO' as tipo_movimiento,
        pp.id,
        pp.referencia,
        pp.fecha,
        pp.monto,
        COALESCE(SUM(pi.monto_aplicado), pp.monto) as monto_aplicado,
        pp.monto as saldo_original,
        0 as saldo_actual,
        pp.observaciones,
        pp.id as pago_id,
        pp.forma_pago,
        'HABER' as tipo_saldo
      FROM pagos_proveedores pp
      LEFT JOIN pagos_proveedores_items pi ON pp.id = pi.pago_id
      WHERE pp.proveedor_id = $1
      GROUP BY pp.id, pp.referencia, pp.fecha, pp.monto, pp.observaciones, pp.forma_pago
      
      ORDER BY fecha DESC, tipo_movimiento
    `;
    
    const params = [proveedor_id];
    
    // Aplicar filtros de fecha si existen
    if (fecha_desde) {
      query = query.replace('WHERE fc.proveedor_id = $1', 
        `WHERE fc.proveedor_id = $1 AND fc.fecha_emision >= $${params.length + 1}`);
      params.push(fecha_desde);
    }
    
    if (fecha_hasta) {
      query = query.replace('AND fc.estado = \'pendiente\'', 
        `AND fc.estado = 'pendiente' AND fc.fecha_emision <= $${params.length + 1}`);
      params.push(fecha_hasta);
    }
    
    const movimientosResult = await pool.query(query, params);
    
    // Calcular saldo acumulado
    let saldoAcumulado = 0;
    const movimientosConSaldo = movimientosResult.rows.map(mov => {
      if (mov.tipo_saldo === 'DEBE') {
        saldoAcumulado += parseFloat(mov.saldo_actual);
      } else {
        saldoAcumulado -= parseFloat(mov.monto_aplicado);
      }
      
      return {
        ...mov,
        saldo_acumulado: saldoAcumulado
      };
    });
    
    // Invertir el orden para mostrar cronológicamente (más antiguo primero)
    movimientosConSaldo.reverse();
    
    res.json({
      proveedor,
      filtros: {
        fecha_desde,
        fecha_hasta,
        incluir_pagadas
      },
      total_movimientos: movimientosConSaldo.length,
      saldo_actual: saldoAcumulado,
      movimientos: movimientosConSaldo,
      resumen: {
        total_debe: movimientosConSaldo
          .filter(m => m.tipo_saldo === 'DEBE')
          .reduce((sum, m) => sum + parseFloat(m.saldo_actual), 0),
        total_haber: movimientosConSaldo
          .filter(m => m.tipo_saldo === 'HABER')
          .reduce((sum, m) => sum + parseFloat(m.monto_aplicado), 0)
      }
    });
  } catch (error) {
    console.error('Error obteniendo detalle de estado de cuenta:', error);
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
});

module.exports = router;



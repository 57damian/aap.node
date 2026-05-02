const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken } = require('../middlewares/auth');

// =====================
// RUTAS PARA PAGOS
// =====================

// Obtener todos los pagos (con filtros)
router.get('/pagos', verificarToken, async (req, res) => {
  try {
    const { cliente_id, desde, hasta, estado } = req.query;
    
    let query = `
      SELECT 
        p.*,
        c.nombre as cliente_nombre,
        (
          SELECT json_agg(json_build_object(
            'id', pi.id,
            'tipo', pi.tipo,
            'monto', pi.monto,
            'cheque_numero', pi.cheque_numero,
            'cheque_banco', pi.cheque_banco,
            'transferencia_numero_operacion', pi.transferencia_numero_operacion
          ))
          FROM pago_items pi
          WHERE pi.pago_id = p.id
        ) as items
      FROM pagos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (cliente_id) {
      query += ` AND p.cliente_id = $${paramIndex}`;
      params.push(cliente_id);
      paramIndex++;
    }
    
    if (desde) {
      query += ` AND p.fecha_recepcion >= $${paramIndex}`;
      params.push(desde);
      paramIndex++;
    }
    
    if (hasta) {
      query += ` AND p.fecha_recepcion <= $${paramIndex}`;
      params.push(hasta);
      paramIndex++;
    }
    
    if (estado) {
      query += ` AND p.estado = $${paramIndex}`;
      params.push(estado);
      paramIndex++;
    }
    
    query += ` ORDER BY p.fecha_recepcion DESC, p.id DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo pagos:', error);
    res.status(500).json({ error: 'Error obteniendo pagos' });
  }
});

// Obtener un pago específico
router.get('/pagos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const pagoResult = await pool.query(`
      SELECT 
        p.*,
        c.nombre as cliente_nombre,
        (
          SELECT json_agg(json_build_object(
            'id', pi.id,
            'tipo', pi.tipo,
            'monto', pi.monto,
            'observaciones', pi.observaciones,
            'cheque_numero', pi.cheque_numero,
            'cheque_banco', pi.cheque_banco,
            'cheque_fecha_emision', pi.cheque_fecha_emision,
            'cheque_fecha_cobro', pi.cheque_fecha_cobro,
            'cheque_fecha_depositado', pi.cheque_fecha_depositado,
            'cheque_estado', pi.cheque_estado,
            'cheque_gasto_comision', pi.cheque_gasto_comision,
            'cheque_motivo_rechazo', pi.cheque_motivo_rechazo,
            'transferencia_banco_origen', pi.transferencia_banco_origen,
            'transferencia_banco_destino', pi.transferencia_banco_destino,
            'transferencia_numero_operacion', pi.transferencia_numero_operacion,
            'transferencia_fecha', pi.transferencia_fecha,
            'transferencia_comprobante_url', pi.transferencia_comprobante_url,
            'endosado', pi.endosado,
            'endosado_a_proveedor_id', pi.endosado_a_proveedor_id,
            'fecha_endoso', pi.fecha_endoso
          ))
          FROM pago_items pi
          WHERE pi.pago_id = p.id
        ) as items,
        (
          SELECT json_agg(json_build_object(
            'id', ap.id,
            'factura_id', ap.factura_id,
            'monto_aplicado', ap.monto_aplicado,
            'created_at', ap.created_at
          ))
          FROM aplicacion_pagos ap
          WHERE ap.pago_id = p.id
        ) as aplicaciones
      FROM pagos p
      LEFT JOIN clientes c ON p.cliente_id = c.id
      WHERE p.id = $1
    `, [id]);
    
    if (pagoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    res.json(pagoResult.rows[0]);
  } catch (error) {
    console.error('Error obteniendo pago:', error);
    res.status(500).json({ error: 'Error obteniendo pago' });
  }
});

// Crear un nuevo pago
router.post('/pagos', verificarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { cliente_id, fecha_recepcion, observaciones, items } = req.body;
    
    // Validaciones básicas
    if (!cliente_id || !fecha_recepcion || !items || items.length === 0) {
      throw new Error('Datos incompletos');
    }
    
    // Calcular monto total
    const monto_total = items.reduce((sum, item) => sum + parseFloat(item.monto), 0);
    
    // Insertar pago
    const pagoResult = await client.query(`
      INSERT INTO pagos (cliente_id, fecha_recepcion, monto_total, observaciones, estado)
      VALUES ($1, $2, $3, $4, 'pendiente')
      RETURNING *
    `, [cliente_id, fecha_recepcion, monto_total, observaciones]);
    
    const pago = pagoResult.rows[0];
    
    // Insertar items del pago
    for (const item of items) {
      const { tipo, monto, observaciones: itemObs, 
              cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro,
              transferencia_banco_origen, transferencia_banco_destino, 
              transferencia_numero_operacion, transferencia_fecha } = item;
      
      let query = `
        INSERT INTO pago_items 
        (pago_id, tipo, monto, observaciones, 
         cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro,
         transferencia_banco_origen, transferencia_banco_destino, 
         transferencia_numero_operacion, transferencia_fecha)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `;
      
      await client.query(query, [
        pago.id, tipo, monto, itemObs || null,
        cheque_numero || null, cheque_banco || null, cheque_fecha_emision || null, cheque_fecha_cobro || null,
        transferencia_banco_origen || null, transferencia_banco_destino || null,
        transferencia_numero_operacion || null, transferencia_fecha || null
      ]);
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({ 
      message: 'Pago creado exitosamente',
      pago 
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creando pago:', error);
    res.status(500).json({ error: error.message || 'Error creando pago' });
  } finally {
    client.release();
  }
});

// Aplicar pago a facturas
router.post('/pagos/:id/aplicar', verificarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { aplicaciones } = req.body;
    
    // Verificar que el pago existe y está pendiente
    const pagoResult = await client.query(
      'SELECT * FROM pagos WHERE id = $1 AND estado = $2',
      [id, 'pendiente']
    );
    
    if (pagoResult.rows.length === 0) {
      throw new Error('Pago no encontrado o ya aplicado');
    }
    
    const pago = pagoResult.rows[0];
    
    // Aplicar a cada factura
    for (const aplicacion of aplicaciones) {
      const { factura_id, monto_aplicado } = aplicacion;
      
      // Verificar que la factura existe y tiene saldo suficiente
      const facturaResult = await client.query(
        'SELECT * FROM facturas WHERE id = $1',
        [factura_id]
      );
      
      if (facturaResult.rows.length === 0) {
        throw new Error(`Factura ${factura_id} no encontrada`);
      }
      
      // Insertar aplicación de pago
      await client.query(`
        INSERT INTO aplicacion_pagos (pago_id, factura_id, monto_aplicado)
        VALUES ($1, $2, $3)
      `, [id, factura_id, monto_aplicado]);
    }
    
    // Actualizar estado del pago
    await client.query(
      'UPDATE pagos SET estado = $1 WHERE id = $2',
      ['aplicado', id]
    );
    
    await client.query('COMMIT');
    
    res.json({ 
      message: 'Pago aplicado exitosamente',
      pago_id: id 
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error aplicando pago:', error);
    res.status(500).json({ error: error.message || 'Error aplicando pago' });
  } finally {
    client.release();
  }
});

// =====================
// RUTAS PARA RECIBOS
// =====================

// Obtener todos los recibos (con filtros)
router.get('/recibos', verificarToken, async (req, res) => {
  try {
    const { cliente_id, desde, hasta } = req.query;
    
    let query = `
      SELECT 
        r.*,
        c.nombre as cliente_nombre,
        t.numero_talonario
      FROM recibos r
      LEFT JOIN clientes c ON r.cliente_id = c.id
      LEFT JOIN talonarios_recibo t ON r.talonario_id = t.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (cliente_id) {
      query += ` AND r.cliente_id = $${paramIndex}`;
      params.push(cliente_id);
      paramIndex++;
    }
    
    if (desde) {
      query += ` AND r.fecha_emision >= $${paramIndex}`;
      params.push(desde);
      paramIndex++;
    }
    
    if (hasta) {
      query += ` AND r.fecha_emision <= $${paramIndex}`;
      params.push(hasta);
      paramIndex++;
    }
    
    query += ` ORDER BY r.fecha_emision DESC, r.id DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo recibos:', error);
    res.status(500).json({ error: 'Error obteniendo recibos' });
  }
});

// Obtener un recibo específico
router.get('/recibos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const reciboResult = await pool.query(`
      SELECT 
        r.*,
        c.nombre as cliente_nombre,
        c.direccion as cliente_direccion,
        c.cuit as cliente_cuit,
        t.numero_talonario
      FROM recibos r
      LEFT JOIN clientes c ON r.cliente_id = c.id
      LEFT JOIN talonarios_recibo t ON r.talonario_id = t.id
      WHERE r.id = $1
    `, [id]);
    
    if (reciboResult.rows.length === 0) {
      return res.status(404).json({ error: 'Recibo no encontrado' });
    }
    
    res.json(reciboResult.rows[0]);
  } catch (error) {
    console.error('Error obteniendo recibo:', error);
    res.status(500).json({ error: 'Error obteniendo recibo' });
  }
});

// Crear un nuevo recibo
router.post('/recibos', verificarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { 
      numero_recibo, 
      talonario_numero,
      cliente_id, 
      fecha_emision, 
      pago_ids, 
      observaciones 
    } = req.body;
    
    // Validaciones básicas
    if (!numero_recibo || !cliente_id || !fecha_emision) {
      throw new Error('Datos incompletos');
    }
    
    // Obtener ID del talonario si se proporciona el número
    let talonario_id = null;
    if (talonario_numero) {
      const talonarioResult = await client.query(
        'SELECT id FROM talonarios_recibo WHERE numero_talonario = $1 AND activo = true',
        [talonario_numero]
      );
      
      if (talonarioResult.rows.length > 0) {
        talonario_id = talonarioResult.rows[0].id;
      }
    }
    
    // Calcular totales de los pagos
    let total_efectivo = 0;
    let total_cheques = 0;
    let total_transferencias = 0;
    let total_pagado = 0;
    
    if (pago_ids && pago_ids.length > 0) {
      for (const pago_id of pago_ids) {
        const pagoResult = await client.query(`
          SELECT 
            p.monto_total,
            (
              SELECT SUM(pi.monto)
              FROM pago_items pi
              WHERE pi.pago_id = p.id AND pi.tipo = 'EFECTIVO'
            ) as efectivo,
            (
              SELECT SUM(pi.monto)
              FROM pago_items pi
              WHERE pi.pago_id = p.id AND pi.tipo = 'CHEQUE'
            ) as cheques,
            (
              SELECT SUM(pi.monto)
              FROM pago_items pi
              WHERE pi.pago_id = p.id AND pi.tipo = 'TRANSFERENCIA'
            ) as transferencias
          FROM pagos p
          WHERE p.id = $1
        `, [pago_id]);
        
        if (pagoResult.rows.length > 0) {
          const pago = pagoResult.rows[0];
          total_efectivo += parseFloat(pago.efectivo || 0);
          total_cheques += parseFloat(pago.cheques || 0);
          total_transferencias += parseFloat(pago.transferencias || 0);
          total_pagado += parseFloat(pago.monto_total || 0);
        }
      }
    }
    
    // Insertar recibo
    const reciboResult = await client.query(`
      INSERT INTO recibos 
      (numero_recibo, talonario_id, cliente_id, fecha_emision, 
       pago_ids, total_efectivo, total_cheques, total_transferencias, 
       total_pagado, observaciones, usuario_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      numero_recibo, talonario_id, cliente_id, fecha_emision,
      pago_ids || [], total_efectivo, total_cheques, total_transferencias,
      total_pagado, observaciones || null, req.usuario.id
    ]);
    
    const recibo = reciboResult.rows[0];
    
    await client.query('COMMIT');
    
    res.status(201).json({ 
      message: 'Recibo creado exitosamente',
      recibo 
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creando recibo:', error);
    res.status(500).json({ error: error.message || 'Error creando recibo' });
  } finally {
    client.release();
  }
});

// =====================
// RUTAS PARA CHEQUES
// =====================

// Obtener todos los cheques (con filtros)
router.get('/cheques', verificarToken, async (req, res) => {
  try {
    const { cliente_id, estado, desde, hasta } = req.query;
    
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
        p.cliente_id,
        c.nombre as cliente_nombre
      FROM pago_items pi
      JOIN pagos p ON pi.pago_id = p.id
      JOIN clientes c ON p.cliente_id = c.id
      WHERE pi.tipo = 'CHEQUE'
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (cliente_id) {
      query += ` AND p.cliente_id = $${paramIndex}`;
      params.push(cliente_id);
      paramIndex++;
    }
    
    if (estado) {
      query += ` AND pi.cheque_estado = $${paramIndex}`;
      params.push(estado);
      paramIndex++;
    }
    
    if (desde) {
      query += ` AND pi.cheque_fecha_cobro >= $${paramIndex}`;
      params.push(desde);
      paramIndex++;
    }
    
    if (hasta) {
      query += ` AND pi.cheque_fecha_cobro <= $${paramIndex}`;
      params.push(hasta);
      paramIndex++;
    }
    
    query += ` ORDER BY pi.cheque_fecha_cobro ASC, pi.id DESC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo cheques:', error);
    res.status(500).json({ error: 'Error obteniendo cheques' });
  }
});

// Obtener un cheque específico
router.get('/cheques/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        pi.*,
        p.cliente_id,
        c.nombre as cliente_nombre,
        p.fecha_recepcion as pago_fecha,
        p.observaciones as pago_observaciones
      FROM pago_items pi
      JOIN pagos p ON pi.pago_id = p.id
      JOIN clientes c ON p.cliente_id = c.id
      WHERE pi.id = $1 AND pi.tipo = 'CHEQUE'
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cheque no encontrado' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo cheque:', error);
    res.status(500).json({ error: 'Error obteniendo cheque' });
  }
});

// Actualizar estado de un cheque
router.put('/cheques/:id/estado', verificarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { 
      cheque_estado, 
      cheque_fecha_depositado, 
      cheque_gasto_comision, 
      cheque_motivo_rechazo 
    } = req.body;
    
    // Verificar que el cheque existe
    const chequeResult = await client.query(
      'SELECT * FROM pago_items WHERE id = $1 AND tipo = $2',
      [id, 'CHEQUE']
    );
    
    if (chequeResult.rows.length === 0) {
      throw new Error('Cheque no encontrado');
    }
    
    // Actualizar estado del cheque
    const updateQuery = `
      UPDATE pago_items 
      SET 
        cheque_estado = $1,
        cheque_fecha_depositado = $2,
        cheque_gasto_comision = $3,
        cheque_motivo_rechazo = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `;
    
    const updateResult = await client.query(updateQuery, [
      cheque_estado,
      cheque_fecha_depositado || null,
      cheque_gasto_comision || null,
      cheque_motivo_rechazo || null,
      id
    ]);
    
    await client.query('COMMIT');
    
    res.json({ 
      message: 'Estado del cheque actualizado exitosamente',
      cheque: updateResult.rows[0]
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error actualizando estado del cheque:', error);
    res.status(500).json({ error: error.message || 'Error actualizando estado del cheque' });
  } finally {
    client.release();
  }
});

// Endosar cheque a proveedor
router.post('/cheques/:id/endosar', verificarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { proveedor_id, fecha_endoso } = req.body;
    
    // Verificar que el cheque existe y está en estado pendiente o depositado
    const chequeResult = await client.query(`
      SELECT * FROM pago_items 
      WHERE id = $1 AND tipo = 'CHEQUE' 
      AND cheque_estado IN ('pendiente', 'depositado')
    `, [id]);
    
    if (chequeResult.rows.length === 0) {
      throw new Error('Cheque no encontrado o no disponible para endoso');
    }
    
    // Verificar que el proveedor existe
    const proveedorResult = await client.query(
      'SELECT id FROM proveedores WHERE id = $1',
      [proveedor_id]
    );
    
    if (proveedorResult.rows.length === 0) {
      throw new Error('Proveedor no encontrado');
    }
    
    // Actualizar cheque como endosado
    const updateResult = await client.query(`
      UPDATE pago_items 
      SET 
        endosado = true,
        endosado_a_proveedor_id = $1,
        fecha_endoso = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [proveedor_id, fecha_endoso || new Date(), id]);
    
    await client.query('COMMIT');
    
    res.json({ 
      message: 'Cheque endosado exitosamente',
      cheque: updateResult.rows[0]
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error endosando cheque:', error);
    res.status(500).json({ error: error.message || 'Error endosando cheque' });
  } finally {
    client.release();
  }
});

// =====================
// RUTAS PARA REPORTES
// =====================

// Reporte de pagos por cliente
router.get('/reportes/pagos-por-cliente', verificarToken, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    
    let query = `
      SELECT 
        c.id as cliente_id,
        c.nombre as cliente_nombre,
        COUNT(p.id) as total_pagos,
        SUM(p.monto_total) as total_monto,
        SUM(CASE WHEN p.estado = 'pendiente' THEN p.monto_total ELSE 0 END) as pendiente,
        SUM(CASE WHEN p.estado = 'aplicado' THEN p.monto_total ELSE 0 END) as aplicado
      FROM clientes c
      LEFT JOIN pagos p ON c.id = p.cliente_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (desde) {
      query += ` AND p.fecha_recepcion >= $${paramIndex}`;
      params.push(desde);
      paramIndex++;
    }
    
    if (hasta) {
      query += ` AND p.fecha_recepcion <= $${paramIndex}`;
      params.push(hasta);
      paramIndex++;
    }
    
    query += `
      GROUP BY c.id, c.nombre
      ORDER BY total_monto DESC
    `;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error generando reporte:', error);
    res.status(500).json({ error: 'Error generando reporte' });
  }
});

// Reporte de cheques por estado
router.get('/reportes/cheques-por-estado', verificarToken, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    
    let query = `
      SELECT 
        pi.cheque_estado,
        COUNT(*) as cantidad,
        SUM(pi.monto) as total_monto
      FROM pago_items pi
      WHERE pi.tipo = 'CHEQUE'
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (desde) {
      query += ` AND pi.cheque_fecha_cobro >= $${paramIndex}`;
      params.push(desde);
      paramIndex++;
    }
    
    if (hasta) {
      query += ` AND pi.cheque_fecha_cobro <= $${paramIndex}`;
      params.push(hasta);
      paramIndex++;
    }
    
    query += `
      GROUP BY pi.cheque_estado
      ORDER BY total_monto DESC
    `;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error generando reporte:', error);
    res.status(500).json({ error: 'Error generando reporte' });
  }
});

// =====================
// RUTAS PARA DASHBOARD
// =====================

// Estadísticas para dashboard
router.get('/dashboard/estadisticas', verificarToken, async (req, res) => {
  try {
    const { mes, anio } = req.query;
    
    // Pagos del mes
    const pagosQuery = `
      SELECT 
        COUNT(*) as total_pagos,
        SUM(monto_total) as total_monto,
        COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) as pagos_pendientes,
        SUM(CASE WHEN estado = 'pendiente' THEN monto_total ELSE 0 END) as monto_pendiente
      FROM pagos
      WHERE EXTRACT(MONTH FROM fecha_recepcion) = $1 
        AND EXTRACT(YEAR FROM fecha_recepcion) = $2
    `;
    
    // Cheques por vencer (próximos 7 días)
    const chequesQuery = `
      SELECT 
        COUNT(*) as cheques_por_vencer,
        SUM(monto) as monto_por_vencer
      FROM pago_items pi
      WHERE pi.tipo = 'CHEQUE' 
        AND pi.cheque_estado = 'pendiente'
        AND pi.cheque_fecha_cobro BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    `;
    
    // Top 5 clientes por pagos recibidos
    const topClientesQuery = `
      SELECT 
        c.nombre as cliente_nombre,
        COUNT(p.id) as cantidad_pagos,
        SUM(p.monto_total) as total_pagado
      FROM pagos p
      JOIN clientes c ON p.cliente_id = c.id
      WHERE EXTRACT(MONTH FROM p.fecha_recepcion) = $1 
        AND EXTRACT(YEAR FROM p.fecha_recepcion) = $2
      GROUP BY c.id, c.nombre
      ORDER BY total_pagado DESC
      LIMIT 5
    `;
    
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-indexed
    const currentYear = currentDate.getFullYear();
    
    const [pagosResult, chequesResult, topClientesResult] = await Promise.all([
      pool.query(pagosQuery, [mes || currentMonth, anio || currentYear]),
      pool.query(chequesQuery),
      pool.query(topClientesQuery, [mes || currentMonth, anio || currentYear])
    ]);
    
    res.json({
      pagos: pagosResult.rows[0],
      cheques: chequesResult.rows[0],
      top_clientes: topClientesResult.rows
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

module.exports = router;

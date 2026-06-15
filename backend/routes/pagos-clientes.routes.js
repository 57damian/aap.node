const express = require('express');
const router = express.Router();
const { verificarToken, authorize } = require('../middlewares/auth');
const pool = require('../db');

router.use(verificarToken);
router.use(authorize(['admin', 'control']));

// ---------------------------------------------------------------
// ORDEN: rutas con segmentos fijos ANTES que las de parámetro
// ---------------------------------------------------------------

// 1. Alertas de cheques próximos a vencer
router.get('/cheques/alertas', async (req, res) => {
  const dias = parseInt(req.query.dias) || 3;
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as total
      FROM cheques_propios cp
      JOIN pago_items pi ON cp.pago_item_id = pi.id
      WHERE cp.estado = 'pendiente'
        AND pi.cheque_fecha_cobro BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
    `, [dias]);
    res.json({ total: parseInt(result.rows[0].total), dias });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener alertas' });
  }
});

// 2. Facturas pendientes de un cliente
router.get('/facturas-pendientes/:clienteId', async (req, res) => {
  const { clienteId } = req.params;
  try {
    const result = await pool.query(`
      SELECT
        f.id, f.numero_factura, f.tipo_factura, f.fecha,
        f.total, f.saldo, f.fecha_vencimiento,
        CASE
          WHEN f.saldo <= 0                          THEN 'pagada'
          WHEN f.saldo < f.total                     THEN 'parcial'
          WHEN CURRENT_DATE > f.fecha_vencimiento    THEN 'vencida'
          ELSE 'pendiente'
        END as estado_pago
      FROM facturas f
      WHERE f.cliente_id = $1 AND f.saldo > 0
      ORDER BY f.fecha_vencimiento ASC NULLS LAST
    `, [clienteId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener facturas pendientes' });
  }
});

// 3. Estado de cuenta del cliente
router.get('/estado-cuenta/:clienteId', async (req, res) => {
  const { clienteId } = req.params;
  try {
    const totales = await pool.query(`
      SELECT
        COALESCE(SUM(total), 0)         as total_facturado,
        COALESCE(SUM(total - saldo), 0) as total_pagado,
        COALESCE(SUM(saldo), 0)         as saldo_actual
      FROM facturas WHERE cliente_id = $1
    `, [clienteId]);

    const deudaVencida = await pool.query(`
      SELECT COALESCE(SUM(saldo), 0) as deuda_vencida
      FROM facturas
      WHERE cliente_id = $1 AND saldo > 0 AND fecha_vencimiento < CURRENT_DATE
    `, [clienteId]);

    const proximas = await pool.query(`
      SELECT COUNT(*) as cantidad, COALESCE(SUM(saldo), 0) as total
      FROM facturas
      WHERE cliente_id = $1 AND saldo > 0
        AND fecha_vencimiento >= CURRENT_DATE
        AND fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days'
    `, [clienteId]);

    res.json({
      total_facturado:  parseFloat(totales.rows[0].total_facturado),
      total_pagado:     parseFloat(totales.rows[0].total_pagado),
      saldo_actual:     parseFloat(totales.rows[0].saldo_actual),
      deuda_vencida:    parseFloat(deudaVencida.rows[0].deuda_vencida),
      proximas_a_vencer: {
        cantidad: parseInt(proximas.rows[0].cantidad),
        total:    parseFloat(proximas.rows[0].total)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener estado de cuenta' });
  }
});

// ---------------------------------------------------------------
// 4. CREAR PAGO + APLICAR A FACTURAS (flujo unificado)
// ---------------------------------------------------------------
router.post('/pagos', async (req, res) => {
  const { cliente_id, fecha_recepcion, numero_talonario, observaciones, items, aplicaciones } = req.body;

  if (!cliente_id || !fecha_recepcion) {
    return res.status(400).json({ error: 'cliente_id y fecha_recepcion son obligatorios' });
  }
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Debe ingresar al menos un item de pago' });
  }
  if (!aplicaciones || aplicaciones.length === 0) {
    return res.status(400).json({ error: 'Debe seleccionar al menos una factura para aplicar el pago' });
  }

  const itemsValidos = items.filter(i => parseFloat(i.monto) > 0);
  const appsValidas  = aplicaciones.filter(a => parseFloat(a.monto_aplicado) > 0);

  if (itemsValidos.length === 0) return res.status(400).json({ error: 'Los montos de los items deben ser mayores a 0' });
  if (appsValidas.length === 0)  return res.status(400).json({ error: 'Los montos a aplicar deben ser mayores a 0' });

  const totalItems = itemsValidos.reduce((s, i) => s + parseFloat(i.monto), 0);
  const totalApps  = appsValidas.reduce((s, a) => s + parseFloat(a.monto_aplicado), 0);

  if (totalApps > totalItems + 0.01) {
    return res.status(400).json({
      error: `El total a aplicar ($${totalApps.toFixed(2)}) supera el monto cobrado ($${totalItems.toFixed(2)})`
    });
  }

  const clienteCheck = await pool.query(
    'SELECT id FROM clientes WHERE id = $1 AND activo = true', [cliente_id]
  );
  if (clienteCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Cliente no válido o inactivo' });
  }

  const facturaIds = [...new Set(appsValidas.map(a => a.factura_id))];
  const facturasCheck = await pool.query(
    'SELECT id FROM facturas WHERE id = ANY($1::int[])', [facturaIds]
  );
  if (facturasCheck.rows.length !== facturaIds.length) {
    return res.status(400).json({ error: 'Una o más facturas no existen' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const facturasLocked = await client.query(
      'SELECT id, saldo, cliente_id FROM facturas WHERE id = ANY($1::int[]) FOR UPDATE',
      [facturaIds]
    );

    for (const factura of facturasLocked.rows) {
      if (parseInt(factura.cliente_id) !== parseInt(cliente_id)) {
        throw new Error(`La factura ${factura.id} no pertenece al cliente seleccionado`);
      }
      const app = appsValidas.find(a => parseInt(a.factura_id) === parseInt(factura.id));
      if (app && parseFloat(app.monto_aplicado) > parseFloat(factura.saldo) + 0.01) {
        throw new Error(`El monto ($${parseFloat(app.monto_aplicado).toFixed(2)}) supera el saldo de la factura ${factura.id} ($${parseFloat(factura.saldo).toFixed(2)})`);
      }
    }

    const estado = totalApps >= totalItems - 0.01 ? 'aplicado' : 'parcial';

    const pagoResult = await client.query(`
      INSERT INTO pagos (cliente_id, fecha_recepcion, monto_total, estado, numero_talonario, observaciones)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [cliente_id, fecha_recepcion, totalItems, estado, numero_talonario || null, observaciones || null]);
    const pagoId = pagoResult.rows[0].id;

    const itemsInsertados = [];
    for (const item of itemsValidos) {
      const {
        tipo, monto,
        cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro,
        transferencia_banco_origen, transferencia_banco_destino,
        transferencia_numero_operacion, transferencia_fecha,
        observaciones: obsItem
      } = item;

      const itemResult = await client.query(`
        INSERT INTO pago_items (
          pago_id, tipo, monto,
          cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro,
          transferencia_banco_origen, transferencia_banco_destino,
          transferencia_numero_operacion, transferencia_fecha, observaciones
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id
      `, [pagoId, tipo, monto,
          cheque_numero || null, cheque_banco || null,
          cheque_fecha_emision || null, cheque_fecha_cobro || null,
          transferencia_banco_origen || null, transferencia_banco_destino || null,
          transferencia_numero_operacion || null, transferencia_fecha || null,
          obsItem || null]);

      const itemId = itemResult.rows[0].id;
      itemsInsertados.push({ id: itemId, tipo, monto });

      if (tipo === 'CHEQUE') {
        if (!cheque_numero || !cheque_banco || !cheque_fecha_cobro) {
          throw new Error('Los cheques requieren número, banco y fecha de cobro');
        }
        await client.query(`
          INSERT INTO cheques_propios
            (pago_item_id, numero_cheque, banco, fecha_emision, fecha_cobro, monto, estado)
          VALUES ($1,$2,$3,$4,$5,$6,'pendiente')
        `, [itemId, cheque_numero, cheque_banco,
            cheque_fecha_emision || null, cheque_fecha_cobro, monto]);
      }
    }

    const aplicacionesInsertadas = [];
    for (const ap of appsValidas) {
      const monto = parseFloat(ap.monto_aplicado);

      const updateResult = await client.query(`
        UPDATE facturas
        SET
          saldo  = saldo - $1,
          estado = CASE
            WHEN saldo - $1 <= 0.01 THEN 'pagada'
            WHEN saldo - $1 < total THEN 'parcial'
            ELSE estado
          END
        WHERE id = $2 AND saldo >= $1
        RETURNING id, saldo as saldo_nuevo
      `, [monto, ap.factura_id]);

      if (updateResult.rowCount === 0) {
        throw new Error(`No se pudo aplicar $${monto.toFixed(2)} a factura ${ap.factura_id}: saldo insuficiente`);
      }

      await client.query(`
        INSERT INTO aplicacion_pagos (pago_id, factura_id, monto_aplicado, fecha_aplicacion)
        VALUES ($1, $2, $3, NOW())
      `, [pagoId, ap.factura_id, monto]);

      aplicacionesInsertadas.push({
        factura_id:     ap.factura_id,
        monto_aplicado: monto,
        saldo_nuevo:    parseFloat(updateResult.rows[0].saldo_nuevo)
      });
    }

    await client.query('COMMIT');

    res.status(201).json({
      mensaje:           'Pago registrado y aplicado correctamente',
      pago_id:           pagoId,
      estado,
      monto_total:       totalItems,
      total_aplicado:    totalApps,
      saldo_sin_aplicar: parseFloat((totalItems - totalApps).toFixed(2)),
      items:             itemsInsertados,
      aplicaciones:      aplicacionesInsertadas
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al registrar pago:', error);
    res.status(500).json({ error: error.message || 'Error al registrar el pago' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// 5. APLICAR SALDO RESTANTE (pagos en estado 'parcial')
// ---------------------------------------------------------------
router.post('/pagos/:id/aplicar', async (req, res) => {
  const pagoId = parseInt(req.params.id);
  const { aplicaciones } = req.body;

  if (!aplicaciones || aplicaciones.length === 0) {
    return res.status(400).json({ error: 'Debe especificar al menos una factura' });
  }

  const appsValidas = aplicaciones.filter(ap => parseFloat(ap.monto_aplicado) > 0);
  if (appsValidas.length === 0) {
    return res.status(400).json({ error: 'Los montos deben ser mayores a 0' });
  }

  const totalAplicar = appsValidas.reduce((s, a) => s + parseFloat(a.monto_aplicado), 0);

  const pagoCheck = await pool.query(
    'SELECT id, estado, monto_total, cliente_id FROM pagos WHERE id = $1', [pagoId]
  );
  if (pagoCheck.rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });
  if (!['pendiente', 'parcial'].includes(pagoCheck.rows[0].estado)) {
    return res.status(400).json({ error: 'El pago ya fue aplicado completamente' });
  }

  const pago = pagoCheck.rows[0];
  const historicoResult = await pool.query(
    'SELECT COALESCE(SUM(monto_aplicado), 0) as ya_aplicado FROM aplicacion_pagos WHERE pago_id = $1',
    [pagoId]
  );
  const yaAplicado      = parseFloat(historicoResult.rows[0].ya_aplicado);
  const saldoDisponible = parseFloat(pago.monto_total) - yaAplicado;

  if (totalAplicar > saldoDisponible + 0.01) {
    return res.status(400).json({
      error: `El monto ($${totalAplicar.toFixed(2)}) supera el saldo disponible ($${saldoDisponible.toFixed(2)})`,
      saldo_disponible: saldoDisponible
    });
  }

  const facturaIds = [...new Set(appsValidas.map(a => a.factura_id))];
  const facturasCheck = await pool.query(
    'SELECT id FROM facturas WHERE id = ANY($1::int[])', [facturaIds]
  );
  if (facturasCheck.rows.length !== facturaIds.length) {
    return res.status(400).json({ error: 'Una o más facturas no existen' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const facturasLocked = await client.query(
      'SELECT id, saldo, cliente_id FROM facturas WHERE id = ANY($1::int[]) FOR UPDATE',
      [facturaIds]
    );

    for (const factura of facturasLocked.rows) {
      if (parseInt(factura.cliente_id) !== parseInt(pago.cliente_id)) {
        throw new Error(`La factura ${factura.id} no pertenece al cliente del pago`);
      }
    }

    const aplicacionesInsertadas = [];
    for (const ap of appsValidas) {
      const monto = parseFloat(ap.monto_aplicado);

      const updateResult = await client.query(`
        UPDATE facturas
        SET
          saldo  = saldo - $1,
          estado = CASE
            WHEN saldo - $1 <= 0.01 THEN 'pagada'
            WHEN saldo - $1 < total THEN 'parcial'
            ELSE estado
          END
        WHERE id = $2 AND saldo >= $1
        RETURNING id, saldo as saldo_nuevo
      `, [monto, ap.factura_id]);

      if (updateResult.rowCount === 0) {
        throw new Error(`No se pudo aplicar $${monto.toFixed(2)} a factura ${ap.factura_id}`);
      }

      await client.query(`
        INSERT INTO aplicacion_pagos (pago_id, factura_id, monto_aplicado, fecha_aplicacion)
        VALUES ($1, $2, $3, NOW())
      `, [pagoId, ap.factura_id, monto]);

      aplicacionesInsertadas.push({
        factura_id:     ap.factura_id,
        monto_aplicado: monto,
        saldo_nuevo:    parseFloat(updateResult.rows[0].saldo_nuevo)
      });
    }

    const nuevoAcumulado = yaAplicado + totalAplicar;
    const nuevoEstado = nuevoAcumulado >= parseFloat(pago.monto_total) - 0.01 ? 'aplicado' : 'parcial';
    await client.query('UPDATE pagos SET estado = $1 WHERE id = $2', [nuevoEstado, pagoId]);

    await client.query('COMMIT');

    res.json({
      mensaje:          'Aplicación registrada correctamente',
      monto_aplicado:   totalAplicar,
      total_acumulado:  nuevoAcumulado,
      saldo_restante:   parseFloat((parseFloat(pago.monto_total) - nuevoAcumulado).toFixed(2)),
      estado:           nuevoEstado,
      aplicaciones:     aplicacionesInsertadas
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al aplicar pago:', error);
    res.status(500).json({ error: error.message || 'Error al aplicar el pago' });
  } finally {
    client.release();
  }
});

// 6. Listar pagos con filtros
router.get('/pagos', async (req, res) => {
  const { cliente_id, desde, hasta, estado } = req.query;
  let query = `
    SELECT
      p.id, p.fecha_recepcion, p.monto_total, p.estado,
      p.numero_talonario, p.observaciones,
      c.nombre as cliente_nombre,
      (SELECT json_agg(json_build_object('tipo', pi.tipo, 'monto', pi.monto))
       FROM pago_items pi WHERE pi.pago_id = p.id) as items,
      (SELECT COALESCE(SUM(ap.monto_aplicado), 0)
       FROM aplicacion_pagos ap WHERE ap.pago_id = p.id) as total_aplicado
    FROM pagos p
    JOIN clientes c ON p.cliente_id = c.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (cliente_id) { query += ` AND p.cliente_id = $${idx++}`; params.push(cliente_id); }
  if (desde)      { query += ` AND p.fecha_recepcion >= $${idx++}`; params.push(desde); }
  if (hasta)      { query += ` AND p.fecha_recepcion <= $${idx++}`; params.push(hasta); }
  if (estado)     { query += ` AND p.estado = $${idx++}`; params.push(estado); }

  query += ' ORDER BY p.fecha_recepcion DESC, p.id DESC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al listar pagos' });
  }
});

// 7. Trazabilidad completa de un pago
router.get('/pagos/:id/trazabilidad', async (req, res) => {
  const { id } = req.params;
  try {
    const pagoRes = await pool.query(`
      SELECT p.*, c.nombre as cliente_nombre
      FROM pagos p JOIN clientes c ON p.cliente_id = c.id
      WHERE p.id = $1
    `, [id]);
    if (pagoRes.rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });
    const pago = pagoRes.rows[0];

    const itemsRes = await pool.query(`
      SELECT
        pi.id, pi.tipo, pi.monto,
        pi.cheque_numero, pi.cheque_banco, pi.cheque_fecha_emision, pi.cheque_fecha_cobro,
        pi.transferencia_banco_origen, pi.transferencia_banco_destino,
        pi.transferencia_numero_operacion, pi.transferencia_fecha,
        cp.id as cheque_id, cp.estado as cheque_estado,
        cp.fecha_depositado, cp.fecha_acreditado,
        cp.motivo_rechazo, cp.gasto_comision
      FROM pago_items pi
      LEFT JOIN cheques_propios cp ON pi.id = cp.pago_item_id
      WHERE pi.pago_id = $1
    `, [id]);

    const appsRes = await pool.query(`
      SELECT
        ap.id, ap.factura_id, ap.monto_aplicado, ap.fecha_aplicacion,
        f.numero_factura, f.fecha as fecha_factura,
        f.total as total_factura, f.saldo as saldo_factura
      FROM aplicacion_pagos ap
      JOIN facturas f ON ap.factura_id = f.id
      WHERE ap.pago_id = $1
      ORDER BY ap.fecha_aplicacion ASC
    `, [id]);

    const totalAplicado   = appsRes.rows.reduce((s, a) => s + parseFloat(a.monto_aplicado), 0);
    const saldoSinAplicar = parseFloat(pago.monto_total) - totalAplicado;

    res.json({
      pago,
      items:             itemsRes.rows,
      aplicaciones:      appsRes.rows,
      total_aplicado:    totalAplicado,
      saldo_sin_aplicar: parseFloat(saldoSinAplicar.toFixed(2))
    });
  } catch (error) {
    console.error('Error en trazabilidad:', error);
    res.status(500).json({ error: 'Error al obtener trazabilidad' });
  }
});

// 8. Detalle básico de un pago
router.get('/pagos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const pagoResult = await pool.query(`
      SELECT p.*, c.nombre as cliente_nombre
      FROM pagos p JOIN clientes c ON p.cliente_id = c.id
      WHERE p.id = $1
    `, [id]);
    if (pagoResult.rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });

    const itemsResult = await pool.query(`
      SELECT pi.*,
        cp.id as cheque_id, cp.estado as cheque_estado
      FROM pago_items pi
      LEFT JOIN cheques_propios cp ON pi.id = cp.pago_item_id
      WHERE pi.pago_id = $1
    `, [id]);

    const pago = pagoResult.rows[0];
    pago.items = itemsResult.rows;
    res.json(pago);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener detalle del pago' });
  }
});

// ---------------------------------------------------------------
// CHEQUES — ciclo de vida completo
// ---------------------------------------------------------------

// 9. Listar cheques
router.get('/cheques', async (req, res) => {
  const { cliente_id, estado, desde, hasta } = req.query;
  let query = `
    SELECT
      cp.id as cheque_id,
      pi.id as pago_item_id,
      pi.monto, pi.cheque_numero, pi.cheque_banco,
      pi.cheque_fecha_emision, pi.cheque_fecha_cobro,
      cp.estado as cheque_estado,
      cp.fecha_depositado, cp.fecha_acreditado,
      cp.motivo_rechazo, cp.gasto_comision, cp.es_reemplazo,
      p.id as pago_id, p.fecha_recepcion as pago_fecha, p.numero_talonario,
      c.id as cliente_id, c.nombre as cliente_nombre
    FROM cheques_propios cp
    JOIN pago_items pi ON cp.pago_item_id = pi.id
    JOIN pagos p ON pi.pago_id = p.id
    JOIN clientes c ON p.cliente_id = c.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (cliente_id) { query += ` AND p.cliente_id = $${idx++}`;          params.push(cliente_id); }
  if (estado)     { query += ` AND cp.estado = $${idx++}`;              params.push(estado); }
  if (desde)      { query += ` AND pi.cheque_fecha_cobro >= $${idx++}`; params.push(desde); }
  if (hasta)      { query += ` AND pi.cheque_fecha_cobro <= $${idx++}`; params.push(hasta); }

  query += ' ORDER BY pi.cheque_fecha_cobro ASC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al listar cheques' });
  }
});

// 10. Detalle de cheque
router.get('/cheques/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT
        cp.*,
        pi.monto, pi.cheque_numero, pi.cheque_banco,
        pi.cheque_fecha_emision, pi.cheque_fecha_cobro,
        p.id as pago_id, p.fecha_recepcion, p.numero_talonario,
        c.nombre as cliente_nombre
      FROM cheques_propios cp
      JOIN pago_items pi ON cp.pago_item_id = pi.id
      JOIN pagos p ON pi.pago_id = p.id
      JOIN clientes c ON p.cliente_id = c.id
      WHERE cp.id = $1
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Cheque no encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener cheque' });
  }
});

// 11. Depositar cheque
router.post('/cheques/:id/depositar', async (req, res) => {
  const { id } = req.params;
  const { fecha_depositado } = req.body;
  try {
    const check = await pool.query('SELECT estado FROM cheques_propios WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Cheque no encontrado' });
    if (check.rows[0].estado !== 'pendiente') {
      return res.status(400).json({ error: 'Solo se pueden depositar cheques pendientes' });
    }
    await pool.query(`
      UPDATE cheques_propios
      SET estado = 'depositado', fecha_depositado = COALESCE($1::date, CURRENT_DATE)
      WHERE id = $2
    `, [fecha_depositado || null, id]);
    res.json({ message: 'Cheque depositado correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al depositar cheque' });
  }
});

// 12. Acreditar cheque
router.put('/cheques/:id/acreditar', async (req, res) => {
  const { id } = req.params;
  try {
    const check = await pool.query('SELECT estado FROM cheques_propios WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Cheque no encontrado' });
    if (check.rows[0].estado !== 'depositado') {
      return res.status(400).json({ error: 'Solo se pueden acreditar cheques depositados' });
    }
    await pool.query(`
      UPDATE cheques_propios
      SET estado = 'acreditado', fecha_acreditado = CURRENT_DATE
      WHERE id = $1
    `, [id]);
    res.json({ message: 'Cheque acreditado correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al acreditar cheque' });
  }
});

// 13. Rechazar cheque (con reemplazo opcional)
router.post('/cheques/:id/rechazar', async (req, res) => {
  const { id } = req.params;
  const { motivo_rechazo, gasto_comision, nuevo_cheque } = req.body;

  if (!motivo_rechazo) return res.status(400).json({ error: 'El motivo de rechazo es obligatorio' });

  const chequeActual = await pool.query(
    `SELECT cp.estado, cp.pago_item_id, pi.pago_id
     FROM cheques_propios cp
     JOIN pago_items pi ON cp.pago_item_id = pi.id
     WHERE cp.id = $1`, [id]
  );
  if (chequeActual.rows.length === 0) return res.status(404).json({ error: 'Cheque no encontrado' });
  if (chequeActual.rows[0].estado !== 'pendiente') {
    return res.status(400).json({ error: 'Solo se pueden rechazar cheques pendientes' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE cheques_propios
      SET estado = 'rechazado', motivo_rechazo = $1,
          gasto_comision = $2, fecha_rechazo = CURRENT_DATE
      WHERE id = $3
    `, [motivo_rechazo, gasto_comision || 0, id]);

    if (nuevo_cheque) {
      const { pago_id, numero_cheque, banco, fecha_emision, fecha_cobro, monto } = nuevo_cheque;
      if (!pago_id || !numero_cheque || !banco || !fecha_cobro || !monto) {
        throw new Error('Datos incompletos para el cheque de reemplazo');
      }
      const newItem = await client.query(`
        INSERT INTO pago_items
          (pago_id, tipo, monto, cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro)
        VALUES ($1,'CHEQUE',$2,$3,$4,$5,$6)
        RETURNING id
      `, [pago_id, monto, numero_cheque, banco, fecha_emision || null, fecha_cobro]);

      await client.query(`
        INSERT INTO cheques_propios
          (pago_item_id, numero_cheque, banco, fecha_emision, fecha_cobro,
           monto, estado, es_reemplazo, cheque_reemplazado_id)
        VALUES ($1,$2,$3,$4,$5,$6,'pendiente',true,$7)
      `, [newItem.rows[0].id, numero_cheque, banco,
          fecha_emision || null, fecha_cobro, monto, id]);
    }

    await client.query('COMMIT');
    res.json({ message: 'Cheque rechazado registrado' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: error.message || 'Error al rechazar cheque' });
  } finally {
    client.release();
  }
});

module.exports = router;

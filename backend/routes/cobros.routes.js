/* =====================================================================
 * COBROS A CLIENTES
 * ---------------------------------------------------------------------
 * Reemplaza a pagos-clientes.routes.js. Montado en /api/cobros.
 *
 * Reglas de negocio (decididas 13/09/2026):
 *  1. El saldo NUNCA se guarda: se calcula siempre en vivo como
 *     factura.total - notas de crédito - imputaciones acreditadas.
 *  2. Un cheque cancela deuda RECIÉN cuando se acredita. Mientras está
 *     en cartera o depositado la factura sigue con saldo, pero se marca
 *     "en gestión de cobro" para que no parezca deuda olvidada.
 *  3. La imputación es item→factura (no cobro→factura). Por eso un
 *     cheque rechazado devuelve la deuda solo, sin revertir nada a mano.
 *  4. Se permite cobro a cuenta: un cobro puede quedar sin imputar y
 *     queda como saldo a favor del cliente.
 * ===================================================================== */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const {
  CTE_FACTURAS, CTE_A_FAVOR, EXCESO_COBRADO, ESTADO_FACTURA,
  resumenCliente, cuentaCorriente
} = require('../services/cuenta-cliente');
const { anularCobro } = require('../services/anulaciones');
const { generarPdfCobro } = require('../services/pdf-cobro');
const { nombreArchivo } = require('../services/pdf-base');

router.use(verificarToken);

// Todo este módulo es plata: lo ve y lo toca solo el administrador.
// Antes la constante de lectura incluía 'operario', así que un usuario de
// planta podía consultar por API la deuda, los cheques y las cuentas
// corrientes aunque el menú no le mostrara esas pantallas.

const TIPOS_ITEM = ['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'RETENCION'];
const ESTADOS_EN_GESTION = ['EN_CARTERA', 'DEPOSITADO'];

/* ---------------------------------------------------------------------
 * Helpers de dinero: se trabaja en centavos para no arrastrar errores
 * de punto flotante al comparar saldos.
 * ------------------------------------------------------------------- */
const cents = (v) => Math.round((parseFloat(v) || 0) * 100);
const pesos = (c) => Math.round(c) / 100;

function fallar(res, code, msg) {
  return res.status(code).json({ error: msg });
}

/* =====================================================================
 * 1. PANEL DE SEGUIMIENTO — "¿quién nos debe?"
 * ===================================================================*/

/* Totales generales + antigüedad de la deuda + cheques en cartera. */
router.get('/resumen', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH ${CTE_FACTURAS}
      SELECT
        COUNT(*) FILTER (WHERE saldo > 0.005)                                 AS facturas_con_saldo,
        COUNT(DISTINCT cliente_id) FILTER (WHERE saldo > 0.005)               AS clientes_con_deuda,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005), 0), 2)        AS deuda_total,
        ROUND(COALESCE(SUM(en_gestion), 0), 2)                                AS en_gestion,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso > 0), 0), 2)  AS vencido,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso <= 0), 0), 2) AS por_vencer,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso BETWEEN 1 AND 30), 0), 2)  AS atraso_1_30,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso BETWEEN 31 AND 60), 0), 2) AS atraso_31_60,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso BETWEEN 61 AND 90), 0), 2) AS atraso_61_90,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso > 90), 0), 2)              AS atraso_90_mas,
        ROUND(COALESCE(SUM(-saldo) FILTER (WHERE saldo < -0.005), 0), 2)                                 AS exceso_cobrado
      FROM facturas_saldo
    `);

    const cheques = await pool.query(`
      SELECT
        COUNT(*)                                                      AS cantidad,
        ROUND(COALESCE(SUM(monto), 0), 2)                             AS total,
        COUNT(*) FILTER (WHERE cheque_fecha_cobro <= CURRENT_DATE + 7) AS vencen_7_dias,
        ROUND(COALESCE(SUM(monto) FILTER (WHERE cheque_fecha_cobro <= CURRENT_DATE + 7), 0), 2) AS total_7_dias,
        COUNT(*) FILTER (WHERE cheque_fecha_cobro < CURRENT_DATE)      AS vencidos_sin_depositar
      FROM pago_items
      WHERE tipo = 'CHEQUE' AND estado IN ('EN_CARTERA','DEPOSITADO')
    `);

    const aFavor = await pool.query(`
      WITH ${CTE_A_FAVOR}
      SELECT ROUND(COALESCE(SUM(saldo_a_favor), 0), 2) AS total_a_favor
      FROM a_favor WHERE saldo_a_favor > 0.005
    `);

    res.json({
      deuda: rows[0],
      cheques_en_cartera: cheques.rows[0],
      saldo_a_favor: aFavor.rows[0].total_a_favor
    });
  } catch (err) {
    console.error('Error en resumen de cobros:', err);
    fallar(res, 500, err.message);
  }
});

/* Deuda por cliente. Es la tabla principal de la herramienta. */
router.get('/deuda', soloAdmin, async (req, res) => {
  const { buscar, solo_vencido, orden } = req.query;
  const incluirSinDeuda = req.query.incluir_sin_deuda === 'true';

  const ordenSql = {
    saldo: 'saldo DESC',
    vencido: 'vencido DESC, saldo DESC',
    atraso: 'dias_atraso_max DESC NULLS LAST, saldo DESC',
    nombre: 'cliente_nombre ASC'
  }[orden] || 'vencido DESC, saldo DESC';

  try {
    const params = [];
    let filtro = '';

    if (buscar) {
      params.push(`%${buscar}%`);
      filtro += ` AND (c.nombre ILIKE $${params.length} OR COALESCE(c.cuit,'') ILIKE $${params.length})`;
    }

    const { rows } = await pool.query(`
      WITH ${CTE_FACTURAS}, ${CTE_A_FAVOR}
      SELECT * FROM (
        SELECT
          c.id                                                         AS cliente_id,
          c.nombre                                                     AS cliente_nombre,
          c.cuit,
          c.telefono,
          c.correo,
          c.dias_max_pago,
          COUNT(fs.id) FILTER (WHERE fs.saldo > 0.005)                 AS facturas_pendientes,
          ROUND(COALESCE(SUM(fs.total), 0), 2)                         AS total_facturado,
          ROUND(COALESCE(SUM(fs.cobrado), 0), 2)                       AS total_cobrado,
          ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005), 0), 2) AS saldo,
          ROUND(COALESCE(SUM(fs.en_gestion), 0), 2)                    AS en_gestion,
          ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso > 0), 0), 2)  AS vencido,
          ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso <= 0), 0), 2) AS por_vencer,
          MAX(fs.dias_atraso) FILTER (WHERE fs.saldo > 0.005)          AS dias_atraso_max,
          MIN(fs.fecha_vencimiento) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso > 0) AS vencimiento_mas_viejo,
          ${EXCESO_COBRADO}                                            AS exceso_cobrado,
          ROUND(GREATEST(COALESCE(af.saldo_a_favor, 0), 0), 2)         AS saldo_a_favor
        FROM clientes c
        LEFT JOIN facturas_saldo fs ON fs.cliente_id = c.id
        LEFT JOIN a_favor af        ON af.cliente_id = c.id
        WHERE 1=1 ${filtro}
        GROUP BY c.id, c.nombre, c.cuit, c.telefono, c.correo, c.dias_max_pago, af.saldo_a_favor
      ) t
      WHERE ${incluirSinDeuda ? '1=1' : '(saldo > 0.005 OR saldo_a_favor > 0.005 OR exceso_cobrado > 0.005)'}
        ${solo_vencido === 'true' ? 'AND vencido > 0.005' : ''}
      ORDER BY ${ordenSql}
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('Error en deuda por cliente:', err);
    fallar(res, 500, err.message);
  }
});

/* Ficha de deuda de un cliente: totales + facturas + cheques + cobros. */
router.get('/clientes/:id', soloAdmin, async (req, res) => {
  const { id } = req.params;
  const soloPendientes = req.query.solo_pendientes !== 'false';

  try {
    const cli = await pool.query(
      'SELECT id, nombre, cuit, telefono, correo, direccion, forma_pago, dias_max_pago FROM clientes WHERE id = $1',
      [id]
    );
    if (!cli.rows.length) return fallar(res, 404, 'Cliente no encontrado');

    const facturas = await pool.query(`
      WITH ${CTE_FACTURAS}
      SELECT fs.*, ${ESTADO_FACTURA} AS estado
      FROM facturas_saldo fs
      WHERE fs.cliente_id = $1
        ${soloPendientes ? 'AND fs.saldo > 0.005' : ''}
      ORDER BY fs.fecha_vencimiento ASC, fs.id ASC
    `, [id]);

    const totales = await resumenCliente(pool, id);

    const cheques = await pool.query(`
      SELECT pi.id, pi.cheque_numero, pi.cheque_banco, pi.monto,
             pi.cheque_fecha_emision, pi.cheque_fecha_cobro, pi.estado,
             pi.endosado, (pi.cheque_fecha_cobro - CURRENT_DATE) AS dias_para_cobro
      FROM pago_items pi
      JOIN pagos p ON p.id = pi.pago_id
      WHERE p.cliente_id = $1 AND pi.tipo = 'CHEQUE'
        AND pi.estado IN ('EN_CARTERA','DEPOSITADO')
      ORDER BY pi.cheque_fecha_cobro ASC
    `, [id]);

    res.json({
      cliente: cli.rows[0],
      totales,
      facturas: facturas.rows,
      cheques_en_cartera: cheques.rows
    });
  } catch (err) {
    console.error('Error en ficha de cliente:', err);
    fallar(res, 500, err.message);
  }
});

/* Cuenta corriente: movimientos con saldo acumulado. */
router.get('/clientes/:id/cuenta-corriente', soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { desde, hasta } = req.query;

  try {
    const cli = await pool.query('SELECT id, nombre FROM clientes WHERE id = $1', [id]);
    if (!cli.rows.length) return fallar(res, 404, 'Cliente no encontrado');

    const movimientos = await cuentaCorriente(pool, id, req.query);

    res.json({ cliente: cli.rows[0], movimientos });
  } catch (err) {
    console.error('Error en cuenta corriente:', err);
    fallar(res, 500, err.message);
  }
});

/* Facturas con saldo de un cliente — alimenta el formulario de cobro. */
router.get('/clientes/:id/facturas-pendientes', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH ${CTE_FACTURAS}
      SELECT fs.*, ${ESTADO_FACTURA} AS estado
      FROM facturas_saldo fs
      WHERE fs.cliente_id = $1 AND fs.saldo > 0.005
      ORDER BY fs.fecha_vencimiento ASC, fs.id ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo facturas pendientes:', err);
    fallar(res, 500, err.message);
  }
});

/* =====================================================================
 * 2. MOTOR DE IMPUTACIÓN
 * ===================================================================*/

/**
 * Reparte `aplicaciones` [{factura_id, monto}] sobre los items del cobro.
 * Consume primero el dinero ya acreditado (efectivo, transferencia,
 * retención) y después los cheques por fecha de cobro más próxima, así
 * la parte de una factura que queda "en gestión" es la mínima posible.
 */
async function imputar(client, pagoId, clienteId, aplicaciones) {
  const itemsRes = await client.query(`
    SELECT pi.id, pi.tipo, pi.monto, pi.estado, pi.cheque_fecha_cobro,
           COALESCE((SELECT SUM(ap.monto_aplicado)
                     FROM aplicacion_pagos ap WHERE ap.pago_item_id = pi.id), 0) AS imputado
    FROM pago_items pi
    WHERE pi.pago_id = $1 AND pi.estado NOT IN ('RECHAZADO','ANULADO')
    ORDER BY (pi.estado = 'ACREDITADO') DESC, pi.cheque_fecha_cobro ASC NULLS FIRST, pi.id ASC
  `, [pagoId]);

  const items = itemsRes.rows.map(i => ({
    id: i.id,
    disponible: cents(i.monto) - cents(i.imputado)
  }));

  const resultado = [];

  for (const ap of aplicaciones) {
    const facturaId = parseInt(ap.factura_id, 10);
    let aImputar = cents(ap.monto ?? ap.monto_aplicado);

    if (!facturaId || aImputar <= 0) {
      throw new Error('Imputación inválida: falta factura o el monto no es positivo');
    }

    // Bloquear la factura y recalcular su saldo dentro de la transacción
    await client.query('SELECT id FROM facturas WHERE id = $1 FOR UPDATE', [facturaId]);
    const fac = await client.query(`
      WITH ${CTE_FACTURAS}
      SELECT fs.* FROM facturas_saldo fs WHERE fs.id = $1
    `, [facturaId]);

    if (!fac.rows.length) throw new Error(`La factura ${facturaId} no existe`);
    const factura = fac.rows[0];

    if (parseInt(factura.cliente_id, 10) !== parseInt(clienteId, 10)) {
      throw new Error(`La factura ${factura.numero_factura} es de otro cliente`);
    }

    // El saldo tope incluye lo que ya está en gestión: no se puede imputar
    // dos veces la misma plata aunque todavía no esté acreditada.
    const tope = cents(factura.saldo) - cents(factura.en_gestion);
    if (aImputar > tope + 1) {
      throw new Error(
        `No se puede imputar $${pesos(aImputar).toFixed(2)} a la factura ${factura.numero_factura}: ` +
        `su saldo disponible es $${pesos(tope).toFixed(2)}` +
        (cents(factura.en_gestion) > 0
          ? ` (tiene $${parseFloat(factura.en_gestion).toFixed(2)} en gestión de cobro)` : '')
      );
    }
    if (aImputar > tope) aImputar = tope; // absorber diferencia de redondeo

    let restante = aImputar;
    for (const item of items) {
      if (restante <= 0) break;
      if (item.disponible <= 0) continue;
      const usar = Math.min(restante, item.disponible);
      await client.query(
        `INSERT INTO aplicacion_pagos (pago_id, pago_item_id, factura_id, monto_aplicado)
         VALUES ($1, $2, $3, $4)`,
        [pagoId, item.id, facturaId, pesos(usar)]
      );
      item.disponible -= usar;
      restante -= usar;
    }

    if (restante > 0) {
      throw new Error(
        `El cobro no tiene saldo disponible suficiente: faltan $${pesos(restante).toFixed(2)} ` +
        `para imputar a la factura ${factura.numero_factura}`
      );
    }

    resultado.push({ factura_id: facturaId, numero_factura: factura.numero_factura, monto: pesos(aImputar) });
  }

  return resultado;
}

/** Imputación automática FIFO: cancela primero lo más vencido. */
async function imputarAutomatico(client, pagoId, clienteId) {
  const disponibleRes = await client.query(`
    SELECT COALESCE(SUM(pi.monto - COALESCE(ap.imputado, 0)), 0) AS disponible
    FROM pago_items pi
    LEFT JOIN (SELECT pago_item_id, SUM(monto_aplicado) AS imputado
               FROM aplicacion_pagos GROUP BY pago_item_id) ap ON ap.pago_item_id = pi.id
    WHERE pi.pago_id = $1 AND pi.estado NOT IN ('RECHAZADO','ANULADO')
  `, [pagoId]);

  let disponible = cents(disponibleRes.rows[0].disponible);
  if (disponible <= 0) return [];

  const facturas = await client.query(`
    WITH ${CTE_FACTURAS}
    SELECT fs.id, fs.saldo, fs.en_gestion
    FROM facturas_saldo fs
    WHERE fs.cliente_id = $1 AND fs.saldo - fs.en_gestion > 0.005
    ORDER BY fs.fecha_vencimiento ASC, fs.id ASC
  `, [clienteId]);

  const aplicaciones = [];
  for (const f of facturas.rows) {
    if (disponible <= 0) break;
    const tope = cents(f.saldo) - cents(f.en_gestion);
    const usar = Math.min(disponible, tope);
    if (usar <= 0) continue;
    aplicaciones.push({ factura_id: f.id, monto: pesos(usar) });
    disponible -= usar;
  }

  return aplicaciones.length ? imputar(client, pagoId, clienteId, aplicaciones) : [];
}

/* Valida y normaliza un item de cobro venido del frontend. */
function normalizarItem(item, fechaRecepcion) {
  const tipo = String(item.tipo || '').toUpperCase();
  if (!TIPOS_ITEM.includes(tipo)) {
    throw new Error(`Forma de cobro inválida: "${item.tipo}"`);
  }

  const monto = parseFloat(item.monto);
  if (!monto || monto <= 0) throw new Error('Cada forma de cobro necesita un monto mayor a cero');

  const base = {
    tipo,
    monto,
    observaciones: item.observaciones || null,
    cheque_numero: null, cheque_banco: null,
    cheque_fecha_emision: null, cheque_fecha_cobro: null,
    transferencia_banco_origen: null, transferencia_banco_destino: null,
    transferencia_numero_operacion: null, transferencia_fecha: null,
    retencion_tipo: null, retencion_certificado: null,
    estado: 'ACREDITADO',
    fecha_acreditacion: fechaRecepcion
  };

  if (tipo === 'CHEQUE') {
    if (!item.cheque_numero || !item.cheque_banco || !item.cheque_fecha_cobro) {
      throw new Error('Un cheque necesita número, banco y fecha de cobro');
    }
    base.cheque_numero = String(item.cheque_numero).trim();
    base.cheque_banco = String(item.cheque_banco).trim();
    base.cheque_fecha_emision = item.cheque_fecha_emision || null;
    base.cheque_fecha_cobro = item.cheque_fecha_cobro;
    base.estado = 'EN_CARTERA';          // no cancela deuda hasta acreditarse
    base.fecha_acreditacion = null;
  }

  if (tipo === 'TRANSFERENCIA') {
    base.transferencia_banco_origen = item.transferencia_banco_origen || null;
    base.transferencia_banco_destino = item.transferencia_banco_destino || null;
    base.transferencia_numero_operacion = item.transferencia_numero_operacion || null;
    base.transferencia_fecha = item.transferencia_fecha || fechaRecepcion;
    base.fecha_acreditacion = base.transferencia_fecha;
  }

  if (tipo === 'RETENCION') {
    if (!item.retencion_tipo) {
      throw new Error('Una retención necesita el impuesto (IIBB, Ganancias, IVA, SUSS)');
    }
    base.retencion_tipo = String(item.retencion_tipo).toUpperCase();
    base.retencion_certificado = item.retencion_certificado || null;
  }

  return base;
}

/* =====================================================================
 * 3. COBROS
 * ===================================================================*/

/* Historial de cobros. `estado` es calculado, no hay columna. */
router.get('/', soloAdmin, async (req, res) => {
  const { cliente_id, desde, hasta, estado } = req.query;
  const params = [];
  let filtro = '';

  if (cliente_id) { params.push(cliente_id); filtro += ` AND p.cliente_id = $${params.length}`; }
  if (desde)      { params.push(desde);      filtro += ` AND p.fecha_recepcion >= $${params.length}`; }
  if (hasta)      { params.push(hasta);      filtro += ` AND p.fecha_recepcion <= $${params.length}`; }

  try {
    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT
          p.id, p.cliente_id, p.fecha_recepcion, p.observaciones, p.anulado,
          p.recibo_id, r.numero_recibo,
          c.nombre AS cliente_nombre,
          ROUND(p.monto_total, 2) AS monto_total,
          ROUND(COALESCE(t.imputado, 0), 2)   AS imputado,
          ROUND(COALESCE(t.disponible, 0), 2) AS disponible,
          ROUND(COALESCE(t.en_gestion, 0), 2) AS en_gestion,
          ROUND(COALESCE(t.rechazado, 0), 2)  AS rechazado,
          COALESCE(t.rechazado, 0) > 0.005    AS tiene_rechazo,
          t.formas,
          CASE
            WHEN p.anulado                              THEN 'ANULADO'
            WHEN COALESCE(t.disponible, 0) <= 0.005     THEN 'IMPUTADO'
            WHEN COALESCE(t.imputado, 0) > 0.005        THEN 'PARCIAL'
            ELSE 'A_CUENTA'
          END AS estado
        FROM pagos p
        LEFT JOIN clientes c ON c.id = p.cliente_id
        LEFT JOIN recibos  r ON r.id = p.recibo_id
        LEFT JOIN (
          SELECT
            pi.pago_id,
            SUM(CASE WHEN pi.estado IN ('RECHAZADO','ANULADO') THEN 0
                     ELSE COALESCE(ap.imputado, 0) END)                                AS imputado,
            SUM(CASE WHEN pi.estado IN ('RECHAZADO','ANULADO') THEN 0
                     ELSE pi.monto - COALESCE(ap.imputado, 0) END)                     AS disponible,
            SUM(CASE WHEN pi.estado IN ('EN_CARTERA','DEPOSITADO')
                     THEN COALESCE(ap.imputado, 0) ELSE 0 END)                         AS en_gestion,
            SUM(CASE WHEN pi.estado = 'RECHAZADO' THEN pi.monto ELSE 0 END)            AS rechazado,
            string_agg(DISTINCT pi.tipo, ' + ' ORDER BY pi.tipo)                       AS formas
          FROM pago_items pi
          LEFT JOIN (SELECT pago_item_id, SUM(monto_aplicado) AS imputado
                     FROM aplicacion_pagos GROUP BY pago_item_id) ap ON ap.pago_item_id = pi.id
          GROUP BY pi.pago_id
        ) t ON t.pago_id = p.id
        WHERE 1=1 ${filtro}
      ) q
      ${estado ? 'WHERE q.estado = $' + (params.push(estado.toUpperCase())) : ''}
      ORDER BY q.fecha_recepcion DESC, q.id DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('Error listando cobros:', err);
    fallar(res, 500, err.message);
  }
});

/* Registrar un cobro (opcionalmente imputándolo en el mismo paso). */
router.post('/', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { cliente_id, fecha_recepcion, observaciones, items, aplicaciones, imputar_automatico } = req.body;

    if (!cliente_id || !fecha_recepcion) throw new Error('Falta el cliente o la fecha del cobro');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Agregá al menos una forma de cobro');

    const cli = await client.query('SELECT id FROM clientes WHERE id = $1', [cliente_id]);
    if (!cli.rows.length) throw new Error('El cliente no existe');

    const normalizados = items.map(i => normalizarItem(i, fecha_recepcion));
    const montoTotal = pesos(normalizados.reduce((acc, i) => acc + cents(i.monto), 0));

    // Evitar cargar dos veces el mismo cheque
    for (const it of normalizados.filter(i => i.tipo === 'CHEQUE')) {
      const dup = await client.query(`
        SELECT pi.id FROM pago_items pi
        WHERE pi.tipo = 'CHEQUE'
          AND upper(trim(pi.cheque_numero)) = upper($1)
          AND upper(trim(COALESCE(pi.cheque_banco,''))) = upper($2)
          AND pi.estado <> 'ANULADO'
      `, [it.cheque_numero, it.cheque_banco]);
      if (dup.rows.length) {
        throw new Error(`El cheque ${it.cheque_numero} del ${it.cheque_banco} ya está cargado (item #${dup.rows[0].id})`);
      }
    }

    const pagoRes = await client.query(`
      INSERT INTO pagos (cliente_id, fecha_recepcion, monto_total, observaciones)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [cliente_id, fecha_recepcion, montoTotal, observaciones || null]);

    const pago = pagoRes.rows[0];

    for (const it of normalizados) {
      await client.query(`
        INSERT INTO pago_items
          (pago_id, tipo, monto, observaciones, estado, fecha_acreditacion,
           cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro,
           transferencia_banco_origen, transferencia_banco_destino,
           transferencia_numero_operacion, transferencia_fecha,
           retencion_tipo, retencion_certificado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      `, [
        pago.id, it.tipo, it.monto, it.observaciones, it.estado, it.fecha_acreditacion,
        it.cheque_numero, it.cheque_banco, it.cheque_fecha_emision, it.cheque_fecha_cobro,
        it.transferencia_banco_origen, it.transferencia_banco_destino,
        it.transferencia_numero_operacion, it.transferencia_fecha,
        it.retencion_tipo, it.retencion_certificado
      ]);
    }

    let imputado = [];
    if (Array.isArray(aplicaciones) && aplicaciones.length) {
      imputado = await imputar(client, pago.id, cliente_id, aplicaciones);
    } else if (imputar_automatico) {
      imputado = await imputarAutomatico(client, pago.id, cliente_id);
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: imputado.length
        ? `Cobro registrado e imputado a ${imputado.length} factura(s)`
        : 'Cobro registrado a cuenta (sin imputar)',
      pago_id: pago.id,
      monto_total: montoTotal,
      imputaciones: imputado
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error registrando cobro:', err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
});

/* Deshacer una imputación puntual (imputé a la factura equivocada). */
router.delete('/imputaciones/:id', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM aplicacion_pagos WHERE id = $1 RETURNING *', [req.params.id]
    );
    if (!rows.length) return fallar(res, 404, 'Imputación no encontrada');
    res.json({ message: 'Imputación deshecha', imputacion: rows[0] });
  } catch (err) {
    console.error('Error deshaciendo imputación:', err);
    fallar(res, 500, err.message);
  }
});

/* =====================================================================
 * 4. CHEQUES
 * ===================================================================*/

router.get('/cheques', soloAdmin, async (req, res) => {
  const { cliente_id, estado, desde, hasta } = req.query;
  const params = [];
  let filtro = '';

  if (cliente_id) { params.push(cliente_id); filtro += ` AND p.cliente_id = $${params.length}`; }
  if (estado)     { params.push(estado.toUpperCase()); filtro += ` AND pi.estado = $${params.length}`; }
  if (desde)      { params.push(desde); filtro += ` AND pi.cheque_fecha_cobro >= $${params.length}`; }
  if (hasta)      { params.push(hasta); filtro += ` AND pi.cheque_fecha_cobro <= $${params.length}`; }

  try {
    const { rows } = await pool.query(`
      SELECT
        pi.id, pi.cheque_numero, pi.cheque_banco, pi.monto, pi.estado,
        pi.cheque_fecha_emision, pi.cheque_fecha_cobro, pi.cheque_fecha_depositado,
        pi.cheque_motivo_rechazo, pi.cheque_gasto_comision,
        pi.endosado, pi.endosado_a_proveedor_id, pi.fecha_endoso,
        prov.nombre AS endosado_a,
        p.id AS pago_id, p.fecha_recepcion, p.cliente_id, c.nombre AS cliente_nombre,
        (pi.cheque_fecha_cobro - CURRENT_DATE) AS dias_para_cobro,
        COALESCE((SELECT SUM(ap.monto_aplicado) FROM aplicacion_pagos ap
                  WHERE ap.pago_item_id = pi.id), 0) AS imputado,
        (SELECT string_agg(f.numero_factura, ', ' ORDER BY f.numero_factura)
           FROM aplicacion_pagos ap JOIN facturas f ON f.id = ap.factura_id
          WHERE ap.pago_item_id = pi.id) AS facturas
      FROM pago_items pi
      JOIN pagos p        ON p.id = pi.pago_id
      JOIN clientes c     ON c.id = p.cliente_id
      LEFT JOIN proveedores prov ON prov.id = pi.endosado_a_proveedor_id
      WHERE pi.tipo = 'CHEQUE' ${filtro}
      ORDER BY pi.cheque_fecha_cobro ASC, pi.id DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('Error listando cheques:', err);
    fallar(res, 500, err.message);
  }
});

router.get('/cheques/alertas', soloAdmin, async (req, res) => {
  const dias = parseInt(req.query.dias, 10) || 7;
  try {
    const { rows } = await pool.query(`
      SELECT pi.id, pi.cheque_numero, pi.cheque_banco, pi.monto, pi.estado,
             pi.cheque_fecha_cobro, c.nombre AS cliente_nombre,
             (pi.cheque_fecha_cobro - CURRENT_DATE) AS dias_para_cobro
      FROM pago_items pi
      JOIN pagos p    ON p.id = pi.pago_id
      JOIN clientes c ON c.id = p.cliente_id
      WHERE pi.tipo = 'CHEQUE'
        AND pi.estado IN ('EN_CARTERA','DEPOSITADO')
        AND pi.cheque_fecha_cobro <= CURRENT_DATE + $1::int
      ORDER BY pi.cheque_fecha_cobro ASC
    `, [dias]);

    res.json({
      dias,
      cantidad: rows.length,
      total: pesos(rows.reduce((a, r) => a + cents(r.monto), 0)),
      cheques: rows
    });
  } catch (err) {
    console.error('Error en alertas de cheques:', err);
    fallar(res, 500, err.message);
  }
});

/* Cambios de estado del cheque. Solo ACREDITADO cancela deuda. */
async function cambiarEstadoCheque(req, res, { desde, hacia, extra }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const chq = await client.query(
      `SELECT * FROM pago_items WHERE id = $1 AND tipo = 'CHEQUE' FOR UPDATE`,
      [req.params.id]
    );
    if (!chq.rows.length) throw new Error('Cheque no encontrado');

    const cheque = chq.rows[0];
    if (!desde.includes(cheque.estado)) {
      throw new Error(`Un cheque ${cheque.estado} no se puede pasar a ${hacia}`);
    }

    const campos = extra(req.body, cheque);
    const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`);
    const valores = Object.values(campos);

    const { rows } = await client.query(`
      UPDATE pago_items
      SET estado = $${valores.length + 2}, updated_at = now()${sets.length ? ', ' + sets.join(', ') : ''}
      WHERE id = $1 RETURNING *
    `, [req.params.id, ...valores, hacia]);

    await client.query('COMMIT');
    res.json({ estado: hacia, cheque: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Error pasando cheque a ${hacia}:`, err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
}

router.post('/cheques/:id/depositar', soloAdmin, (req, res) =>
  cambiarEstadoCheque(req, res, {
    desde: ['EN_CARTERA'],
    hacia: 'DEPOSITADO',
    extra: (body) => ({ cheque_fecha_depositado: body.fecha || new Date().toISOString().slice(0, 10) })
  })
);

router.post('/cheques/:id/acreditar', soloAdmin, (req, res) =>
  cambiarEstadoCheque(req, res, {
    desde: ['EN_CARTERA', 'DEPOSITADO'],
    hacia: 'ACREDITADO',
    extra: (body, cheque) => ({
      fecha_acreditacion: body.fecha || new Date().toISOString().slice(0, 10),
      cheque_gasto_comision: body.gasto_comision ?? cheque.cheque_gasto_comision ?? 0
    })
  })
);

/* El rechazo NO revierte nada a mano: al dejar de estar ACREDITADO/EN_CARTERA,
   sus imputaciones dejan de contar y la deuda reaparece sola. */
router.post('/cheques/:id/rechazar', soloAdmin, (req, res) =>
  cambiarEstadoCheque(req, res, {
    desde: ['EN_CARTERA', 'DEPOSITADO', 'ACREDITADO'],
    hacia: 'RECHAZADO',
    extra: (body) => ({
      cheque_motivo_rechazo: body.motivo || 'Sin fondos',
      cheque_gasto_comision: body.gasto_comision || 0,
      fecha_acreditacion: null
    })
  })
);

/* Endoso a proveedor. Registra en endosos_cheques (que es lo que mira
   el módulo de Proveedores) además de marcar el item. */
router.post('/cheques/:id/endosar', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { proveedor_id, fecha_endoso, observaciones } = req.body;
    if (!proveedor_id) throw new Error('Falta el proveedor al que se endosa');

    const chq = await client.query(
      `SELECT * FROM pago_items WHERE id = $1 AND tipo = 'CHEQUE' FOR UPDATE`, [req.params.id]
    );
    if (!chq.rows.length) throw new Error('Cheque no encontrado');

    const cheque = chq.rows[0];
    if (cheque.endosado) throw new Error('Este cheque ya fue endosado');
    if (cheque.estado !== 'EN_CARTERA') {
      throw new Error(`Solo se puede endosar un cheque en cartera (este está ${cheque.estado})`);
    }

    const prov = await client.query('SELECT id, nombre FROM proveedores WHERE id = $1', [proveedor_id]);
    if (!prov.rows.length) throw new Error('El proveedor no existe');

    const fecha = fecha_endoso || new Date().toISOString().slice(0, 10);

    await client.query(`
      UPDATE pago_items
      SET endosado = true, endosado_a_proveedor_id = $1, fecha_endoso = $2, updated_at = now()
      WHERE id = $3
    `, [proveedor_id, fecha, req.params.id]);

    const endoso = await client.query(`
      INSERT INTO endosos_cheques
        (pago_item_id, proveedor_id, fecha_endoso, monto_endosado, estado, observaciones, created_by)
      VALUES ($1, $2, $3, $4, 'PENDIENTE', $5, $6)
      RETURNING *
    `, [req.params.id, proveedor_id, fecha, cheque.monto, observaciones || null, req.usuario?.id || null]);

    await client.query('COMMIT');
    res.json({
      message: `Cheque endosado a ${prov.rows[0].nombre}`,
      endoso: endoso.rows[0],
      nota: 'El cheque sigue sin cancelar la deuda del cliente hasta que se acredite.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error endosando cheque:', err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * 5. RECIBOS
 * ===================================================================*/

router.get('/talonarios', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT t.id, t.numero_talonario, t.fecha_asignacion, t.activo, u.nombre_usuario
      FROM talonarios_recibo t
      LEFT JOIN usuarios u ON u.id = t.usuario_asignado_id
      WHERE t.activo = true
      ORDER BY t.numero_talonario
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error listando talonarios:', err);
    fallar(res, 500, err.message);
  }
});

router.get('/recibos', soloAdmin, async (req, res) => {
  const { cliente_id, desde, hasta } = req.query;
  const params = [];
  let filtro = '';

  if (cliente_id) { params.push(cliente_id); filtro += ` AND r.cliente_id = $${params.length}`; }
  if (desde)      { params.push(desde);      filtro += ` AND r.fecha_emision >= $${params.length}`; }
  if (hasta)      { params.push(hasta);      filtro += ` AND r.fecha_emision <= $${params.length}`; }

  try {
    const { rows } = await pool.query(`
      SELECT r.*, c.nombre AS cliente_nombre, t.numero_talonario,
             (SELECT COUNT(*) FROM pagos p WHERE p.recibo_id = r.id) AS cantidad_cobros
      FROM recibos r
      LEFT JOIN clientes c          ON c.id = r.cliente_id
      LEFT JOIN talonarios_recibo t ON t.id = r.talonario_id
      WHERE 1=1 ${filtro}
      ORDER BY r.fecha_emision DESC, r.id DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Error listando recibos:', err);
    fallar(res, 500, err.message);
  }
});

router.get('/recibos/:id', soloAdmin, async (req, res) => {
  try {
    const recibo = await pool.query(`
      SELECT r.*, c.nombre AS cliente_nombre, c.cuit AS cliente_cuit,
             c.direccion AS cliente_direccion, t.numero_talonario
      FROM recibos r
      LEFT JOIN clientes c          ON c.id = r.cliente_id
      LEFT JOIN talonarios_recibo t ON t.id = r.talonario_id
      WHERE r.id = $1
    `, [req.params.id]);

    if (!recibo.rows.length) return fallar(res, 404, 'Recibo no encontrado');

    const cobros = await pool.query(`
      SELECT p.id, p.fecha_recepcion, p.monto_total,
             (SELECT json_agg(json_build_object(
                'tipo', pi.tipo, 'monto', pi.monto, 'estado', pi.estado,
                'cheque_numero', pi.cheque_numero, 'cheque_banco', pi.cheque_banco))
              FROM pago_items pi WHERE pi.pago_id = p.id) AS items
      FROM pagos p WHERE p.recibo_id = $1 ORDER BY p.id
    `, [req.params.id]);

    const facturas = await pool.query(`
      SELECT DISTINCT f.numero_factura, f.fecha, ap.monto_aplicado
      FROM pagos p
      JOIN aplicacion_pagos ap ON ap.pago_id = p.id
      JOIN facturas f          ON f.id = ap.factura_id
      WHERE p.recibo_id = $1
      ORDER BY f.fecha
    `, [req.params.id]);

    res.json({ ...recibo.rows[0], cobros: cobros.rows, facturas: facturas.rows });
  } catch (err) {
    console.error('Error obteniendo recibo:', err);
    fallar(res, 500, err.message);
  }
});

router.post('/recibos', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { numero_recibo, talonario_id, talonario_numero, cliente_id, fecha_emision, pago_ids, observaciones } = req.body;

    if (!numero_recibo || !cliente_id || !fecha_emision) {
      throw new Error('Faltan número de recibo, cliente o fecha');
    }
    if (!Array.isArray(pago_ids) || !pago_ids.length) {
      throw new Error('Seleccioná al menos un cobro para el recibo');
    }

    const dup = await client.query('SELECT id FROM recibos WHERE numero_recibo = $1', [numero_recibo]);
    if (dup.rows.length) throw new Error(`Ya existe un recibo con el número ${numero_recibo}`);

    let talonarioId = talonario_id || null;
    if (!talonarioId && talonario_numero) {
      const tal = await client.query(
        'SELECT id FROM talonarios_recibo WHERE numero_talonario = $1 AND activo = true',
        [talonario_numero]
      );
      talonarioId = tal.rows.length ? tal.rows[0].id : null;
    }

    // El lock va aparte: Postgres no admite FOR UPDATE junto a GROUP BY.
    await client.query('SELECT id FROM pagos WHERE id = ANY($1::int[]) FOR UPDATE', [pago_ids]);

    const cobros = await client.query(`
      SELECT p.id, p.cliente_id, p.recibo_id, p.anulado, p.monto_total,
             COALESCE(SUM(pi.monto) FILTER (WHERE pi.tipo = 'EFECTIVO'), 0)       AS efectivo,
             COALESCE(SUM(pi.monto) FILTER (WHERE pi.tipo = 'CHEQUE'), 0)         AS cheques,
             COALESCE(SUM(pi.monto) FILTER (WHERE pi.tipo = 'TRANSFERENCIA'), 0)  AS transferencias,
             COALESCE(SUM(pi.monto) FILTER (WHERE pi.tipo = 'RETENCION'), 0)      AS retenciones
      FROM pagos p
      LEFT JOIN pago_items pi ON pi.pago_id = p.id AND pi.estado <> 'ANULADO'
      WHERE p.id = ANY($1::int[])
      GROUP BY p.id
    `, [pago_ids]);

    if (cobros.rows.length !== pago_ids.length) throw new Error('Alguno de los cobros no existe');

    const totales = { efectivo: 0, cheques: 0, transferencias: 0, retenciones: 0, total: 0 };
    for (const c of cobros.rows) {
      if (c.anulado) throw new Error(`El cobro #${c.id} está anulado`);
      if (c.recibo_id) throw new Error(`El cobro #${c.id} ya está incluido en otro recibo`);
      if (parseInt(c.cliente_id, 10) !== parseInt(cliente_id, 10)) {
        throw new Error(`El cobro #${c.id} es de otro cliente`);
      }
      totales.efectivo += cents(c.efectivo);
      totales.cheques += cents(c.cheques);
      totales.transferencias += cents(c.transferencias);
      totales.retenciones += cents(c.retenciones);
      totales.total += cents(c.monto_total);
    }

    const recibo = await client.query(`
      INSERT INTO recibos
        (numero_recibo, talonario_id, cliente_id, fecha_emision,
         total_efectivo, total_cheques, total_transferencias, total_retenciones,
         total_pagado, observaciones, usuario_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      numero_recibo, talonarioId, cliente_id, fecha_emision,
      pesos(totales.efectivo), pesos(totales.cheques), pesos(totales.transferencias),
      pesos(totales.retenciones), pesos(totales.total),
      observaciones || null, req.usuario?.id || null
    ]);

    await client.query('UPDATE pagos SET recibo_id = $1 WHERE id = ANY($2::int[])',
      [recibo.rows[0].id, pago_ids]);

    await client.query('COMMIT');
    res.status(201).json({ message: 'Recibo emitido', recibo: recibo.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error emitiendo recibo:', err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
});

/* =====================================================================
 * 6. RUTAS POR ID DEL COBRO
 * Van al final a propósito: `/:id` matchea cualquier cosa, así que si se
 * registraran antes se comerían /cheques, /recibos, /resumen, etc.
 * ===================================================================*/

router.param('id', (req, res, next, valor) => {
  if (!/^\d+$/.test(valor)) return res.status(404).json({ error: 'Ruta no encontrada' });
  next();
});

/* Detalle de un cobro: formas de pago + a qué facturas se imputó. */
router.get('/:id', soloAdmin, async (req, res) => {
  try {
    const pago = await pool.query(`
      SELECT p.*, c.nombre AS cliente_nombre, c.cuit, r.numero_recibo
      FROM pagos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN recibos  r ON r.id = p.recibo_id
      WHERE p.id = $1
    `, [req.params.id]);

    if (!pago.rows.length) return fallar(res, 404, 'Cobro no encontrado');

    const items = await pool.query(`
      SELECT pi.*,
             COALESCE((SELECT SUM(ap.monto_aplicado) FROM aplicacion_pagos ap
                       WHERE ap.pago_item_id = pi.id), 0) AS imputado
      FROM pago_items pi WHERE pi.pago_id = $1 ORDER BY pi.id
    `, [req.params.id]);

    const imputaciones = await pool.query(`
      SELECT ap.id, ap.factura_id, ap.monto_aplicado, ap.created_at,
             f.numero_factura, f.tipo_factura, f.fecha,
             pi.tipo AS forma_pago, pi.estado AS estado_forma, pi.cheque_numero
      FROM aplicacion_pagos ap
      JOIN facturas f    ON f.id = ap.factura_id
      JOIN pago_items pi ON pi.id = ap.pago_item_id
      WHERE ap.pago_id = $1
      ORDER BY f.fecha, ap.id
    `, [req.params.id]);

    res.json({ ...pago.rows[0], items: items.rows, imputaciones: imputaciones.rows });
  } catch (err) {
    console.error('Error obteniendo cobro:', err);
    fallar(res, 500, err.message);
  }
});

/* Descargar el recibo del cobro en PDF. */
router.get('/:id/pdf', soloAdmin, async (req, res) => {
  try {
    const pago = await pool.query(`
      SELECT p.*, c.nombre AS cliente_nombre, c.cuit, r.numero_recibo
      FROM pagos p
      LEFT JOIN clientes c ON c.id = p.cliente_id
      LEFT JOIN recibos  r ON r.id = p.recibo_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!pago.rows.length) return fallar(res, 404, 'Cobro no encontrado');

    const items = await pool.query(
      `SELECT * FROM pago_items WHERE pago_id = $1 ORDER BY id`, [req.params.id]
    );

    const imputaciones = await pool.query(`
      SELECT ap.monto_aplicado, f.numero_factura, f.tipo_factura, f.fecha
      FROM aplicacion_pagos ap
      JOIN facturas f ON f.id = ap.factura_id
      WHERE ap.pago_id = $1
      ORDER BY f.fecha, ap.id
    `, [req.params.id]);

    const cobro = pago.rows[0];
    cobro.items = items.rows;
    cobro.imputaciones = imputaciones.rows;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="Cobro-${nombreArchivo(cobro.numero_recibo, cobro.id)}.pdf"`);
    generarPdfCobro(cobro, res);
  } catch (err) {
    console.error('Error generando PDF de cobro:', err);
    if (!res.headersSent) fallar(res, 500, err.message);
  }
});

/* Imputar (o seguir imputando) un cobro ya registrado. */
router.post('/:id/imputar', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pago = await client.query(
      'SELECT * FROM pagos WHERE id = $1 FOR UPDATE', [req.params.id]
    );
    if (!pago.rows.length) throw new Error('Cobro no encontrado');
    if (pago.rows[0].anulado) throw new Error('El cobro está anulado');

    const { aplicaciones, imputar_automatico } = req.body;
    const resultado = (Array.isArray(aplicaciones) && aplicaciones.length)
      ? await imputar(client, pago.rows[0].id, pago.rows[0].cliente_id, aplicaciones)
      : await imputarAutomatico(client, pago.rows[0].id, pago.rows[0].cliente_id);

    if (!resultado.length) throw new Error('No hay facturas pendientes a las que imputar este cobro');

    await client.query('COMMIT');
    res.json({ message: `Imputado a ${resultado.length} factura(s)`, imputaciones: resultado });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error imputando cobro:', err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
});

/* Anular un cobro entero (se cargó mal). Libera la deuda imputada. */
router.post('/:id/anular', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // La lógica vive en services/anulaciones.js porque también la usa la
    // anulación de facturas. Además de lo de antes, ahora rechaza un cobro
    // que ya estaba anulado o que tiene un cheque endosado a un proveedor.
    await anularCobro(client, req.params.id, req.body.motivo);

    await client.query('COMMIT');
    res.json({ message: 'Cobro anulado. La deuda de las facturas imputadas volvió a quedar abierta.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error anulando cobro:', err);
    fallar(res, err.status || 400, err.message);
  } finally {
    client.release();
  }
});

module.exports = router;

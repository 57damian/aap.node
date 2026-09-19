/* =====================================================================
 * PAGOS A PROVEEDORES
 * ---------------------------------------------------------------------
 * Reemplaza a pagos.routes.js. Montado en /api/pagos-proveedores.
 *
 * Reglas de negocio (13/09/2026, espejo de las de Cobros):
 *  1. El saldo NUNCA se guarda: se calcula en vivo en
 *     services/cuenta-proveedor.js. Las columnas facturas_compra.
 *     neto_pagado y saldo_pendiente se eliminaron.
 *  2. La imputación es item→factura, no pago→factura. Por eso un cheque
 *     rechazado devuelve la deuda solo, sin revertir nada a mano.
 *  3. Entregar el valor ya cancela la factura (ENTREGADO o DEBITADO).
 *     Lo cubierto con cheques que todavía no se debitaron se informa
 *     aparte, como `en_valores`: es el compromiso de caja pendiente.
 *  4. Se permite pago a cuenta: un pago puede quedar sin imputar y queda
 *     como saldo a favor nuestro con ese proveedor.
 *  5. Un cheque de cliente endosado a un proveedor no tiene estado
 *     propio: hereda el del cheque original. Si al cliente se lo
 *     rechazan, la deuda con el proveedor vuelve automáticamente.
 *
 * Las órdenes de pago (ordenes_pago_proveedores) se eliminaron del
 * circuito: la tabla existía, la pantalla tenía una pestaña, pero el
 * listado nunca funcionó (la ruta la interceptaba /:id) y el circuito de
 * autorización no forma parte del modelo de negocio acordado.
 * ===================================================================== */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const {
  ESTADO_EFECTIVO_ITEM, CTE_FACTURAS_COMPRA, CTE_A_FAVOR_PROV,
  EXCESO_PAGADO, ESTADO_FACTURA_COMPRA,
  resumenProveedor, cuentaCorrienteProveedor
} = require('../services/cuenta-proveedor');

router.use(verificarToken);

// Todo este módulo es plata: lo ve y lo toca solo el administrador.
// Antes la constante de lectura incluía 'operario', así que un usuario de
// planta podía consultar por API la deuda, los cheques y las cuentas
// corrientes aunque el menú no le mostrara esas pantallas.

const TIPOS_ITEM = ['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'CHEQUE_ENDOSADO', 'RETENCION'];

/* Dinero en centavos, para no arrastrar errores de punto flotante. */
const cents = (v) => Math.round((parseFloat(v) || 0) * 100);
const pesos = (c) => Math.round(c) / 100;
const hoy = () => new Date().toISOString().slice(0, 10);

function fallar(res, code, msg) {
  return res.status(code).json({ error: msg });
}

/* =====================================================================
 * 1. PANEL DE SEGUIMIENTO — "¿a quién le debo?"
 * ===================================================================*/

router.get('/resumen', soloAdmin, async (req, res) => {
  try {
    const deuda = await pool.query(`
      WITH ${CTE_FACTURAS_COMPRA}
      SELECT
        COUNT(*) FILTER (WHERE saldo > 0.005)                          AS facturas_con_saldo,
        COUNT(DISTINCT proveedor_id) FILTER (WHERE saldo > 0.005)      AS proveedores_con_deuda,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005), 0), 2) AS deuda_total,
        ROUND(COALESCE(SUM(en_valores), 0), 2)                         AS en_valores,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso > 0), 0), 2)  AS vencido,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso <= 0), 0), 2) AS por_vencer,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso BETWEEN 1 AND 30), 0), 2)  AS atraso_1_30,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso BETWEEN 31 AND 60), 0), 2) AS atraso_31_60,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso BETWEEN 61 AND 90), 0), 2) AS atraso_61_90,
        ROUND(COALESCE(SUM(saldo) FILTER (WHERE saldo > 0.005 AND dias_atraso > 90), 0), 2)              AS atraso_90_mas,
        ROUND(COALESCE(SUM(-saldo) FILTER (WHERE saldo < -0.005), 0), 2)                                 AS exceso_pagado
      FROM facturas_compra_saldo
    `);

    /* Cheques propios y endosados todavía no debitados: compromiso de caja. */
    const cheques = await pool.query(`
      SELECT
        COUNT(*)                                                     AS cantidad,
        ROUND(COALESCE(SUM(ppi.monto), 0), 2)                        AS total,
        COUNT(*) FILTER (WHERE f.cobro <= CURRENT_DATE + 7)          AS vencen_7_dias,
        ROUND(COALESCE(SUM(ppi.monto) FILTER (WHERE f.cobro <= CURRENT_DATE + 7), 0), 2) AS total_7_dias,
        COUNT(*) FILTER (WHERE f.cobro < CURRENT_DATE)               AS pasados_sin_debitar
      FROM pago_proveedor_items ppi
      JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
      LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
      CROSS JOIN LATERAL (SELECT COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) AS cobro) f
      WHERE ppi.tipo IN ('CHEQUE','CHEQUE_ENDOSADO')
        AND ${ESTADO_EFECTIVO_ITEM} = 'ENTREGADO'
    `);

    const aFavor = await pool.query(`
      WITH ${CTE_A_FAVOR_PROV}
      SELECT ROUND(COALESCE(SUM(saldo_a_favor), 0), 2) AS total_a_favor
      FROM a_favor_prov WHERE saldo_a_favor > 0.005
    `);

    res.json({
      deuda: deuda.rows[0],
      cheques_a_debitar: cheques.rows[0],
      saldo_a_favor: aFavor.rows[0].total_a_favor
    });
  } catch (err) {
    console.error('Error en resumen de pagos a proveedores:', err);
    fallar(res, 500, err.message);
  }
});

/* Deuda por proveedor. Es la tabla principal de la herramienta. */
router.get('/deuda', soloAdmin, async (req, res) => {
  const { buscar, solo_vencido, orden } = req.query;
  const incluirSinDeuda = req.query.incluir_sin_deuda === 'true';

  const ordenSql = {
    saldo: 'saldo DESC',
    vencido: 'vencido DESC, saldo DESC',
    atraso: 'dias_atraso_max DESC NULLS LAST, saldo DESC',
    nombre: 'proveedor_nombre ASC'
  }[orden] || 'vencido DESC, saldo DESC';

  try {
    const params = [];
    let filtro = '';

    if (buscar) {
      params.push(`%${buscar}%`);
      filtro += ` AND (pr.nombre ILIKE $${params.length} OR COALESCE(pr.cuit,'') ILIKE $${params.length})`;
    }

    const { rows } = await pool.query(`
      WITH ${CTE_FACTURAS_COMPRA}, ${CTE_A_FAVOR_PROV}
      SELECT * FROM (
        SELECT
          pr.id                                                        AS proveedor_id,
          pr.nombre                                                    AS proveedor_nombre,
          pr.cuit,
          pr.telefono,
          pr.email,
          pr.dias_credito,
          pr.forma_pago_habitual,
          COUNT(fs.id) FILTER (WHERE fs.saldo > 0.005)                 AS facturas_pendientes,
          ROUND(COALESCE(SUM(fs.total), 0), 2)                         AS total_facturado,
          ROUND(COALESCE(SUM(fs.pagado), 0), 2)                        AS total_pagado,
          ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005), 0), 2) AS saldo,
          ROUND(COALESCE(SUM(fs.en_valores), 0), 2)                    AS en_valores,
          ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso > 0), 0), 2)  AS vencido,
          ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso <= 0), 0), 2) AS por_vencer,
          MAX(fs.dias_atraso) FILTER (WHERE fs.saldo > 0.005)          AS dias_atraso_max,
          MIN(fs.fecha_vencimiento) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso > 0) AS vencimiento_mas_viejo,
          ${EXCESO_PAGADO}                                             AS exceso_pagado,
          ROUND(GREATEST(COALESCE(af.saldo_a_favor, 0), 0), 2)         AS saldo_a_favor
        FROM proveedores pr
        LEFT JOIN facturas_compra_saldo fs ON fs.proveedor_id = pr.id
        LEFT JOIN a_favor_prov af          ON af.proveedor_id = pr.id
        WHERE pr.activo = true ${filtro}
        GROUP BY pr.id, pr.nombre, pr.cuit, pr.telefono, pr.email,
                 pr.dias_credito, pr.forma_pago_habitual, af.saldo_a_favor
      ) t
      WHERE ${incluirSinDeuda ? '1=1' : '(saldo > 0.005 OR saldo_a_favor > 0.005 OR exceso_pagado > 0.005)'}
        ${solo_vencido === 'true' ? 'AND vencido > 0.005' : ''}
      ORDER BY ${ordenSql}
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('Error en deuda por proveedor:', err);
    fallar(res, 500, err.message);
  }
});

/* Ficha de un proveedor: totales + facturas + cheques entregados. */
router.get('/proveedores/:id', soloAdmin, async (req, res) => {
  const { id } = req.params;
  const soloPendientes = req.query.solo_pendientes !== 'false';

  try {
    const prov = await pool.query(
      `SELECT id, nombre, cuit, telefono, email, direccion, contacto,
              condicion_iva, dias_credito, forma_pago_habitual
       FROM proveedores WHERE id = $1`, [id]
    );
    if (!prov.rows.length) return fallar(res, 404, 'Proveedor no encontrado');

    const facturas = await pool.query(`
      WITH ${CTE_FACTURAS_COMPRA}
      SELECT fs.*, ${ESTADO_FACTURA_COMPRA} AS estado
      FROM facturas_compra_saldo fs
      WHERE fs.proveedor_id = $1
        ${soloPendientes ? 'AND fs.saldo > 0.005' : ''}
      ORDER BY fs.fecha_vencimiento ASC, fs.id ASC
    `, [id]);

    const totales = await resumenProveedor(pool, id);

    const cheques = await pool.query(`
      SELECT ppi.id, ppi.tipo, ppi.monto,
             COALESCE(ppi.cheque_numero, orig.cheque_numero) AS cheque_numero,
             COALESCE(ppi.cheque_banco,  orig.cheque_banco)  AS cheque_banco,
             COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) AS cheque_fecha_cobro,
             ${ESTADO_EFECTIVO_ITEM} AS estado,
             (COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) - CURRENT_DATE) AS dias_para_debito
      FROM pago_proveedor_items ppi
      JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
      LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
      WHERE pp.proveedor_id = $1
        AND ppi.tipo IN ('CHEQUE','CHEQUE_ENDOSADO')
        AND ${ESTADO_EFECTIVO_ITEM} = 'ENTREGADO'
      ORDER BY 6 ASC
    `, [id]);

    res.json({
      proveedor: prov.rows[0],
      totales,
      facturas: facturas.rows,
      cheques_a_debitar: cheques.rows
    });
  } catch (err) {
    console.error('Error en ficha de proveedor:', err);
    fallar(res, 500, err.message);
  }
});

router.get('/proveedores/:id/cuenta-corriente', soloAdmin, async (req, res) => {
  try {
    const prov = await pool.query('SELECT id, nombre FROM proveedores WHERE id = $1', [req.params.id]);
    if (!prov.rows.length) return fallar(res, 404, 'Proveedor no encontrado');

    const movimientos = await cuentaCorrienteProveedor(pool, req.params.id, req.query);
    res.json({ proveedor: prov.rows[0], movimientos });
  } catch (err) {
    console.error('Error en cuenta corriente de proveedor:', err);
    fallar(res, 500, err.message);
  }
});

/* Facturas con saldo — alimenta el formulario de pago. */
router.get('/proveedores/:id/facturas-pendientes', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH ${CTE_FACTURAS_COMPRA}
      SELECT fs.*, ${ESTADO_FACTURA_COMPRA} AS estado
      FROM facturas_compra_saldo fs
      WHERE fs.proveedor_id = $1 AND fs.saldo > 0.005
      ORDER BY fs.fecha_vencimiento ASC, fs.id ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo facturas pendientes:', err);
    fallar(res, 500, err.message);
  }
});

/* Alertas de facturas por vencer / vencidas. Lo consumen el dashboard y
   alertas-pagos.html. Antes tiraba 500 por EXTRACT(DAY FROM date - date). */
router.get('/alertas/facturas-pendientes', soloAdmin, async (req, res) => {
  const dias = parseInt(req.query.dias_vencimiento, 10) || 7;
  try {
    const { rows } = await pool.query(`
      WITH ${CTE_FACTURAS_COMPRA}
      SELECT fs.*, pr.nombre AS proveedor_nombre, pr.telefono, pr.email,
             fs.saldo        AS saldo_pendiente,   -- alias para el dashboard
             -fs.dias_atraso AS dias_restantes,    -- idem
             ${ESTADO_FACTURA_COMPRA} AS estado,
             CASE WHEN fs.dias_atraso > 0 THEN 'vencida'
                  WHEN fs.dias_atraso >= -$1::int THEN 'por_vencer'
                  ELSE 'normal' END AS estado_alerta
      FROM facturas_compra_saldo fs
      JOIN proveedores pr ON pr.id = fs.proveedor_id
      WHERE fs.saldo > 0.005
      ORDER BY fs.fecha_vencimiento ASC
    `, [dias]);

    const suma = (arr) => pesos(arr.reduce((a, f) => a + cents(f.saldo), 0));
    const vencidas = rows.filter(f => f.estado_alerta === 'vencida');
    const porVencer = rows.filter(f => f.estado_alerta === 'por_vencer');

    res.json({
      // `success` y `data` son por compatibilidad con dashboard.js y
      // alertas-pagos.js, que esperan esa forma.
      success: true,
      data: rows,
      dias_vencimiento: dias,
      vencidas,
      por_vencer: porVencer,
      total: rows.length,
      monto_total: suma(rows),
      monto_vencido: suma(vencidas),
      monto_por_vencer: suma(porVencer),
      facturas: rows
    });
  } catch (err) {
    console.error('Error en alertas de facturas:', err);
    fallar(res, 500, err.message);
  }
});

/* =====================================================================
 * 2. MOTOR DE IMPUTACIÓN
 * ===================================================================*/

/**
 * Reparte `aplicaciones` [{factura_compra_id, monto}] sobre los items del
 * pago. Consume primero la plata que ya salió (efectivo, transferencia,
 * retención) y después los cheques por fecha de débito más próxima.
 */
async function imputar(client, pagoId, proveedorId, aplicaciones) {
  const itemsRes = await client.query(`
    SELECT ppi.id, ppi.tipo, ppi.monto, ppi.estado,
           COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) AS fecha_cobro,
           COALESCE((SELECT SUM(ap.monto_aplicado)
                     FROM aplicacion_pagos_proveedores ap
                     WHERE ap.pago_item_id = ppi.id), 0) AS imputado
    FROM pago_proveedor_items ppi
    JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
    LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
    WHERE ppi.pago_id = $1 AND ${ESTADO_EFECTIVO_ITEM} NOT IN ('RECHAZADO','ANULADO')
    ORDER BY (ppi.estado = 'DEBITADO') DESC,
             COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) ASC NULLS FIRST,
             ppi.id ASC
  `, [pagoId]);

  const items = itemsRes.rows.map(i => ({
    id: i.id,
    disponible: cents(i.monto) - cents(i.imputado)
  }));

  const resultado = [];

  for (const ap of aplicaciones) {
    const facturaId = parseInt(ap.factura_compra_id ?? ap.factura_id, 10);
    let aImputar = cents(ap.monto ?? ap.monto_aplicado);

    if (!facturaId || aImputar <= 0) {
      throw new Error('Imputación inválida: falta la factura o el monto no es positivo');
    }

    await client.query('SELECT id FROM facturas_compra WHERE id = $1 FOR UPDATE', [facturaId]);
    const fac = await client.query(`
      WITH ${CTE_FACTURAS_COMPRA}
      SELECT fs.* FROM facturas_compra_saldo fs WHERE fs.id = $1
    `, [facturaId]);

    if (!fac.rows.length) throw new Error(`La factura de compra ${facturaId} no existe o está anulada`);
    const factura = fac.rows[0];

    if (parseInt(factura.proveedor_id, 10) !== parseInt(proveedorId, 10)) {
      throw new Error(`La factura ${factura.numero_factura} es de otro proveedor`);
    }

    const tope = cents(factura.saldo);
    if (tope <= 0) {
      throw new Error(`La factura ${factura.numero_factura} ya está cancelada`);
    }
    if (aImputar > tope + 1) {
      throw new Error(
        `No se puede imputar $${pesos(aImputar).toFixed(2)} a la factura ${factura.numero_factura}: ` +
        `su saldo es $${pesos(tope).toFixed(2)}`
      );
    }
    if (aImputar > tope) aImputar = tope; // absorber redondeo

    let restante = aImputar;
    for (const item of items) {
      if (restante <= 0) break;
      if (item.disponible <= 0) continue;
      const usar = Math.min(restante, item.disponible);
      await client.query(`
        INSERT INTO aplicacion_pagos_proveedores (pago_id, pago_item_id, factura_compra_id, monto_aplicado)
        VALUES ($1, $2, $3, $4)
      `, [pagoId, item.id, facturaId, pesos(usar)]);
      item.disponible -= usar;
      restante -= usar;
    }

    if (restante > 0) {
      throw new Error(
        `El pago no tiene saldo disponible suficiente: faltan $${pesos(restante).toFixed(2)} ` +
        `para imputar a la factura ${factura.numero_factura}`
      );
    }

    resultado.push({
      factura_compra_id: facturaId,
      numero_factura: factura.numero_factura,
      monto: pesos(aImputar)
    });
  }

  return resultado;
}

/** Imputación automática FIFO: cancela primero lo más vencido. */
async function imputarAutomatico(client, pagoId, proveedorId) {
  const disponibleRes = await client.query(`
    SELECT COALESCE(SUM(ppi.monto - COALESCE(ap.imputado, 0)), 0) AS disponible
    FROM pago_proveedor_items ppi
    JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
    LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
    LEFT JOIN (SELECT pago_item_id, SUM(monto_aplicado) AS imputado
               FROM aplicacion_pagos_proveedores GROUP BY pago_item_id) ap ON ap.pago_item_id = ppi.id
    WHERE ppi.pago_id = $1 AND ${ESTADO_EFECTIVO_ITEM} NOT IN ('RECHAZADO','ANULADO')
  `, [pagoId]);

  let disponible = cents(disponibleRes.rows[0].disponible);
  if (disponible <= 0) return [];

  const facturas = await client.query(`
    WITH ${CTE_FACTURAS_COMPRA}
    SELECT fs.id, fs.saldo
    FROM facturas_compra_saldo fs
    WHERE fs.proveedor_id = $1 AND fs.saldo > 0.005
    ORDER BY fs.fecha_vencimiento ASC, fs.id ASC
  `, [proveedorId]);

  const aplicaciones = [];
  for (const f of facturas.rows) {
    if (disponible <= 0) break;
    const usar = Math.min(disponible, cents(f.saldo));
    if (usar <= 0) continue;
    aplicaciones.push({ factura_compra_id: f.id, monto: pesos(usar) });
    disponible -= usar;
  }

  return aplicaciones.length ? imputar(client, pagoId, proveedorId, aplicaciones) : [];
}

/* Valida y normaliza una forma de pago venida del frontend.
   El cheque endosado se resuelve aparte porque necesita ir a la base. */
function normalizarItem(item, fechaPago) {
  const tipo = String(item.tipo || '').toUpperCase();
  if (!TIPOS_ITEM.includes(tipo)) {
    throw new Error(`Forma de pago inválida: "${item.tipo}"`);
  }

  const base = {
    tipo,
    monto: parseFloat(item.monto),
    observaciones: item.observaciones || null,
    estado: 'DEBITADO',
    fecha_debito: fechaPago,
    cheque_numero: null, cheque_banco: null,
    cheque_fecha_emision: null, cheque_fecha_cobro: null,
    pago_item_origen_id: null, endoso_id: null,
    transferencia_banco_origen: null, transferencia_banco_destino: null,
    transferencia_numero_operacion: null, transferencia_fecha: null,
    retencion_tipo: null, retencion_certificado: null
  };

  if (tipo !== 'CHEQUE_ENDOSADO' && (!base.monto || base.monto <= 0)) {
    throw new Error('Cada forma de pago necesita un monto mayor a cero');
  }

  if (tipo === 'CHEQUE') {
    if (!item.cheque_numero || !item.cheque_banco || !item.cheque_fecha_cobro) {
      throw new Error('Un cheque propio necesita número, banco y fecha de cobro');
    }
    base.cheque_numero = String(item.cheque_numero).trim();
    base.cheque_banco = String(item.cheque_banco).trim();
    base.cheque_fecha_emision = item.cheque_fecha_emision || fechaPago;
    base.cheque_fecha_cobro = item.cheque_fecha_cobro;
    base.estado = 'ENTREGADO';   // la plata todavía no salió de la cuenta
    base.fecha_debito = null;
  }

  if (tipo === 'CHEQUE_ENDOSADO') {
    if (!item.pago_item_origen_id) {
      throw new Error('Para endosar hace falta indicar qué cheque de cliente se entrega');
    }
    base.pago_item_origen_id = parseInt(item.pago_item_origen_id, 10);
    base.estado = 'ENTREGADO';
    base.fecha_debito = null;
    base.monto = null;           // lo define el cheque original
  }

  if (tipo === 'TRANSFERENCIA') {
    base.transferencia_banco_origen = item.transferencia_banco_origen || null;
    base.transferencia_banco_destino = item.transferencia_banco_destino || null;
    base.transferencia_numero_operacion = item.transferencia_numero_operacion || null;
    base.transferencia_fecha = item.transferencia_fecha || fechaPago;
    base.fecha_debito = base.transferencia_fecha;
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

/* Toma un cheque de cliente en cartera y lo deja endosado al proveedor.
   Devuelve {monto, endoso_id} para completar el item. */
async function endosarCheque(client, chequeId, proveedorId, fecha, usuarioId, observaciones) {
  const chq = await client.query(
    `SELECT * FROM pago_items WHERE id = $1 AND tipo = 'CHEQUE' FOR UPDATE`, [chequeId]
  );
  if (!chq.rows.length) throw new Error(`El cheque de cliente #${chequeId} no existe`);

  const cheque = chq.rows[0];
  if (cheque.estado !== 'EN_CARTERA') {
    throw new Error(`Solo se puede endosar un cheque en cartera (el ${cheque.cheque_numero} está ${cheque.estado})`);
  }

  /* Si ya se endosó desde la pantalla de Cobros, se reutiliza ese endoso
     (siempre que sea al mismo proveedor). Si no, se crea acá. */
  const previo = await client.query(
    `SELECT * FROM endosos_cheques WHERE pago_item_id = $1 AND estado <> 'RECHAZADO'`, [chequeId]
  );

  let endosoId;
  if (previo.rows.length) {
    const e = previo.rows[0];
    if (parseInt(e.proveedor_id, 10) !== parseInt(proveedorId, 10)) {
      throw new Error(`El cheque ${cheque.cheque_numero} ya está endosado a otro proveedor`);
    }
    endosoId = e.id;
    await client.query(
      `UPDATE endosos_cheques SET estado = 'APLICADO', fecha_aceptacion = $2 WHERE id = $1`,
      [endosoId, fecha]
    );
  } else {
    if (cheque.endosado) throw new Error(`El cheque ${cheque.cheque_numero} ya fue endosado`);
    const nuevo = await client.query(`
      INSERT INTO endosos_cheques
        (pago_item_id, proveedor_id, fecha_endoso, monto_endosado, estado, fecha_aceptacion, observaciones, created_by)
      VALUES ($1, $2, $3, $4, 'APLICADO', $3, $5, $6)
      RETURNING id
    `, [chequeId, proveedorId, fecha, cheque.monto, observaciones || null, usuarioId || null]);
    endosoId = nuevo.rows[0].id;
  }

  await client.query(`
    UPDATE pago_items
    SET endosado = true, endosado_a_proveedor_id = $1, fecha_endoso = $2, updated_at = now()
    WHERE id = $3
  `, [proveedorId, fecha, chequeId]);

  return { monto: parseFloat(cheque.monto), endoso_id: endosoId, numero: cheque.cheque_numero };
}

/* =====================================================================
 * 3. PAGOS
 * ===================================================================*/

/* Historial de pagos. `estado` es calculado, no hay columna. */
router.get('/', soloAdmin, async (req, res) => {
  const { proveedor_id, desde, hasta, estado, fecha_desde, fecha_hasta } = req.query;
  const params = [];
  let filtro = '';

  const d = desde || fecha_desde;
  const h = hasta || fecha_hasta;

  if (proveedor_id) { params.push(proveedor_id); filtro += ` AND pp.proveedor_id = $${params.length}`; }
  if (d) { params.push(d); filtro += ` AND pp.fecha >= $${params.length}`; }
  if (h) { params.push(h); filtro += ` AND pp.fecha <= $${params.length}`; }

  try {
    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT
          pp.id, pp.proveedor_id, pp.fecha, pp.referencia, pp.observaciones, pp.anulado,
          pr.nombre AS proveedor_nombre,
          ROUND(pp.monto, 2)                  AS monto,
          ROUND(COALESCE(t.imputado, 0), 2)   AS imputado,
          ROUND(COALESCE(t.disponible, 0), 2) AS disponible,
          ROUND(COALESCE(t.en_valores, 0), 2) AS en_valores,
          ROUND(COALESCE(t.rechazado, 0), 2)  AS rechazado,
          COALESCE(t.rechazado, 0) > 0.005    AS tiene_rechazo,
          t.formas,
          CASE
            WHEN pp.anulado                          THEN 'ANULADO'
            WHEN COALESCE(t.disponible, 0) <= 0.005  THEN 'IMPUTADO'
            WHEN COALESCE(t.imputado, 0) > 0.005     THEN 'PARCIAL'
            ELSE 'A_CUENTA'
          END AS estado
        FROM pagos_proveedores pp
        LEFT JOIN proveedores pr ON pr.id = pp.proveedor_id
        LEFT JOIN (
          SELECT
            ppi.pago_id,
            SUM(CASE WHEN est.efectivo IN ('RECHAZADO','ANULADO') THEN 0
                     ELSE COALESCE(ap.imputado, 0) END)                        AS imputado,
            SUM(CASE WHEN est.efectivo IN ('RECHAZADO','ANULADO') THEN 0
                     ELSE ppi.monto - COALESCE(ap.imputado, 0) END)            AS disponible,
            SUM(CASE WHEN est.efectivo = 'ENTREGADO' THEN ppi.monto ELSE 0 END) AS en_valores,
            SUM(CASE WHEN est.efectivo = 'RECHAZADO' THEN ppi.monto ELSE 0 END) AS rechazado,
            string_agg(DISTINCT ppi.tipo, ' + ' ORDER BY ppi.tipo)              AS formas
          FROM pago_proveedor_items ppi
          JOIN pagos_proveedores pp2 ON pp2.id = ppi.pago_id
          LEFT JOIN pago_items    orig ON orig.id = ppi.pago_item_origen_id
          CROSS JOIN LATERAL (
            SELECT CASE
              WHEN pp2.anulado THEN 'ANULADO'
              WHEN ppi.tipo = 'CHEQUE_ENDOSADO' AND orig.estado IN ('RECHAZADO','ANULADO') THEN 'RECHAZADO'
              WHEN ppi.tipo = 'CHEQUE_ENDOSADO' AND orig.estado = 'ACREDITADO' THEN 'DEBITADO'
              ELSE ppi.estado END AS efectivo
          ) est
          LEFT JOIN (SELECT pago_item_id, SUM(monto_aplicado) AS imputado
                     FROM aplicacion_pagos_proveedores GROUP BY pago_item_id) ap ON ap.pago_item_id = ppi.id
          GROUP BY ppi.pago_id
        ) t ON t.pago_id = pp.id
        WHERE 1=1 ${filtro}
      ) q
      ${estado ? 'WHERE q.estado = $' + (params.push(estado.toUpperCase())) : ''}
      ORDER BY q.fecha DESC, q.id DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('Error listando pagos a proveedores:', err);
    fallar(res, 500, err.message);
  }
});

/* Registrar un pago (opcionalmente imputándolo en el mismo paso). */
router.post('/', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      proveedor_id, fecha_pago, fecha, referencia, observaciones,
      items, aplicaciones, imputar_automatico
    } = req.body;

    const fechaPago = fecha_pago || fecha;
    if (!proveedor_id || !fechaPago) throw new Error('Falta el proveedor o la fecha del pago');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Agregá al menos una forma de pago');

    const prov = await client.query('SELECT id, nombre FROM proveedores WHERE id = $1', [proveedor_id]);
    if (!prov.rows.length) throw new Error('El proveedor no existe');

    const normalizados = items.map(i => normalizarItem(i, fechaPago));

    /* Cheques de cliente a endosar: se resuelven contra la base, porque
       el monto lo define el cheque original, no lo que mande la pantalla. */
    for (const it of normalizados.filter(i => i.tipo === 'CHEQUE_ENDOSADO')) {
      const r = await endosarCheque(
        client, it.pago_item_origen_id, proveedor_id, fechaPago,
        req.usuario?.id, it.observaciones
      );
      it.monto = r.monto;
      it.endoso_id = r.endoso_id;
      it.cheque_numero = r.numero;
    }

    /* No cargar dos veces el mismo cheque propio. */
    for (const it of normalizados.filter(i => i.tipo === 'CHEQUE')) {
      const dup = await client.query(`
        SELECT ppi.id FROM pago_proveedor_items ppi
        WHERE ppi.tipo = 'CHEQUE'
          AND upper(btrim(ppi.cheque_numero)) = upper($1)
          AND upper(btrim(COALESCE(ppi.cheque_banco,''))) = upper($2)
          AND ppi.estado <> 'ANULADO'
      `, [it.cheque_numero, it.cheque_banco]);
      if (dup.rows.length) {
        throw new Error(`El cheque ${it.cheque_numero} del ${it.cheque_banco} ya está cargado (item #${dup.rows[0].id})`);
      }
    }

    const montoTotal = pesos(normalizados.reduce((acc, i) => acc + cents(i.monto), 0));
    if (montoTotal <= 0) throw new Error('El pago tiene que ser mayor a cero');

    const pagoRes = await client.query(`
      INSERT INTO pagos_proveedores
        (proveedor_id, fecha, monto, referencia, observaciones, forma_pago, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      proveedor_id, fechaPago, montoTotal, referencia || null, observaciones || null,
      [...new Set(normalizados.map(i => i.tipo))].join(' + '),
      req.usuario?.id || null
    ]);

    const pago = pagoRes.rows[0];

    for (const it of normalizados) {
      await client.query(`
        INSERT INTO pago_proveedor_items
          (pago_id, tipo, monto, estado, fecha_debito, observaciones,
           cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro,
           pago_item_origen_id, endoso_id,
           transferencia_banco_origen, transferencia_banco_destino,
           transferencia_numero_operacion, transferencia_fecha,
           retencion_tipo, retencion_certificado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `, [
        pago.id, it.tipo, it.monto, it.estado, it.fecha_debito, it.observaciones,
        it.cheque_numero, it.cheque_banco, it.cheque_fecha_emision, it.cheque_fecha_cobro,
        it.pago_item_origen_id, it.endoso_id,
        it.transferencia_banco_origen, it.transferencia_banco_destino,
        it.transferencia_numero_operacion, it.transferencia_fecha,
        it.retencion_tipo, it.retencion_certificado
      ]);
    }

    let imputado = [];
    if (Array.isArray(aplicaciones) && aplicaciones.length) {
      imputado = await imputar(client, pago.id, proveedor_id, aplicaciones);
    } else if (imputar_automatico) {
      imputado = await imputarAutomatico(client, pago.id, proveedor_id);
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: imputado.length
        ? `Pago registrado e imputado a ${imputado.length} factura(s)`
        : 'Pago registrado a cuenta (sin imputar)',
      pago_id: pago.id,
      monto: montoTotal,
      imputaciones: imputado
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error registrando pago a proveedor:', err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
});

/* Deshacer una imputación puntual (se imputó a la factura equivocada). */
router.delete('/imputaciones/:imputacion_id', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM aplicacion_pagos_proveedores WHERE id = $1 RETURNING *',
      [req.params.imputacion_id]
    );
    if (!rows.length) return fallar(res, 404, 'Imputación no encontrada');
    res.json({ message: 'Imputación deshecha', imputacion: rows[0] });
  } catch (err) {
    console.error('Error deshaciendo imputación:', err);
    fallar(res, 500, err.message);
  }
});

/* =====================================================================
 * 4. CHEQUES ENTREGADOS (propios y endosados)
 * ===================================================================*/

router.get('/cheques', soloAdmin, async (req, res) => {
  const { proveedor_id, estado, desde, hasta, tipo } = req.query;
  const params = [];
  let filtro = '';

  if (proveedor_id) { params.push(proveedor_id); filtro += ` AND pp.proveedor_id = $${params.length}`; }
  if (tipo)         { params.push(tipo.toUpperCase()); filtro += ` AND ppi.tipo = $${params.length}`; }
  if (desde)        { params.push(desde); filtro += ` AND COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) >= $${params.length}`; }
  if (hasta)        { params.push(hasta); filtro += ` AND COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) <= $${params.length}`; }

  try {
    const { rows } = await pool.query(`
      SELECT * FROM (
        SELECT
          ppi.id, ppi.tipo, ppi.monto,
          COALESCE(ppi.cheque_numero, orig.cheque_numero)           AS cheque_numero,
          COALESCE(ppi.cheque_banco, orig.cheque_banco)             AS cheque_banco,
          COALESCE(ppi.cheque_fecha_emision, orig.cheque_fecha_emision) AS cheque_fecha_emision,
          COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) AS cheque_fecha_cobro,
          ppi.fecha_debito,
          COALESCE(ppi.cheque_motivo_rechazo, orig.cheque_motivo_rechazo) AS cheque_motivo_rechazo,
          ppi.cheque_gasto_comision,
          ${ESTADO_EFECTIVO_ITEM}                                   AS estado,
          pp.id AS pago_id, pp.fecha AS fecha_pago, pp.proveedor_id,
          pr.nombre AS proveedor_nombre,
          cli.nombre AS cliente_origen,
          (COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) - CURRENT_DATE) AS dias_para_debito,
          COALESCE((SELECT SUM(ap.monto_aplicado) FROM aplicacion_pagos_proveedores ap
                    WHERE ap.pago_item_id = ppi.id), 0) AS imputado,
          (SELECT string_agg(fc.numero_factura, ', ' ORDER BY fc.numero_factura)
             FROM aplicacion_pagos_proveedores ap
             JOIN facturas_compra fc ON fc.id = ap.factura_compra_id
            WHERE ap.pago_item_id = ppi.id) AS facturas
        FROM pago_proveedor_items ppi
        JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
        JOIN proveedores       pr ON pr.id = pp.proveedor_id
        LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
        LEFT JOIN pagos        pcli ON pcli.id = orig.pago_id
        LEFT JOIN clientes     cli  ON cli.id = pcli.cliente_id
        WHERE ppi.tipo IN ('CHEQUE','CHEQUE_ENDOSADO') ${filtro}
      ) q
      ${estado ? 'WHERE q.estado = $' + (params.push(estado.toUpperCase())) : ''}
      ORDER BY q.cheque_fecha_cobro ASC NULLS LAST, q.id DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('Error listando cheques entregados:', err);
    fallar(res, 500, err.message);
  }
});

/* Cheques que se van a debitar pronto: alerta de caja. */
router.get('/cheques/alertas', soloAdmin, async (req, res) => {
  const dias = parseInt(req.query.dias, 10) || 7;
  try {
    const { rows } = await pool.query(`
      SELECT ppi.id, ppi.tipo, ppi.monto,
             COALESCE(ppi.cheque_numero, orig.cheque_numero) AS cheque_numero,
             COALESCE(ppi.cheque_banco, orig.cheque_banco)   AS cheque_banco,
             COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) AS cheque_fecha_cobro,
             pr.nombre AS proveedor_nombre,
             (COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) - CURRENT_DATE) AS dias_para_debito
      FROM pago_proveedor_items ppi
      JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
      JOIN proveedores       pr ON pr.id = pp.proveedor_id
      LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
      WHERE ppi.tipo IN ('CHEQUE','CHEQUE_ENDOSADO')
        AND ${ESTADO_EFECTIVO_ITEM} = 'ENTREGADO'
        AND COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) <= CURRENT_DATE + $1::int
      ORDER BY 6 ASC
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

/* Cheques de clientes disponibles para endosar. Alimenta el formulario. */
router.get('/cheques-endosables', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pi.id, pi.cheque_numero, pi.cheque_banco, pi.monto,
             pi.cheque_fecha_emision, pi.cheque_fecha_cobro,
             c.nombre AS cliente_nombre,
             (pi.cheque_fecha_cobro - CURRENT_DATE) AS dias_para_cobro
      FROM pago_items pi
      JOIN pagos p    ON p.id = pi.pago_id
      JOIN clientes c ON c.id = p.cliente_id
      WHERE pi.tipo = 'CHEQUE'
        AND pi.estado = 'EN_CARTERA'
        AND COALESCE(pi.endosado, false) = false
        AND p.anulado = false
      ORDER BY pi.cheque_fecha_cobro ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error listando cheques endosables:', err);
    fallar(res, 500, err.message);
  }
});

/* Cambios de estado de un cheque entregado. */
async function cambiarEstadoCheque(req, res, { desde, hacia, extra }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const chq = await client.query(
      `SELECT * FROM pago_proveedor_items
       WHERE id = $1 AND tipo IN ('CHEQUE','CHEQUE_ENDOSADO') FOR UPDATE`,
      [req.params.cheque_id]
    );
    if (!chq.rows.length) throw new Error('Cheque no encontrado');

    const cheque = chq.rows[0];
    if (cheque.tipo === 'CHEQUE_ENDOSADO') {
      throw new Error('Un cheque endosado sigue el estado del cheque original: gestionalo desde Cobros');
    }
    if (!desde.includes(cheque.estado)) {
      throw new Error(`Un cheque ${cheque.estado} no se puede pasar a ${hacia}`);
    }

    const campos = extra(req.body, cheque);
    const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`);
    const valores = Object.values(campos);

    const { rows } = await client.query(`
      UPDATE pago_proveedor_items
      SET estado = $${valores.length + 2}, updated_at = now()${sets.length ? ', ' + sets.join(', ') : ''}
      WHERE id = $1 RETURNING *
    `, [req.params.cheque_id, ...valores, hacia]);

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

/* El cheque salió de la cuenta. No cambia la deuda: ya estaba cancelada
   al entregarlo. Sí saca el monto del compromiso de caja pendiente. */
router.post('/cheques/:cheque_id/debitar', soloAdmin, (req, res) =>
  cambiarEstadoCheque(req, res, {
    desde: ['ENTREGADO'],
    hacia: 'DEBITADO',
    extra: (body) => ({ fecha_debito: body.fecha || hoy() })
  })
);

/* Rechazo: el proveedor devuelve el cheque. Al dejar de estar vigente,
   sus imputaciones dejan de contar y la deuda reaparece sola. */
router.post('/cheques/:cheque_id/rechazar', soloAdmin, (req, res) =>
  cambiarEstadoCheque(req, res, {
    desde: ['ENTREGADO', 'DEBITADO'],
    hacia: 'RECHAZADO',
    extra: (body) => ({
      cheque_motivo_rechazo: body.motivo || 'Sin fondos',
      cheque_gasto_comision: body.gasto_comision || 0,
      fecha_debito: null
    })
  })
);

/* Anular un cheque cargado por error. */
router.post('/cheques/:cheque_id/anular', soloAdmin, (req, res) =>
  cambiarEstadoCheque(req, res, {
    desde: ['ENTREGADO', 'DEBITADO', 'RECHAZADO'],
    hacia: 'ANULADO',
    extra: (body) => ({ observaciones: body.motivo || 'Anulado' })
  })
);

/* =====================================================================
 * 5. RUTAS POR ID DEL PAGO
 * Van al final a propósito: `/:id` matchea cualquier cosa, así que si se
 * registraran antes se comerían /cheques, /deuda, /resumen, etc. Ese fue
 * exactamente el bug que dejaba muerta la pestaña de Órdenes de Pago en
 * la versión anterior.
 * ===================================================================*/

router.param('id', (req, res, next, valor) => {
  if (!/^\d+$/.test(valor)) return res.status(404).json({ error: 'Ruta no encontrada' });
  next();
});

/* Detalle de un pago: formas de pago + a qué facturas se imputó. */
router.get('/:id', soloAdmin, async (req, res) => {
  try {
    const pago = await pool.query(`
      SELECT pp.*, pr.nombre AS proveedor_nombre, pr.cuit
      FROM pagos_proveedores pp
      LEFT JOIN proveedores pr ON pr.id = pp.proveedor_id
      WHERE pp.id = $1
    `, [req.params.id]);

    if (!pago.rows.length) return fallar(res, 404, 'Pago no encontrado');

    const items = await pool.query(`
      SELECT ppi.*,
             ${ESTADO_EFECTIVO_ITEM} AS estado_efectivo,
             orig.cheque_numero AS origen_cheque_numero,
             orig.cheque_banco  AS origen_cheque_banco,
             orig.estado        AS origen_estado,
             cli.nombre         AS cliente_origen,
             COALESCE((SELECT SUM(ap.monto_aplicado) FROM aplicacion_pagos_proveedores ap
                       WHERE ap.pago_item_id = ppi.id), 0) AS imputado
      FROM pago_proveedor_items ppi
      JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
      LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
      LEFT JOIN pagos        pcli ON pcli.id = orig.pago_id
      LEFT JOIN clientes     cli  ON cli.id = pcli.cliente_id
      WHERE ppi.pago_id = $1 ORDER BY ppi.id
    `, [req.params.id]);

    const imputaciones = await pool.query(`
      SELECT ap.id, ap.factura_compra_id, ap.monto_aplicado, ap.created_at,
             fc.numero_factura, fc.tipo_factura, fc.fecha_emision,
             ppi.tipo AS forma_pago, ppi.estado AS estado_forma, ppi.cheque_numero
      FROM aplicacion_pagos_proveedores ap
      JOIN facturas_compra fc       ON fc.id = ap.factura_compra_id
      JOIN pago_proveedor_items ppi ON ppi.id = ap.pago_item_id
      WHERE ap.pago_id = $1
      ORDER BY fc.fecha_emision, ap.id
    `, [req.params.id]);

    res.json({ ...pago.rows[0], items: items.rows, imputaciones: imputaciones.rows });
  } catch (err) {
    console.error('Error obteniendo pago:', err);
    fallar(res, 500, err.message);
  }
});

/* Imputar (o seguir imputando) un pago ya registrado. */
router.post('/:id/imputar', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pago = await client.query(
      'SELECT * FROM pagos_proveedores WHERE id = $1 FOR UPDATE', [req.params.id]
    );
    if (!pago.rows.length) throw new Error('Pago no encontrado');
    if (pago.rows[0].anulado) throw new Error('El pago está anulado');

    const { aplicaciones, imputar_automatico } = req.body;
    const resultado = (Array.isArray(aplicaciones) && aplicaciones.length)
      ? await imputar(client, pago.rows[0].id, pago.rows[0].proveedor_id, aplicaciones)
      : await imputarAutomatico(client, pago.rows[0].id, pago.rows[0].proveedor_id);

    if (!resultado.length) throw new Error('No hay facturas pendientes a las que imputar este pago');

    await client.query('COMMIT');
    res.json({ message: `Imputado a ${resultado.length} factura(s)`, imputaciones: resultado });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error imputando pago:', err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
});

/* Anular un pago entero. Libera la deuda imputada y, si había un cheque
   de cliente endosado, lo devuelve a cartera. */
router.post('/:id/anular', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pago = await client.query(
      'SELECT * FROM pagos_proveedores WHERE id = $1 FOR UPDATE', [req.params.id]
    );
    if (!pago.rows.length) throw new Error('Pago no encontrado');
    if (pago.rows[0].anulado) throw new Error('El pago ya estaba anulado');

    const endosados = await client.query(
      `SELECT pago_item_origen_id, endoso_id FROM pago_proveedor_items
       WHERE pago_id = $1 AND tipo = 'CHEQUE_ENDOSADO' AND pago_item_origen_id IS NOT NULL`,
      [req.params.id]
    );

    for (const e of endosados.rows) {
      await client.query(`
        UPDATE pago_items
        SET endosado = false, endosado_a_proveedor_id = NULL, fecha_endoso = NULL, updated_at = now()
        WHERE id = $1
      `, [e.pago_item_origen_id]);
      if (e.endoso_id) {
        // Soltar la referencia antes de borrar el endoso: si no, la FK
        // pago_proveedor_items.endoso_id bloquea el DELETE.
        await client.query(
          'UPDATE pago_proveedor_items SET endoso_id = NULL WHERE endoso_id = $1', [e.endoso_id]
        );
        await client.query('DELETE FROM endosos_cheques WHERE id = $1', [e.endoso_id]);
      }
    }

    await client.query('DELETE FROM aplicacion_pagos_proveedores WHERE pago_id = $1', [req.params.id]);
    await client.query(
      `UPDATE pago_proveedor_items SET estado = 'ANULADO', updated_at = now() WHERE pago_id = $1`,
      [req.params.id]
    );
    await client.query(`
      UPDATE pagos_proveedores
      SET anulado = true, motivo_anulacion = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [req.params.id, req.body.motivo || 'sin motivo']);

    await client.query('COMMIT');
    res.json({
      message: 'Pago anulado. La deuda de las facturas imputadas volvió a quedar abierta.',
      cheques_devueltos_a_cartera: endosados.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error anulando pago:', err);
    fallar(res, 400, err.message);
  } finally {
    client.release();
  }
});

module.exports = router;

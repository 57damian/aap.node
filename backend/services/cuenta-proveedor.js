/* =====================================================================
 * CUENTA DE PROVEEDORES — definición única del saldo
 * ---------------------------------------------------------------------
 * Espejo de services/cuenta-cliente.js, para el lado de compras.
 *
 * Existe para que haya UNA sola definición de "cuánto le debo a un
 * proveedor". Antes había tres campos que decían representar lo mismo y
 * ninguno funcionaba: facturas_compra.neto_pagado (nunca se actualizaba
 * pero era el que se leía), facturas_compra.saldo_pendiente (se
 * descontaba al pagar pero nunca se inicializaba, así que valía NULL) y
 * el agregado de pagos_proveedores filtrando por estado='CONFIRMADO',
 * que el alta de pagos nunca escribía. Las dos columnas se eliminaron en
 * migracion-pagos-proveedores.sql: el saldo se calcula, no se guarda.
 *
 * REGLAS
 * ------
 * 1. Una factura de compra se cancela con imputaciones cuyo item de pago
 *    está ENTREGADO o DEBITADO. Entregar el valor ya cancela la factura
 *    (es el criterio contable habitual: la cuenta del proveedor se salda
 *    al entregarle el cheque; lo que queda es un compromiso de caja).
 * 2. Lo cubierto con cheques todavía no debitados se expone aparte, como
 *    `en_valores`. Es el número que responde "de lo que figura pagado,
 *    cuánto todavía no salió de la cuenta".
 * 3. Un cheque RECHAZADO o ANULADO deja de contar y la deuda reaparece
 *    sola, sin revertir nada a mano — igual que del lado de cobros.
 * 4. Un cheque de cliente endosado a un proveedor hereda la suerte del
 *    cheque original: si al cliente se lo rechazan, la deuda con el
 *    proveedor vuelve automáticamente (ver ESTADO_EFECTIVO_ITEM).
 *
 * INVARIANTE (correr después de tocar cualquier cosa del módulo):
 *
 *     saldo del panel de deuda − exceso pagado = saldo de la cuenta corriente
 *
 * para todo proveedor. El panel suma solo saldos positivos; la cuenta
 * corriente suma todos los movimientos. El saldo a favor por pagos sin
 * imputar NO entra en ninguno de los dos lados.
 * ===================================================================== */

/**
 * Estado real de un item de pago a proveedor.
 * Un cheque de cliente endosado no tiene estado propio: vale lo que valga
 * el cheque original. Requiere los alias `ppi` (item), `pp` (pago) y
 * `orig` (pago_items del cheque de cliente, LEFT JOIN).
 */
const ESTADO_EFECTIVO_ITEM = `
  CASE
    WHEN pp.anulado THEN 'ANULADO'
    WHEN ppi.tipo = 'CHEQUE_ENDOSADO' AND orig.estado IN ('RECHAZADO','ANULADO') THEN 'RECHAZADO'
    WHEN ppi.tipo = 'CHEQUE_ENDOSADO' AND orig.estado = 'ACREDITADO' THEN 'DEBITADO'
    ELSE ppi.estado
  END
`;

/** Imputaciones vigentes por factura de compra. Se usa dentro del CTE. */
const SUBQ_IMPUTADO = `
  SELECT
    ap.factura_compra_id,
    SUM(ap.monto_aplicado) FILTER (WHERE est.efectivo IN ('ENTREGADO','DEBITADO'))       AS pagado,
    SUM(ap.monto_aplicado) FILTER (WHERE est.efectivo = 'ENTREGADO'
                                     AND ppi.tipo IN ('CHEQUE','CHEQUE_ENDOSADO'))       AS en_valores,
    SUM(ap.monto_aplicado) FILTER (WHERE est.efectivo = 'RECHAZADO')                     AS rechazado
  FROM aplicacion_pagos_proveedores ap
  JOIN pago_proveedor_items ppi ON ppi.id = ap.pago_item_id
  JOIN pagos_proveedores    pp  ON pp.id  = ppi.pago_id
  LEFT JOIN pago_items      orig ON orig.id = ppi.pago_item_origen_id
  CROSS JOIN LATERAL (SELECT ${ESTADO_EFECTIVO_ITEM} AS efectivo) est
  GROUP BY ap.factura_compra_id
`;

/**
 * Factura de compra con su saldo real.
 * Se usa como CTE: `WITH ${CTE_FACTURAS_COMPRA} SELECT ...`
 *
 * La fecha de vencimiento es derivada: si la factura no la trae cargada
 * se calcula como fecha_emision + proveedores.dias_credito. Antes la
 * columna quedaba siempre en NULL porque el alta de facturas de compra
 * nunca la completaba.
 */
const CTE_FACTURAS_COMPRA = `
  facturas_compra_saldo AS (
    SELECT
      fc.id,
      fc.proveedor_id,
      fc.numero_factura,
      fc.tipo_factura,
      fc.punto_venta,
      fc.fecha_emision                                   AS fecha,
      fc.condicion_pago,
      fc.estado                                          AS estado_registro,
      COALESCE(pr.dias_credito, 0)                       AS dias_credito,
      COALESCE(
        fc.fecha_vencimiento,
        (fc.fecha_emision + (COALESCE(pr.dias_credito, 0) || ' days')::interval)::date
      )                                                  AS fecha_vencimiento,
      ROUND(fc.total, 2)                                 AS total,
      ROUND(COALESCE(imp.pagado, 0), 2)                  AS pagado,
      ROUND(COALESCE(imp.en_valores, 0), 2)              AS en_valores,
      ROUND(COALESCE(imp.rechazado, 0), 2)               AS rechazado,
      ROUND(fc.total - COALESCE(imp.pagado, 0), 2)       AS saldo,
      (CURRENT_DATE - COALESCE(
        fc.fecha_vencimiento,
        (fc.fecha_emision + (COALESCE(pr.dias_credito, 0) || ' days')::interval)::date
      ))                                                 AS dias_atraso
    FROM facturas_compra fc
    JOIN proveedores pr ON pr.id = fc.proveedor_id
    LEFT JOIN (${SUBQ_IMPUTADO}) imp ON imp.factura_compra_id = fc.id
    WHERE COALESCE(fc.estado, 'PENDIENTE') <> 'ANULADA'
  )
`;

/**
 * Saldo a favor por proveedor: plata pagada y no rechazada que todavía no
 * se imputó a ninguna factura (pagos a cuenta / anticipos).
 * NO incluye el exceso de las facturas sobre-pagadas — ese va aparte.
 */
const CTE_A_FAVOR_PROV = `
  a_favor_prov AS (
    SELECT
      pp.proveedor_id,
      ROUND(SUM(ppi.monto - COALESCE(ap.imputado, 0)), 2) AS saldo_a_favor
    FROM pago_proveedor_items ppi
    JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
    LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
    LEFT JOIN (
      SELECT pago_item_id, SUM(monto_aplicado) AS imputado
      FROM aplicacion_pagos_proveedores GROUP BY pago_item_id
    ) ap ON ap.pago_item_id = ppi.id
    WHERE pp.anulado = false
      AND ${ESTADO_EFECTIVO_ITEM} NOT IN ('RECHAZADO','ANULADO')
    GROUP BY pp.proveedor_id
  )
`;

/**
 * Exceso imputado sobre facturas pagadas de más (saldo negativo).
 * Se usa como expresión de agregación sobre facturas_compra_saldo con
 * alias `fs`. Ver la invariante en la cabecera del archivo.
 */
const EXCESO_PAGADO = `
  ROUND(COALESCE(SUM(-fs.saldo) FILTER (WHERE fs.saldo < -0.005), 0), 2)
`;

/** Estado mostrable de una factura de compra. El alias de la fila debe ser `fs`. */
const ESTADO_FACTURA_COMPRA = `
  CASE
    WHEN fs.saldo < -0.005                  THEN 'SOBRE_PAGADA'
    WHEN fs.saldo <= 0.005 AND fs.en_valores > 0.005 THEN 'PAGADA_EN_VALORES'
    WHEN fs.saldo <= 0.005                  THEN 'PAGADA'
    WHEN fs.dias_atraso > 0                 THEN 'VENCIDA'
    WHEN fs.pagado > 0.005                  THEN 'PARCIAL'
    ELSE 'PENDIENTE'
  END
`;

/** Totales de cuenta de un proveedor. */
async function resumenProveedor(pool, proveedorId) {
  const { rows } = await pool.query(`
    WITH ${CTE_FACTURAS_COMPRA}, ${CTE_A_FAVOR_PROV}
    SELECT
      ROUND(COALESCE(SUM(fs.total), 0), 2)      AS total_facturado,
      ROUND(COALESCE(SUM(fs.pagado), 0), 2)     AS total_pagado,
      ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005), 0), 2) AS saldo,
      ROUND(COALESCE(SUM(fs.en_valores), 0), 2) AS en_valores,
      ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso > 0), 0), 2) AS vencido,
      COUNT(*) FILTER (WHERE fs.saldo > 0.005)  AS facturas_pendientes,
      MAX(fs.dias_atraso) FILTER (WHERE fs.saldo > 0.005) AS dias_atraso_max,
      ${EXCESO_PAGADO} AS exceso_pagado,
      ROUND(GREATEST(COALESCE((SELECT af.saldo_a_favor FROM a_favor_prov af
                               WHERE af.proveedor_id = $1), 0), 0), 2) AS saldo_a_favor
    FROM facturas_compra_saldo fs
    WHERE fs.proveedor_id = $1
  `, [proveedorId]);
  return rows[0];
}

/** Movimientos de cuenta corriente con saldo acumulado (lo que le debemos). */
async function cuentaCorrienteProveedor(pool, proveedorId, { desde, hasta } = {}) {
  const params = [proveedorId];
  let filtro = '';
  if (desde) { params.push(desde); filtro += ` AND fecha >= $${params.length}`; }
  if (hasta) { params.push(hasta); filtro += ` AND fecha <= $${params.length}`; }

  const { rows } = await pool.query(`
    SELECT * FROM (
      -- Facturas de compra recibidas: aumentan lo que debemos
      SELECT fc.fecha_emision AS fecha, 1 AS orden, 'FACTURA' AS tipo,
             fc.numero_factura AS comprobante,
             ROUND(fc.total, 2) AS debe, 0::numeric AS haber, ROUND(fc.total, 2) AS monto,
             NULL::text AS detalle, fc.id AS ref_id
      FROM facturas_compra fc
      WHERE fc.proveedor_id = $1 AND COALESCE(fc.estado,'PENDIENTE') <> 'ANULADA'

      UNION ALL

      -- Pagos imputados y vigentes: son los únicos que bajan el saldo
      SELECT COALESCE(ppi.fecha_debito, pp.fecha) AS fecha, 2, 'PAGO',
             'Pago #' || pp.id,
             0::numeric, ROUND(SUM(ap.monto_aplicado), 2), ROUND(SUM(ap.monto_aplicado), 2),
             ppi.tipo || COALESCE(' ' || ppi.cheque_numero, '')
                       || COALESCE(' ' || orig.cheque_numero, ''),
             pp.id
      FROM aplicacion_pagos_proveedores ap
      JOIN pago_proveedor_items ppi ON ppi.id = ap.pago_item_id
      JOIN pagos_proveedores    pp  ON pp.id  = ppi.pago_id
      LEFT JOIN pago_items      orig ON orig.id = ppi.pago_item_origen_id
      WHERE pp.proveedor_id = $1
        AND ${ESTADO_EFECTIVO_ITEM} IN ('ENTREGADO','DEBITADO')
      GROUP BY ppi.fecha_debito, pp.fecha, pp.id, ppi.tipo, ppi.cheque_numero, orig.cheque_numero

      UNION ALL

      -- Informativos: no mueven el saldo. Explican por qué una factura
      -- figura cancelada aunque la plata todavía no haya salido, o por qué
      -- una que parecía pagada volvió a quedar abierta.
      SELECT COALESCE(ppi.cheque_fecha_cobro, pp.fecha), 3,
             CASE WHEN ${ESTADO_EFECTIVO_ITEM} = 'RECHAZADO' THEN 'CHEQUE_RECHAZADO'
                  ELSE 'CHEQUE_A_DEBITAR' END,
             'Cheque ' || COALESCE(ppi.cheque_numero, orig.cheque_numero, 's/n'),
             0::numeric, 0::numeric, ROUND(ppi.monto, 2),
             CASE WHEN ${ESTADO_EFECTIVO_ITEM} = 'RECHAZADO'
                  THEN 'Rechazado: ' || COALESCE(ppi.cheque_motivo_rechazo, orig.cheque_motivo_rechazo, 'sin motivo')
                  ELSE 'Entregado, se debita el ' ||
                       to_char(COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro), 'DD/MM/YYYY') END,
             pp.id
      FROM pago_proveedor_items ppi
      JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
      LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
      WHERE pp.proveedor_id = $1
        AND ppi.tipo IN ('CHEQUE','CHEQUE_ENDOSADO')
        AND ${ESTADO_EFECTIVO_ITEM} IN ('ENTREGADO','RECHAZADO')
    ) mov
    WHERE 1=1 ${filtro}
    ORDER BY fecha ASC, orden ASC
  `, params);

  let acumulado = 0;
  return rows.map(m => {
    acumulado += parseFloat(m.debe) - parseFloat(m.haber);
    return { ...m, saldo_acumulado: Math.round(acumulado * 100) / 100 };
  });
}

/** Saldo pendiente de una factura de compra puntual. */
async function saldoFacturaCompra(clientOrPool, facturaCompraId) {
  const { rows } = await clientOrPool.query(`
    WITH ${CTE_FACTURAS_COMPRA}
    SELECT fs.* FROM facturas_compra_saldo fs WHERE fs.id = $1
  `, [facturaCompraId]);
  return rows[0] || null;
}

module.exports = {
  ESTADO_EFECTIVO_ITEM,
  SUBQ_IMPUTADO,
  CTE_FACTURAS_COMPRA,
  CTE_A_FAVOR_PROV,
  EXCESO_PAGADO,
  ESTADO_FACTURA_COMPRA,
  resumenProveedor,
  cuentaCorrienteProveedor,
  saldoFacturaCompra
};

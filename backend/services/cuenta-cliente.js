/* =====================================================================
 * CUENTA DE CLIENTES — definición única del saldo
 * ---------------------------------------------------------------------
 * Este módulo existe para que haya UNA sola definición de "cuánto debe
 * un cliente" en todo el sistema. Antes había tres convenciones distintas
 * (pagos.estado 'aplicado' vs 'acreditado', más un saldo que nunca se
 * calculaba), y por eso el saldo de todo cliente daba igual al total
 * facturado. Cualquier ruta que necesite saldos importa de acá.
 *
 * Regla: una factura se cancela con imputaciones cuyo item de cobro está
 * ACREDITADO. Un cheque en cartera o depositado NO cancela deuda: cuenta
 * aparte como "en gestión de cobro".
 * ===================================================================== */

/** Factura con su saldo real. Se usa como CTE: `WITH ${CTE_FACTURAS} SELECT ...` */
const CTE_FACTURAS = `
  facturas_saldo AS (
    SELECT
      f.id,
      f.cliente_id,
      f.numero_factura,
      f.tipo_factura,
      f.fecha,
      COALESCE(f.dias_credito, 0)                                             AS dias_credito,
      (f.fecha + (COALESCE(f.dias_credito, 0) || ' days')::interval)::date    AS fecha_vencimiento,
      ROUND(f.total, 2)                                                       AS total,
      ROUND(COALESCE(nc.total_nc, 0), 2)                                      AS notas_credito,
      ROUND(COALESCE(imp.cobrado, 0), 2)                                      AS cobrado,
      ROUND(COALESCE(imp.en_gestion, 0), 2)                                   AS en_gestion,
      ROUND(f.total - COALESCE(nc.total_nc, 0) - COALESCE(imp.cobrado, 0), 2) AS saldo,
      (CURRENT_DATE - (f.fecha + (COALESCE(f.dias_credito, 0) || ' days')::interval)::date) AS dias_atraso
    FROM facturas f
    LEFT JOIN (
      SELECT factura_id, SUM(total) AS total_nc
      FROM notas_credito
      GROUP BY factura_id
    ) nc ON nc.factura_id = f.id
    LEFT JOIN (
      SELECT
        ap.factura_id,
        SUM(ap.monto_aplicado) FILTER (WHERE pi.estado = 'ACREDITADO')                 AS cobrado,
        SUM(ap.monto_aplicado) FILTER (WHERE pi.estado IN ('EN_CARTERA','DEPOSITADO')) AS en_gestion
      FROM aplicacion_pagos ap
      JOIN pago_items pi ON pi.id = ap.pago_item_id
      GROUP BY ap.factura_id
    ) imp ON imp.factura_id = f.id
  )
`;

/** Saldo a favor por cliente: plata cobrada y no rechazada que todavía
 * no se imputó a ninguna factura. NO incluye el exceso de las facturas
 * sobre-cobradas — ese va aparte (ver EXCESO_COBRADO), porque son cosas
 * distintas y mezclarlas rompe el chequeo de consistencia de abajo. */
const CTE_A_FAVOR = `
  a_favor AS (
    SELECT
      p.cliente_id,
      ROUND(SUM(pi.monto - COALESCE(ap.imputado, 0)), 2) AS saldo_a_favor
    FROM pago_items pi
    JOIN pagos p ON p.id = pi.pago_id
    LEFT JOIN (
      SELECT pago_item_id, SUM(monto_aplicado) AS imputado
      FROM aplicacion_pagos GROUP BY pago_item_id
    ) ap ON ap.pago_item_id = pi.id
    WHERE p.anulado = false
      AND pi.estado NOT IN ('RECHAZADO','ANULADO')
    GROUP BY p.cliente_id
  )
`;

/** Exceso imputado sobre facturas cobradas de más (saldo negativo).
 *
 * CHEQUEO DE CONSISTENCIA — vale la pena recordarlo, porque es la forma más
 * barata de detectar que algún cálculo se desincronizó:
 *
 *     saldo del panel de deuda − exceso cobrado = saldo de la cuenta corriente
 *
 * Se cumple porque el panel suma solo los saldos positivos (Σ max(saldo,0))
 * mientras la cuenta corriente suma todos los movimientos (Σ saldo). El
 * saldo a favor por cobros sin imputar NO entra en ninguno de los dos lados,
 * así que restarlo acá sería descontarlo dos veces.
 *
 * Se usa como expresión de agregación sobre facturas_saldo con alias `fs`. */
const EXCESO_COBRADO = `
  ROUND(COALESCE(SUM(-fs.saldo) FILTER (WHERE fs.saldo < -0.005), 0), 2)
`;

/** Estado mostrable de una factura. Requiere que el alias de la fila sea `fs`. */
const ESTADO_FACTURA = `
  CASE
    WHEN fs.saldo < -0.005                 THEN 'SOBRE_COBRADA'
    WHEN fs.saldo <= 0.005                 THEN 'COBRADA'
    WHEN fs.en_gestion >= fs.saldo - 0.005 THEN 'EN_GESTION'
    WHEN fs.dias_atraso > 0                THEN 'VENCIDA'
    WHEN fs.cobrado > 0.005                THEN 'PARCIAL'
    ELSE 'PENDIENTE'
  END
`;

/** Totales de cuenta de un cliente. */
async function resumenCliente(pool, clienteId) {
  const { rows } = await pool.query(`
    WITH ${CTE_FACTURAS}, ${CTE_A_FAVOR}
    SELECT
      ROUND(COALESCE(SUM(fs.total), 0), 2)         AS total_facturado,
      ROUND(COALESCE(SUM(fs.notas_credito), 0), 2) AS notas_credito,
      ROUND(COALESCE(SUM(fs.cobrado), 0), 2)       AS total_cobrado,
      ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005), 0), 2) AS saldo,
      ROUND(COALESCE(SUM(fs.en_gestion), 0), 2)    AS en_gestion,
      ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso > 0), 0), 2) AS vencido,
      MAX(fs.dias_atraso) FILTER (WHERE fs.saldo > 0.005) AS dias_atraso_max,
      ${EXCESO_COBRADO} AS exceso_cobrado,
      ROUND(GREATEST(COALESCE((SELECT af.saldo_a_favor FROM a_favor af WHERE af.cliente_id = $1), 0), 0), 2) AS saldo_a_favor
    FROM facturas_saldo fs
    WHERE fs.cliente_id = $1
  `, [clienteId]);
  return rows[0];
}

/** Movimientos de cuenta corriente con saldo acumulado. */
async function cuentaCorriente(pool, clienteId, { desde, hasta } = {}) {
  const params = [clienteId];
  let filtro = '';
  if (desde) { params.push(desde); filtro += ` AND fecha >= $${params.length}`; }
  if (hasta) { params.push(hasta); filtro += ` AND fecha <= $${params.length}`; }

  const { rows } = await pool.query(`
    SELECT * FROM (
      -- Facturas emitidas
      SELECT f.fecha, 1 AS orden, 'FACTURA' AS tipo,
             f.numero_factura AS comprobante,
             ROUND(f.total, 2) AS debe, 0::numeric AS haber, ROUND(f.total, 2) AS monto,
             NULL::text AS detalle, f.id AS ref_id
      FROM facturas f
      WHERE f.cliente_id = $1

      UNION ALL

      -- Notas de crédito
      SELECT nc.fecha, 2, 'NOTA_CREDITO',
             nc.numero_nota,
             0::numeric, ROUND(nc.total, 2), ROUND(nc.total, 2),
             'NC sobre factura ' || f.numero_factura, nc.id
      FROM notas_credito nc
      JOIN facturas f ON f.id = nc.factura_id
      WHERE f.cliente_id = $1

      UNION ALL

      -- Cobros imputados y acreditados: los únicos que mueven el saldo
      SELECT COALESCE(pi.fecha_acreditacion, p.fecha_recepcion), 3, 'COBRO',
             'Cobro #' || p.id,
             0::numeric, ROUND(SUM(ap.monto_aplicado), 2), ROUND(SUM(ap.monto_aplicado), 2),
             pi.tipo || COALESCE(' ' || pi.cheque_numero, ''), p.id
      FROM aplicacion_pagos ap
      JOIN pago_items pi ON pi.id = ap.pago_item_id
      JOIN pagos p       ON p.id = pi.pago_id
      WHERE p.cliente_id = $1 AND p.anulado = false AND pi.estado = 'ACREDITADO'
      GROUP BY pi.fecha_acreditacion, p.fecha_recepcion, p.id, pi.tipo, pi.cheque_numero

      UNION ALL

      -- Informativos: no mueven el saldo, porque un cheque solo cancela
      -- deuda al acreditarse. Se listan para explicar por qué una factura
      -- figura impaga aunque el cliente ya haya entregado un valor.
      SELECT p.fecha_recepcion, 4,
             CASE pi.estado WHEN 'RECHAZADO' THEN 'CHEQUE_RECHAZADO' ELSE 'CHEQUE_EN_GESTION' END,
             'Cheque ' || COALESCE(pi.cheque_numero, 's/n'),
             0::numeric, 0::numeric, ROUND(pi.monto, 2),
             CASE pi.estado
               WHEN 'RECHAZADO'  THEN 'Rechazado: ' || COALESCE(pi.cheque_motivo_rechazo, 'sin motivo')
               WHEN 'DEPOSITADO' THEN 'Depositado, a la espera de acreditación'
               ELSE 'En cartera, se cobra el ' || to_char(pi.cheque_fecha_cobro, 'DD/MM/YYYY')
             END,
             p.id
      FROM pago_items pi
      JOIN pagos p ON p.id = pi.pago_id
      WHERE p.cliente_id = $1 AND p.anulado = false
        AND pi.tipo = 'CHEQUE'
        AND pi.estado IN ('EN_CARTERA','DEPOSITADO','RECHAZADO')
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

/** Saldo pendiente de una factura puntual (lo usa Notas de Crédito). */
async function saldoFactura(clientOrPool, facturaId) {
  const { rows } = await clientOrPool.query(`
    WITH ${CTE_FACTURAS}
    SELECT fs.* FROM facturas_saldo fs WHERE fs.id = $1
  `, [facturaId]);
  return rows[0] || null;
}

module.exports = {
  CTE_FACTURAS,
  CTE_A_FAVOR,
  EXCESO_COBRADO,
  ESTADO_FACTURA,
  resumenCliente,
  cuentaCorriente,
  saldoFactura
};

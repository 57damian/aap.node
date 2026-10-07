/* =====================================================================
 * Informes contables (07/10/2026): ventas vs compras, IVA, impuestos y
 * balance de un período. Solo lectura. Dos criterios:
 *
 *  - 'factura' (devengado): cada factura cuenta en el mes en que se
 *    emitió, se haya cobrado/pagado o no. Es el criterio del IVA.
 *      · Ventas: facturas no anuladas, netas de notas de crédito (que
 *        restan en su propia fecha).
 *      · Compras: facturas_compra no anuladas.
 *      · Gastos: gastos VIGENTES, por su neto (el IVA va al crédito fiscal).
 *
 *  - 'percibido' (flujo de plata): solo lo que se cobró y se pagó.
 *      · Cobrado: pago_items ACREDITADO (sin retenciones) de cobros no anulados.
 *      · Pagado a proveedores: ítems de pago en estado efectivo ENTREGADO o
 *        DEBITADO (un cheque entregado ya cancela la factura; el cheque
 *        endosado de un cliente cuenta en los dos lados), sin retenciones.
 *      · Gastos: por su total (con IVA: es plata que salió).
 *    No calcula IVA: se liquida por facturación, no por cobro.
 *
 * Todo en pesos. Los importes salen redondeados a centavos (`r2`).
 * ===================================================================== */

const { r2 } = require('./montos');
const { ESTADO_EFECTIVO_ITEM } = require('./cuenta-proveedor');

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MESES = 60;

const num = (v) => r2(Number(v) || 0);

function validarRango(desde, hasta) {
  for (const [valor, etiqueta] of [[desde, 'Desde'], [hasta, 'Hasta']]) {
    if (!RE_FECHA.test(String(valor || '')) || isNaN(new Date(valor + 'T00:00:00'))) {
      const e = new Error(`${etiqueta} no es una fecha válida`);
      e.status = 400;
      throw e;
    }
  }
  if (desde > hasta) {
    const e = new Error('La fecha "Desde" no puede ser posterior a "Hasta"');
    e.status = 400;
    throw e;
  }
}

/** Lista de 'YYYY-MM' desde el mes de `desde` hasta el de `hasta`. */
function mesesDelRango(desde, hasta) {
  const meses = [];
  let [a, m] = desde.slice(0, 7).split('-').map(Number);
  const [ah, mh] = hasta.slice(0, 7).split('-').map(Number);
  while ((a < ah || (a === ah && m <= mh)) && meses.length <= MAX_MESES) {
    meses.push(`${a}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  if (meses.length > MAX_MESES) {
    const e = new Error(`El período es demasiado largo (máximo ${MAX_MESES} meses)`);
    e.status = 400;
    throw e;
  }
  return meses;
}

const MES = (columna) => `to_char(${columna}, 'YYYY-MM')`;

/** Cobros acreditados (sin retenciones): la fecha es la de acreditación. */
const FECHA_COBRO = 'COALESCE(pi.fecha_acreditacion, p.fecha_recepcion)';

async function consultas(pool, desde, hasta) {
  const p = [desde, hasta];

  const [ventas, notasCredito, compras, ivaAlicuota, gastos, retenciones, cobrado, pagado] = await Promise.all([
    pool.query(`
      SELECT ${MES('f.fecha')} AS mes,
             COALESCE(SUM(f.subtotal_sin_iva), 0) AS neto, COALESCE(SUM(f.iva_21), 0) AS iva,
             COALESCE(SUM(f.total), 0) AS total, COUNT(*)::int AS cantidad
      FROM facturas f
      WHERE COALESCE(upper(f.estado), 'EMITIDA') <> 'ANULADA' AND f.fecha BETWEEN $1 AND $2
      GROUP BY 1`, p),
    pool.query(`
      SELECT ${MES('nc.fecha')} AS mes,
             COALESCE(SUM(nc.subtotal), 0) AS neto, COALESCE(SUM(nc.iva_21), 0) AS iva,
             COALESCE(SUM(nc.total), 0) AS total, COUNT(*)::int AS cantidad
      FROM notas_credito nc
      WHERE nc.fecha BETWEEN $1 AND $2
      GROUP BY 1`, p),
    pool.query(`
      SELECT ${MES('fc.fecha_emision')} AS mes,
             COALESCE(SUM(fc.subtotal), 0) AS neto, COALESCE(SUM(fc.iva), 0) AS iva,
             COALESCE(SUM(fc.percepciones), 0) AS percepciones,
             COALESCE(SUM(fc.impuestos_provinciales), 0) AS impuestos_provinciales,
             COALESCE(SUM(fc.retenciones), 0) AS retenciones,
             COALESCE(SUM(fc.total), 0) AS total, COUNT(*)::int AS cantidad
      FROM facturas_compra fc
      WHERE COALESCE(upper(fc.estado), 'PENDIENTE') <> 'ANULADA' AND fc.fecha_emision BETWEEN $1 AND $2
      GROUP BY 1`, p),
    pool.query(`
      SELECT COALESCE(fi.iva_porcentaje, 0) AS alicuota,
             COALESCE(SUM(fi.subtotal), 0) AS neto, COALESCE(SUM(fi.iva), 0) AS iva
      FROM factura_items fi
      JOIN facturas_compra fc ON fc.id = fi.factura_id
      WHERE COALESCE(upper(fc.estado), 'PENDIENTE') <> 'ANULADA' AND fc.fecha_emision BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY 1`, p),
    pool.query(`
      SELECT ${MES('g.fecha')} AS mes, c.id AS categoria_id, c.nombre, c.es_impuesto,
             COALESCE(SUM(g.neto), 0) AS neto, COALESCE(SUM(g.iva), 0) AS iva,
             COALESCE(SUM(g.total), 0) AS total, COUNT(*)::int AS cantidad
      FROM gastos g JOIN categorias_gasto c ON c.id = g.categoria_id
      WHERE g.estado = 'VIGENTE' AND g.fecha BETWEEN $1 AND $2
      GROUP BY 1, c.id, c.nombre, c.es_impuesto`, p),
    pool.query(`
      SELECT ${MES(FECHA_COBRO)} AS mes, COALESCE(pi.retencion_tipo, 'SIN TIPO') AS tipo,
             COALESCE(SUM(pi.monto), 0) AS total
      FROM pago_items pi JOIN pagos p ON p.id = pi.pago_id
      WHERE pi.tipo = 'RETENCION' AND pi.estado = 'ACREDITADO' AND COALESCE(p.anulado, false) = false
        AND ${FECHA_COBRO} BETWEEN $1 AND $2
      GROUP BY 1, 2`, p),
    pool.query(`
      SELECT ${MES(FECHA_COBRO)} AS mes, COALESCE(SUM(pi.monto), 0) AS total, COUNT(*)::int AS cantidad
      FROM pago_items pi JOIN pagos p ON p.id = pi.pago_id
      WHERE pi.tipo <> 'RETENCION' AND pi.estado = 'ACREDITADO' AND COALESCE(p.anulado, false) = false
        AND ${FECHA_COBRO} BETWEEN $1 AND $2
      GROUP BY 1`, p),
    pool.query(`
      SELECT ${MES('pp.fecha')} AS mes, COALESCE(SUM(ppi.monto), 0) AS total, COUNT(*)::int AS cantidad
      FROM pago_proveedor_items ppi
      JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
      LEFT JOIN pago_items orig ON orig.id = ppi.pago_item_origen_id
      CROSS JOIN LATERAL (SELECT ${ESTADO_EFECTIVO_ITEM} AS efectivo) est
      WHERE ppi.tipo <> 'RETENCION' AND est.efectivo IN ('ENTREGADO','DEBITADO')
        AND pp.fecha BETWEEN $1 AND $2
      GROUP BY 1`, p)
  ]);

  return {
    ventas: ventas.rows, notasCredito: notasCredito.rows, compras: compras.rows,
    ivaAlicuota: ivaAlicuota.rows, gastos: gastos.rows, retenciones: retenciones.rows,
    cobrado: cobrado.rows, pagado: pagado.rows
  };
}

const sumar = (filas, campo, mes) =>
  r2(filas.filter(f => mes === undefined || f.mes === mes).reduce((s, f) => s + (Number(f[campo]) || 0), 0));

/** Gastos agrupados por categoría (suma de todos los meses del período). */
function gastosPorCategoria(filas) {
  const mapa = new Map();
  for (const f of filas) {
    const c = mapa.get(f.categoria_id) || {
      categoria_id: f.categoria_id, nombre: f.nombre, es_impuesto: f.es_impuesto,
      neto: 0, iva: 0, total: 0, cantidad: 0
    };
    c.neto = r2(c.neto + Number(f.neto));
    c.iva = r2(c.iva + Number(f.iva));
    c.total = r2(c.total + Number(f.total));
    c.cantidad += f.cantidad;
    mapa.set(f.categoria_id, c);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

function retencionesPorTipo(filas) {
  const mapa = new Map();
  for (const f of filas) mapa.set(f.tipo, r2((mapa.get(f.tipo) || 0) + Number(f.total)));
  return [...mapa.entries()].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total);
}

function armarDevengado(d, meses, desde, hasta) {
  const ventasBrutas = { neto: sumar(d.ventas, 'neto'), iva: sumar(d.ventas, 'iva'), total: sumar(d.ventas, 'total'), cantidad: d.ventas.reduce((s, f) => s + f.cantidad, 0) };
  const nc = { neto: sumar(d.notasCredito, 'neto'), iva: sumar(d.notasCredito, 'iva'), total: sumar(d.notasCredito, 'total'), cantidad: d.notasCredito.reduce((s, f) => s + f.cantidad, 0) };
  const ventas = {
    neto: r2(ventasBrutas.neto - nc.neto),
    iva: r2(ventasBrutas.iva - nc.iva),
    total: r2(ventasBrutas.total - nc.total),
    cantidad: ventasBrutas.cantidad,
    facturado_neto: ventasBrutas.neto,
    notas_credito: nc
  };

  const compras = {
    neto: sumar(d.compras, 'neto'), iva: sumar(d.compras, 'iva'),
    percepciones: sumar(d.compras, 'percepciones'),
    impuestos_provinciales: sumar(d.compras, 'impuestos_provinciales'),
    retenciones: sumar(d.compras, 'retenciones'),
    total: sumar(d.compras, 'total'),
    cantidad: d.compras.reduce((s, f) => s + f.cantidad, 0)
  };

  const porCategoria = gastosPorCategoria(d.gastos);
  const gastosImp = d.gastos.filter(g => g.es_impuesto);
  const gastos = {
    neto: sumar(d.gastos, 'neto'), iva: sumar(d.gastos, 'iva'), total: sumar(d.gastos, 'total'),
    impuestos: sumar(gastosImp, 'neto'),
    otros: r2(sumar(d.gastos, 'neto') - sumar(gastosImp, 'neto')),
    por_categoria: porCategoria
  };

  const retenciones = retencionesPorTipo(d.retenciones);
  const retencionesIva = retenciones.find(r => r.tipo === 'IVA')?.total || 0;

  const creditoTotal = r2(compras.iva + gastos.iva);
  const saldo = r2(ventas.iva - creditoTotal);
  const iva = {
    debito: ventas.iva,
    credito_compras: compras.iva,
    credito_gastos: gastos.iva,
    credito_total: creditoTotal,
    saldo, // positivo = a pagar (en contra); negativo = a favor
    estado: saldo > 0 ? 'A_PAGAR' : saldo < 0 ? 'A_FAVOR' : 'SIN_SALDO',
    por_alicuota: d.ivaAlicuota.map(a => ({ alicuota: Number(a.alicuota), neto: num(a.neto), iva: num(a.iva) })),
    // Facturas de compra cargadas sin ítems (las viejas): tienen IVA en la
    // cabecera pero no se sabe a qué alícuota. Sin esto el desglose no cierra.
    credito_compras_sin_detalle: r2(compras.iva - d.ivaAlicuota.reduce((s, a) => s + Number(a.iva), 0)),
    retenciones_iva_sufridas: retencionesIva
  };

  const impuestos = {
    pagados: gastos.impuestos,
    percepciones_compras: compras.percepciones,
    impuestos_provinciales_compras: compras.impuestos_provinciales,
    retenciones_sufridas: retenciones,
    retenciones_sufridas_total: r2(retenciones.reduce((s, r) => s + r.total, 0))
  };

  const costoImpuestos = r2(compras.percepciones + compras.impuestos_provinciales);
  const balance = {
    ventas_netas: ventas.neto,
    compras_netas: compras.neto,
    gastos_netos: gastos.otros,
    impuestos_pagados: gastos.impuestos,
    percepciones_y_provinciales: costoImpuestos,
    resultado: r2(ventas.neto - compras.neto - gastos.otros - gastos.impuestos - costoImpuestos)
  };

  const mensual = meses.map(mes => {
    const v = r2(sumar(d.ventas, 'neto', mes) - sumar(d.notasCredito, 'neto', mes));
    const vIva = r2(sumar(d.ventas, 'iva', mes) - sumar(d.notasCredito, 'iva', mes));
    const c = sumar(d.compras, 'neto', mes);
    const cImp = r2(sumar(d.compras, 'percepciones', mes) + sumar(d.compras, 'impuestos_provinciales', mes));
    const gm = d.gastos.filter(g => g.mes === mes);
    const gImp = sumar(gm.filter(g => g.es_impuesto), 'neto');
    const gOtros = r2(sumar(gm, 'neto') - gImp);
    const credito = r2(sumar(d.compras, 'iva', mes) + sumar(gm, 'iva'));
    return {
      mes, ventas: v, compras: c, gastos: gOtros, impuestos: r2(gImp + cImp),
      resultado: r2(v - c - gOtros - gImp - cImp),
      iva_debito: vIva, iva_credito: credito, iva_saldo: r2(vIva - credito)
    };
  });

  return { criterio: 'factura', desde, hasta, ventas, compras, gastos, iva, impuestos, balance, mensual };
}

function armarPercibido(d, meses, desde, hasta) {
  const porCategoria = gastosPorCategoria(d.gastos);
  const gastosImp = d.gastos.filter(g => g.es_impuesto);
  const cobrado = sumar(d.cobrado, 'total');
  const pagadoProv = sumar(d.pagado, 'total');
  const gastosTotal = sumar(d.gastos, 'total');
  const retenciones = retencionesPorTipo(d.retenciones);

  const flujo = {
    cobrado,
    cobros: d.cobrado.reduce((s, f) => s + f.cantidad, 0),
    pagado_proveedores: pagadoProv,
    pagos: d.pagado.reduce((s, f) => s + f.cantidad, 0),
    gastos: gastosTotal,
    gastos_impuestos: sumar(gastosImp, 'total'),
    gastos_otros: r2(gastosTotal - sumar(gastosImp, 'total')),
    saldo: r2(cobrado - pagadoProv - gastosTotal)
  };

  const mensual = meses.map(mes => {
    const c = sumar(d.cobrado, 'total', mes);
    const p = sumar(d.pagado, 'total', mes);
    const g = sumar(d.gastos, 'total', mes);
    return { mes, cobrado: c, pagado_proveedores: p, gastos: g, saldo: r2(c - p - g) };
  });

  return {
    criterio: 'percibido', desde, hasta, flujo,
    gastos: { total: gastosTotal, por_categoria: porCategoria },
    impuestos: {
      pagados: flujo.gastos_impuestos,
      retenciones_sufridas: retenciones,
      retenciones_sufridas_total: r2(retenciones.reduce((s, r) => s + r.total, 0))
    },
    mensual
  };
}

/**
 * @param {object} pool
 * @param {{desde: string, hasta: string, criterio?: 'factura'|'percibido'}} opts
 */
async function resumen(pool, { desde, hasta, criterio = 'factura' }) {
  validarRango(desde, hasta);
  if (!['factura', 'percibido'].includes(criterio)) {
    const e = new Error('Criterio inválido (factura o percibido)');
    e.status = 400;
    throw e;
  }
  const meses = mesesDelRango(desde, hasta);
  const datos = await consultas(pool, desde, hasta);
  return criterio === 'factura'
    ? armarDevengado(datos, meses, desde, hasta)
    : armarPercibido(datos, meses, desde, hasta);
}

module.exports = { resumen, mesesDelRango };

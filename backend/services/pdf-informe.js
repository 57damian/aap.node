/* =====================================================================
 * PDF del informe contable (balance, ventas vs compras, IVA, impuestos).
 * Mismo patrón que el resto: pdfkit + membrete y tabla de pdf-base.js.
 * Recibe lo que devuelve services/informes.js `resumen()`.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, dibujarTabla, piePagina, fecha
} = require('./pdf-base');

function monto(v) {
  const n = Number(v) || 0;
  const t = Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + t;
}

function mesTexto(m) {
  const [a, mm] = String(m).split('-');
  return `${mm}/${a}`;
}

const COLS_CONCEPTO = [
  { campo: 'concepto', titulo: 'Concepto', x: 0, ancho: 340 },
  { campo: 'importe', titulo: 'Importe', x: 340, ancho: 155, align: 'right' }
];

function seccion(doc, titulo) {
  if (doc.y > doc.page.height - 170) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(titulo, MARGEN, doc.y);
  doc.moveDown(0.4);
  dibujarLinea(doc);
}

function tablaConceptos(doc, filas) {
  dibujarTabla(doc, COLS_CONCEPTO, filas, (f) => ({ concepto: f[0], importe: f[1] }));
}

function nombreSaldoIva(iva) {
  if (iva.estado === 'A_PAGAR') return 'Saldo de IVA a pagar (IVA en contra)';
  if (iva.estado === 'A_FAVOR') return 'Saldo de IVA a favor';
  return 'Saldo de IVA';
}

function generarPdfInforme(inf, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  const devengado = inf.criterio === 'factura';
  dibujarMembrete(doc, devengado ? 'Informe contable — por fecha de factura' : 'Informe de flujo de plata — por fecha de cobro y pago');
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(`Período: ${fecha(inf.desde)} a ${fecha(inf.hasta)}`, MARGEN, doc.y, { width: ANCHO_UTIL })
    .fillColor('#000');
  doc.moveDown(0.4);
  dibujarLinea(doc);

  if (devengado) {
    const b = inf.balance;
    seccion(doc, 'Balance del período');
    tablaConceptos(doc, [
      ['Ventas netas (sin IVA, menos notas de crédito)', monto(b.ventas_netas)],
      ['Compras de materia prima (neto)', monto(-b.compras_netas)],
      ['Gastos (neto)', monto(-b.gastos_netos)],
      ['Impuestos pagados', monto(-b.impuestos_pagados)],
      ['Percepciones e impuestos provinciales de compras', monto(-b.percepciones_y_provinciales)],
      ['Resultado', monto(b.resultado)]
    ]);

    seccion(doc, 'Ventas vs compras');
    tablaConceptos(doc, [
      [`Ventas: ${inf.ventas.cantidad} factura(s), neto`, monto(inf.ventas.facturado_neto)],
      [`Notas de crédito: ${inf.ventas.notas_credito.cantidad}, neto`, monto(-inf.ventas.notas_credito.neto)],
      ['Ventas netas', monto(inf.ventas.neto)],
      [`Compras: ${inf.compras.cantidad} factura(s), neto`, monto(inf.compras.neto)],
      ['Diferencia (ventas - compras)', monto(inf.ventas.neto - inf.compras.neto)]
    ]);

    seccion(doc, 'IVA');
    const iva = inf.iva;
    const filasIva = [
      ['IVA débito (ventas, neto de notas de crédito)', monto(iva.debito)],
      ['IVA crédito de compras', monto(iva.credito_compras)],
      ['IVA crédito de gastos', monto(iva.credito_gastos)],
      [nombreSaldoIva(iva), monto(Math.abs(iva.saldo))]
    ];
    iva.por_alicuota.forEach(a => filasIva.push([`   Crédito de compras al ${a.alicuota}% (neto ${monto(a.neto)})`, monto(a.iva)]));
    if (Math.abs(iva.credito_compras_sin_detalle) >= 0.005) {
      filasIva.push(['   Crédito de compras sin detalle de alícuota (facturas cargadas sin ítems)', monto(iva.credito_compras_sin_detalle)]);
    }
    if (iva.retenciones_iva_sufridas) {
      filasIva.push(['Retenciones de IVA sufridas (a computar aparte)', monto(iva.retenciones_iva_sufridas)]);
    }
    tablaConceptos(doc, filasIva);

    seccion(doc, 'Impuestos');
    const imp = inf.impuestos;
    const filasImp = [
      ['Impuestos pagados (gastos de categoría impuesto)', monto(imp.pagados)],
      ['Percepciones en facturas de compra', monto(imp.percepciones_compras)],
      ['Impuestos provinciales en facturas de compra', monto(imp.impuestos_provinciales_compras)]
    ];
    imp.retenciones_sufridas.forEach(r => filasImp.push([`Retenciones sufridas — ${r.tipo} (impuesto a favor)`, monto(r.total)]));
    tablaConceptos(doc, filasImp);

    if (inf.gastos.por_categoria.length) {
      seccion(doc, 'Gastos por categoría');
      dibujarTabla(doc, [
        { campo: 'cat', titulo: 'Categoría', x: 0, ancho: 235 },
        { campo: 'neto', titulo: 'Neto', x: 235, ancho: 90, align: 'right' },
        { campo: 'iva', titulo: 'IVA', x: 325, ancho: 80, align: 'right' },
        { campo: 'total', titulo: 'Total', x: 405, ancho: 90, align: 'right' }
      ], inf.gastos.por_categoria, (c) => ({
        cat: c.nombre + (c.es_impuesto ? ' (impuesto)' : ''),
        neto: monto(c.neto), iva: monto(c.iva), total: monto(c.total)
      }));
    }

    seccion(doc, 'Resultado mes a mes');
    dibujarTabla(doc, [
      { campo: 'mes', titulo: 'Mes', x: 0, ancho: 60 },
      { campo: 'ventas', titulo: 'Ventas', x: 60, ancho: 85, align: 'right' },
      { campo: 'compras', titulo: 'Compras', x: 145, ancho: 85, align: 'right' },
      { campo: 'gastos', titulo: 'Gastos', x: 230, ancho: 80, align: 'right' },
      { campo: 'impuestos', titulo: 'Impuestos', x: 310, ancho: 90, align: 'right' },
      { campo: 'resultado', titulo: 'Resultado', x: 400, ancho: 95, align: 'right' }
    ], inf.mensual, (m) => ({
      mes: mesTexto(m.mes), ventas: monto(m.ventas), compras: monto(m.compras),
      gastos: monto(m.gastos), impuestos: monto(m.impuestos), resultado: monto(m.resultado)
    }));
  } else {
    const f = inf.flujo;
    seccion(doc, 'Flujo de plata del período');
    tablaConceptos(doc, [
      [`Cobrado (${f.cobros} cobro(s), sin retenciones)`, monto(f.cobrado)],
      [`Pagado a proveedores (${f.pagos} pago(s), sin retenciones)`, monto(-f.pagado_proveedores)],
      ['Gastos (con IVA)', monto(-f.gastos)],
      ['Saldo', monto(f.saldo)]
    ]);
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text('Un cheque de cliente endosado a un proveedor cuenta como cobrado y como pagado. El IVA no se calcula con este criterio.',
        MARGEN, doc.y, { width: ANCHO_UTIL }).fillColor('#000');

    seccion(doc, 'Impuestos');
    const filas = [['Impuestos pagados (gastos de categoría impuesto)', monto(inf.impuestos.pagados)]];
    inf.impuestos.retenciones_sufridas.forEach(r => filas.push([`Retenciones sufridas — ${r.tipo}`, monto(r.total)]));
    tablaConceptos(doc, filas);

    seccion(doc, 'Mes a mes');
    dibujarTabla(doc, [
      { campo: 'mes', titulo: 'Mes', x: 0, ancho: 60 },
      { campo: 'cobrado', titulo: 'Cobrado', x: 60, ancho: 105, align: 'right' },
      { campo: 'pagado', titulo: 'Pagado a proveedores', x: 165, ancho: 120, align: 'right' },
      { campo: 'gastos', titulo: 'Gastos', x: 285, ancho: 100, align: 'right' },
      { campo: 'saldo', titulo: 'Saldo', x: 385, ancho: 110, align: 'right' }
    ], inf.mensual, (m) => ({
      mes: mesTexto(m.mes), cobrado: monto(m.cobrado), pagado: monto(m.pagado_proveedores),
      gastos: monto(m.gastos), saldo: monto(m.saldo)
    }));
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfInforme };

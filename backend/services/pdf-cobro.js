/* =====================================================================
 * PDF del cobro (recibo a un cliente), generado desde cobros.routes.js.
 * Muestra las formas de cobro (efectivo, cheque, transferencia,
 * retención) y a qué facturas se imputó.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, dibujarBannerAnulado,
  dibujarTabla, piePagina, fecha, money
} = require('./pdf-base');

const COLS_FORMAS = [
  { campo: 'forma', titulo: 'Forma de cobro', x: 0, ancho: 340 },
  { campo: 'monto', titulo: 'Monto', x: 340, ancho: ANCHO_UTIL - 340, align: 'right' }
];

const COLS_FACTURAS = [
  { campo: 'factura', titulo: 'Factura', x: 0, ancho: 340 },
  { campo: 'monto', titulo: 'Monto imputado', x: 340, ancho: ANCHO_UTIL - 340, align: 'right' }
];

function descripcionForma(item) {
  if (item.tipo === 'CHEQUE') {
    return `Cheque ${item.cheque_numero || ''} — ${item.cheque_banco || ''} ` +
      `(vence ${fecha(item.cheque_fecha_cobro)}, ${String(item.estado || '').replace(/_/g, ' ').toLowerCase()})`;
  }
  if (item.tipo === 'TRANSFERENCIA') {
    return `Transferencia${item.transferencia_numero_operacion ? ' — ' + item.transferencia_numero_operacion : ''}`;
  }
  if (item.tipo === 'RETENCION') return `Retención ${item.retencion_tipo || ''}`;
  return 'Efectivo';
}

/**
 * `pago` trae { id, numero_recibo, fecha_recepcion, cliente_nombre, cuit,
 * monto_total, observaciones, anulado, items: [...pago_items],
 * imputaciones: [{ numero_factura, tipo_factura, monto_aplicado }] }.
 */
function generarPdfCobro(pago, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarMembrete(doc, 'Recibo de cobro');

  doc.font('Helvetica-Bold').fontSize(14)
    .text(`Cobro #${pago.id}${pago.numero_recibo ? ' — Recibo ' + pago.numero_recibo : ''}`, MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10).text(`Fecha: ${fecha(pago.fecha_recepcion)}`, MARGEN, doc.y + 2);

  if (pago.anulado) dibujarBannerAnulado(doc, 'COBRO ANULADO', null);

  doc.moveDown(0.5);
  dibujarLinea(doc);

  doc.font('Helvetica-Bold').fontSize(11).text('Cliente', MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10).text(pago.cliente_nombre || '—', MARGEN, doc.y + 2);
  if (pago.cuit) {
    doc.fontSize(9).fillColor('#555').text(`CUIT: ${pago.cuit}`, MARGEN, doc.y + 2).fillColor('#000');
  }

  doc.moveDown(0.8);
  dibujarLinea(doc);

  dibujarTabla(doc, COLS_FORMAS, pago.items || [], (item) => ({
    forma: descripcionForma(item),
    monto: money(item.monto)
  }));

  doc.font('Helvetica-Bold').fontSize(11)
    .text(`Total cobrado: ${money(pago.monto_total)}`, MARGEN + ANCHO_UTIL - 200, doc.y, { width: 200, align: 'right' });
  doc.moveDown(1);

  if (pago.imputaciones && pago.imputaciones.length) {
    doc.font('Helvetica-Bold').fontSize(11).text('Facturas imputadas', MARGEN, doc.y);
    doc.moveDown(0.3);
    dibujarTabla(doc, COLS_FACTURAS, pago.imputaciones, (imp) => ({
      factura: `${imp.tipo_factura || ''} ${imp.numero_factura}`.trim(),
      monto: money(imp.monto_aplicado)
    }));
  }

  if (pago.observaciones) {
    doc.font('Helvetica-Bold').fontSize(10).text('Observaciones', MARGEN, doc.y);
    doc.font('Helvetica').fontSize(9).text(pago.observaciones, MARGEN, doc.y + 2, { width: ANCHO_UTIL });
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfCobro };

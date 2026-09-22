/* =====================================================================
 * PDF de la factura de venta (facturas.routes.js). A diferencia del
 * remito, sí lleva precios: subtotal sin IVA, IVA 21% y total.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, dibujarBannerAnulado,
  dibujarTabla, piePagina, fecha, money
} = require('./pdf-base');

const COLS = [
  { campo: 'modelo', titulo: 'Modelo', x: 0, ancho: 220 },
  { campo: 'cantidad', titulo: 'Cantidad', x: 220, ancho: 70, align: 'right' },
  { campo: 'precio', titulo: 'Precio unit.', x: 290, ancho: 100, align: 'right' },
  { campo: 'subtotal', titulo: 'Subtotal', x: 390, ancho: ANCHO_UTIL - 390, align: 'right' }
];

/**
 * `factura` trae { numero_factura, tipo_factura, fecha, dias_credito,
 * subtotal_sin_iva, iva_21, total, estado, motivo_anulacion, remitos,
 * cliente_nombre, cliente_cuit, cliente_direccion,
 * items: [{ modelo, cantidad, precio_unitario, subtotal }] }.
 */
function generarPdfFactura(factura, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarMembrete(doc, 'Factura de venta');

  doc.font('Helvetica-Bold').fontSize(14)
    .text(`Factura ${factura.tipo_factura || ''} ${factura.numero_factura}`, MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10).text(`Fecha: ${fecha(factura.fecha)}`, MARGEN, doc.y + 2);
  if (factura.dias_credito) doc.text(`Días de crédito: ${factura.dias_credito}`, MARGEN, doc.y + 2);
  if (factura.remitos) doc.text(`Remitos: ${factura.remitos}`, MARGEN, doc.y + 2);

  const anulada = String(factura.estado || '').toUpperCase() === 'ANULADA';
  if (anulada) dibujarBannerAnulado(doc, 'FACTURA ANULADA', factura.motivo_anulacion);

  doc.moveDown(0.5);
  dibujarLinea(doc);

  doc.font('Helvetica-Bold').fontSize(11).text('Cliente', MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10).text(factura.cliente_nombre || '—', MARGEN, doc.y + 2);
  const datosCliente = [];
  if (factura.cliente_cuit) datosCliente.push(`CUIT: ${factura.cliente_cuit}`);
  if (factura.cliente_direccion) datosCliente.push(factura.cliente_direccion);
  if (datosCliente.length) {
    doc.fontSize(9).fillColor('#555').text(datosCliente.join('   ·   '), MARGEN, doc.y + 2).fillColor('#000');
  }

  doc.moveDown(0.8);
  dibujarLinea(doc);

  dibujarTabla(doc, COLS, factura.items || [], (item) => ({
    modelo: item.modelo || '—',
    cantidad: Number(item.cantidad).toLocaleString('es-AR'),
    precio: money(item.precio_unitario),
    subtotal: money(item.subtotal)
  }));

  const xTotales = MARGEN + ANCHO_UTIL - 200;
  doc.font('Helvetica').fontSize(10);
  doc.text(`Subtotal sin IVA: ${money(factura.subtotal_sin_iva)}`, xTotales, doc.y, { width: 200, align: 'right' });
  doc.text(`IVA 21%: ${money(factura.iva_21)}`, xTotales, doc.y + 2, { width: 200, align: 'right' });
  doc.font('Helvetica-Bold').text(`Total: ${money(factura.total)}`, xTotales, doc.y + 4, { width: 200, align: 'right' });

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfFactura };

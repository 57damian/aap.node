/* =====================================================================
 * PDF de la factura de compra (facturas-compra.routes.js). A diferencia
 * de la factura de venta, no es un comprobante fiscal propio: es un
 * registro interno de lo que se cargó en el sistema (proveedor, ítems,
 * IVA, percepciones/retenciones/impuestos provinciales), útil para
 * imprimir o adjuntar sin tener que volver a entrar a la pantalla.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, dibujarBannerAnulado,
  dibujarTabla, piePagina, fecha, money
} = require('./pdf-base');

const COLS = [
  { campo: 'codigo', titulo: 'Código', x: 0, ancho: 50 },
  { campo: 'nombre', titulo: 'Material', x: 55, ancho: 125 },
  { campo: 'cantidad', titulo: 'Cantidad', x: 185, ancho: 50, align: 'right' },
  { campo: 'unidad', titulo: 'Unidad', x: 240, ancho: 35 },
  { campo: 'precio', titulo: 'Precio unit.', x: 280, ancho: 65, align: 'right' },
  { campo: 'iva', titulo: 'IVA %', x: 350, ancho: 30, align: 'right' },
  { campo: 'total', titulo: 'Total', x: 385, ancho: ANCHO_UTIL - 385, align: 'right' }
];

/**
 * `factura` trae { tipo_factura, punto_venta, numero_factura, cae,
 * fecha_emision, fecha_recepcion, condicion_pago, estado, dolar,
 * subtotal, iva, percepciones, retenciones, impuestos_provinciales,
 * total, observaciones, proveedor_nombre, proveedor_cuit,
 * proveedor_direccion, proveedor_telefono,
 * items: [{ codigo, nombre, materia_codigo, materia_nombre, cantidad,
 * unidad_medida, precio_unitario, iva_porcentaje, total }] }.
 */
function generarPdfFacturaCompra(factura, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarMembrete(doc, 'Factura de compra — registro interno');

  const numero = `${factura.punto_venta || ''}-${factura.numero_factura || ''}`.replace(/^-/, '');
  doc.font('Helvetica-Bold').fontSize(14)
    .text(`Factura ${factura.tipo_factura || ''} ${numero}`, MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10).text(`Emisión: ${fecha(factura.fecha_emision)}`, MARGEN, doc.y + 2);
  if (factura.fecha_recepcion) doc.text(`Recepción: ${fecha(factura.fecha_recepcion)}`, MARGEN, doc.y + 2);
  if (factura.cae) doc.text(`CAE: ${factura.cae}`, MARGEN, doc.y + 2);
  doc.text(`Condición de pago: ${factura.condicion_pago || 'CONTADO'}`, MARGEN, doc.y + 2);
  if (factura.dolar) doc.text(`Cotización del dólar: ${money(factura.dolar)}`, MARGEN, doc.y + 2);

  const anulada = String(factura.estado || '').toUpperCase() === 'ANULADA';
  if (anulada) {
    dibujarBannerAnulado(doc, 'FACTURA ANULADA', null);
  } else {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#555')
      .text(`Estado: ${factura.estado || 'PENDIENTE'}`, MARGEN, doc.y + 2).fillColor('#000');
  }

  doc.moveDown(0.5);
  dibujarLinea(doc);

  doc.font('Helvetica-Bold').fontSize(11).text('Proveedor', MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10).text(factura.proveedor_nombre || '—', MARGEN, doc.y + 2);
  const datosProveedor = [];
  if (factura.proveedor_cuit) datosProveedor.push(`CUIT: ${factura.proveedor_cuit}`);
  if (factura.proveedor_telefono) datosProveedor.push(`Tel: ${factura.proveedor_telefono}`);
  if (datosProveedor.length) {
    doc.fontSize(9).fillColor('#555').text(datosProveedor.join('   ·   '), MARGEN, doc.y + 2).fillColor('#000');
  }
  if (factura.proveedor_direccion) {
    doc.fontSize(9).fillColor('#555').text(factura.proveedor_direccion, MARGEN, doc.y + 2).fillColor('#000');
  }

  doc.moveDown(0.8);
  dibujarLinea(doc);

  dibujarTabla(doc, COLS, factura.items || [], (item) => ({
    codigo: item.codigo || item.materia_codigo || '—',
    nombre: item.nombre || item.materia_nombre || item.descripcion || '—',
    cantidad: Number(item.cantidad || 0).toLocaleString('es-AR'),
    unidad: item.unidad_medida || '—',
    precio: money(item.precio_unitario),
    iva: `${Number(item.iva_porcentaje || 0).toLocaleString('es-AR')}%`,
    total: money(item.total)
  }));

  const xTotales = MARGEN + ANCHO_UTIL - 220;
  doc.font('Helvetica').fontSize(10);
  doc.text(`Subtotal: ${money(factura.subtotal)}`, xTotales, doc.y, { width: 220, align: 'right' });
  doc.text(`IVA: ${money(factura.iva)}`, xTotales, doc.y + 2, { width: 220, align: 'right' });
  if (Number(factura.percepciones) > 0) {
    doc.text(`Percepciones: ${money(factura.percepciones)}`, xTotales, doc.y + 2, { width: 220, align: 'right' });
  }
  if (Number(factura.impuestos_provinciales) > 0) {
    doc.text(`Impuestos provinciales: ${money(factura.impuestos_provinciales)}`, xTotales, doc.y + 2, { width: 220, align: 'right' });
  }
  if (Number(factura.retenciones) > 0) {
    doc.text(`Retenciones: -${money(factura.retenciones)}`, xTotales, doc.y + 2, { width: 220, align: 'right' });
  }
  doc.font('Helvetica-Bold').text(`Total: ${money(factura.total)}`, xTotales, doc.y + 4, { width: 220, align: 'right' });

  if (factura.observaciones) {
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).text('Observaciones', MARGEN, doc.y);
    doc.font('Helvetica').fontSize(9).text(factura.observaciones, MARGEN, doc.y + 2, { width: ANCHO_UTIL });
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfFacturaCompra };

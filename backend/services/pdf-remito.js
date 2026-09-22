/* =====================================================================
 * PDF del remito: comprobante de entrega para un cliente, generado desde
 * una venta (ver ventas.routes.js). No lleva precios — el remito prueba
 * qué se entregó, no es un documento fiscal; eso lo hace la factura.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, dibujarBannerAnulado,
  dibujarTabla, piePagina, fecha
} = require('./pdf-base');

const COLS = [
  { campo: 'modelo', titulo: 'Modelo', x: 0, ancho: 350 },
  { campo: 'cantidad', titulo: 'Cantidad', x: 350, ancho: ANCHO_UTIL - 350, align: 'right' }
];

/**
 * `venta` trae { id, remito_numero, remito_fecha, remito_observaciones,
 * fecha, numero_oc, anulada_en, motivo_anulacion, cliente_nombre,
 * cliente_cuit, cliente_direccion, items: [{ modelo, cantidad }] }.
 */
function generarPdfRemito(venta, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarMembrete(doc, 'Remito de entrega');

  doc.font('Helvetica-Bold').fontSize(14)
    .text(`Remito ${venta.remito_numero || `(venta #${venta.id})`}`, MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10)
    .text(`Fecha: ${fecha(venta.remito_fecha || venta.fecha)}`, MARGEN, doc.y + 2);
  if (venta.numero_oc) {
    doc.text(`Orden de compra: ${venta.numero_oc}`, MARGEN, doc.y + 2);
  }

  if (venta.anulada_en) {
    dibujarBannerAnulado(doc, 'REMITO ANULADO', venta.motivo_anulacion);
  }

  doc.moveDown(0.5);
  dibujarLinea(doc);

  doc.font('Helvetica-Bold').fontSize(11).text('Cliente', MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10).text(venta.cliente_nombre || '—', MARGEN, doc.y + 2);
  const datosCliente = [];
  if (venta.cliente_cuit) datosCliente.push(`CUIT: ${venta.cliente_cuit}`);
  if (venta.cliente_direccion) datosCliente.push(venta.cliente_direccion);
  if (datosCliente.length) {
    doc.fontSize(9).fillColor('#555').text(datosCliente.join('   ·   '), MARGEN, doc.y + 2).fillColor('#000');
  }

  doc.moveDown(0.8);
  dibujarLinea(doc);

  if (venta.items && venta.items.length) {
    dibujarTabla(doc, COLS, venta.items, (item) => ({
      modelo: item.modelo || '—',
      cantidad: Number(item.cantidad).toLocaleString('es-AR')
    }));
  } else {
    doc.font('Helvetica').fontSize(9).fillColor('#555').text('Este remito no tiene items.', MARGEN, doc.y).fillColor('#000');
    doc.moveDown(0.5);
  }

  if (venta.remito_observaciones) {
    doc.font('Helvetica-Bold').fontSize(10).text('Observaciones', MARGEN, doc.y);
    doc.font('Helvetica').fontSize(9).text(venta.remito_observaciones, MARGEN, doc.y + 2, { width: ANCHO_UTIL });
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfRemito };

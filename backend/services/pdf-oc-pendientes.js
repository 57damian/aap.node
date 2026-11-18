/* =====================================================================
 * PDF de pendientes de entrega por cliente: una sección por cliente con
 * cada modelo sumado y, debajo, las OC de donde sale (ver
 * services/oc-pendientes.js). Documento vertical, membretado.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, piePagina, fecha
} = require('./pdf-base');

// Columnas: modelo (o "OC n° …" en las filas de desglose), pedido, entregado, pendiente.
const X_PEDIDO = 300;
const ANCHO_NUM = 70;
const X_ENTREGADO = X_PEDIDO + ANCHO_NUM;
const X_PENDIENTE = X_ENTREGADO + ANCHO_NUM;

const num = (v) => Number(v || 0).toLocaleString('es-AR');

function saltoSiNoEntra(doc, alto) {
  if (doc.y + alto > doc.page.height - MARGEN - 40) {
    doc.addPage();
    return true;
  }
  return false;
}

function cabeceraColumnas(doc) {
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
  doc.text('Modelo / orden de compra', MARGEN, y, { width: X_PEDIDO - 10 });
  doc.text('Pedido', MARGEN + X_PEDIDO, y, { width: ANCHO_NUM, align: 'right' });
  doc.text('Entregado', MARGEN + X_ENTREGADO, y, { width: ANCHO_NUM, align: 'right' });
  doc.text('Pendiente', MARGEN + X_PENDIENTE, y, { width: ANCHO_UTIL - X_PENDIENTE, align: 'right' });
  doc.fillColor('#000');
  doc.y = y + 13;
  dibujarLinea(doc);
}

function fila(doc, { texto, pedido, entregado, pendiente, negrita, sangria, gris }) {
  const y = doc.y;
  doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(negrita ? 10 : 9)
    .fillColor(gris ? '#555' : '#000');
  doc.text(texto, MARGEN + (sangria || 0), y, { width: X_PEDIDO - 10 - (sangria || 0) });
  const alto = doc.y - y;
  doc.text(pedido === '' ? '' : num(pedido), MARGEN + X_PEDIDO, y, { width: ANCHO_NUM, align: 'right' });
  doc.text(entregado === '' ? '' : num(entregado), MARGEN + X_ENTREGADO, y, { width: ANCHO_NUM, align: 'right' });
  doc.text(num(pendiente),MARGEN + X_PENDIENTE, y, { width: ANCHO_UTIL - X_PENDIENTE, align: 'right' });
  doc.fillColor('#000');
  doc.y = y + Math.max(alto, 12) + 3;
}

/**
 * @param {Array} clientes - resultado de pendientesPorCliente().
 * @param {object} res - Response de Express con los headers ya seteados.
 */
function generarPdfPendientes(clientes, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarMembrete(doc, 'Pendientes de entrega por cliente');
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(`Situación al ${fecha(new Date().toISOString().slice(0, 10))}. ` +
          'Órdenes de compra vigentes (no cerradas ni anuladas).', MARGEN, doc.y, { width: ANCHO_UTIL })
    .fillColor('#000');
  doc.moveDown(0.6);

  if (!clientes.length) {
    doc.font('Helvetica').fontSize(10).text('No hay entregas pendientes.', MARGEN, doc.y);
  }

  clientes.forEach((cli, i) => {
    // El título del cliente nunca queda solo al final de una hoja.
    saltoSiNoEntra(doc, 90);
    if (i > 0) doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(12).text(cli.cliente, MARGEN, doc.y);
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(`${num(cli.total_pendiente)} unidades pendientes en ${cli.modelos.length} modelo${cli.modelos.length === 1 ? '' : 's'}`,
        MARGEN, doc.y + 1)
      .fillColor('#000');
    doc.moveDown(0.4);
    cabeceraColumnas(doc);

    cli.modelos.forEach((m) => {
      // El modelo y su desglose se mantienen juntos mientras entren en la hoja.
      if (saltoSiNoEntra(doc, 16 + 14 * Math.min(m.ordenes.length, 3))) cabeceraColumnas(doc);
      fila(doc, { texto: m.modelo, pedido: m.pedido, entregado: m.entregado, pendiente: m.pendiente, negrita: true });

      m.ordenes.forEach((o) => {
        if (saltoSiNoEntra(doc, 14)) cabeceraColumnas(doc);
        fila(doc, {
          texto: `OC ${o.numero_oc} · ${fecha(o.fecha_oc)}`,
          pedido: o.pedido, entregado: o.entregado, pendiente: o.pendiente,
          sangria: 14, gris: true
        });
      });
      doc.moveDown(0.2);
    });

    dibujarLinea(doc);
    fila(doc, { texto: 'Total pendiente', pedido: '', entregado: '', pendiente: cli.total_pendiente, negrita: true });
  });

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfPendientes };

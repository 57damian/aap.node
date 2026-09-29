/* =====================================================================
 * Generador genérico de PDF para los informes con filtros de fecha
 * (Stock, Producción, Ventas, Precios…), documentados en
 * docs/claude/modulo-reportes.md. A diferencia de los otros pdf-*.js
 * (que arman un documento con layout propio: remito, factura, cobro),
 * un informe es siempre lo mismo — título, filtros aplicados, tabla
 * paginada con las mismas columnas que se ven en pantalla — así que
 * usa un único generador reusado por todos los endpoints .../reporte/pdf
 * en vez de un archivo por módulo.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, dibujarLinea, dibujarMembrete, dibujarTabla, piePagina
} = require('./pdf-base');

// Los informes suelen tener más columnas que un documento (remito/factura),
// así que se generan apaisados para tener más ancho útil. dibujarLinea()
// de pdf-base.js usa el ANCHO_UTIL de A4 vertical para las líneas
// divisorias — queda una línea más corta que el ancho de la tabla, pero es
// un detalle cosmético menor frente a duplicar esa función; las columnas
// (dibujarTabla) sí usan el ancho apaisado real.
const ANCHO_UTIL_REPORTE = 841.89 - MARGEN * 2;

/**
 * @param {object} opts
 * @param {string} opts.titulo - Título del informe (ej. "Movimientos de stock").
 * @param {string} [opts.filtrosTexto] - Descripción legible de los filtros aplicados
 *   (ej. "Período: 01/09/2026 a 30/09/2026 · Proveedor: Acme"). Si no hay
 *   filtros, omitir.
 * @param {Array} opts.cols - Mismo formato que dibujarTabla: [{campo, titulo, x, ancho, align}].
 * @param {Array} opts.filas - Filas crudas.
 * @param {Function} opts.armarCelda - (fila) => { [campo]: texto ya formateado }.
 * @param {object} res - Response de Express, ya con los headers seteados por la ruta.
 */
function generarPdfReporte({ titulo, filtrosTexto, cols, filas, armarCelda }, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, layout: 'landscape' });
  doc.pipe(res);

  dibujarMembrete(doc, titulo);

  if (filtrosTexto) {
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(filtrosTexto, MARGEN, doc.y, { width: ANCHO_UTIL_REPORTE }).fillColor('#000');
    doc.moveDown(0.4);
  }
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(`${filas.length} registro${filas.length === 1 ? '' : 's'}`, MARGEN, doc.y).fillColor('#000');
  doc.moveDown(0.5);
  dibujarLinea(doc);

  if (filas.length) {
    dibujarTabla(doc, cols, filas, armarCelda);
  } else {
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text('No hay datos para este filtro.', MARGEN, doc.y).fillColor('#000');
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfReporte, ANCHO_UTIL_REPORTE };

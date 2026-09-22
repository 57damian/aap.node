/* =====================================================================
 * PDF de la ficha técnica de un transformador (ficha.routes.js). Antes se
 * generaba en el navegador con jsPDF y solo traía 3 campos (modelo,
 * voltajes); este reemplaza esa versión con un documento completo y
 * membretado, igual que el resto de los PDF del sistema (22/09/2026).
 * ===================================================================== */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, piePagina } = require('./pdf-base');

const NOMBRE_DEVANADO = ['Terciario', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo'];
const ALTO_DEVANADO_ESTIMADO = 100; // título + 5 campos, para decidir salto de página

function campo(doc, etiqueta, valor, unidad) {
  const texto = valor === null || valor === undefined || valor === '' ? '—' : `${valor}${unidad || ''}`;
  doc.font('Helvetica-Bold').fontSize(9).text(`${etiqueta}: `, MARGEN, doc.y, { continued: true });
  doc.font('Helvetica').text(texto);
}

function tituloSeccion(doc, texto) {
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).text(texto, MARGEN, doc.y);
  doc.moveDown(0.2);
  dibujarLinea(doc);
}

function dibujarDevanado(doc, titulo, d) {
  if (doc.y + ALTO_DEVANADO_ESTIMADO > doc.page.height - MARGEN - 40) doc.addPage();
  tituloSeccion(doc, titulo);
  campo(doc, 'Alambre', d.alambre);
  campo(doc, 'Diámetro', d.diametro_mm, ' mm');
  campo(doc, 'Espiras', d.espiras);
  campo(doc, 'Pines', d.pines);
  campo(doc, 'Peso', d.peso_kg, ' gr');
}

/**
 * `ficha` trae las columnas de ficha_transformador + cliente_nombre +
 * devanados_extra: [{ orden, alambre, diametro_mm, espiras, pines, peso_kg }].
 * `ficha.foto_modelo` es la ruta relativa a backend/public (ej.
 * "uploads/modelos/xxx.png"); si no existe el archivo, el PDF sale igual.
 */
function generarPdfFicha(ficha, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarMembrete(doc, 'Ficha técnica de transformador');

  doc.font('Helvetica-Bold').fontSize(14).text(`Modelo ${ficha.modelo}`, MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10)
    .text(`Cliente: ${ficha.cliente_nombre || 'Modelo genérico'}`, MARGEN, doc.y + 2);

  doc.moveDown(0.5);
  dibujarLinea(doc);

  // La foto (si existe) va arriba a la derecha; el texto de al lado se
  // angosta para no meterse debajo de la imagen.
  const yInicio = doc.y;
  const fotoPath = ficha.foto_modelo ? path.join(__dirname, '..', 'public', ficha.foto_modelo) : null;
  const hayFoto = !!(fotoPath && fs.existsSync(fotoPath));
  if (hayFoto) {
    try {
      doc.image(fotoPath, MARGEN + ANCHO_UTIL - 140, doc.y, { fit: [140, 140] });
    } catch (e) {
      console.warn('No se pudo insertar la foto de la ficha en el PDF:', e.message);
    }
  }

  tituloSeccion(doc, 'Eléctricas');
  campo(doc, 'Voltaje entrada', ficha.voltaje_entrada, ' V');
  campo(doc, 'Voltaje salida', ficha.voltaje_salida, ' V');
  campo(doc, 'Amperaje entrada', ficha.amperaje_entrada, ' A');
  campo(doc, 'Amperaje salida', ficha.amperaje_salida, ' A');

  tituloSeccion(doc, 'Físicas');
  campo(doc, 'Tipo de carretel', ficha.tipo_carretel);
  campo(doc, 'Laminación', ficha.laminacion);
  campo(doc, 'Peso laminación', ficha.peso_laminacion_kg, ' gr');

  if (hayFoto) doc.y = Math.max(doc.y, yInicio + 150);

  dibujarDevanado(doc, 'Devanado primario', {
    alambre: ficha.alambre_primario,
    diametro_mm: ficha.diametro_primario_mm,
    espiras: ficha.espiras_primario,
    pines: ficha.pines_primario,
    peso_kg: ficha.peso_primario_kg
  });
  dibujarDevanado(doc, 'Devanado secundario', {
    alambre: ficha.alambre_secundario,
    diametro_mm: ficha.diametro_secundario_mm,
    espiras: ficha.espiras_secundario,
    pines: ficha.pines_secundario,
    peso_kg: ficha.peso_secundario_kg
  });

  (ficha.devanados_extra || []).forEach((d, i) => {
    dibujarDevanado(doc, `Devanado ${NOMBRE_DEVANADO[i] || `${i + 3}°`}`, d);
  });

  if (ficha.observaciones) {
    tituloSeccion(doc, 'Observaciones');
    doc.font('Helvetica').fontSize(9).text(ficha.observaciones, MARGEN, doc.y, { width: ANCHO_UTIL });
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfFicha };

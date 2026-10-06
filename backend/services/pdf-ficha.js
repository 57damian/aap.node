/* =====================================================================
 * PDF de la ficha técnica de un transformador (ficha.routes.js). Antes se
 * generaba en el navegador con jsPDF y solo traía 3 campos (modelo,
 * voltajes); este reemplaza esa versión con un documento completo y
 * membretado, igual que el resto de los PDF del sistema (22/09/2026).
 * ===================================================================== */

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

const COLOR_PIN = { PRIMARIO: '#dc2626', SECUNDARIO: '#2563eb', OTRO: '#6b7280' };
const NOMBRE_FUNCION = { PRIMARIO: 'Primario', SECUNDARIO: 'Secundario', OTRO: 'Otro' };
const ANCHO_CELDA_BORNERA = 28;
const ALTO_BORNERA = 34;

/**
 * Dibuja el diagrama de salidas (pines, cables, borneras, textos) con
 * primitivas vectoriales de pdfkit, escalado al ancho de la página. Las
 * coordenadas son las del editor (ficha_diagramas.datos). Si no entra en lo
 * que queda de la hoja, pasa a una página nueva.
 */
function dibujarDiagrama(doc, diag, fondoBuffer) {
  const escala = Math.min(1, ANCHO_UTIL / diag.ancho);
  const alto = diag.alto * escala;
  const necesario = alto + 60;
  if (doc.y + necesario > doc.page.height - MARGEN - 40) doc.addPage();

  tituloSeccion(doc, 'Diagrama de salidas');
  const x0 = MARGEN;
  const y0 = doc.y + 4;

  // Leyenda de pines (qué color es primario / secundario)
  const usadas = [...new Set(diag.elementos.filter(e => e.tipo === 'pin').map(e => e.funcion))];
  if (usadas.length) {
    let lx = x0;
    doc.font('Helvetica').fontSize(8);
    usadas.forEach(f => {
      doc.circle(lx + 4, y0 + 4, 4).fill(COLOR_PIN[f]);
      doc.fillColor('#000').text(NOMBRE_FUNCION[f], lx + 12, y0 + 1, { lineBreak: false });
      lx += 80;
    });
  }
  const yDibujo = y0 + (usadas.length ? 14 : 0);

  doc.save();
  doc.translate(x0, yDibujo).scale(escala);
  doc.rect(0, 0, diag.ancho, diag.alto).lineWidth(1 / escala).strokeColor('#cbd5e1').stroke();
  doc.rect(0, 0, diag.ancho, diag.alto).clip();

  if (fondoBuffer) {
    try {
      doc.image(fondoBuffer, 0, 0, { fit: [diag.ancho, diag.alto], align: 'center', valign: 'center' });
    } catch (e) {
      // pdfkit no lee WEBP: el diagrama sale igual, sin el fondo.
      console.warn('No se pudo insertar el fondo del diagrama en el PDF:', e.message);
    }
  }

  diag.elementos.forEach(e => {
    if (e.tipo === 'cable') {
      // Borde oscuro debajo, para que se vea también un cable blanco o amarillo.
      doc.lineJoin('round').lineCap('round');
      doc.lineWidth(7).strokeColor('#1e293b');
      e.puntos.forEach(([px, py], i) => (i ? doc.lineTo(px, py) : doc.moveTo(px, py)));
      doc.stroke();
      doc.lineWidth(4).strokeColor(e.color);
      e.puntos.forEach(([px, py], i) => (i ? doc.lineTo(px, py) : doc.moveTo(px, py)));
      doc.stroke();
      if (e.etiqueta) {
        const medio = e.puntos[Math.floor(e.puntos.length / 2)];
        doc.font('Helvetica').fontSize(11).fillColor('#0f172a')
          .text(e.etiqueta, medio[0] + 6, medio[1] - 16, { lineBreak: false });
      }
    } else if (e.tipo === 'bornera') {
      const ancho = ANCHO_CELDA_BORNERA * e.posiciones;
      doc.rect(e.x, e.y, ancho, ALTO_BORNERA).lineWidth(1.5).fillAndStroke('#e2e8f0', '#334155');
      for (let i = 0; i < e.posiciones; i++) {
        const cx = e.x + i * ANCHO_CELDA_BORNERA;
        if (i) doc.moveTo(cx, e.y).lineTo(cx, e.y + ALTO_BORNERA).lineWidth(1).strokeColor('#334155').stroke();
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a')
          .text(String(i + 1), cx, e.y + 11, { width: ANCHO_CELDA_BORNERA, align: 'center', lineBreak: false });
      }
      if (e.etiqueta) {
        doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text(e.etiqueta, e.x, e.y - 16, { lineBreak: false });
      }
    } else if (e.tipo === 'pin') {
      doc.circle(e.x, e.y, 12).lineWidth(1.5).fillAndStroke(COLOR_PIN[e.funcion] || COLOR_PIN.OTRO, '#ffffff');
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
        .text(e.numero, e.x - 12, e.y - 6, { width: 24, align: 'center', lineBreak: false });
      if (e.etiqueta) {
        doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(e.etiqueta, e.x - 40, e.y + 16, { width: 80, align: 'center', lineBreak: false });
      }
    } else if (e.tipo === 'texto') {
      doc.font('Helvetica').fontSize(e.tam || 14).fillColor('#0f172a').text(e.texto, e.x, e.y, { lineBreak: false });
    }
  });
  doc.restore();

  doc.fillColor('#000');
  doc.y = yDibujo + alto + 8;
}

/**
 * `ficha` trae las columnas de ficha_transformador + cliente_nombre +
 * devanados_extra: [{ orden, alambre, diametro_mm, espiras, pines, peso_kg }].
 * `ficha.foto_buffer` es el contenido de la foto (viene de ficha_archivos);
 * si no hay foto, el PDF sale igual.
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
  let hayFoto = !!ficha.foto_buffer;
  if (hayFoto) {
    try {
      doc.image(ficha.foto_buffer, MARGEN + ANCHO_UTIL - 140, doc.y, { fit: [140, 140] });
    } catch (e) {
      // pdfkit no lee WEBP: el PDF sale igual, sin la foto.
      console.warn('No se pudo insertar la foto de la ficha en el PDF:', e.message);
      hayFoto = false;
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

  if (ficha.diagrama && ficha.diagrama.elementos && ficha.diagrama.elementos.length) {
    dibujarDiagrama(doc, ficha.diagrama, ficha.diagrama_fondo);
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfFicha };

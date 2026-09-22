/* =====================================================================
 * Helpers compartidos por los generadores de PDF (membrete, medidas,
 * tabla genérica). Extraído de pdf-pedido-proveedor.js cuando se sumaron
 * los PDF de remito, factura, cobro y ficha técnica (22/09/2026): los
 * cuatro necesitan el mismo membrete y el mismo dibujo de tabla paginada.
 * ===================================================================== */

const fs = require('fs');
const empresa = require('../config/empresa');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2; // A4 en puntos

function dibujarLinea(doc) {
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.6);
}

/** Logo + nombre de la empresa arriba de cada documento. `subtitulo` dice
 * qué tipo de documento es (ej. "Remito de entrega"). */
function dibujarMembrete(doc, subtitulo) {
  const yInicio = doc.y;
  let yDespuesMembrete;

  if (empresa.logoPath && fs.existsSync(empresa.logoPath)) {
    try {
      doc.image(empresa.logoPath, MARGEN, yInicio, { fit: [200, 65] });
      yDespuesMembrete = yInicio + 65;
    } catch (e) {
      console.warn('No se pudo insertar el logo en el PDF:', e.message);
      doc.font('Helvetica-Bold').fontSize(16).text(empresa.nombre, MARGEN, yInicio);
      yDespuesMembrete = doc.y;
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(16).text(empresa.nombre, MARGEN, yInicio);
    yDespuesMembrete = doc.y;
  }

  doc.y = yDespuesMembrete + 4;
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(subtitulo, MARGEN, doc.y);
  doc.fillColor('#000');

  doc.y = Math.max(doc.y + 15, yInicio + 75);
}

/** Banner para un documento anulado que igual se puede volver a descargar
 * como registro (mismo criterio que pedido a proveedor). */
function dibujarBannerAnulado(doc, etiqueta, motivo) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#c0392b').text(etiqueta, MARGEN, doc.y + 4);
  if (motivo) {
    doc.font('Helvetica').fontSize(9).fillColor('#c0392b')
      .text(`Motivo: ${motivo}`, MARGEN, doc.y + 2, { width: ANCHO_UTIL });
  }
  doc.fillColor('#000');
  doc.moveDown(0.4);
}

function piePagina(doc) {
  doc.font('Helvetica').fontSize(8).fillColor('#999')
    .text(`Generado el ${new Date().toLocaleString('es-AR')} — ${empresa.nombre}`, MARGEN, doc.page.height - MARGEN - 10);
  doc.fillColor('#000');
}

function fecha(v) {
  if (!v) return '—';
  const d = new Date(String(v).length <= 10 ? v + 'T00:00:00' : v);
  return isNaN(d) ? '—' : d.toLocaleDateString('es-AR');
}

function money(v) {
  return '$' + Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Nombre de archivo seguro para Content-Disposition: solo lo que un
 * filesystem/navegador acepta sin lío, ningún carácter de ruptura. */
function nombreArchivo(valor, alternativa) {
  const t = String(valor || alternativa || 'documento').trim();
  return t.replace(/[^a-zA-Z0-9\-_. ]/g, '_') || 'documento';
}

/**
 * Tabla paginada: dibuja el encabezado y cada fila, saltando de página
 * cuando no entra. `cols`: [{ campo, titulo, x, ancho, align }].
 * `filas` es la lista de datos crudos; `armarCelda(fila)` devuelve
 * { [campo]: texto } ya formateado para mostrar.
 */
function dibujarTabla(doc, cols, filas, armarCelda) {
  function cabecera() {
    doc.font('Helvetica-Bold').fontSize(9);
    const y = doc.y;
    cols.forEach((c) => doc.text(c.titulo, MARGEN + c.x, y, { width: c.ancho, align: c.align || 'left' }));
    doc.moveDown(0.4);
    dibujarLinea(doc);
    doc.font('Helvetica').fontSize(9);
  }

  cabecera();

  filas.forEach((fila, i) => {
    const celdas = armarCelda(fila);
    doc.font('Helvetica').fontSize(9);
    const alturas = cols.map((c) => doc.heightOfString(String(celdas[c.campo] ?? ''), { width: c.ancho }));
    const alto = Math.max(...alturas, 12) + 8;

    if (doc.y + alto > doc.page.height - MARGEN - 60) {
      doc.addPage();
      cabecera();
    }

    const y = doc.y;
    cols.forEach((c) => {
      doc.text(String(celdas[c.campo] ?? ''), MARGEN + c.x, y, { width: c.ancho, align: c.align || 'left' });
    });
    doc.y += alto;
    if (i < filas.length - 1) {
      doc.moveTo(MARGEN, doc.y - 4).lineTo(MARGEN + ANCHO_UTIL, doc.y - 4).strokeColor('#eee').stroke();
    }
  });

  doc.moveDown(0.5);
  dibujarLinea(doc);
}

module.exports = {
  MARGEN, ANCHO_UTIL,
  dibujarLinea, dibujarMembrete, dibujarBannerAnulado, dibujarTabla,
  piePagina, fecha, money, nombreArchivo
};

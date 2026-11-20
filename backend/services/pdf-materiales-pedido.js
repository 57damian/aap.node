/* =====================================================================
 * PDF de "Materiales para un pedido" (20/11/2026): los modelos y cantidades
 * del pedido, los materiales que hacen falta contra el stock, lo que la ficha
 * anota sin vincular al catálogo, las etiquetas a imprimir y los datos que
 * faltan cargar. El resultado viene de calcularNecesidadPedido()
 * (services/receta.js). Documento vertical, membretado, sin precios.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, ANCHO_UTIL, dibujarLinea, dibujarMembrete, dibujarTabla, piePagina, fecha
} = require('./pdf-base');

const num = (v) => Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 4 });

/** Cantidad con su unidad; los gramos pasan a kg cuando son mil o más. */
function cant(n, unidad) {
  if (String(unidad || '').toUpperCase() === 'GR' && Math.abs(n) >= 1000) return `${num(n / 1000)} kg`;
  return `${num(n)} ${unidad || ''}`.trim();
}

function titulo(doc, texto) {
  // El título nunca queda solo al pie de una hoja: se reserva lugar para la nota, el encabezado y un par de filas.
  if (doc.y + 120 > doc.page.height - MARGEN - 60) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(texto, MARGEN, doc.y);
  doc.moveDown(0.3);
}

function nota(doc, texto) {
  doc.font('Helvetica').fontSize(8).fillColor('#555').text(texto, MARGEN, doc.y, { width: ANCHO_UTIL }).fillColor('#000');
  doc.moveDown(0.4);
}

/**
 * @param {object} r - resultado de calcularNecesidadPedido().
 * @param {object} res - Response de Express con los headers ya seteados.
 */
function generarPdfMaterialesPedido(r, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarMembrete(doc, 'Materiales para un pedido');
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(`Calculado el ${fecha(new Date().toISOString().slice(0, 10))} con las recetas de cada modelo y el stock de ese momento. ` +
          'Es un cálculo de referencia: no descuenta stock.', MARGEN, doc.y, { width: ANCHO_UTIL })
    .fillColor('#000');

  // 1. Qué se fabrica
  titulo(doc, `Pedido: ${num(r.unidades_total)} transformador${r.unidades_total === 1 ? '' : 'es'} en ${r.modelos.length} modelo${r.modelos.length === 1 ? '' : 's'}`);
  dibujarTabla(doc, [
    { campo: 'modelo', titulo: 'Modelo', x: 0, ancho: 330 },
    { campo: 'cantidad', titulo: 'Cantidad', x: 330, ancho: 80, align: 'right' },
    { campo: 'etiqueta', titulo: 'Etiqueta', x: 420, ancho: ANCHO_UTIL - 420, align: 'right' }
  ], r.modelos, (m) => ({
    modelo: m.modelo,
    cantidad: num(m.cantidad),
    etiqueta: m.lleva_etiqueta ? 'Sí' : '—'
  }));

  // 2. Materiales
  titulo(doc, 'Materiales a comprar');
  if (!r.materiales.length) {
    doc.font('Helvetica').fontSize(10).text('Ningún modelo tiene materiales vinculados todavía.', MARGEN, doc.y);
    doc.moveDown(0.5);
  } else {
    nota(doc, r.faltantes
      ? `Falta stock de ${r.faltantes} de ${r.materiales.length} material${r.materiales.length === 1 ? '' : 'es'}. Lo que se cuenta por unidad o rollo se compra en números enteros.`
      : 'El stock alcanza para todos los materiales.');
    dibujarTabla(doc, [
      { campo: 'material', titulo: 'Material', x: 0, ancho: 185 },
      { campo: 'necesario', titulo: 'Necesario', x: 185, ancho: 100, align: 'right' },
      { campo: 'stock', titulo: 'En stock', x: 290, ancho: 100, align: 'right' },
      { campo: 'comprar', titulo: 'A comprar', x: 395, ancho: ANCHO_UTIL - 395, align: 'right' }
    ], r.materiales, (m) => ({
      material: m.categoria ? `${m.nombre}\n${m.categoria}` : m.nombre,
      necesario: cant(m.necesaria, m.unidad),
      stock: cant(m.stock_actual, m.unidad),
      comprar: m.faltante > 0 ? cant(m.a_comprar, m.unidad) : 'Alcanza'
    }));
  }

  // 3. Anotado en la ficha sin material del catálogo
  if (r.sin_vincular.length) {
    titulo(doc, 'Anotado en la ficha, sin material del catálogo');
    nota(doc, 'Salen de los datos de la ficha pero no están vinculados a una materia prima: no se comparan con el stock.');
    dibujarTabla(doc, [
      { campo: 'concepto', titulo: 'Concepto', x: 0, ancho: 230 },
      { campo: 'cantidad', titulo: 'Necesario', x: 230, ancho: 100, align: 'right' },
      { campo: 'modelos', titulo: 'Modelos', x: 345, ancho: ANCHO_UTIL - 345 }
    ], r.sin_vincular, (s) => ({
      concepto: s.concepto, cantidad: cant(s.cantidad, s.unidad), modelos: s.modelos.join(', ')
    }));
  }

  // 4. Etiquetas
  if (r.etiquetas.length) {
    titulo(doc, 'Etiquetas a imprimir');
    dibujarTabla(doc, [
      { campo: 'modelo', titulo: 'Modelo', x: 0, ancho: 200 },
      { campo: 'cantidad', titulo: 'Cantidad', x: 200, ancho: 70, align: 'right' },
      { campo: 'archivos', titulo: 'Etiquetas cargadas', x: 285, ancho: ANCHO_UTIL - 285 }
    ], r.etiquetas, (e) => ({
      modelo: e.modelo, cantidad: num(e.cantidad), archivos: e.archivos.map(a => a.nombre).join(', ')
    }));
  }

  // 5. Datos que faltan
  const avisos = [];
  r.modelos.forEach((m) => {
    m.errores.forEach(t => avisos.push({ modelo: m.modelo, texto: t }));
    m.faltan_datos.forEach(t => avisos.push({ modelo: m.modelo, texto: t }));
  });
  if (avisos.length) {
    titulo(doc, 'Datos que faltan cargar');
    nota(doc, 'El cálculo está incompleto para estos modelos hasta que se carguen.');
    dibujarTabla(doc, [
      { campo: 'modelo', titulo: 'Modelo', x: 0, ancho: 110 },
      { campo: 'texto', titulo: 'Qué falta', x: 120, ancho: ANCHO_UTIL - 120 }
    ], avisos, (a) => ({ modelo: a.modelo, texto: a.texto }));
  }

  piePagina(doc);
  doc.end();
}

module.exports = { generarPdfMaterialesPedido };

/* =====================================================================
 * PDF del "Pedido a proveedor" — documento para mandarle al proveedor por
 * correo con lo que se necesita: modelo, código, cantidad y unidad.
 *
 * Las cantidades marcadas `aproximado` (ver migracion-pedidos-proveedor.sql)
 * salen con "(aprox.)" al lado y una nota al pie explica por qué: por
 * ejemplo, se pide 500gr de alambre de cobre pero el rollo real puede
 * pesar 540gr — la cantidad es de referencia, no tiene que coincidir
 * exacto con lo que termine llegando.
 * ===================================================================== */

const fs = require('fs');
const PDFDocument = require('pdfkit');
const empresa = require('../config/empresa');

const MARGEN = 50;
const ANCHO_UTIL = 595.28 - MARGEN * 2; // A4 en puntos

// Columnas de la tabla de ítems (x relativo al margen izquierdo, ancho)
const COLS = [
  { campo: 'codigo', titulo: 'Código', x: 0, ancho: 55 },
  { campo: 'material', titulo: 'Material', x: 55, ancho: 170 },
  { campo: 'cantidad', titulo: 'Cantidad', x: 230, ancho: 75, align: 'right' },
  { campo: 'unidad', titulo: 'Unidad', x: 315, ancho: 50 },
  { campo: 'observaciones', titulo: 'Observaciones', x: 375, ancho: ANCHO_UTIL - 375 }
];

function fecha(v) {
  if (!v) return '—';
  const d = new Date(v.length <= 10 ? v + 'T00:00:00' : v);
  return isNaN(d) ? '—' : d.toLocaleDateString('es-AR');
}

function dibujarEncabezado(doc, pedido) {
  const yInicio = doc.y;
  // El logo ya trae el nombre de la empresa como isologo (no hace falta
  // repetirlo en texto al lado); si no está el archivo, se cae a un
  // nombre en texto para que el PDF no salga sin membrete.
  let yDespuesMembrete;

  if (empresa.logoPath && fs.existsSync(empresa.logoPath)) {
    try {
      doc.image(empresa.logoPath, MARGEN, yInicio, { fit: [200, 65] });
      yDespuesMembrete = yInicio + 65;
    } catch (e) {
      // Logo con formato no soportado o corrupto: seguimos solo con el nombre.
      console.warn('No se pudo insertar el logo en el PDF:', e.message);
      doc.font('Helvetica-Bold').fontSize(16).text(empresa.nombre, MARGEN, yInicio);
      yDespuesMembrete = doc.y;
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(16).text(empresa.nombre, MARGEN, yInicio);
    yDespuesMembrete = doc.y;
  }

  doc.y = yDespuesMembrete + 4;
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text('Pedido de materia prima a proveedor', MARGEN, doc.y);
  doc.fillColor('#000');

  doc.y = Math.max(doc.y + 15, yInicio + 75);

  doc.font('Helvetica-Bold').fontSize(14).text(`Pedido ${pedido.numero}`, MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10)
    .text(`Fecha: ${fecha(pedido.fecha)}`, MARGEN, doc.y + 2);

  if (pedido.estado === 'ANULADO') {
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#c0392b')
      .text('ANULADO', MARGEN, doc.y + 4);
    if (pedido.motivo_anulacion) {
      doc.font('Helvetica').fontSize(9).fillColor('#c0392b')
        .text(`Motivo: ${pedido.motivo_anulacion}`, MARGEN, doc.y + 2, { width: ANCHO_UTIL });
    }
    doc.fillColor('#000');
  }

  doc.moveDown(0.5);
  dibujarLinea(doc);
}

function dibujarLinea(doc) {
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.6);
}

function dibujarProveedor(doc, proveedor) {
  doc.font('Helvetica-Bold').fontSize(11).text('Proveedor', MARGEN, doc.y);
  doc.font('Helvetica').fontSize(10);
  doc.text(proveedor.nombre || '—', MARGEN, doc.y + 2);
  const datos = [];
  if (proveedor.contacto) datos.push(`Contacto: ${proveedor.contacto}`);
  if (proveedor.telefono) datos.push(`Tel: ${proveedor.telefono}`);
  if (proveedor.email) datos.push(`Email: ${proveedor.email}`);
  if (datos.length) doc.fontSize(9).fillColor('#555').text(datos.join('   ·   '), MARGEN, doc.y + 2).fillColor('#000');
  if (proveedor.direccion) doc.fontSize(9).fillColor('#555').text(proveedor.direccion, MARGEN, doc.y + 2).fillColor('#000');

  doc.moveDown(0.8);
  dibujarLinea(doc);
}

function dibujarCabeceraTabla(doc) {
  doc.font('Helvetica-Bold').fontSize(9);
  const y = doc.y;
  COLS.forEach((c) => {
    doc.text(c.titulo, MARGEN + c.x, y, { width: c.ancho, align: c.align || 'left' });
  });
  doc.moveDown(0.4);
  dibujarLinea(doc);
  doc.font('Helvetica').fontSize(9);
}

function altoFila(doc, item) {
  doc.font('Helvetica').fontSize(9);
  const alturas = [
    doc.heightOfString(item.codigo || '—', { width: COLS[0].ancho }),
    doc.heightOfString(item.material || '—', { width: COLS[1].ancho }),
    doc.heightOfString(item.cantidad, { width: COLS[2].ancho }),
    doc.heightOfString(item.unidad || '—', { width: COLS[3].ancho }),
    doc.heightOfString(item.observaciones || '', { width: COLS[4].ancho })
  ];
  return Math.max(...alturas, 12) + 8;
}

function dibujarFilaItem(doc, item) {
  const y = doc.y;
  doc.text(item.codigo || '—', MARGEN + COLS[0].x, y, { width: COLS[0].ancho });
  doc.text(item.material || '—', MARGEN + COLS[1].x, y, { width: COLS[1].ancho });
  doc.text(item.cantidad, MARGEN + COLS[2].x, y, { width: COLS[2].ancho, align: 'right' });
  doc.text(item.unidad || '—', MARGEN + COLS[3].x, y, { width: COLS[3].ancho });
  if (item.observaciones) doc.fillColor('#555').text(item.observaciones, MARGEN + COLS[4].x, y, { width: COLS[4].ancho }).fillColor('#000');
}

function dibujarItems(doc, items) {
  dibujarCabeceraTabla(doc);
  let hayAproximados = false;

  items.forEach((item, i) => {
    const cantidadTxt = `${Number(item.cantidad).toLocaleString('es-AR')}${item.aproximado ? ' (aprox.)' : ''}`;
    if (item.aproximado) hayAproximados = true;

    const filaData = {
      codigo: item.codigo,
      material: item.material,
      cantidad: cantidadTxt,
      unidad: item.unidad_medida,
      observaciones: item.observaciones
    };

    const alto = altoFila(doc, filaData);
    if (doc.y + alto > doc.page.height - MARGEN - 60) {
      doc.addPage();
      dibujarCabeceraTabla(doc);
    }

    dibujarFilaItem(doc, filaData);
    doc.y += alto;
    if (i < items.length - 1) {
      doc.moveTo(MARGEN, doc.y - 4).lineTo(MARGEN + ANCHO_UTIL, doc.y - 4).strokeColor('#eee').stroke();
    }
  });

  doc.moveDown(0.5);
  dibujarLinea(doc);
  return hayAproximados;
}

function dibujarPie(doc, pedido, hayAproximados) {
  if (pedido.observaciones) {
    doc.font('Helvetica-Bold').fontSize(10).text('Observaciones', MARGEN, doc.y);
    doc.font('Helvetica').fontSize(9).text(pedido.observaciones, MARGEN, doc.y + 2, { width: ANCHO_UTIL });
    doc.moveDown(0.6);
  }

  if (hayAproximados) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555').text(
      'Las cantidades marcadas (aprox.) son de referencia: el material real puede variar levemente ' +
      '(por ejemplo, un rollo de alambre puede pesar algo más o menos que lo pedido).',
      MARGEN, doc.y, { width: ANCHO_UTIL }
    ).fillColor('#000');
    doc.moveDown(0.6);
  }

  doc.font('Helvetica').fontSize(8).fillColor('#999')
    .text(`Generado el ${new Date().toLocaleString('es-AR')} — ${empresa.nombre}`, MARGEN, doc.page.height - MARGEN - 10);
}

/**
 * Genera el PDF de un pedido a proveedor y lo escribe en `res` (un stream
 * writable con los headers ya seteados por quien llama). `pedido` trae
 * { numero, fecha, estado, observaciones, motivo_anulacion, proveedor, items }.
 */
function generarPdfPedidoProveedor(pedido, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN });
  doc.pipe(res);

  dibujarEncabezado(doc, pedido);
  dibujarProveedor(doc, pedido.proveedor);
  const hayAproximados = dibujarItems(doc, pedido.items);
  dibujarPie(doc, pedido, hayAproximados);

  doc.end();
}

module.exports = { generarPdfPedidoProveedor };

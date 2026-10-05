/* =====================================================================
 * PDF del estado de cuenta de un cliente o de un proveedor: la misma
 * jerarquía que las pantallas de Cobros y de Pagos a proveedores
 * (resumen → una línea por factura → pagos aplicados con sangría debajo).
 * La página 1 responde "cuánto debe y qué facturas están pendientes"; el
 * detalle de pagos es opcional (`detalle`).
 * Apaisado, como los informes (pdf-reporte.js).
 *
 * Los dos lados comparten el dibujo; lo que cambia (títulos, nombres de
 * campo, etiquetas) está en CONFIG_CLIENTE / CONFIG_PROVEEDOR.
 * ===================================================================== */

const PDFDocument = require('pdfkit');
const {
  MARGEN, dibujarLinea, dibujarMembrete, piePagina, fecha, money
} = require('./pdf-base');
const { ANCHO_UTIL_REPORTE } = require('./pdf-reporte');

const CONFIG_CLIENTE = {
  entidad: (datos) => datos.cliente.nombre,
  tituloColumnaPagado: 'Cobrado',
  tituloColumnaValores: 'En gestión',
  tarjetas: (r) => [
    ['Facturado', r.facturado], ['Cobrado', r.cobrado], ['Por cobrar', r.por_cobrar], ['Vencido', r.vencido]
  ],
  pagado: (x) => x.cobrado,
  valores: (x) => x.en_gestion,
  saldoTotal: (r) => r.por_cobrar,
  notaValores: (monto) => `Incluye ${money(monto)} en cheques en gestión de cobro (todavía no acreditados).`,
  etiquetaPago: (p) => `Cobro #${p.pago_id}`,
  fechaPago: (p) => p.fecha_recepcion,
  detallePago: (p) => [p.numero_recibo ? `Recibo ${p.numero_recibo}` : null, p.formas, ETIQUETA_FORMA[p.estado_forma]],
  notaACuenta: (monto) => `Cobros a cuenta sin imputar a ninguna factura: ${money(monto)}`,
  etiquetaEstado: {
    VENCIDA: 'Vencida', PARCIAL: 'Parcial', EN_GESTION: 'En gestión',
    PENDIENTE: 'Pendiente', SOBRE_COBRADA: 'Cobrada de más', COBRADA: 'Cobrada'
  },
  notasCredito: true
};

const CONFIG_PROVEEDOR = {
  entidad: (datos) => datos.proveedor.nombre,
  tituloColumnaPagado: 'Pagado',
  tituloColumnaValores: 'En valores',
  tarjetas: (r) => [
    ['Facturado', r.facturado], ['Pagado', r.pagado], ['Por pagar', r.por_pagar], ['Vencido', r.vencido]
  ],
  pagado: (x) => x.pagado,
  valores: (x) => x.en_valores,
  saldoTotal: (r) => r.por_pagar,
  notaValores: (monto) => `Del pagado, ${money(monto)} está en cheques entregados que todavía no se debitaron.`,
  etiquetaPago: (p) => `Pago #${p.pago_id}`,
  fechaPago: (p) => p.fecha,
  detallePago: (p) => [p.referencia, p.formas, ETIQUETA_FORMA[p.estado_forma]],
  notaACuenta: (monto) => `Pagos a cuenta sin imputar a ninguna factura: ${money(monto)}`,
  etiquetaEstado: {
    VENCIDA: 'Vencida', PARCIAL: 'Parcial', PENDIENTE: 'Pendiente',
    SOBRE_PAGADA: 'Pagada de más', PAGADA_EN_VALORES: 'Pagada en valores', PAGADA: 'Pagada'
  },
  notasCredito: false
};

const ETIQUETA_FORMA = {
  ACREDITADO: 'acreditado', EN_CARTERA: 'en cartera', ENTREGADO: 'entregado', DEBITADO: 'debitado',
  RECHAZADO: 'rechazado', ANULADO: 'anulado'
};

const COLS = [
  { campo: 'factura', titulo: 'Factura', x: 0, ancho: 95 },
  { campo: 'fecha', titulo: 'Fecha', x: 95, ancho: 62 },
  { campo: 'vence', titulo: 'Vencim.', x: 157, ancho: 62 },
  { campo: 'total', titulo: 'Total', x: 219, ancho: 80, align: 'right' },
  { campo: 'pagado', titulo: 'Cobrado', x: 299, ancho: 80, align: 'right' },
  { campo: 'valores', titulo: 'En gestión', x: 379, ancho: 80, align: 'right' },
  { campo: 'saldo', titulo: 'Saldo', x: 459, ancho: 80, align: 'right' },
  { campo: 'estado', titulo: 'Estado', x: 555, ancho: ANCHO_UTIL_REPORTE - 555 }
];

const LIMITE_PAGINA = (doc) => doc.page.height - MARGEN - 40;

function celda(doc, col, texto, y, opts = {}) {
  doc.text(String(texto ?? ''), MARGEN + col.x + (opts.sangria || 0), y,
    { width: col.ancho - (opts.sangria || 0), align: col.align || 'left', lineBreak: false, ellipsis: true });
}

function cabecera(doc, cfg) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
  const y = doc.y;
  COLS.forEach(c => {
    const titulo = c.campo === 'pagado' ? cfg.tituloColumnaPagado
      : c.campo === 'valores' ? cfg.tituloColumnaValores : c.titulo;
    celda(doc, c, titulo, y);
  });
  doc.y = y + 14;
  doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL_REPORTE, doc.y).strokeColor('#ccc').stroke();
  doc.y += 5;
}

function resumenTarjetas(doc, resumen, cfg) {
  const items = cfg.tarjetas(resumen);
  const ancho = ANCHO_UTIL_REPORTE / items.length;
  const y = doc.y;
  items.forEach(([titulo, valor], i) => {
    const x = MARGEN + i * ancho;
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(titulo, x, y, { width: ancho - 10 });
    doc.font('Helvetica-Bold').fontSize(14)
      .fillColor(titulo === 'Vencido' && valor > 0 ? '#c0392b' : '#000')
      .text(money(valor), x, y + 12, { width: ancho - 10 });
  });
  doc.fillColor('#000');
  doc.y = y + 40;
  const enValores = cfg.valores(resumen);
  if (enValores > 0.005) {
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(cfg.notaValores(enValores), MARGEN, doc.y);
    doc.fillColor('#000').moveDown(0.3);
  }
}

function generarPdf(cfg, datos, { filtrosTexto, detalle = true } = {}, res) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, layout: 'landscape' });
  doc.pipe(res);

  dibujarMembrete(doc, 'Estado de cuenta');

  doc.font('Helvetica-Bold').fontSize(12).text(cfg.entidad(datos), MARGEN, doc.y);
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  if (filtrosTexto) doc.text(filtrosTexto, MARGEN, doc.y);
  doc.text(`Emitido el ${fecha(new Date().toISOString().slice(0, 10))}`, MARGEN, doc.y);
  doc.fillColor('#000').moveDown(0.6);

  resumenTarjetas(doc, datos.resumen, cfg);
  dibujarLinea(doc);

  if (!datos.facturas.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text('No hay facturas para este filtro.', MARGEN, doc.y).fillColor('#000');
  } else {
    cabecera(doc, cfg);

    datos.facturas.forEach((f) => {
      const ncs = cfg.notasCredito ? f.notas_credito_detalle : [];
      const sublineas = detalle ? f.pagos.length + ncs.length : 0;
      // La factura y su primer pago van juntos: no se corta entre páginas
      // dejando una factura sola al pie.
      if (doc.y + 16 + Math.min(sublineas, 1) * 13 > LIMITE_PAGINA(doc)) {
        doc.addPage();
        cabecera(doc, cfg);
      }

      const y = doc.y;
      const filaVencida = f.estado === 'VENCIDA';
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
      celda(doc, COLS[0], f.numero_factura, y);
      doc.font('Helvetica').fillColor('#000');
      celda(doc, COLS[1], fecha(f.fecha), y);
      celda(doc, COLS[2], fecha(f.fecha_vencimiento), y);
      celda(doc, COLS[3], money(f.total), y);
      celda(doc, COLS[4], money(cfg.pagado(f)), y);
      celda(doc, COLS[5], Number(cfg.valores(f)) > 0.005 ? money(cfg.valores(f)) : '—', y);
      celda(doc, COLS[6], money(f.saldo), y);
      doc.fillColor(filaVencida ? '#c0392b' : '#000').font('Helvetica-Bold');
      celda(doc, COLS[7], cfg.etiquetaEstado[f.estado] || f.estado, y);
      doc.fillColor('#000');
      doc.y = y + 15;

      if (detalle) {
        doc.font('Helvetica').fontSize(8).fillColor('#555');
        f.pagos.forEach((p) => {
          if (doc.y + 13 > LIMITE_PAGINA(doc)) { doc.addPage(); cabecera(doc, cfg); doc.font('Helvetica').fontSize(8).fillColor('#555'); }
          const yy = doc.y;
          celda(doc, COLS[0], cfg.etiquetaPago(p), yy, { sangria: 12 });
          celda(doc, COLS[1], fecha(cfg.fechaPago(p)), yy);
          celda(doc, COLS[4], money(p.monto_aplicado), yy);
          celda(doc, COLS[7], cfg.detallePago(p).filter(Boolean).join(' · '), yy);
          doc.y = yy + 13;
        });
        ncs.forEach((n) => {
          if (doc.y + 13 > LIMITE_PAGINA(doc)) { doc.addPage(); cabecera(doc, cfg); doc.font('Helvetica').fontSize(8).fillColor('#555'); }
          const yy = doc.y;
          celda(doc, COLS[0], `NC ${n.numero_nota}`, yy, { sangria: 12 });
          celda(doc, COLS[1], fecha(n.fecha), yy);
          celda(doc, COLS[3], `-${money(n.total)}`, yy);
          celda(doc, COLS[7], 'Nota de crédito', yy);
          doc.y = yy + 13;
        });
        doc.fillColor('#000');
      }

      doc.moveTo(MARGEN, doc.y + 1).lineTo(MARGEN + ANCHO_UTIL_REPORTE, doc.y + 1).strokeColor('#eee').stroke();
      doc.y += 6;
    });

    // Fila de totales
    if (doc.y + 30 > LIMITE_PAGINA(doc)) doc.addPage();
    doc.moveTo(MARGEN, doc.y).lineTo(MARGEN + ANCHO_UTIL_REPORTE, doc.y).strokeColor('#999').stroke();
    doc.y += 5;
    const y = doc.y;
    const r = datos.resumen;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
    celda(doc, COLS[0], 'TOTALES', y);
    celda(doc, COLS[3], money(r.facturado), y);
    celda(doc, COLS[4], money(cfg.pagado(r)), y);
    celda(doc, COLS[5], money(cfg.valores(r)), y);
    celda(doc, COLS[6], money(cfg.saldoTotal(r)), y);
    doc.y = y + 16;
  }

  if (datos.a_cuenta > 0.005) {
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(cfg.notaACuenta(datos.a_cuenta), MARGEN, doc.y + 4)
      .fillColor('#000');
  }

  piePagina(doc);
  doc.end();
}

/**
 * @param {object} datos - { cliente, resumen, facturas, a_cuenta } (estadoCuenta + cliente)
 * @param {object} opts - { filtrosTexto, detalle }
 */
function generarPdfEstadoCuenta(datos, opts, res) {
  generarPdf(CONFIG_CLIENTE, datos, opts, res);
}

/**
 * @param {object} datos - { proveedor, resumen, facturas, a_cuenta } (estadoCuentaProveedor + proveedor)
 * @param {object} opts - { filtrosTexto, detalle }
 */
function generarPdfEstadoCuentaProveedor(datos, opts, res) {
  generarPdf(CONFIG_PROVEEDOR, datos, opts, res);
}

module.exports = { generarPdfEstadoCuenta, generarPdfEstadoCuentaProveedor };

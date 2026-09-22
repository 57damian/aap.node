// ============================================================================
// Datos de la empresa para membretar documentos generados por el sistema
// (hoy: el PDF de "Pedido a proveedor"; se puede reusar para otros).
//
// El logo es un archivo estático en public/img/logo-empresa.png (no se
// subió en la migración inicial: si no existe, el PDF sale igual, solo que
// sin la imagen — servicios/pdf-pedido-proveedor.js lo chequea antes de
// usarlo). Formatos aceptados por pdfkit: PNG y JPG.
// ============================================================================

const path = require('path');

module.exports = {
  nombre: 'Campbell Electrónica',
  logoPath: path.join(__dirname, '..', 'public', 'img', 'logo-empresa.png')
};

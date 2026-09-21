// Fotos de modelos (fichas técnicas). La lógica de seguridad está en
// uploadImagen.js, que también usan las fotos de OC.
const { crearUpload } = require('./uploadImagen');

module.exports = crearUpload('modelos');

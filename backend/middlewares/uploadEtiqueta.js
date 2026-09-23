/* =====================================================================
 * SUBIDA DE ETIQUETAS (el PDF que lleva pegado cada transformador, se
 * guarda en la ficha técnica para poder reimprimirlo — 22/09/2026).
 * Mismo criterio de seguridad que uploadImagen.js: nombre aleatorio,
 * extensión fija, se comprueba la firma real del archivo (no solo el
 * Content-Type que declara el navegador) y se borra si no coincide,
 * tamaño máximo. Va en un archivo aparte porque acá se valida un PDF, no
 * una imagen — otro tipo MIME, otra firma.
 * ===================================================================== */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { RAIZ_UPLOADS } = require('./uploadImagen');

const MAX_BYTES = 5 * 1024 * 1024;
const destino = path.join(RAIZ_UPLOADS, 'etiquetas');
fs.mkdirSync(destino, { recursive: true });

// Todo PDF empieza con la firma "%PDF-".
function firmaCoincide(ruta) {
  const fd = fs.openSync(ruta, 'r');
  const b = Buffer.alloc(5);
  try { fs.readSync(fd, b, 0, 5, 0); } finally { fs.closeSync(fd); }
  return b.toString('latin1') === '%PDF-';
}

// No se filtra por `file.mimetype` acá: es el Content-Type que declara el
// navegador para esa parte del multipart, y para PDF viene inconsistente
// o vacío bastante seguido (adjuntos de mail, escaneos, "imprimir a PDF"
// de ciertos programas) — filtrar por eso rechazaba PDF de verdad antes de
// llegar a mirar el archivo. La extensión ya sale fija de acá (nunca del
// nombre que manda el cliente) y la firma real se comprueba después de
// guardarlo, así que el filtro temprano no aportaba seguridad, solo
// falsos rechazos.
const multerInstancia = multer({
  storage: multer.diskStorage({
    destination: destino,
    filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.pdf')
  }),
  limits: { fileSize: MAX_BYTES, files: 1 }
});

module.exports = {
  single(campo) {
    const subir = multerInstancia.single(campo);
    return (req, res, next) => {
      subir(req, res, (err) => {
        if (err) return next(err);
        if (req.file && !firmaCoincide(req.file.path)) {
          fs.unlink(req.file.path, () => {});
          return next(new Error('Solo PDF'));
        }
        next();
      });
    };
  }
};

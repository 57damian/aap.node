/* =====================================================================
 * SUBIDA DE FOTOS Y ETIQUETAS DE LA FICHA TÉCNICA (06/10/2026)
 * ---------------------------------------------------------------------
 * Antes se guardaban en disco (uploadImagen.js / uploadEtiqueta.js) y en
 * Railway se perdían en cada deploy. Ahora el archivo se queda en memoria
 * (req.file.buffer) y la ruta lo inserta en ficha_archivos, así que no hay
 * nada que limpiar si el guardado falla.
 *
 * Mismo criterio de seguridad de antes:
 *  - se decide el tipo por la FIRMA REAL del archivo, nunca por el
 *    Content-Type ni la extensión que declara el navegador (para PDF viene
 *    inconsistente o vacío seguido);
 *  - solo JPG, PNG, WEBP, GIF (no SVG) o PDF según el caso;
 *  - máximo 5 MB y un archivo por pedido.
 * Deja `req.file.mimeDetectado` con el tipo comprobado.
 * ===================================================================== */

const multer = require('multer');

const MAX_BYTES = 5 * 1024 * 1024;

/** Tipo de imagen según los primeros bytes, o null. */
function tipoImagen(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Todo PDF empieza con "%PDF-". */
function tipoPdf(b) {
  return b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : null;
}

function crearSubida(detectar, mensajeError) {
  const multerInstancia = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 }
  });

  return {
    single(campo) {
      const subir = multerInstancia.single(campo);
      return (req, res, next) => {
        subir(req, res, (err) => {
          if (err) return next(err);
          if (req.file) {
            const mime = detectar(req.file.buffer);
            if (!mime) return next(new Error(mensajeError));
            req.file.mimeDetectado = mime;
          }
          next();
        });
      };
    }
  };
}

module.exports = {
  MAX_BYTES,
  imagen: crearSubida(tipoImagen, 'Solo imágenes'),
  pdf: crearSubida(tipoPdf, 'Solo PDF')
};

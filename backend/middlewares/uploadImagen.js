/* =====================================================================
 * SUBIDA DE IMÁGENES (fotos de modelos, fotos de OC de clientes)
 * ---------------------------------------------------------------------
 * Antes: el nombre era Date.now() + la extensión que mandaba el usuario, y
 * el filtro llamaba al callback dos veces (rechazaba y aceptaba a la vez).
 * Con eso alguien con una cuenta podía subir un .html o un .svg con un
 * script, que después se servía desde el mismo sitio y corría con la sesión
 * de quien lo abriera.
 *
 * Ahora:
 *  - solo JPG, PNG, WEBP o GIF (no SVG);
 *  - la extensión sale del tipo permitido, nunca del nombre original;
 *  - el nombre es aleatorio (no se puede adivinar);
 *  - se comprueba la firma real del archivo, no solo lo que declara el
 *    navegador, y si no coincide se borra;
 *  - máximo 5 MB y un archivo por pedido.
 * Además index.js sirve /uploads solo con sesión y con cabeceras que impiden
 * que un archivo se ejecute como página.
 * ===================================================================== */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const RAIZ_UPLOADS = path.join(__dirname, '..', 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;

const EXTENSION_POR_TIPO = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

// ¿Los primeros bytes son de verdad los de una imagen del tipo declarado?
function firmaCoincide(ruta, tipo) {
  const fd = fs.openSync(ruta, 'r');
  const b = Buffer.alloc(12);
  try { fs.readSync(fd, b, 0, 12, 0); } finally { fs.closeSync(fd); }
  switch (tipo) {
    case 'image/jpeg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png': return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/gif': return ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'));
    case 'image/webp': return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
    default: return false;
  }
}

/** Devuelve un objeto con `single(campo)`, como multer, que guarda en uploads/<carpeta>. */
function crearUpload(carpeta) {
  const destino = path.join(RAIZ_UPLOADS, carpeta);
  fs.mkdirSync(destino, { recursive: true });

  const multerInstancia = multer({
    storage: multer.diskStorage({
      destination: destino,
      filename: (_req, file, cb) => {
        cb(null, crypto.randomBytes(16).toString('hex') + EXTENSION_POR_TIPO[file.mimetype]);
      }
    }),
    fileFilter: (_req, file, cb) => {
      if (!EXTENSION_POR_TIPO[file.mimetype]) return cb(new Error('Solo imágenes'));
      cb(null, true);
    },
    limits: { fileSize: MAX_BYTES, files: 1 }
  });

  return {
    single(campo) {
      const subir = multerInstancia.single(campo);
      return (req, res, next) => {
        subir(req, res, (err) => {
          if (err) return next(err);
          if (req.file && !firmaCoincide(req.file.path, req.file.mimetype)) {
            fs.unlink(req.file.path, () => {});
            return next(new Error('Solo imágenes'));
          }
          next();
        });
      };
    }
  };
}

module.exports = { crearUpload, RAIZ_UPLOADS };

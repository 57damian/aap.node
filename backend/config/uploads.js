// Único lugar donde se define dónde viven los archivos subidos (fotos de
// modelos, fotos de OC, etiquetas PDF).
//
// En la base se guarda siempre la ruta lógica "uploads/<carpeta>/<archivo>";
// acá se traduce a la carpeta física. Por defecto es backend/uploads. En
// Railway el disco del contenedor es efímero (se vacía en cada deploy o
// reinicio), así que en producción hay que montar un Volume y apuntar
// UPLOAD_PATH a él (ej. UPLOAD_PATH=/data/uploads con el volumen en /data).
const path = require('path');

const RAIZ_UPLOADS = process.env.UPLOAD_PATH
  ? path.resolve(path.join(__dirname, '..'), process.env.UPLOAD_PATH)
  : path.join(__dirname, '..', 'uploads');

/** "uploads/modelos/x.png" (como se guarda en la base) → ruta física en disco. */
function rutaFisica(rutaLogica) {
  return path.join(RAIZ_UPLOADS, String(rutaLogica).replace(/^\/*uploads\//, ''));
}

module.exports = { RAIZ_UPLOADS, rutaFisica };

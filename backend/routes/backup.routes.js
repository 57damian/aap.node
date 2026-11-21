const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { verificarToken, soloAdmin } = require('../middlewares/auth');
const { crearBackup, describirBase } = require('../services/backup-base');
const { restaurarBackup } = require('../services/restaurar-backup');

// Copias de seguridad de la base, desde la pantalla "Copias de seguridad".
// Solo el administrador. La lógica está en services/backup-base.js (descargar)
// y services/restaurar-backup.js (restaurar).
router.use(verificarToken, soloAdmin);

// Descargar un backup lee toda la base y restaurar la reemplaza: no tiene
// sentido repetirlo decenas de veces. Esto frena un bucle o un click nervioso.
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos de backup seguidos. Esperá unos minutos.' }
}));

const FRASE_CONFIRMACION = 'RESTAURAR';
const MAX_BYTES_BACKUP = 300 * 1024 * 1024;

// El archivo subido va a disco (no a memoria): un backup con fotos puede ser grande.
const subir = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, fs.mkdtempSync(path.join(os.tmpdir(), 'restaurar-'))),
    filename: (req, file, cb) => cb(null, 'backup.subido')
  }),
  limits: { fileSize: MAX_BYTES_BACKUP, files: 1 }
}).single('archivo');

let restaurando = false;

function responderError(res, err, contexto) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: err.message });
}

const borrarCarpeta = (carpeta) => fs.rm(carpeta, { recursive: true, force: true }, () => {});

/** GET /api/backup/info — a qué base está conectada la app (sin credenciales). */
router.get('/info', (req, res) => {
  try {
    const { etiqueta, nombreBase } = describirBase(process.env.DATABASE_URL);
    res.json({ etiqueta, base: nombreBase });
  } catch (err) {
    responderError(res, err, 'GET /backup/info');
  }
});

/** GET /api/backup/descargar — genera el backup y lo entrega como .sql.gz. */
router.get('/descargar', async (req, res) => {
  if (restaurando) return res.status(409).json({ error: 'Hay una restauración en curso. Esperá a que termine.' });
  let carpeta;
  try {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
    const { archivoSql, resumen } = await crearBackup({ pool, carpeta });
    console.log(`Backup descargado por ${req.usuario.nombre_usuario}: ${Object.keys(resumen.tablas).length} tablas, ${resumen.total_filas} filas`);
    res.setHeader('X-Backup-Filas', String(resumen.total_filas));
    res.setHeader('X-Backup-Tablas', String(Object.keys(resumen.tablas).length));
    res.setHeader('Access-Control-Expose-Headers', 'X-Backup-Filas, X-Backup-Tablas, Content-Disposition');
    res.download(archivoSql, path.basename(archivoSql), () => borrarCarpeta(carpeta));
  } catch (err) {
    if (carpeta) borrarCarpeta(carpeta);
    responderError(res, err, 'GET /backup/descargar');
  }
});

/**
 * POST /api/backup/restaurar (multipart: archivo + confirmacion)
 * Reemplaza TODOS los datos por los del archivo. Todo o nada.
 */
router.post('/restaurar', (req, res) => {
  subir(req, res, async (errSubida) => {
    const carpetaTmp = req.file ? path.dirname(req.file.path) : null;
    try {
      if (errSubida) {
        if (errSubida.code === 'LIMIT_FILE_SIZE') {
          throw Object.assign(new Error(`El archivo supera el máximo de ${MAX_BYTES_BACKUP / 1024 / 1024} MB`), { status: 400 });
        }
        throw Object.assign(new Error('No se pudo recibir el archivo'), { status: 400 });
      }
      if (!req.file) throw Object.assign(new Error('Elegí el archivo del backup (.sql.gz)'), { status: 400 });
      if (String(req.body.confirmacion || '').trim() !== FRASE_CONFIRMACION) {
        throw Object.assign(new Error(`Para confirmar hay que escribir ${FRASE_CONFIRMACION}`), { status: 400 });
      }
      if (restaurando) throw Object.assign(new Error('Ya hay una restauración en curso.'), { status: 409 });

      restaurando = true;
      console.warn(`⚠️  Restauración de backup iniciada por ${req.usuario.nombre_usuario}`);
      try {
        const r = await restaurarBackup({ pool, archivo: req.file.path, log: console.log });
        console.warn(`⚠️  Restauración de backup terminada (${req.usuario.nombre_usuario}): ${r.tablas} tablas, ${r.filas} filas`);
        res.json({ mensaje: 'Backup restaurado', ...r });
      } finally {
        restaurando = false;
      }
    } catch (err) {
      responderError(res, err, 'POST /backup/restaurar');
    } finally {
      if (carpetaTmp) borrarCarpeta(carpetaTmp);
    }
  });
});

module.exports = router;

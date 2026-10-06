// Diagrama de salidas de una ficha técnica. Se monta dentro de ficha.routes.js,
// en /api/ficha-transformador/:id/diagrama (ya con verificarToken).
//
//   GET    /         diagrama guardado (o uno vacío) + si tiene imagen de fondo
//   PUT    /         guarda el diagrama (solo admin)
//   GET    /fondo    imagen de fondo (foto o boceto del carretel)
//   PUT    /fondo    sube/reemplaza la imagen de fondo (solo admin, campo "fondo")
//   DELETE /fondo    quita la imagen de fondo (solo admin)
//
// El diagrama es un JSON de elementos dibujados a mano (migracion-ficha-diagramas.sql):
// pines numerados, cables con color y texto, borneras y textos. Como lo escribe
// una persona y se muestra a otras, el servidor lo valida contra una lista blanca
// (tipos, colores hex, largos, cantidad) y no acepta < > " \ ` en los textos.

const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db');
const { soloAdmin, adminYOperario } = require('../middlewares/auth');
const { imagen: subidaImagen } = require('./../middlewares/uploadFichaArchivo');

const MAX_ELEMENTOS = 300;
const MAX_PUNTOS_CABLE = 30;
const LIMITE_COORD = 5000;
const FUNCIONES_PIN = ['PRIMARIO', 'SECUNDARIO', 'OTRO'];
const COLOR_HEX = /^#[0-9a-fA-F]{6}$/;
const ID_VALIDO = /^[A-Za-z0-9_-]{1,24}$/;
const SIN_ROTURA = /[<>"\\`]/;

const DIAGRAMA_VACIO = { version: 1, ancho: 800, alto: 500, elementos: [] };

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

function responderError(res, err, contexto) {
  if (!err.status) console.error(contexto, err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno del servidor' });
}

function coord(v, cual) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > LIMITE_COORD) throw fallo(400, `${cual}: posición fuera del dibujo`);
  return Math.round(n * 10) / 10;
}

function texto(v, max, cual, { obligatorio = false } = {}) {
  const t = String(v ?? '').trim();
  if (SIN_ROTURA.test(t)) throw fallo(400, `${cual} tiene caracteres no permitidos (< > " \\ \`)`);
  if (t.length > max) throw fallo(400, `${cual} es demasiado largo (máximo ${max} caracteres)`);
  if (obligatorio && !t) throw fallo(400, `${cual} no puede quedar vacío`);
  return t;
}

/** Valida el documento y devuelve una copia limpia (solo los campos conocidos). */
function normalizarDiagrama(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fallo(400, 'El diagrama no tiene un formato válido');
  if (!Array.isArray(raw.elementos)) throw fallo(400, 'El diagrama no tiene un formato válido');
  if (raw.elementos.length > MAX_ELEMENTOS) throw fallo(400, `El diagrama admite hasta ${MAX_ELEMENTOS} elementos`);

  const ancho = Math.round(Number(raw.ancho));
  const alto = Math.round(Number(raw.alto));
  if (!(ancho >= 200 && ancho <= 3000 && alto >= 200 && alto <= 3000)) throw fallo(400, 'El tamaño del diagrama no es válido');

  const ids = new Set();
  const elementos = raw.elementos.map((e, i) => {
    const cual = `Elemento ${i + 1}`;
    if (!e || typeof e !== 'object') throw fallo(400, `${cual}: formato inválido`);
    const id = String(e.id ?? '');
    if (!ID_VALIDO.test(id) || ids.has(id)) throw fallo(400, `${cual}: identificador inválido`);
    ids.add(id);

    switch (e.tipo) {
      case 'pin': {
        const funcion = FUNCIONES_PIN.includes(e.funcion) ? e.funcion : null;
        if (!funcion) throw fallo(400, `${cual}: la función del pin no es válida`);
        return {
          id, tipo: 'pin', x: coord(e.x, cual), y: coord(e.y, cual),
          numero: texto(e.numero, 6, `${cual}: el número del pin`, { obligatorio: true }),
          funcion, etiqueta: texto(e.etiqueta, 40, `${cual}: la etiqueta`)
        };
      }
      case 'cable': {
        if (!Array.isArray(e.puntos) || e.puntos.length < 2 || e.puntos.length > MAX_PUNTOS_CABLE) {
          throw fallo(400, `${cual}: un cable necesita entre 2 y ${MAX_PUNTOS_CABLE} puntos`);
        }
        if (!COLOR_HEX.test(String(e.color))) throw fallo(400, `${cual}: el color del cable no es válido`);
        return {
          id, tipo: 'cable',
          puntos: e.puntos.map(p => {
            if (!Array.isArray(p) || p.length !== 2) throw fallo(400, `${cual}: punto inválido`);
            return [coord(p[0], cual), coord(p[1], cual)];
          }),
          color: String(e.color).toLowerCase(),
          etiqueta: texto(e.etiqueta, 40, `${cual}: la etiqueta`)
        };
      }
      case 'bornera': {
        const posiciones = Number(e.posiciones);
        if (!Number.isInteger(posiciones) || posiciones < 1 || posiciones > 24) {
          throw fallo(400, `${cual}: la bornera admite de 1 a 24 posiciones`);
        }
        return {
          id, tipo: 'bornera', x: coord(e.x, cual), y: coord(e.y, cual), posiciones,
          etiqueta: texto(e.etiqueta, 40, `${cual}: la etiqueta`)
        };
      }
      case 'texto': {
        const tam = Number(e.tam);
        return {
          id, tipo: 'texto', x: coord(e.x, cual), y: coord(e.y, cual),
          texto: texto(e.texto, 80, `${cual}: el texto`, { obligatorio: true }),
          tam: Number.isFinite(tam) ? Math.min(48, Math.max(8, Math.round(tam))) : 14
        };
      }
      default:
        throw fallo(400, `${cual}: tipo de elemento no válido`);
    }
  });

  return { version: 1, ancho, alto, elementos };
}

router.get('/', adminYOperario, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT datos, actualizado_en FROM ficha_diagramas WHERE ficha_id = $1', [req.params.id]);
    const fondo = await pool.query(
      `SELECT 1 FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'FONDO_DIAGRAMA'`, [req.params.id]);
    if (!r.rows.length) {
      const ficha = await pool.query('SELECT 1 FROM ficha_transformador WHERE id = $1', [req.params.id]);
      if (!ficha.rows.length) return res.status(404).json({ error: 'Ficha no encontrada' });
    }
    res.json({
      datos: r.rows.length ? r.rows[0].datos : DIAGRAMA_VACIO,
      actualizado_en: r.rows.length ? r.rows[0].actualizado_en : null,
      tiene_fondo: fondo.rows.length > 0,
      ruta_fondo: fondo.rows.length ? `api/ficha-transformador/${req.params.id}/diagrama/fondo` : null
    });
  } catch (err) {
    responderError(res, err, 'Error leyendo diagrama:');
  }
});

router.put('/', soloAdmin, async (req, res) => {
  try {
    const datos = normalizarDiagrama(req.body.datos);
    const ficha = await pool.query('SELECT 1 FROM ficha_transformador WHERE id = $1', [req.params.id]);
    if (!ficha.rows.length) return res.status(404).json({ error: 'Ficha no encontrada' });

    const r = await pool.query(`
      INSERT INTO ficha_diagramas (ficha_id, datos, actualizado_por)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (ficha_id) DO UPDATE
        SET datos = EXCLUDED.datos, actualizado_en = now(), actualizado_por = EXCLUDED.actualizado_por
      RETURNING datos, actualizado_en`,
      [req.params.id, JSON.stringify(datos), req.usuario.id]);
    res.json({ datos: r.rows[0].datos, actualizado_en: r.rows[0].actualizado_en });
  } catch (err) {
    responderError(res, err, 'Error guardando diagrama:');
  }
});

router.get('/fondo', adminYOperario, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT mime, contenido FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'FONDO_DIAGRAMA'`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Este diagrama no tiene imagen de fondo' });
    res.setHeader('Content-Type', r.rows[0].mime);
    res.setHeader('Content-Length', r.rows[0].contenido.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.end(r.rows[0].contenido);
  } catch (err) {
    responderError(res, err, 'Error sirviendo fondo del diagrama:');
  }
});

router.put('/fondo', soloAdmin, subidaImagen.single('fondo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta la imagen de fondo' });
  try {
    const ficha = await pool.query('SELECT 1 FROM ficha_transformador WHERE id = $1', [req.params.id]);
    if (!ficha.rows.length) return res.status(404).json({ error: 'Ficha no encontrada' });

    const nombre = String(req.file.originalname || '').replace(/[<>"\\`]/g, '').trim().slice(0, 150) || null;
    await pool.query(`
      INSERT INTO ficha_archivos (ficha_id, tipo, nombre_original, mime, tamano, contenido, creado_por)
      VALUES ($1, 'FONDO_DIAGRAMA', $2, $3, $4, $5, $6)
      ON CONFLICT (ficha_id) WHERE tipo = 'FONDO_DIAGRAMA' DO UPDATE SET
        nombre_original = EXCLUDED.nombre_original, mime = EXCLUDED.mime, tamano = EXCLUDED.tamano,
        contenido = EXCLUDED.contenido, creado_en = now(), creado_por = EXCLUDED.creado_por`,
      [req.params.id, nombre, req.file.mimeDetectado, req.file.size, req.file.buffer, req.usuario.id]);
    res.json({ ok: true, ruta_fondo: `api/ficha-transformador/${req.params.id}/diagrama/fondo` });
  } catch (err) {
    responderError(res, err, 'Error guardando fondo del diagrama:');
  }
});

router.delete('/fondo', soloAdmin, async (req, res) => {
  try {
    await pool.query(`DELETE FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'FONDO_DIAGRAMA'`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'Error quitando fondo del diagrama:');
  }
});

module.exports = router;
module.exports.normalizarDiagrama = normalizarDiagrama;

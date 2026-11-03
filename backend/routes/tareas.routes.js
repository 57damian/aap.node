const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin } = require('../middlewares/auth');

// Tareas y notas informales del panel de inicio. Solo las ve y las toca el
// administrador.
router.use(verificarToken, soloAdmin);

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LIMITE_COMPLETADAS = 100;

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

function idValido(valor) {
  const id = parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) throw fallo(400, 'ID inválido');
  return id;
}

// Lo que tipea una persona no puede traer < ni > (se muestra en pantalla).
function texto(valor, max, etiqueta) {
  const t = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (!t) throw fallo(400, `Escribí ${etiqueta}`);
  if (t.length > max) throw fallo(400, `${etiqueta} es demasiado largo (máximo ${max} caracteres)`);
  if (/[<>]/.test(t)) throw fallo(400, `${etiqueta} no puede incluir < ni >`);
  return t;
}

// Opcional: vacío = sin fecha límite.
function fechaLimite(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  if (!RE_FECHA.test(String(valor)) || isNaN(new Date(valor + 'T00:00:00'))) {
    throw fallo(400, 'La fecha límite no es una fecha válida');
  }
  return valor;
}

function responderError(res, err, contexto) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: err.message });
}

// Fechas como texto para que no se corran por zona horaria.
const COLUMNAS = `
  id, texto, fijada, estado,
  fecha_limite::text AS fecha_limite,
  creado_en, completada_en`;

/**
 * GET /api/tareas?estado=PENDIENTE|COMPLETADA
 * Pendientes: las fijadas primero, después las más nuevas. Completadas: las
 * últimas que se hicieron (tope LIMITE_COMPLETADAS).
 */
router.get('/', async (req, res) => {
  try {
    const estado = String(req.query.estado || 'PENDIENTE').toUpperCase();
    if (!['PENDIENTE', 'COMPLETADA'].includes(estado)) throw fallo(400, 'Estado inválido');

    const orden = estado === 'PENDIENTE'
      ? 'fijada DESC, creado_en DESC, id DESC'
      : 'completada_en DESC, id DESC';
    const r = await pool.query(
      `SELECT ${COLUMNAS} FROM tareas WHERE estado = $1 ORDER BY ${orden} LIMIT $2`,
      [estado, estado === 'COMPLETADA' ? LIMITE_COMPLETADAS : 500]
    );
    const cant = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE estado = 'PENDIENTE')::int AS pendientes,
              COUNT(*) FILTER (WHERE estado = 'COMPLETADA')::int AS completadas
       FROM tareas`
    );
    res.json({ tareas: r.rows, ...cant.rows[0] });
  } catch (err) {
    responderError(res, err, 'GET /tareas');
  }
});

/** POST /api/tareas — body: { texto, fecha_limite?, fijada? } */
router.post('/', async (req, res) => {
  try {
    const t = texto(req.body.texto, 300, 'la tarea');
    const limite = fechaLimite(req.body.fecha_limite);
    const fijada = req.body.fijada === true || req.body.fijada === 'true';
    const r = await pool.query(
      `INSERT INTO tareas (texto, fecha_limite, fijada, creado_por)
       VALUES ($1, $2, $3, $4) RETURNING ${COLUMNAS}`,
      [t, limite, fijada, req.usuario.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    responderError(res, err, 'POST /tareas');
  }
});

/** PUT /api/tareas/:id — body: { texto, fecha_limite? } (reemplaza ambos) */
router.put('/:id', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const t = texto(req.body.texto, 300, 'la tarea');
    const limite = fechaLimite(req.body.fecha_limite);
    const r = await pool.query(
      `UPDATE tareas SET texto = $1, fecha_limite = $2 WHERE id = $3 RETURNING ${COLUMNAS}`,
      [t, limite, id]
    );
    if (r.rowCount === 0) throw fallo(404, 'La tarea no existe');
    res.json(r.rows[0]);
  } catch (err) {
    responderError(res, err, 'PUT /tareas/:id');
  }
});

/** POST /api/tareas/:id/completar */
router.post('/:id/completar', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const r = await pool.query(
      `UPDATE tareas SET estado = 'COMPLETADA', completada_en = NOW(), completada_por = $1
       WHERE id = $2 RETURNING ${COLUMNAS}`,
      [req.usuario.id, id]
    );
    if (r.rowCount === 0) throw fallo(404, 'La tarea no existe');
    res.json(r.rows[0]);
  } catch (err) {
    responderError(res, err, 'POST /tareas/:id/completar');
  }
});

/** POST /api/tareas/:id/reabrir — vuelve a pendiente. */
router.post('/:id/reabrir', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const r = await pool.query(
      `UPDATE tareas SET estado = 'PENDIENTE', completada_en = NULL, completada_por = NULL
       WHERE id = $1 RETURNING ${COLUMNAS}`,
      [id]
    );
    if (r.rowCount === 0) throw fallo(404, 'La tarea no existe');
    res.json(r.rows[0]);
  } catch (err) {
    responderError(res, err, 'POST /tareas/:id/reabrir');
  }
});

/** POST /api/tareas/:id/fijar — body: { fijada: true|false } */
router.post('/:id/fijar', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const fijada = req.body.fijada === true || req.body.fijada === 'true';
    const r = await pool.query(
      `UPDATE tareas SET fijada = $1 WHERE id = $2 RETURNING ${COLUMNAS}`,
      [fijada, id]
    );
    if (r.rowCount === 0) throw fallo(404, 'La tarea no existe');
    res.json(r.rows[0]);
  } catch (err) {
    responderError(res, err, 'POST /tareas/:id/fijar');
  }
});

/** DELETE /api/tareas/:id */
router.delete('/:id', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const r = await pool.query('DELETE FROM tareas WHERE id = $1', [id]);
    if (r.rowCount === 0) throw fallo(404, 'La tarea no existe');
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'DELETE /tareas/:id');
  }
});

module.exports = router;

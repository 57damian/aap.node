const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin } = require('../middlewares/auth');
const { r2 } = require('../services/montos');

// Gastos varios (contador, sueldos, banco, caja chica, impuestos…). Es plata:
// todo el módulo es solo para el administrador.
router.use(verificarToken, soloAdmin);

const FORMAS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'DEBITO', 'OTRO'];
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

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
function texto(valor, max, etiqueta, obligatorio) {
  const t = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (!t) {
    if (obligatorio) throw fallo(400, `Escribí ${etiqueta}`);
    return null;
  }
  if (t.length > max) throw fallo(400, `${etiqueta} es demasiado largo (máximo ${max} caracteres)`);
  if (/[<>]/.test(t)) throw fallo(400, `${etiqueta} no puede incluir < ni >`);
  return t;
}

// Acepta coma o punto decimal. Vacío = 0 solo si `vacioEsCero`.
function importe(valor, etiqueta, vacioEsCero) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    if (vacioEsCero) return 0;
    throw fallo(400, `Cargá ${etiqueta}`);
  }
  const n = Number(String(valor).replace(',', '.'));
  if (!isFinite(n)) throw fallo(400, `${etiqueta} no es un número válido`);
  return r2(n);
}

function validarFecha(valor, etiqueta) {
  if (!RE_FECHA.test(String(valor || '')) || isNaN(new Date(valor + 'T00:00:00'))) {
    throw fallo(400, `${etiqueta} no es una fecha válida`);
  }
  return valor;
}

function validarGasto(body) {
  const fecha = validarFecha(body.fecha, 'La fecha');
  const categoria_id = idValido(body.categoria_id);
  const descripcion = texto(body.descripcion, 200, 'la descripción', true);
  const neto = importe(body.neto, 'el importe');
  const iva = importe(body.iva, 'el IVA', true);
  if (neto <= 0) throw fallo(400, 'El importe tiene que ser mayor a cero');
  if (iva < 0) throw fallo(400, 'El IVA no puede ser negativo');

  let forma_pago = body.forma_pago ? String(body.forma_pago).toUpperCase() : null;
  if (forma_pago && !FORMAS_PAGO.includes(forma_pago)) throw fallo(400, 'Forma de pago inválida');
  const comprobante = texto(body.comprobante, 60, 'el comprobante', false);

  return { fecha, categoria_id, descripcion, neto, iva, total: r2(neto + iva), forma_pago, comprobante };
}

function responderError(res, err, contexto) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: err.message });
}

// ---------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------

function validarCategoria(body) {
  const nombre = texto(body.nombre, 60, 'el nombre de la categoría', true);
  return { nombre, es_impuesto: body.es_impuesto === true || body.es_impuesto === 'true' };
}

/** GET /api/gastos/categorias — con la cantidad de gastos vigentes de cada una. */
router.get('/categorias', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.id, c.nombre, c.es_impuesto, c.activa,
             COUNT(g.id) FILTER (WHERE g.estado = 'VIGENTE')::int AS cantidad
      FROM categorias_gasto c
      LEFT JOIN gastos g ON g.categoria_id = c.id
      GROUP BY c.id
      ORDER BY c.activa DESC, lower(c.nombre)
    `);
    res.json(r.rows);
  } catch (err) {
    responderError(res, err, 'GET /gastos/categorias');
  }
});

router.post('/categorias', async (req, res) => {
  try {
    const v = validarCategoria(req.body);
    const r = await pool.query(
      'INSERT INTO categorias_gasto (nombre, es_impuesto) VALUES ($1, $2) RETURNING id, nombre, es_impuesto, activa',
      [v.nombre, v.es_impuesto]
    );
    res.status(201).json({ ...r.rows[0], cantidad: 0 });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    responderError(res, err, 'POST /gastos/categorias');
  }
});

/** PUT /api/gastos/categorias/:id — renombrar, cambiar si es impuesto, activar/desactivar. */
router.put('/categorias/:id', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const v = validarCategoria(req.body);
    const activa = req.body.activa === undefined ? true : req.body.activa === true || req.body.activa === 'true';
    const r = await pool.query(
      `UPDATE categorias_gasto SET nombre = $1, es_impuesto = $2, activa = $3
        WHERE id = $4 RETURNING id, nombre, es_impuesto, activa`,
      [v.nombre, v.es_impuesto, activa, id]
    );
    if (r.rowCount === 0) throw fallo(404, 'Categoría no encontrada');
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
    responderError(res, err, 'PUT /gastos/categorias/:id');
  }
});

/** DELETE — solo si nunca se usó; si tiene gastos, hay que desactivarla. */
router.delete('/categorias/:id', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const usada = await pool.query('SELECT 1 FROM gastos WHERE categoria_id = $1 LIMIT 1', [id]);
    if (usada.rowCount > 0) {
      throw fallo(400, 'La categoría ya tiene gastos cargados: desactivala en vez de eliminarla');
    }
    const r = await pool.query('DELETE FROM categorias_gasto WHERE id = $1 RETURNING id', [id]);
    if (r.rowCount === 0) throw fallo(404, 'Categoría no encontrada');
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'DELETE /gastos/categorias/:id');
  }
});

// ---------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------

const SELECT_GASTO = `
  SELECT g.id, g.fecha::text AS fecha, g.categoria_id, c.nombre AS categoria_nombre,
         c.es_impuesto, g.descripcion, g.neto, g.iva, g.total, g.forma_pago,
         g.comprobante, g.estado, g.anulado_en, g.motivo_anulacion, g.creado_en
  FROM gastos g
  JOIN categorias_gasto c ON c.id = g.categoria_id
`;

/**
 * GET /api/gastos?desde&hasta&categoria_id&estado
 * Devuelve { gastos, resumen } — el resumen suma solo los gastos VIGENTES
 * del filtro (los anulados se listan pero no cuentan).
 */
router.get('/', async (req, res) => {
  try {
    const { desde, hasta, categoria_id, estado } = req.query;
    const params = [];
    let filtro = ' WHERE 1=1';
    if (desde) { params.push(validarFecha(desde, 'Desde')); filtro += ` AND g.fecha >= $${params.length}`; }
    if (hasta) { params.push(validarFecha(hasta, 'Hasta')); filtro += ` AND g.fecha <= $${params.length}`; }
    if (categoria_id) { params.push(idValido(categoria_id)); filtro += ` AND g.categoria_id = $${params.length}`; }
    if (estado) {
      const e = String(estado).toUpperCase();
      if (!['VIGENTE', 'ANULADO'].includes(e)) throw fallo(400, 'Estado inválido');
      params.push(e);
      filtro += ` AND g.estado = $${params.length}`;
    }

    const lista = await pool.query(`${SELECT_GASTO}${filtro} ORDER BY g.fecha DESC, g.id DESC LIMIT 1000`, params);
    const resumen = await pool.query(`
      SELECT COALESCE(SUM(g.total) FILTER (WHERE g.estado = 'VIGENTE'), 0)::numeric(15,2) AS total,
             COALESCE(SUM(g.total) FILTER (WHERE g.estado = 'VIGENTE' AND c.es_impuesto), 0)::numeric(15,2) AS impuestos,
             COALESCE(SUM(g.total) FILTER (WHERE g.estado = 'VIGENTE' AND NOT c.es_impuesto), 0)::numeric(15,2) AS otros,
             COUNT(*) FILTER (WHERE g.estado = 'VIGENTE')::int AS cantidad
      FROM gastos g JOIN categorias_gasto c ON c.id = g.categoria_id${filtro}
    `, params);
    res.json({ gastos: lista.rows, resumen: resumen.rows[0] });
  } catch (err) {
    responderError(res, err, 'GET /gastos');
  }
});

async function categoriaActiva(clientOrPool, id, permitirInactivaId) {
  const r = await clientOrPool.query('SELECT activa FROM categorias_gasto WHERE id = $1', [id]);
  if (r.rowCount === 0) throw fallo(400, 'La categoría no existe');
  if (!r.rows[0].activa && id !== permitirInactivaId) throw fallo(400, 'La categoría está desactivada');
}

router.post('/', async (req, res) => {
  try {
    const v = validarGasto(req.body);
    await categoriaActiva(pool, v.categoria_id);
    const r = await pool.query(
      `INSERT INTO gastos (fecha, categoria_id, descripcion, neto, iva, total, forma_pago, comprobante, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [v.fecha, v.categoria_id, v.descripcion, v.neto, v.iva, v.total, v.forma_pago, v.comprobante, req.usuario.id]
    );
    const g = await pool.query(`${SELECT_GASTO} WHERE g.id = $1`, [r.rows[0].id]);
    res.status(201).json(g.rows[0]);
  } catch (err) {
    responderError(res, err, 'POST /gastos');
  }
});

/** PUT /api/gastos/:id — solo un gasto VIGENTE se puede corregir. */
router.put('/:id', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const v = validarGasto(req.body);

    const actual = await pool.query('SELECT estado, categoria_id FROM gastos WHERE id = $1', [id]);
    if (actual.rowCount === 0) throw fallo(404, 'Gasto no encontrado');
    if (actual.rows[0].estado !== 'VIGENTE') throw fallo(400, 'Un gasto anulado no se puede editar');
    await categoriaActiva(pool, v.categoria_id, actual.rows[0].categoria_id);

    await pool.query(
      `UPDATE gastos SET fecha=$1, categoria_id=$2, descripcion=$3, neto=$4, iva=$5, total=$6,
                         forma_pago=$7, comprobante=$8
        WHERE id=$9`,
      [v.fecha, v.categoria_id, v.descripcion, v.neto, v.iva, v.total, v.forma_pago, v.comprobante, id]
    );
    const g = await pool.query(`${SELECT_GASTO} WHERE g.id = $1`, [id]);
    res.json(g.rows[0]);
  } catch (err) {
    responderError(res, err, 'PUT /gastos/:id');
  }
});

/** POST /api/gastos/:id/anular — body: { motivo } (≥ 5 caracteres). */
router.post('/:id/anular', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    const motivo = texto(req.body.motivo, 500, 'el motivo', true);
    if (motivo.length < 5) throw fallo(400, 'El motivo tiene que tener al menos 5 caracteres');

    const r = await pool.query(
      `UPDATE gastos SET estado = 'ANULADO', anulado_en = NOW(), anulado_por = $1, motivo_anulacion = $2
        WHERE id = $3 AND estado = 'VIGENTE' RETURNING id`,
      [req.usuario.id, motivo, id]
    );
    if (r.rowCount === 0) {
      const existe = await pool.query('SELECT estado FROM gastos WHERE id = $1', [id]);
      if (existe.rowCount === 0) throw fallo(404, 'Gasto no encontrado');
      throw fallo(400, 'El gasto ya está anulado');
    }
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'POST /gastos/:id/anular');
  }
});

module.exports = router;

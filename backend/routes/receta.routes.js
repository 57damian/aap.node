// Receta de un modelo de transformador. Se monta dentro de ficha.routes.js, en
// /api/ficha-transformador/:id/receta (ya con verificarToken).
//
//   GET  /                      receta guardada (devanados con su material + renglones)
//   PUT  /                      reemplaza los renglones (solo admin)
//   GET  /necesidad?cantidad=N  qué material hace falta para N transformadores y si alcanza el stock
//
// El material de alambre de cada devanado se guarda con la ficha (ficha.routes.js).
// Lógica de cálculo y descuento: services/receta.js. Sin precios: el operario puede
// consultar la necesidad (la usa Producción) y solo ve cantidades.

const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../db');
const { soloAdmin, adminYOperario } = require('../middlewares/auth');
const { leerReceta, calcularNecesidad } = require('../services/receta');
const { normalizarUnidad, unidadesPermitidas, convertirAUnidadMaterial } = require('../services/unidades');

const MAX_ITEMS = 40;
const MAX_CANTIDAD = 99999999;
const SIN_ROTURA = /[<>"\\`]/;

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

function responderError(res, err, contexto) {
  if (!err.status) console.error(contexto, err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno del servidor' });
}

/** Valida los renglones que manda el formulario y devuelve la lista limpia. */
async function normalizarItems(client, raw) {
  if (!Array.isArray(raw)) throw fallo(400, 'La receta no tiene un formato válido');
  if (raw.length > MAX_ITEMS) throw fallo(400, `La receta admite hasta ${MAX_ITEMS} renglones`);

  const items = raw.map((it, i) => {
    const cual = `Renglón ${i + 1}`;
    const materialId = Number(it && it.materia_prima_id);
    if (!Number.isInteger(materialId) || materialId <= 0) throw fallo(400, `${cual}: elegí el material`);

    const cantidad = Number(String(it.cantidad ?? '').replace(',', '.'));
    if (!isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD) {
      throw fallo(400, `${cual}: la cantidad tiene que ser un número mayor a cero`);
    }

    // Que la unidad sea compatible con el material se comprueba más abajo
    // (convertirAUnidadMaterial); acá solo que tenga forma de unidad.
    const unidad = normalizarUnidad(it.unidad);
    if (!/^[A-Z0-9]{1,10}$/.test(unidad)) throw fallo(400, `${cual}: elegí la unidad`);

    let observaciones = String(it.observaciones ?? '').trim();
    if (SIN_ROTURA.test(observaciones)) throw fallo(400, `${cual}: la nota tiene caracteres no permitidos (< > " \\ \`)`);
    if (observaciones.length > 200) throw fallo(400, `${cual}: la nota es demasiado larga (máximo 200 caracteres)`);
    observaciones = observaciones || null;

    return { materia_prima_id: materialId, cantidad, unidad, observaciones, orden: i };
  });

  if (!items.length) return items;

  const ids = [...new Set(items.map(i => i.materia_prima_id))];
  const r = await client.query(
    'SELECT id, nombre, unidad_medida, metros_por_rollo, activo FROM materias_primas WHERE id = ANY($1::int[])', [ids]);
  const porId = new Map(r.rows.map(m => [m.id, m]));

  items.forEach((it, i) => {
    const mat = porId.get(it.materia_prima_id);
    if (!mat || mat.activo === false) throw fallo(400, `Renglón ${i + 1}: el material no existe o está dado de baja`);
    const c = convertirAUnidadMaterial(1, it.unidad, mat);
    if (!c.ok) throw fallo(400, `Renglón ${i + 1} (${mat.nombre}): ${c.error}`);
  });

  return items;
}

router.get('/', adminYOperario, async (req, res) => {
  try {
    const receta = await leerReceta(pool, req.params.id);
    if (!receta) return res.status(404).json({ error: 'Ficha no encontrada' });
    receta.items.forEach(i => {
      i.unidades_permitidas = unidadesPermitidas({ unidad_medida: i.material_unidad, metros_por_rollo: i.metros_por_rollo });
    });
    res.json(receta);
  } catch (err) {
    responderError(res, err, 'Error leyendo receta:');
  }
});

router.put('/', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const ficha = await client.query('SELECT id FROM ficha_transformador WHERE id = $1', [req.params.id]);
    if (!ficha.rows.length) return res.status(404).json({ error: 'Ficha no encontrada' });

    const items = await normalizarItems(client, req.body.items);

    await client.query('BEGIN');
    await client.query('DELETE FROM ficha_receta_items WHERE ficha_id = $1', [req.params.id]);
    for (const it of items) {
      await client.query(
        `INSERT INTO ficha_receta_items (ficha_id, materia_prima_id, cantidad, unidad, observaciones, orden)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.params.id, it.materia_prima_id, it.cantidad, it.unidad, it.observaciones, it.orden]);
    }
    await client.query('COMMIT');

    res.json(await leerReceta(client, req.params.id));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    responderError(res, err, 'Error guardando receta:');
  } finally {
    client.release();
  }
});

router.get('/necesidad', adminYOperario, async (req, res) => {
  try {
    const unidades = Number(req.query.cantidad);
    if (!Number.isInteger(unidades) || unidades <= 0 || unidades > 1000000) {
      return res.status(400).json({ error: 'La cantidad tiene que ser un número entero mayor a cero' });
    }
    const n = await calcularNecesidad(pool, req.params.id, unidades);
    if (!n) return res.status(404).json({ error: 'Ficha no encontrada' });
    res.json({ unidades, ...n });
  } catch (err) {
    responderError(res, err, 'Error calculando necesidad de material:');
  }
});

module.exports = router;

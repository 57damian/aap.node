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
const { leerReceta, calcularNecesidad, normalizarItems, guardarItems } = require('../services/receta');
const { unidadesPermitidas } = require('../services/unidades');

function responderError(res, err, contexto) {
  if (!err.status) console.error(contexto, err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno del servidor' });
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
    await guardarItems(client, req.params.id, items);
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

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin, adminYOperario } = require('../middlewares/auth');

router.use(verificarToken);

// Mismo criterio de texto que el resto del sistema: lo que tipea una persona
// no puede traer < ni > (se muestra en pantallas del administrador).
function validarNombre(valor) {
  const nombre = String(valor || '').trim().replace(/\s+/g, ' ');
  if (!nombre) return { error: 'Escribí el nombre de la categoría' };
  if (nombre.length > 60) return { error: 'El nombre es demasiado largo (máximo 60 caracteres)' };
  if (/[<>]/.test(nombre)) return { error: 'El nombre no puede incluir < ni >' };
  return { nombre };
}

/**
 * GET /api/categorias-materia-prima
 * Lista las categorías con la cantidad de materias primas activas de cada una.
 * La leen también los operarios (filtran el stock por categoría); la cantidad
 * no es un dato contable.
 */
router.get('/', adminYOperario, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.nombre,
             COUNT(mp.id) FILTER (WHERE mp.activo = true)::int AS cantidad
      FROM categorias_materia_prima c
      LEFT JOIN materias_primas mp ON mp.categoria_id = c.id
      GROUP BY c.id, c.nombre
      ORDER BY lower(c.nombre)
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /categorias-materia-prima:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/categorias-materia-prima
 * Body: { nombre }
 */
router.post('/', soloAdmin, async (req, res) => {
  const v = validarNombre(req.body.nombre);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const result = await pool.query(
      'INSERT INTO categorias_materia_prima (nombre) VALUES ($1) RETURNING id, nombre',
      [v.nombre]
    );
    res.status(201).json({ ...result.rows[0], cantidad: 0 });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: `Ya existe una categoría llamada "${v.nombre}"` });
    }
    console.error('Error en POST /categorias-materia-prima:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/categorias-materia-prima/:id
 * Body: { nombre } — renombra la categoría (las materias primas la siguen
 * teniendo, apuntan por id).
 */
router.put('/:id', soloAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  const v = validarNombre(req.body.nombre);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const result = await pool.query(
      'UPDATE categorias_materia_prima SET nombre = $1 WHERE id = $2 RETURNING id, nombre',
      [v.nombre, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: `Ya existe una categoría llamada "${v.nombre}"` });
    }
    console.error('Error en PUT /categorias-materia-prima/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/categorias-materia-prima/:id
 * Elimina la categoría; sus materias primas quedan "Sin categoría"
 * (ON DELETE SET NULL), no se tocan.
 */
router.delete('/:id', soloAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  try {
    const result = await pool.query(
      'DELETE FROM categorias_materia_prima WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en DELETE /categorias-materia-prima/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

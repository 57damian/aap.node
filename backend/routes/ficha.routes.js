const upload = require('../middlewares/uploadModelo');
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin, adminYOperario } = require('../middlewares/auth');
const { segunRol } = require('../services/vista-operario');

router.use(verificarToken);

/* =========================
   CREATE - Crear nueva ficha
========================= */
router.post('/', adminYOperario, upload.single('foto'), async (req, res) => {
  const { 
    modelo,
    cliente_id,
    voltaje_entrada,
    voltaje_salida,
    tipo_carretel,
    laminacion,
    observaciones
  } = req.body;

  if (!modelo) {
    return res.status(400).json({ error: 'El nombre del modelo es obligatorio' });
  }

  const foto = req.file ? `uploads/modelos/${req.file.filename}` : null;

  try {
    const result = await pool.query(
      `INSERT INTO ficha_transformador (
        modelo, cliente_id, tipo_carretel, foto_modelo,
        voltaje_entrada, voltaje_salida, amperaje_entrada, amperaje_salida,
        alambre_primario, diametro_primario_mm, espiras_primario, pines_primario, peso_primario_kg,
        alambre_secundario, diametro_secundario_mm, espiras_secundario, pines_secundario, peso_secundario_kg,
        laminacion, peso_laminacion_kg, observaciones
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,
        $19,$20,$21
      ) RETURNING *`,
      [
        modelo,
        cliente_id || null,
        tipo_carretel,
        foto,
        voltaje_entrada,
        voltaje_salida,
        req.body.amperaje_entrada,
        req.body.amperaje_salida,
        req.body.alambre_primario,
        req.body.diametro_primario_mm,
        req.body.espiras_primario,
        req.body.pines_primario,
        req.body.peso_primario_kg,
        req.body.alambre_secundario,
        req.body.diametro_secundario_mm,
        req.body.espiras_secundario,
        req.body.pines_secundario,
        req.body.peso_secundario_kg,
        laminacion,
        req.body.peso_laminacion_kg,
        observaciones
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creando ficha:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   READ ALL - Listar todas las fichas
========================= */
router.get('/', adminYOperario, async (req, res) => {
  const { cliente_id } = req.query;

  try {
    let result;

    // hallazgo D11: listar solo fichas activas (deleted_at IS NULL). Este es
    // el listado que alimenta los selectores de "elegir modelo" — una ficha
    // dada de baja no tiene que seguir apareciendo para elegirla de nuevo.
    if (cliente_id) {
      result = await pool.query(
        `SELECT * FROM ficha_transformador
         WHERE (cliente_id IS NULL OR cliente_id = $1) AND deleted_at IS NULL
         ORDER BY modelo`,
        [cliente_id]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM ficha_transformador
         WHERE deleted_at IS NULL
         ORDER BY modelo`
      );
    }

    // Las fichas hoy no guardan precios, pero la consulta es SELECT *: si
    // mañana se agrega una columna de precio, al operario no le llega.
    res.json(segunRol(result.rows, req.usuario.rol));
  } catch (err) {
    console.error('Error listando fichas:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   READ ONE - Obtener una ficha por ID
========================= */
router.get('/:id', adminYOperario, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM ficha_transformador WHERE id = $1',
      [req.params.id]
    );
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Ficha no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo ficha:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   UPDATE - Actualizar ficha
========================= */
router.put('/:id', adminYOperario, upload.single('foto'), async (req, res) => {
  try {
    // Obtener la ficha actual para mantener la foto si no se cambia
    const fichaActual = await pool.query(
      'SELECT foto_modelo FROM ficha_transformador WHERE id = $1',
      [req.params.id]
    );
    
    if (!fichaActual.rows.length) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const fotoActual = fichaActual.rows[0].foto_modelo;
    const nuevaFoto = req.file ? `uploads/modelos/${req.file.filename}` : fotoActual;

    const result = await pool.query(
      `UPDATE ficha_transformador SET
        modelo=$1, cliente_id=$2, tipo_carretel=$3, foto_modelo=$4,
        voltaje_entrada=$5, voltaje_salida=$6, amperaje_entrada=$7, amperaje_salida=$8,
        alambre_primario=$9, diametro_primario_mm=$10, espiras_primario=$11, pines_primario=$12, peso_primario_kg=$13,
        alambre_secundario=$14, diametro_secundario_mm=$15, espiras_secundario=$16, pines_secundario=$17, peso_secundario_kg=$18,
        laminacion=$19, peso_laminacion_kg=$20, observaciones=$21
       WHERE id=$22
       RETURNING *`,
      [
        req.body.modelo,
        req.body.cliente_id || null,
        req.body.tipo_carretel,
        nuevaFoto,
        req.body.voltaje_entrada,
        req.body.voltaje_salida,
        req.body.amperaje_entrada,
        req.body.amperaje_salida,
        req.body.alambre_primario,
        req.body.diametro_primario_mm,
        req.body.espiras_primario,
        req.body.pines_primario,
        req.body.peso_primario_kg,
        req.body.alambre_secundario,
        req.body.diametro_secundario_mm,
        req.body.espiras_secundario,
        req.body.pines_secundario,
        req.body.peso_secundario_kg,
        req.body.laminacion,
        req.body.peso_laminacion_kg,
        req.body.observaciones,
        req.params.id
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error actualizando ficha:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   DELETE - Eliminar ficha
========================= */
router.delete('/:id', soloAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // hallazgo D11: la columna deleted_at existía en el esquema pero no la
    // usaba nadie — el DELETE era físico, y si el modelo tenía producción,
    // ventas, precios o items de OC, Postgres lo rechazaba por FK y el
    // usuario se llevaba un 500 con el mensaje crudo de la base. Ahora es
    // borrado lógico: no rompe nunca por FK, y la ficha sigue existiendo
    // para lo que ya se cargó con ella (ver GET /:id, que no filtra
    // deleted_at a propósito para no romper el detalle de algo viejo).
    const result = await pool.query(
      'UPDATE ficha_transformador SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ficha no encontrada o ya eliminada' });
    }

    res.json({ ok: true, deletedId: id });
  } catch (err) {
    console.error('Error eliminando ficha:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
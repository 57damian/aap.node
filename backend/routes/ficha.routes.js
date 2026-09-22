const upload = require('../middlewares/uploadModelo');
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin, adminYOperario } = require('../middlewares/auth');
const { segunRol } = require('../services/vista-operario');

router.use(verificarToken);

/* =========================
   DEVANADOS ADICIONALES (terciario, cuarto…)
   El primario y el secundario viven en columnas de la ficha; los demás en
   ficha_devanados_extra (orden 3 en adelante). Las espiras son texto porque
   un secundario con punto medio se anota "422 + 422".
========================= */
const MAX_DEVANADOS_EXTRA = 8; // orden 3 a 10
const NOMBRE_DEVANADO = ['terciario', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Los operarios pueden crear y editar fichas, y esos textos después se
// muestran a los administradores en muchas pantallas. Para que nadie pueda
// colar HTML o un script, no se aceptan < ni > en ningún campo de texto; y en
// los datos cortos (modelo, alambre, pines, carretel…) tampoco comillas
// dobles, barras invertidas ni comilla invertida, que servirían para romper
// atributos HTML.
const SIN_HTML = /[<>]/;
const SIN_ROTURA = /[<>"\\`]/;

function validarCaracteres(valor, etiqueta, estricto) {
  if (valor === undefined || valor === null) return;
  if ((estricto ? SIN_ROTURA : SIN_HTML).test(String(valor))) {
    throw fallo(400, `${etiqueta} tiene caracteres no permitidos${estricto ? ' (< > " \\ `)' : ' (< >)'}`);
  }
}

// Campos de texto de la ficha que llegan en el cuerpo del pedido.
function validarTextosFicha(body) {
  const cortos = {
    modelo: 'El modelo', tipo_carretel: 'El tipo de carretel', laminacion: 'La laminación',
    alambre_primario: 'El alambre del primario', alambre_secundario: 'El alambre del secundario',
    pines_primario: 'Los pines del primario', pines_secundario: 'Los pines del secundario'
  };
  for (const [campo, etiqueta] of Object.entries(cortos)) validarCaracteres(body[campo], etiqueta, true);
  validarCaracteres(body.observaciones, 'Las observaciones', false);
}

// Texto libre acotado: recorta y devuelve null si quedó vacío.
function textoCorto(valor, max, etiqueta) {
  validarCaracteres(valor, etiqueta, true);
  const t = String(valor ?? '').trim();
  if (!t) return null;
  if (t.length > max) throw fallo(400, `${etiqueta} es demasiado largo (máximo ${max} caracteres)`);
  return t;
}

function numeroONull(valor, max, etiqueta) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const n = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) throw fallo(400, `${etiqueta} no es un número válido`);
  return n;
}

/** Lee y valida la lista que manda el formulario (JSON en `devanados_extra`).
 * Devuelve undefined si el campo no vino: en ese caso no se toca lo guardado. */
function normalizarExtras(raw) {
  if (raw === undefined) return undefined;

  let lista = raw;
  if (typeof raw === 'string') {
    try { lista = JSON.parse(raw || '[]'); }
    catch (_) { throw fallo(400, 'Los devanados adicionales no tienen un formato válido'); }
  }
  if (!Array.isArray(lista)) throw fallo(400, 'Los devanados adicionales no tienen un formato válido');
  if (lista.length > MAX_DEVANADOS_EXTRA) {
    throw fallo(400, `Se permiten hasta ${MAX_DEVANADOS_EXTRA} devanados adicionales`);
  }

  return lista.map((d, i) => {
    const cual = `del devanado ${NOMBRE_DEVANADO[i]}`;
    return {
      orden: i + 3,
      alambre: textoCorto(d?.alambre, 100, `El alambre ${cual}`),
      diametro_mm: numeroONull(d?.diametro_mm, 999.99, `El diámetro ${cual}`),
      espiras: textoCorto(d?.espiras, 40, `Las espiras ${cual}`),
      pines: textoCorto(d?.pines, 50, `Los pines ${cual}`),
      // Peso en gramos (antes en kg): tope acorde a ficha_devanados_extra.peso_kg
      // numeric(9,2) — ver migracion-ficha-pesos-gramos.sql.
      peso_kg: numeroONull(d?.peso_kg, 9999999.99, `El peso ${cual}`)
    };
  });
}

// Reemplaza todos los devanados adicionales de la ficha por los recibidos.
async function guardarExtras(client, fichaId, extras) {
  await client.query('DELETE FROM ficha_devanados_extra WHERE ficha_id = $1', [fichaId]);
  for (const d of extras) {
    await client.query(
      `INSERT INTO ficha_devanados_extra (ficha_id, orden, alambre, diametro_mm, espiras, pines, peso_kg)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [fichaId, d.orden, d.alambre, d.diametro_mm, d.espiras, d.pines, d.peso_kg]
    );
  }
}

async function leerExtras(cliente, fichaId) {
  const r = await cliente.query(
    `SELECT orden, alambre, diametro_mm, espiras, pines, peso_kg
     FROM ficha_devanados_extra WHERE ficha_id = $1 ORDER BY orden`,
    [fichaId]
  );
  return r.rows;
}

function responderError(res, err, contexto) {
  if (!err.status) console.error(contexto, err);
  res.status(err.status || 500).json({ error: err.message });
}

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

  const client = await pool.connect();
  try {
    validarTextosFicha(req.body);
    const espirasPrimario = textoCorto(req.body.espiras_primario, 40, 'Las espiras del primario');
    const espirasSecundario = textoCorto(req.body.espiras_secundario, 40, 'Las espiras del secundario');
    const extras = normalizarExtras(req.body.devanados_extra);

    await client.query('BEGIN');
    const result = await client.query(
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
        espirasPrimario,
        req.body.pines_primario,
        req.body.peso_primario_kg,
        req.body.alambre_secundario,
        req.body.diametro_secundario_mm,
        espirasSecundario,
        req.body.pines_secundario,
        req.body.peso_secundario_kg,
        laminacion,
        req.body.peso_laminacion_kg,
        observaciones
      ]
    );

    const ficha = result.rows[0];
    if (extras && extras.length) await guardarExtras(client, ficha.id, extras);
    await client.query('COMMIT');

    ficha.devanados_extra = extras || [];
    res.json(ficha);
  } catch (err) {
    await client.query('ROLLBACK');
    responderError(res, err, 'Error creando ficha:');
  } finally {
    client.release();
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
   READ ONE - Obtener una ficha por ID (con sus devanados adicionales)
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

    const ficha = result.rows[0];
    ficha.devanados_extra = await leerExtras(pool, ficha.id);
    res.json(ficha);
  } catch (err) {
    console.error('Error obteniendo ficha:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   UPDATE - Actualizar ficha
========================= */
router.put('/:id', adminYOperario, upload.single('foto'), async (req, res) => {
  const client = await pool.connect();
  try {
    // Obtener la ficha actual para mantener la foto si no se cambia
    const fichaActual = await client.query(
      'SELECT foto_modelo FROM ficha_transformador WHERE id = $1',
      [req.params.id]
    );

    if (!fichaActual.rows.length) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    const fotoActual = fichaActual.rows[0].foto_modelo;
    const nuevaFoto = req.file ? `uploads/modelos/${req.file.filename}` : fotoActual;

    validarTextosFicha(req.body);
    const espirasPrimario = textoCorto(req.body.espiras_primario, 40, 'Las espiras del primario');
    const espirasSecundario = textoCorto(req.body.espiras_secundario, 40, 'Las espiras del secundario');
    const extras = normalizarExtras(req.body.devanados_extra);

    await client.query('BEGIN');
    const result = await client.query(
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
        espirasPrimario,
        req.body.pines_primario,
        req.body.peso_primario_kg,
        req.body.alambre_secundario,
        req.body.diametro_secundario_mm,
        espirasSecundario,
        req.body.pines_secundario,
        req.body.peso_secundario_kg,
        req.body.laminacion,
        req.body.peso_laminacion_kg,
        req.body.observaciones,
        req.params.id
      ]
    );

    // Si el formulario mandó la lista (aunque esté vacía) reemplaza a la guardada.
    if (extras !== undefined) await guardarExtras(client, req.params.id, extras);
    await client.query('COMMIT');

    const ficha = result.rows[0];
    ficha.devanados_extra = await leerExtras(client, ficha.id);
    res.json(ficha);
  } catch (err) {
    await client.query('ROLLBACK');
    responderError(res, err, 'Error actualizando ficha:');
  } finally {
    client.release();
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

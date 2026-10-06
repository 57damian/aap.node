const { imagen: subidaImagen, pdf: subidaPdf } = require('../middlewares/uploadFichaArchivo');
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin, adminYOperario } = require('../middlewares/auth');
const { segunRol } = require('../services/vista-operario');
const { generarPdfFicha } = require('../services/pdf-ficha');
const { nombreArchivo } = require('../services/pdf-base');

router.use(verificarToken);

/* =========================
   FOTO Y ETIQUETAS (06/10/2026)
   Viven en la tabla ficha_archivos (binario en la base), no en disco: el
   disco de Railway se vacía en cada deploy. La API sigue devolviendo
   `foto_modelo` y `etiquetas[].archivo` como una ruta relativa que el
   frontend pide con el token (cargarImagenProtegida / verArchivoProtegido),
   pero ahora esa ruta es un endpoint de esta misma API.
========================= */
const rutaFoto = (fichaId) => `api/ficha-transformador/${fichaId}/foto`;
const rutaEtiqueta = (fichaId, archivoId) => `api/ficha-transformador/${fichaId}/etiquetas/${archivoId}/archivo`;

// Reemplaza la foto de la ficha (una sola por ficha).
async function guardarFoto(client, fichaId, file, usuarioId) {
  await client.query(
    `INSERT INTO ficha_archivos (ficha_id, tipo, nombre_original, mime, tamano, contenido, creado_por)
     VALUES ($1, 'FOTO', $2, $3, $4, $5, $6)
     ON CONFLICT (ficha_id) WHERE tipo = 'FOTO' DO UPDATE SET
       nombre_original = EXCLUDED.nombre_original, mime = EXCLUDED.mime, tamano = EXCLUDED.tamano,
       contenido = EXCLUDED.contenido, creado_en = now(), creado_por = EXCLUDED.creado_por`,
    [fichaId, sanitizarNombreOriginal(file.originalname), file.mimeDetectado, file.size, file.buffer, usuarioId]
  );
}

// foto_modelo (columna vieja, ruta de disco) se pisa con la ruta del endpoint
// nuevo si la ficha tiene foto en la base, o null si no la tiene.
function conRutaDeFoto(ficha, tieneFoto) {
  ficha.foto_modelo = tieneFoto ? rutaFoto(ficha.id) : null;
  delete ficha.tiene_foto;
  return ficha;
}

function enviarArchivo(res, fila, disposicion) {
  res.setHeader('Content-Type', fila.mime);
  res.setHeader('Content-Length', fila.contenido.length);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  if (disposicion) {
    const nombre = (fila.nombre_original || 'archivo').replace(/[^\w.\- ]/g, '_');
    res.setHeader('Content-Disposition', `${disposicion}; filename="${nombre}"`);
  }
  res.end(fila.contenido);
}

/* =========================
   DEVANADOS ADICIONALES (terciario, cuarto…)
   El primario y el secundario viven en columnas de la ficha; los demás en
   ficha_devanados_extra (orden 3 en adelante). Las espiras son texto porque
   un secundario con punto medio se anota "422 + 422".
========================= */
const MAX_DEVANADOS_EXTRA = 8; // orden 3 a 10
const NOMBRE_DEVANADO = ['terciario', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];

// Algunos modelos llevan más de una etiqueta física (ej.: primario y
// secundario por separado). Tope para no dejar subir sin límite.
const MAX_ETIQUETAS = 6;

// Solo para mostrar en pantalla junto al PDF: se limpia de caracteres de
// ruptura y se recorta, no se rechaza el archivo por esto.
function sanitizarNombreOriginal(nombre) {
  if (!nombre) return null;
  const limpio = String(nombre).replace(/[<>"\\`]/g, '').trim().slice(0, 150);
  return limpio || null;
}

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

async function leerEtiquetas(cliente, fichaId) {
  const r = await cliente.query(
    `SELECT id, nombre_original, creado_en
     FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'ETIQUETA' ORDER BY id`,
    [fichaId]
  );
  return r.rows.map(e => ({ ...e, archivo: rutaEtiqueta(fichaId, e.id) }));
}

function responderError(res, err, contexto) {
  if (!err.status) console.error(contexto, err);
  res.status(err.status || 500).json({ error: err.message });
}

/* =========================
   CREATE - Crear nueva ficha
========================= */
router.post('/', adminYOperario, subidaImagen.single('foto'), async (req, res) => {
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

  const client = await pool.connect();
  try {
    validarTextosFicha(req.body);
    const espirasPrimario = textoCorto(req.body.espiras_primario, 40, 'Las espiras del primario');
    const espirasSecundario = textoCorto(req.body.espiras_secundario, 40, 'Las espiras del secundario');
    const extras = normalizarExtras(req.body.devanados_extra);

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO ficha_transformador (
        modelo, cliente_id, tipo_carretel,
        voltaje_entrada, voltaje_salida, amperaje_entrada, amperaje_salida,
        alambre_primario, diametro_primario_mm, espiras_primario, pines_primario, peso_primario_kg,
        alambre_secundario, diametro_secundario_mm, espiras_secundario, pines_secundario, peso_secundario_kg,
        laminacion, peso_laminacion_kg, observaciones
      ) VALUES (
        $1,$2,$3,
        $4,$5,$6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,
        $18,$19,$20
      ) RETURNING *`,
      [
        modelo,
        cliente_id || null,
        tipo_carretel,
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
    if (req.file) await guardarFoto(client, ficha.id, req.file, req.usuario.id);
    await client.query('COMMIT');

    ficha.devanados_extra = extras || [];
    res.json(conRutaDeFoto(ficha, !!req.file));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && /modelo/.test(err.constraint || err.detail || '')) {
      return res.status(400).json({ error: `Ya existe un modelo llamado "${modelo}"` });
    }
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
    const TIENE_FOTO = `EXISTS (SELECT 1 FROM ficha_archivos fa
                                WHERE fa.ficha_id = ft.id AND fa.tipo = 'FOTO') AS tiene_foto`;
    if (cliente_id) {
      result = await pool.query(
        `SELECT ft.*, ${TIENE_FOTO} FROM ficha_transformador ft
         WHERE (ft.cliente_id IS NULL OR ft.cliente_id = $1) AND ft.deleted_at IS NULL
         ORDER BY ft.modelo`,
        [cliente_id]
      );
    } else {
      result = await pool.query(
        `SELECT ft.*, ${TIENE_FOTO} FROM ficha_transformador ft
         WHERE ft.deleted_at IS NULL
         ORDER BY ft.modelo`
      );
    }

    const fichas = result.rows.map(f => conRutaDeFoto(f, f.tiene_foto));

    // Las fichas hoy no guardan precios, pero la consulta es SELECT *: si
    // mañana se agrega una columna de precio, al operario no le llega.
    res.json(segunRol(fichas, req.usuario.rol));
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
    // El JOIN a clientes trae cliente_nombre: sin él el detalle mostraba
    // siempre "Modelo genérico", aunque la ficha tuviera cliente.
    const result = await pool.query(
      `SELECT ft.*, c.nombre AS cliente_nombre,
              EXISTS (SELECT 1 FROM ficha_archivos fa
                      WHERE fa.ficha_id = ft.id AND fa.tipo = 'FOTO') AS tiene_foto
       FROM ficha_transformador ft
       LEFT JOIN clientes c ON c.id = ft.cliente_id
       WHERE ft.id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Ficha no encontrada' });
    }

    const ficha = result.rows[0];
    conRutaDeFoto(ficha, ficha.tiene_foto);
    ficha.devanados_extra = await leerExtras(pool, ficha.id);
    ficha.etiquetas = await leerEtiquetas(pool, ficha.id);
    res.json(ficha);
  } catch (err) {
    console.error('Error obteniendo ficha:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   DESCARGAR PDF - Ficha técnica completa, membretada
========================= */
router.get('/:id/pdf', adminYOperario, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ft.*, c.nombre AS cliente_nombre
       FROM ficha_transformador ft
       LEFT JOIN clientes c ON c.id = ft.cliente_id
       WHERE ft.id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Ficha no encontrada' });
    }

    const ficha = result.rows[0];
    ficha.devanados_extra = await leerExtras(pool, ficha.id);

    const foto = await pool.query(
      `SELECT contenido FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'FOTO'`,
      [ficha.id]
    );
    ficha.foto_buffer = foto.rows.length ? foto.rows[0].contenido : null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="Ficha-${nombreArchivo(ficha.modelo, ficha.id)}.pdf"`);
    generarPdfFicha(ficha, res);
  } catch (err) {
    console.error('Error generando PDF de ficha:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* =========================
   ETIQUETAS (PDF) - agregar
   El transformador lleva pegada una etiqueta física, y algunos modelos
   llevan más de una (ej.: primario y secundario por separado); se suben
   acá para poder reimprimirlas más adelante sin rehacerlas.
========================= */
router.post('/:id/etiquetas', adminYOperario, subidaPdf.single('etiqueta'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo de la etiqueta' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Se bloquea la fila de la ficha: dos subidas simultáneas no pasan del tope.
    const ficha = await client.query(
      'SELECT id FROM ficha_transformador WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!ficha.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ficha no encontrada' });
    }

    const cantidad = await client.query(
      `SELECT COUNT(*)::int AS n FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'ETIQUETA'`,
      [req.params.id]
    );
    if (cantidad.rows[0].n >= MAX_ETIQUETAS) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Esta ficha ya tiene el máximo de ${MAX_ETIQUETAS} etiquetas` });
    }

    const r = await client.query(
      `INSERT INTO ficha_archivos (ficha_id, tipo, nombre_original, mime, tamano, contenido, creado_por)
       VALUES ($1, 'ETIQUETA', $2, $3, $4, $5, $6)
       RETURNING id, nombre_original, creado_en`,
      [req.params.id, sanitizarNombreOriginal(req.file.originalname), req.file.mimeDetectado,
       req.file.size, req.file.buffer, req.usuario.id]
    );
    await client.query('COMMIT');

    const fila = r.rows[0];
    res.status(201).json({ ...fila, archivo: rutaEtiqueta(req.params.id, fila.id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error subiendo etiqueta:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   ETIQUETAS (PDF) - quitar una
========================= */
router.delete('/:id/etiquetas/:etiquetaId', adminYOperario, async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM ficha_archivos WHERE id = $1 AND ficha_id = $2 AND tipo = 'ETIQUETA' RETURNING id`,
      [req.params.etiquetaId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error borrando etiqueta:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   ARCHIVOS - servir la foto y las etiquetas (solo con sesión)
========================= */
router.get('/:id/foto', adminYOperario, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT nombre_original, mime, contenido FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'FOTO'`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Esta ficha no tiene foto' });
    enviarArchivo(res, r.rows[0], null);
  } catch (err) {
    console.error('Error sirviendo foto de ficha:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/etiquetas/:etiquetaId/archivo', adminYOperario, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT nombre_original, mime, contenido FROM ficha_archivos
       WHERE id = $1 AND ficha_id = $2 AND tipo = 'ETIQUETA'`,
      [req.params.etiquetaId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    enviarArchivo(res, r.rows[0], 'inline');
  } catch (err) {
    console.error('Error sirviendo etiqueta:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   UPDATE - Actualizar ficha
========================= */
router.put('/:id', adminYOperario, subidaImagen.single('foto'), async (req, res) => {
  const client = await pool.connect();
  try {
    const fichaActual = await client.query(
      'SELECT id FROM ficha_transformador WHERE id = $1',
      [req.params.id]
    );

    if (!fichaActual.rows.length) {
      return res.status(404).json({ error: 'No encontrado' });
    }

    validarTextosFicha(req.body);
    const espirasPrimario = textoCorto(req.body.espiras_primario, 40, 'Las espiras del primario');
    const espirasSecundario = textoCorto(req.body.espiras_secundario, 40, 'Las espiras del secundario');
    const extras = normalizarExtras(req.body.devanados_extra);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE ficha_transformador SET
        modelo=$1, cliente_id=$2, tipo_carretel=$3,
        voltaje_entrada=$4, voltaje_salida=$5, amperaje_entrada=$6, amperaje_salida=$7,
        alambre_primario=$8, diametro_primario_mm=$9, espiras_primario=$10, pines_primario=$11, peso_primario_kg=$12,
        alambre_secundario=$13, diametro_secundario_mm=$14, espiras_secundario=$15, pines_secundario=$16, peso_secundario_kg=$17,
        laminacion=$18, peso_laminacion_kg=$19, observaciones=$20
       WHERE id=$21
       RETURNING *`,
      [
        req.body.modelo,
        req.body.cliente_id || null,
        req.body.tipo_carretel,
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

    // Foto: una nueva reemplaza a la anterior; sin archivo se conserva la que
    // había, salvo que el formulario pida quitarla (quitar_foto=1).
    if (req.file) {
      await guardarFoto(client, req.params.id, req.file, req.usuario.id);
    } else if (req.body.quitar_foto === '1') {
      await client.query(`DELETE FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'FOTO'`, [req.params.id]);
    }
    await client.query('COMMIT');

    const ficha = result.rows[0];
    ficha.devanados_extra = await leerExtras(client, ficha.id);
    const foto = await client.query(
      `SELECT 1 FROM ficha_archivos WHERE ficha_id = $1 AND tipo = 'FOTO'`, [ficha.id]);
    res.json(conRutaDeFoto(ficha, foto.rows.length > 0));
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505' && /modelo/.test(err.constraint || err.detail || '')) {
      return res.status(400).json({ error: `Ya existe un modelo llamado "${req.body.modelo}"` });
    }
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

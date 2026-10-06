const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin, adminYOperario } = require('../middlewares/auth');
const { generarPdfReporte, ANCHO_UTIL_REPORTE } = require('../services/pdf-reporte');
const { fecha } = require('../services/pdf-base');
const { vistaPreviaAnulacionProduccion, anularProduccion } = require('../services/anulaciones');
const { calcularNecesidad, aplicarConsumo } = require('../services/receta');

const COLS_PDF_PRODUCCION = [
  { campo: 'fecha', titulo: 'Fecha', x: 0, ancho: 70 },
  { campo: 'modelo', titulo: 'Modelo', x: 70, ancho: 250 },
  { campo: 'cantidad', titulo: 'Cantidad', x: 320, ancho: 80, align: 'right' },
  { campo: 'registrado_por', titulo: 'Registró', x: 400, ancho: 150 },
  { campo: 'observaciones', titulo: 'Observaciones', x: 550, ancho: ANCHO_UTIL_REPORTE - 550 }
];

router.use(verificarToken);
/* ============================================
   REGISTRAR PRODUCCIÓN
   POST /api/produccion
============================================ */
// Además de sumar al stock de producción, descuenta la materia prima de la
// receta del modelo (cantidad × receta), todo en una sola transacción:
//   - modelo sin receta: produce igual y avisa que no se descontó nada;
//   - si algún material no alcanza y el pedido no trae `confirmar_faltantes: true`,
//     no se registra nada y se responde 409 con el detalle de lo que falta;
//   - confirmado, se descuenta lo que haya (nunca queda stock negativo) y el
//     faltante queda anotado en produccion_consumos.
// Si la receta tiene unidades que no se pueden convertir, se rechaza (400): hay
// que corregir la receta antes de producir.
router.post('/', adminYOperario, async (req, res) => {
  const {
    ficha_id,
    cantidad,
    fecha_produccion,
    observaciones,
    confirmar_faltantes
  } = req.body;

  // hallazgo D4: antes salía de un header o del body, o sea de datos que
  // controla el cliente — cualquiera podía registrar producción a nombre
  // de otro operario. verificarToken (línea 6) ya dejó req.usuario cargado
  // desde la base con el usuario real del token.
  const usuario_id = req.usuario.id;

  if (!ficha_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({
      error: 'Ficha y cantidad son obligatorios'
    });
  }
  // La cantidad son unidades enteras (produccion.cantidad es integer).
  if (!Number.isInteger(Number(cantidad))) {
    return res.status(400).json({ error: 'La cantidad tiene que ser un número entero' });
  }

  // Las observaciones las escribe el operario y las lee el administrador: sin HTML.
  if (observaciones !== undefined && observaciones !== null && /[<>]/.test(String(observaciones))) {
    return res.status(400).json({ error: 'Las observaciones no pueden contener < ni >' });
  }

  const client = await pool.connect();
  try {
    // Verificar que la ficha existe
    const fichaCheck = await client.query(
      'SELECT modelo FROM ficha_transformador WHERE id = $1',
      [ficha_id]
    );

    if (fichaCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Modelo no encontrado' });
    }
    const modelo = fichaCheck.rows[0].modelo;

    await client.query('BEGIN');

    // Insertar producción
    const result = await client.query(
      `INSERT INTO produccion
       (ficha_id, cantidad, fecha_produccion, usuario_id, observaciones)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        ficha_id,
        Number(cantidad),
        fecha_produccion || new Date().toISOString().split('T')[0],
        usuario_id || null,
        observaciones || null
      ]
    );
    const produccion = result.rows[0];

    // Materia prima: lo que pide la receta, contra el stock (con las filas bloqueadas).
    const necesidad = await calcularNecesidad(client, ficha_id, Number(cantidad), { bloquear: true });

    if (necesidad.errores.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `La receta de ${modelo} tiene un problema y no se puede descontar el material: ${necesidad.errores[0]}`,
        codigo: 'RECETA_INVALIDA',
        errores: necesidad.errores
      });
    }

    if (necesidad.faltantes.length && confirmar_faltantes !== true) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Falta material en stock para fabricar esta cantidad',
        codigo: 'FALTA_MATERIA_PRIMA',
        modelo,
        faltantes: necesidad.faltantes
      });
    }

    const consumos = necesidad.tiene_receta
      ? await aplicarConsumo(client, {
          produccionId: produccion.id,
          lineas: necesidad.lineas,
          observaciones: `Producción #${produccion.id} – ${modelo} (${Number(cantidad)} u.)`,
          usuarioId: usuario_id
        })
      : [];

    await client.query('COMMIT');

    // Obtener stock actualizado (usando nueva vista stock_produccion)
    const stockRes = await pool.query(
      'SELECT * FROM stock_produccion WHERE ficha_id = $1',
      [ficha_id]
    );

    const avisos = [...necesidad.avisos];
    if (!necesidad.tiene_receta) {
      avisos.unshift(`${modelo} no tiene receta cargada: no se descontó materia prima.`);
    }
    const faltantesFinales = consumos.filter(c => c.faltante > 0);

    res.json({
      ok: true,
      produccion,
      stock: stockRes.rows[0] || { stock_actual: 0 },
      consumos,
      faltantes: faltantesFinales,
      avisos,
      mensaje: `✅ Registrados ${cantidad} unidades de ${modelo}`
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error registrando producción:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ============================================
   LISTAR PRODUCCIÓN (CON FILTROS)
   GET /api/produccion?ficha_id=1&desde=2024-01-01&hasta=2024-12-31
============================================ */
router.get('/', adminYOperario, async (req, res) => {
  // Sin paginación real: el filtro por fecha acota el volumen en el uso
  // normal (ver docs/claude/modulo-reportes.md). limit es solo una
  // salvaguarda, no un mecanismo de recorte.
  const { ficha_id, desde, hasta, limit = 5000 } = req.query;

  try {
    let query = `
      SELECT 
        p.id,
        p.cantidad,
        p.fecha_produccion,
        p.observaciones,
        p.created_at,
        f.id as ficha_id,
        f.modelo,
        u.nombre_usuario as registrado_por
      FROM produccion p
      JOIN ficha_transformador f ON f.id = p.ficha_id
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCounter = 1;

    if (ficha_id) {
      query += ` AND p.ficha_id = $${paramCounter}`;
      params.push(ficha_id);
      paramCounter++;
    }

    if (desde) {
      query += ` AND p.fecha_produccion >= $${paramCounter}`;
      params.push(desde);
      paramCounter++;
    }

    if (hasta) {
      query += ` AND p.fecha_produccion <= $${paramCounter}`;
      params.push(hasta);
      paramCounter++;
    }

    query += ` ORDER BY p.fecha_produccion DESC, p.id DESC LIMIT $${paramCounter}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    console.error('Error listando producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   PDF DEL INFORME DE PRODUCCIÓN (mismos filtros que GET /)
   GET /api/produccion/reporte/pdf?ficha_id=&desde=&hasta=
============================================ */
router.get('/reporte/pdf', adminYOperario, async (req, res) => {
  const { ficha_id, desde, hasta } = req.query;

  try {
    let query = `
      SELECT
        p.cantidad, p.fecha_produccion, p.observaciones,
        f.modelo,
        u.nombre_usuario as registrado_por
      FROM produccion p
      JOIN ficha_transformador f ON f.id = p.ficha_id
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE 1=1
    `;
    const params = [];
    let paramCounter = 1;

    if (ficha_id) {
      query += ` AND p.ficha_id = $${paramCounter++}`;
      params.push(ficha_id);
    }
    if (desde) {
      query += ` AND p.fecha_produccion >= $${paramCounter++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND p.fecha_produccion <= $${paramCounter++}`;
      params.push(hasta);
    }
    query += ` ORDER BY p.fecha_produccion DESC, p.id DESC LIMIT 5000`;

    const result = await pool.query(query, params);

    const filtros = [];
    if (desde || hasta) filtros.push(`Período: ${desde ? fecha(desde) : 'inicio'} a ${hasta ? fecha(hasta) : 'hoy'}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="produccion-${desde || 'todo'}_a_${hasta || 'hoy'}.pdf"`);
    generarPdfReporte({
      titulo: 'Informe de producción',
      filtrosTexto: filtros.join(' · ') || undefined,
      cols: COLS_PDF_PRODUCCION,
      filas: result.rows,
      armarCelda: (r) => ({
        fecha: fecha(r.fecha_produccion),
        modelo: r.modelo || '—',
        cantidad: Number(r.cantidad).toLocaleString('es-AR'),
        registrado_por: r.registrado_por || '—',
        observaciones: r.observaciones || '—'
      })
    }, res);
  } catch (err) {
    console.error('Error generando PDF de producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   OBTENER STOCK ACTUAL DE PRODUCCIÓN
   GET /api/produccion/stock
============================================ */
router.get('/stock', adminYOperario, async (req, res) => {
  const { con_stock, solo_genericos, cliente_id } = req.query;

  try {
    // La vista stock_produccion no filtra deleted_at: sin esto un modelo
    // eliminado seguía apareciendo en el stock de producción.
    let query = `SELECT * FROM stock_produccion
                 WHERE ficha_id IN (SELECT id FROM ficha_transformador WHERE deleted_at IS NULL)`;
    const params = [];
    let paramCounter = 1;

    if (con_stock === 'true') {
      query += ` AND stock_actual > 0`;
    }

    if (solo_genericos === 'true') {
      query += ` AND cliente_id IS NULL`;
    }

    if (cliente_id) {
      query += ` AND (cliente_id = $${paramCounter} OR cliente_id IS NULL)`;
      params.push(cliente_id);
      paramCounter++;
    }

    query += ` ORDER BY modelo`;

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    console.error('Error obteniendo stock de producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   OBTENER STOCK DE UN MODELO ESPECÍFICO
   GET /api/produccion/stock/:ficha_id
============================================ */
router.get('/stock/:ficha_id', adminYOperario, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM stock_produccion WHERE ficha_id = $1',
      [req.params.ficha_id]
    );

    if (result.rows.length === 0) {
      // Si no hay en la vista, obtener datos básicos
      const fichaRes = await pool.query(
        'SELECT id as ficha_id, modelo, cliente_id FROM ficha_transformador WHERE id = $1',
        [req.params.ficha_id]
      );

      if (fichaRes.rows.length === 0) {
        return res.status(404).json({ error: 'Modelo no encontrado' });
      }

      return res.json({
        ficha_id: parseInt(req.params.ficha_id),
        modelo: fichaRes.rows[0].modelo,
        producido_total: 0,
        entregado_total: 0,
        stock_actual: 0
      });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error('Error obteniendo stock de producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   REPORTE DE PRODUCCIÓN VS ENTREGAS
   GET /api/produccion/reporte?desde=&hasta=
============================================ */
// El reporte consolidado es del admin: el operario carga y consulta stock.
router.get('/reporte', soloAdmin, async (req, res) => {
  const { desde, hasta } = req.query;

  try {
    let query = `
      SELECT 
        f.id as ficha_id,
        f.modelo,
        COALESCE((
          SELECT SUM(p.cantidad) 
          FROM produccion p 
          WHERE p.ficha_id = f.id
    `;

    const params = [];
    let paramCounter = 1;

    if (desde || hasta) {
      query += ` AND (`;
      if (desde) {
        query += ` p.fecha_produccion >= $${paramCounter}`;
        params.push(desde);
        paramCounter++;
      }
      if (desde && hasta) {
        query += ` AND`;
      }
      if (hasta) {
        query += ` p.fecha_produccion <= $${paramCounter}`;
        params.push(hasta);
        paramCounter++;
      }
      query += `)`;
    }

    query += `
        ), 0) as producido_periodo,
        COALESCE((
          SELECT SUM(vi.cantidad) 
          FROM venta_items vi
          JOIN ventas v ON v.id = vi.venta_id
          WHERE vi.ficha_id = f.id
    `;

    if (desde || hasta) {
      query += ` AND (`;
      if (desde) {
        query += ` v.fecha >= $${paramCounter}`;
        params.push(desde);
        paramCounter++;
      }
      if (desde && hasta) {
        query += ` AND`;
      }
      if (hasta) {
        query += ` v.fecha <= $${paramCounter}`;
        params.push(hasta);
        paramCounter++;
      }
      query += `)`;
    }

    query += `
        ), 0) as entregado_periodo,
        COALESCE((
          SELECT SUM(p.cantidad) 
          FROM produccion p 
          WHERE p.ficha_id = f.id
        ), 0) as producido_total,
        COALESCE((
          SELECT SUM(vi.cantidad) 
          FROM venta_items vi 
          WHERE vi.ficha_id = f.id
        ), 0) as entregado_total,
        (
          COALESCE((
            SELECT SUM(p.cantidad)
            FROM produccion p
            WHERE p.ficha_id = f.id
          ), 0)
          -
          COALESCE((
            SELECT SUM(vi.cantidad)
            FROM venta_items vi
            WHERE vi.ficha_id = f.id
          ), 0)
        ) as stock_actual
      FROM ficha_transformador f
      ORDER BY f.modelo
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    console.error('Error generando reporte:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   ANULAR UNA CARGA DE PRODUCCIÓN (se cargó por error, por ejemplo duplicada)
   GET  /api/produccion/:id/anulacion-preview
   POST /api/produccion/:id/anular   { motivo, confirmar_numero }
   Solo admin. No se puede anular si después quedaría stock negativo (ya se
   entregaron esas unidades): primero hay que anular el remito.
============================================ */
router.get('/:id(\\d+)/anulacion-preview', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await vistaPreviaAnulacionProduccion(client, req.params.id));
  } catch (err) {
    if (!err.status) console.error('Error en vista previa de anulación (PRODUCCION):', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo preparar la anulación' });
  } finally {
    client.release();
  }
});

router.post('/:id(\\d+)/anular', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await anularProduccion(client, req.params.id, {
      motivo: req.body.motivo,
      confirmar_numero: req.body.confirmar_numero,
      usuario: req.usuario
    });
    await client.query('COMMIT');
    res.json({
      message: `Producción N° ${r.identificador} anulada: se descontaron ${r.unidades_descontadas} unidad(es) de ${r.modelo}. Stock actual: ${r.stock_restante}.`,
      ...r
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('Error anulando PRODUCCION:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo anular la producción' });
  } finally {
    client.release();
  }
});

module.exports = router;

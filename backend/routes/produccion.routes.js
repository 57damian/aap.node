const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin, adminYOperario } = require('../middlewares/auth');
const { generarPdfReporte, ANCHO_UTIL_REPORTE } = require('../services/pdf-reporte');
const { fecha } = require('../services/pdf-base');
const { aplicarMovimientoStock } = require('../services/stock-movimientos');
const { vistaPreviaAnulacionProduccion, anularProduccion } = require('../services/anulaciones');

/**
 * Valida y normaliza el array `materiales` de POST /api/produccion (consumo
 * de materia prima por esta carga). Tira un Error con `.status = 400` ante
 * cualquier dato inválido — no "arregla" cantidades negativas con Math.abs(),
 * porque eso ocultaría un error de carga real.
 */
function validarMateriales(materiales) {
  if (materiales === undefined || materiales === null) return [];
  if (!Array.isArray(materiales)) {
    const err = new Error('materiales tiene que ser un array');
    err.status = 400;
    throw err;
  }

  const vistos = new Set();
  const limpios = materiales.map((item) => {
    const item_ = item || {};
    const materiaPrimaId = item_.materia_prima_id;
    if (!materiaPrimaId) {
      const err = new Error('Cada material necesita materia_prima_id');
      err.status = 400;
      throw err;
    }
    if (vistos.has(materiaPrimaId)) {
      const err = new Error(`El material ${materiaPrimaId} está repetido — sumá las cantidades en una sola fila`);
      err.status = 400;
      throw err;
    }
    vistos.add(materiaPrimaId);

    const aNumero = (v) => (v === undefined || v === null || v === '') ? 0 : Number(v);
    const usada = aNumero(item_.cantidad_usada);
    const desperdiciada = aNumero(item_.cantidad_desperdiciada);

    if (!Number.isFinite(usada) || usada < 0 || !Number.isFinite(desperdiciada) || desperdiciada < 0) {
      const err = new Error('Las cantidades usada y desperdiciada tienen que ser números mayores o iguales a cero');
      err.status = 400;
      throw err;
    }
    if (usada === 0 && desperdiciada === 0) {
      const err = new Error('Cada fila de material necesita alguna cantidad usada o desperdiciada');
      err.status = 400;
      throw err;
    }
    if (item_.observaciones !== undefined && item_.observaciones !== null && /[<>]/.test(String(item_.observaciones))) {
      const err = new Error('Las observaciones de material no pueden contener < ni >');
      err.status = 400;
      throw err;
    }

    return {
      materia_prima_id: materiaPrimaId,
      cantidad_usada: usada,
      cantidad_desperdiciada: desperdiciada,
      observaciones: item_.observaciones || null
    };
  });

  // Orden ascendente por materia_prima_id: si dos cargas de producción se
  // registran a la vez y comparten materiales, siempre piden los locks
  // (FOR UPDATE en aplicarMovimientoStock) en el mismo orden global, así
  // se evita un deadlock entre las dos transacciones.
  limpios.sort((a, b) => a.materia_prima_id - b.materia_prima_id);
  return limpios;
}

const COLS_PDF_PRODUCCION = [
  { campo: 'fecha', titulo: 'Fecha', x: 0, ancho: 70 },
  { campo: 'modelo', titulo: 'Modelo', x: 70, ancho: 250 },
  { campo: 'cantidad', titulo: 'Cantidad', x: 320, ancho: 80, align: 'right' },
  { campo: 'registrado_por', titulo: 'Registró', x: 400, ancho: 150 },
  { campo: 'observaciones', titulo: 'Observaciones', x: 550, ancho: ANCHO_UTIL_REPORTE - 550 }
];

const COLS_PDF_MATERIALES_INFORME = [
  { campo: 'material', titulo: 'Material', x: 0, ancho: 220 },
  { campo: 'usado', titulo: 'Usado', x: 220, ancho: 120, align: 'right' },
  { campo: 'desperdiciado', titulo: 'Desperdiciado', x: 340, ancho: 120, align: 'right' },
  { campo: 'porcentaje_merma', titulo: '% Merma', x: 460, ancho: ANCHO_UTIL_REPORTE - 460, align: 'right' }
];

/**
 * GET /api/produccion/materiales-informe: consumo agregado por material en
 * un rango de fechas (para evaluar compras — ver docs/claude/modulo-reportes.md).
 * Siempre filtra sm.produccion_id IS NOT NULL: una merma manual cargada
 * desde el Ajuste de Stock (botón "Vaciar") nunca entra acá, este informe
 * es específicamente sobre consumo de producción. También excluye
 * producciones anuladas (y de paso sus movimientos de reversión, que
 * quedan ligados a esa misma producción ya anulada).
 */
function construirQueryMaterialesInforme(req) {
  const { desde, hasta, ficha_id, materia_prima_id } = req.query;
  let inner = `
    SELECT
      mp.id AS materia_prima_id, mp.codigo, mp.nombre, mp.unidad_medida,
      COALESCE(SUM(ABS(sm.cantidad)) FILTER (WHERE sm.tipo_movimiento = 'SALIDA'), 0) AS total_usado,
      COALESCE(SUM(ABS(sm.cantidad)) FILTER (WHERE sm.tipo_movimiento = 'MERMA'), 0) AS total_desperdiciado
    FROM stock_movimientos sm
    JOIN materias_primas mp ON mp.id = sm.materia_prima_id
    JOIN produccion p ON p.id = sm.produccion_id
    WHERE sm.produccion_id IS NOT NULL AND p.anulada_en IS NULL
  `;
  const params = [];
  if (ficha_id) { params.push(ficha_id); inner += ` AND p.ficha_id = $${params.length}`; }
  if (materia_prima_id) { params.push(materia_prima_id); inner += ` AND sm.materia_prima_id = $${params.length}`; }
  if (desde) { params.push(desde); inner += ` AND sm.fecha_movimiento >= $${params.length}`; }
  if (hasta) { params.push(hasta); inner += ` AND sm.fecha_movimiento <= $${params.length}`; }
  inner += ` GROUP BY mp.id, mp.codigo, mp.nombre, mp.unidad_medida`;

  const query = `
    SELECT *, ROUND(total_desperdiciado / NULLIF(total_usado + total_desperdiciado, 0) * 100, 1) AS porcentaje_merma
    FROM (${inner}) sub
    ORDER BY nombre
  `;
  return { query, params };
}

router.use(verificarToken);
/* ============================================
   REGISTRAR PRODUCCIÓN
   POST /api/produccion
============================================ */
router.post('/', adminYOperario, async (req, res) => {
  const {
    ficha_id,
    cantidad,
    fecha_produccion,
    observaciones,
    materiales
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

  // Las observaciones las escribe el operario y las lee el administrador: sin HTML.
  if (observaciones !== undefined && observaciones !== null && /[<>]/.test(String(observaciones))) {
    return res.status(400).json({ error: 'Las observaciones no pueden contener < ni >' });
  }

  // `materiales` es opcional (30/09/2026): consumo de materia prima de esta
  // carga, cargado a mano porque todavía no hay receta por modelo. Se valida
  // antes de tocar la base, sin abrir transacción, para fallar rápido.
  let materialesValidados;
  try {
    materialesValidados = validarMateriales(materiales);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const fechaLote = fecha_produccion || new Date().toISOString().split('T')[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que la ficha existe
    const fichaCheck = await client.query(
      'SELECT modelo FROM ficha_transformador WHERE id = $1',
      [ficha_id]
    );
    if (fichaCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Modelo no encontrado' });
    }

    // Insertar producción
    const result = await client.query(
      `INSERT INTO produccion
       (ficha_id, cantidad, fecha_produccion, usuario_id, observaciones)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ficha_id, cantidad, fechaLote, usuario_id || null, observaciones || null]
    );
    const produccionId = result.rows[0].id;

    // Consumo de materiales: SALIDA (usado) y/o MERMA (desperdiciado) por
    // cada material, ligados a esta producción. Si falta stock de alguno,
    // aplicarMovimientoStock tira un error con .status=400 y se hace
    // ROLLBACK de todo — incluida la fila de producción recién insertada:
    // nunca puede quedar una carga registrada con el consumo a medio cargar.
    for (const m of materialesValidados) {
      if (m.cantidad_usada > 0) {
        await aplicarMovimientoStock(client, {
          materiaPrimaId: m.materia_prima_id,
          tipoMovimiento: 'SALIDA',
          delta: -m.cantidad_usada,
          observaciones: m.observaciones,
          usuarioId: usuario_id,
          fechaMovimiento: fechaLote,
          produccionId
        });
      }
      if (m.cantidad_desperdiciada > 0) {
        await aplicarMovimientoStock(client, {
          materiaPrimaId: m.materia_prima_id,
          tipoMovimiento: 'MERMA',
          delta: -m.cantidad_desperdiciada,
          observaciones: m.observaciones,
          usuarioId: usuario_id,
          fechaMovimiento: fechaLote,
          produccionId
        });
      }
    }

    await client.query('COMMIT');

    // Obtener stock actualizado (usando nueva vista stock_produccion)
    const stockRes = await pool.query(
      'SELECT * FROM stock_produccion WHERE ficha_id = $1',
      [ficha_id]
    );

    res.json({
      ok: true,
      produccion: result.rows[0],
      stock: stockRes.rows[0] || { stock_actual: 0 },
      mensaje: `✅ Registrados ${cantidad} unidades de ${fichaCheck.rows[0].modelo}`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
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
      WHERE p.anulada_en IS NULL
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
      WHERE p.anulada_en IS NULL
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
    let query = `SELECT * FROM stock_produccion WHERE 1=1`;
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
          WHERE p.ficha_id = f.id AND p.anulada_en IS NULL
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
          WHERE p.ficha_id = f.id AND p.anulada_en IS NULL
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
            WHERE p.ficha_id = f.id AND p.anulada_en IS NULL
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
   CONSUMO DE MATERIALES POR CARGA DE PRODUCCIÓN
   GET /api/produccion/:id/materiales — detalle de una carga puntual
============================================ */
router.get('/:id/materiales', adminYOperario, async (req, res) => {
  try {
    // Columnas explícitas de materias_primas (sin precio_referencia): esto
    // lo puede pedir un operario, que no ve precios.
    const result = await pool.query(`
      SELECT sm.tipo_movimiento, sm.cantidad, sm.unidad, sm.observaciones,
             mp.id AS materia_prima_id, mp.codigo, mp.nombre, mp.unidad_medida
      FROM stock_movimientos sm
      JOIN materias_primas mp ON mp.id = sm.materia_prima_id
      WHERE sm.produccion_id = $1
      ORDER BY sm.tipo_movimiento, mp.nombre
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo consumo de materiales de la producción:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   INFORME DE CONSUMO DE MATERIALES (agregado)
   GET /api/produccion/materiales-informe?desde=&hasta=&ficha_id=&materia_prima_id=
============================================ */
router.get('/materiales-informe', soloAdmin, async (req, res) => {
  try {
    const { query, params } = construirQueryMaterialesInforme(req);
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /produccion/materiales-informe:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/materiales-informe/pdf', soloAdmin, async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const { query, params } = construirQueryMaterialesInforme(req);
    const result = await pool.query(query, params);

    const filtros = [];
    if (desde || hasta) filtros.push(`Período: ${desde ? fecha(desde) : 'inicio'} a ${hasta ? fecha(hasta) : 'hoy'}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="consumo-materiales-${desde || 'todo'}_a_${hasta || 'hoy'}.pdf"`);
    generarPdfReporte({
      titulo: 'Consumo de materiales por producción',
      filtrosTexto: filtros.join(' · ') || undefined,
      cols: COLS_PDF_MATERIALES_INFORME,
      filas: result.rows,
      armarCelda: (r) => ({
        material: `${r.nombre || '—'}${r.codigo ? ' (' + r.codigo + ')' : ''}`,
        usado: `${Number(r.total_usado).toLocaleString('es-AR')} ${r.unidad_medida || ''}`,
        desperdiciado: `${Number(r.total_desperdiciado).toLocaleString('es-AR')} ${r.unidad_medida || ''}`,
        porcentaje_merma: r.porcentaje_merma != null ? `${r.porcentaje_merma}%` : '—'
      })
    }, res);
  } catch (err) {
    console.error('Error generando PDF de consumo de materiales:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   ANULACIÓN DE PRODUCCIÓN
   No hay "editar" una carga de producción — mismo criterio que facturas/
   remitos/OC (CLAUDE.md, "Anular facturas, remitos y OC"): para corregir
   una carga mal cargada se anula (revierte el material al stock) y se
   vuelve a cargar bien.
============================================ */
router.get('/:id/anulacion-preview', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await vistaPreviaAnulacionProduccion(client, req.params.id));
  } catch (err) {
    if (!err.status) console.error('Error en vista previa de anulación (PRODUCCIÓN):', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo preparar la anulación' });
  } finally {
    client.release();
  }
});

router.post('/:id/anular', soloAdmin, async (req, res) => {
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
      message: `Producción #${r.identificador} anulada. ${r.movimientos_revertidos} movimiento(s) de stock revertido(s).`,
      ...r
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('Error anulando PRODUCCIÓN:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo anular la producción' });
  } finally {
    client.release();
  }
});

/* ============================================
   HISTORIAL DE ANULACIONES DE PRODUCCIÓN
   GET /api/produccion/anulaciones
============================================ */
router.get('/anulaciones', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.cantidad, p.fecha_produccion, p.anulada_en, p.motivo_anulacion,
             f.modelo, u.nombre_usuario AS anulada_por_nombre
      FROM produccion p
      JOIN ficha_transformador f ON f.id = p.ficha_id
      LEFT JOIN usuarios u ON u.id = p.anulada_por
      WHERE p.anulada_en IS NOT NULL
      ORDER BY p.anulada_en DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listando anulaciones de producción:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

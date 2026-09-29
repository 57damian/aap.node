const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { fecha: fmtFecha, money } = require('../services/pdf-base');
const { generarPdfReporte, ANCHO_UTIL_REPORTE } = require('../services/pdf-reporte');

const COLS_PDF_HIST_PRECIOS_MP = [
  { campo: 'fecha', titulo: 'Fecha', x: 0, ancho: 60 },
  { campo: 'material', titulo: 'Material', x: 60, ancho: 170 },
  { campo: 'proveedor', titulo: 'Proveedor', x: 230, ancho: 130 },
  { campo: 'precio_anterior', titulo: 'Precio anterior', x: 360, ancho: 90, align: 'right' },
  { campo: 'precio_nuevo', titulo: 'Precio nuevo', x: 450, ancho: 90, align: 'right' },
  { campo: 'variacion', titulo: 'Variación', x: 540, ancho: 70, align: 'right' },
  { campo: 'factura', titulo: 'N° Factura', x: 610, ancho: ANCHO_UTIL_REPORTE - 610 }
];

// Todas las rutas requieren autenticación
router.use(verificarToken);

/**
 * GET /api/materias-primas
 * Lista materias primas con filtros opcionales
 * Query params: search, activo, proveedor_id, con_stock
 */
// soloAdmin: este listado trae el precio de referencia y el proveedor de cada
// material. Era el último endpoint que había quedado sin control de rol
// (hallazgo S7), así que cualquier usuario logueado lo leía entero.
// El operario consulta cantidades por GET /api/stock, que sale filtrado.
router.get('/', soloAdmin, async (req, res) => {
  try {
    const { search, activo = 'true', proveedor_id, con_stock } = req.query;

    let query = `
      SELECT 
        mp.id, mp.codigo, mp.nombre, mp.descripcion, mp.unidad_medida,
        mp.stock_actual, mp.stock_minimo, mp.ubicacion, mp.activo,
        mp.precio_referencia as ultimo_precio
      FROM materias_primas mp
      WHERE mp.activo = $1
    `;
    const params = [activo === 'true'];
    let paramIndex = 2;

    if (search) {
      query += ` AND (mp.codigo ILIKE $${paramIndex} OR mp.nombre ILIKE $${paramIndex} OR mp.descripcion ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (proveedor_id) {
      // Filtrar materias primas que tengan movimientos de stock de ese proveedor
      // (stock_movimientos.proveedor_id, que es lo que factura-compra.routes.js
      // completa realmente en cada compra; compra_items/compras es un esquema
      // viejo ya sin uso, ver "Auditoría — Módulo Stock" en el doc del proyecto)
      query += ` AND EXISTS (SELECT 1 FROM stock_movimientos sm
                WHERE sm.materia_prima_id = mp.id AND sm.proveedor_id = $${paramIndex})`;
      params.push(proveedor_id);
      paramIndex++;
    }

    if (con_stock === 'true') {
      query += ` AND mp.stock_actual > 0`;
    }

    query += ` ORDER BY mp.nombre`;

    const result = await pool.query(query, params);
    
    // Agregar campo calculado valor_total y estado_stock
    const rows = result.rows.map(item => ({
      ...item,
      valor_total: (item.stock_actual || 0) * (item.ultimo_precio || 0),
      estado_stock: item.stock_actual === 0 ? 'CRITICO' :
                    item.stock_actual <= item.stock_minimo ? 'BAJO' : 'NORMAL'
    }));

    res.json(rows);
  } catch (err) {
    console.error('Error en GET /materias-primas:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   HISTORIAL DE PRECIOS DE COMPRA — TODOS LOS MATERIALES
   GET /api/materias-primas/historial-precios?materia_prima_id=&proveedor_id=&desde=&hasta=
   Vista agregada (a diferencia de /:id/historial-precios, que es por
   material): informe de "rutas de aumento" de compra, ver
   docs/claude/modulo-reportes.md.
   IMPORTANTE: va antes de GET /:id — si no, "historial-precios" matchea
   como si fuera un :id y esta ruta nunca se alcanza.
============================================ */
function construirQueryHistorialPreciosMP(req) {
  const { materia_prima_id, proveedor_id, desde, hasta } = req.query;
  let query = `
    SELECT
      hpm.precio_nuevo, hpm.precio_anterior,
      hpm.precio_nuevo_usd, hpm.precio_anterior_usd,
      hpm.variacion_porcentaje, hpm.fecha_cambio,
      mp.nombre as material_nombre, mp.codigo as material_codigo,
      fc.numero_factura as factura_numero,
      p.nombre as proveedor_nombre
    FROM historial_precios_materias hpm
    JOIN materias_primas mp ON mp.id = hpm.materia_prima_id
    LEFT JOIN facturas_compra fc ON hpm.factura_id = fc.id
    LEFT JOIN proveedores p ON hpm.proveedor_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (materia_prima_id) { params.push(materia_prima_id); query += ` AND hpm.materia_prima_id = $${params.length}`; }
  if (proveedor_id) { params.push(proveedor_id); query += ` AND hpm.proveedor_id = $${params.length}`; }
  if (desde) { params.push(desde); query += ` AND hpm.fecha_cambio >= $${params.length}`; }
  if (hasta) { params.push(hasta); query += ` AND hpm.fecha_cambio <= $${params.length}`; }
  query += ` ORDER BY hpm.fecha_cambio DESC, hpm.id DESC LIMIT 5000`;
  return { query, params };
}

router.get('/historial-precios', soloAdmin, async (req, res) => {
  try {
    const { query, params } = construirQueryHistorialPreciosMP(req);
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /materias-primas/historial-precios:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/historial-precios/pdf', soloAdmin, async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const { query, params } = construirQueryHistorialPreciosMP(req);
    const result = await pool.query(query, params);

    const filtros = [];
    if (desde || hasta) filtros.push(`Período: ${desde ? fmtFecha(desde) : 'inicio'} a ${hasta ? fmtFecha(hasta) : 'hoy'}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="precios-compra-${desde || 'todo'}_a_${hasta || 'hoy'}.pdf"`);
    generarPdfReporte({
      titulo: 'Evolución de precios de compra (materias primas)',
      filtrosTexto: filtros.join(' · ') || undefined,
      cols: COLS_PDF_HIST_PRECIOS_MP,
      filas: result.rows,
      armarCelda: (r) => ({
        fecha: fmtFecha(r.fecha_cambio),
        material: `${r.material_nombre || '—'}${r.material_codigo ? ' (' + r.material_codigo + ')' : ''}`,
        proveedor: r.proveedor_nombre || '—',
        precio_anterior: r.precio_anterior != null ? money(r.precio_anterior) : '—',
        precio_nuevo: money(r.precio_nuevo),
        variacion: r.variacion_porcentaje != null ? `${Number(r.variacion_porcentaje) > 0 ? '+' : ''}${Number(r.variacion_porcentaje).toFixed(1)}%` : '—',
        factura: r.factura_numero || '—'
      })
    }, res);
  } catch (err) {
    console.error('Error generando PDF de precios de compra:', err);
    res.status(500).json({ error: err.message });
  }
});

  /**
   * GET /api/materias-primas/:id
   * Obtener una materia prima por ID
   */
  router.get('/:id', soloAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`
        SELECT 
          mp.*,
          (SELECT json_agg(hpm ORDER BY hpm.fecha_cambio DESC) 
           FROM historial_precios_materias hpm 
           WHERE hpm.materia_prima_id = mp.id) as historial_precios
        FROM materias_primas mp
        WHERE mp.id = $1
      `, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Materia prima no encontrada' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error en GET /materias-primas/:id:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/materias-primas
   * Crear nueva materia prima
   */
  router.post('/', soloAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo, nombre, descripcion, unidad_medida, stock_minimo = 0, ubicacion, precio_referencia } = req.body;

      if (!nombre || !unidad_medida) {
        return res.status(400).json({ error: 'Nombre y unidad de medida son obligatorios' });
      }

      await client.query('BEGIN');

      const result = await client.query(`
        INSERT INTO materias_primas 
          (codigo, nombre, descripcion, unidad_medida, stock_minimo, ubicacion, precio_referencia, activo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        RETURNING *
      `, [codigo || null, nombre, descripcion || null, unidad_medida, stock_minimo, ubicacion || null, precio_referencia || null]);

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error en POST /materias-primas:', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  /**
   * PUT /api/materias-primas/:id
   * Actualizar materia prima
   */
  router.put('/:id', soloAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { codigo, nombre, descripcion, unidad_medida, stock_minimo, ubicacion, precio_referencia, activo } = req.body;

      // Verificar que existe
      const check = await client.query('SELECT id FROM materias_primas WHERE id = $1', [id]);
      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'Materia prima no encontrada' });
      }

      await client.query('BEGIN');

      const result = await client.query(`
        UPDATE materias_primas SET
          codigo = COALESCE($1, codigo),
          nombre = COALESCE($2, nombre),
          descripcion = COALESCE($3, descripcion),
          unidad_medida = COALESCE($4, unidad_medida),
          stock_minimo = COALESCE($5, stock_minimo),
          ubicacion = COALESCE($6, ubicacion),
          precio_referencia = COALESCE($7, precio_referencia),
          activo = COALESCE($8, activo),
          actualizado_en = NOW()
        WHERE id = $9
        RETURNING *
      `, [codigo, nombre, descripcion, unidad_medida, stock_minimo, ubicacion, precio_referencia, activo, id]);

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error en PUT /materias-primas/:id:', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

/**
 * DELETE /api/materias-primas/:id
 * Desactivar materia prima (soft delete)
 */
router.delete('/:id', soloAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE materias_primas SET activo = false WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Materia prima desactivada' });
  } catch (err) {
    console.error('Error en DELETE /materias-primas/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

  /**
   * GET /api/materias-primas/:id/historial-precios
   * Obtener historial de precios de una materia prima
   */
  router.get('/:id/historial-precios', soloAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { desde, hasta } = req.query;

      const params = [id];
      let filtroFecha = '';
      if (desde) { params.push(desde); filtroFecha += ` AND hpm.fecha_cambio >= $${params.length}`; }
      if (hasta) { params.push(hasta); filtroFecha += ` AND hpm.fecha_cambio <= $${params.length}`; }

      const result = await pool.query(`
        SELECT
          hpm.id,
          hpm.precio_nuevo,
          hpm.precio_anterior,
          hpm.precio_nuevo_usd,
          hpm.precio_anterior_usd,
          hpm.variacion_porcentaje,
          hpm.fecha_cambio,
          fc.numero_factura as factura_numero,
          p.nombre as proveedor_nombre,
          u.nombre_completo as usuario_nombre
        FROM historial_precios_materias hpm
        LEFT JOIN facturas_compra fc ON hpm.factura_id = fc.id
        LEFT JOIN proveedores p ON hpm.proveedor_id = p.id
        LEFT JOIN usuarios u ON hpm.created_by = u.id
        WHERE hpm.materia_prima_id = $1 ${filtroFecha}
        ORDER BY hpm.fecha_cambio DESC, hpm.created_at DESC
      `, params);

      res.json(result.rows);
    } catch (err) {
      console.error('Error en GET /materias-primas/:id/historial-precios:', err);
      res.status(500).json({ error: err.message });
    }
  });

module.exports = router;

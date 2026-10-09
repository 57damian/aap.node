const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { fecha: fmtFecha, money } = require('../services/pdf-base');
const { generarPdfReporte, ANCHO_UTIL_REPORTE } = require('../services/pdf-reporte');

const COLS_PDF_PRECIOS_MODELO = [
  { campo: 'fecha', titulo: 'Fecha', x: 0, ancho: 65 },
  { campo: 'modelo', titulo: 'Modelo', x: 65, ancho: 200 },
  { campo: 'precio', titulo: 'Precio (USD)', x: 265, ancho: 90, align: 'right' },
  { campo: 'variacion', titulo: 'Variación', x: 355, ancho: 70, align: 'right' },
  { campo: 'observaciones', titulo: 'Observaciones', x: 425, ancho: ANCHO_UTIL_REPORTE - 425 }
];

const COLS_PDF_DOLAR = [
  { campo: 'fecha', titulo: 'Fecha', x: 0, ancho: 120 },
  { campo: 'dolar', titulo: 'Cotización', x: 120, ancho: 100, align: 'right' },
  { campo: 'usuario', titulo: 'Usuario', x: 220, ancho: ANCHO_UTIL_REPORTE - 220 }
];

router.use(verificarToken);

/* =========================
   1️⃣ PRECIOS ACTUALES
========================= */
router.get('/actuales', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        f.id AS ficha_id,
        f.modelo,
        (
          SELECT pm.precio
          FROM precios_modelo pm
          WHERE pm.ficha_id = f.id
          ORDER BY pm.fecha_desde DESC, pm.id DESC
          LIMIT 1
        ) AS precio_usd,
        (
          SELECT pm.fecha_desde
          FROM precios_modelo pm
          WHERE pm.ficha_id = f.id
          ORDER BY pm.fecha_desde DESC, pm.id DESC
          LIMIT 1
        ) AS fecha_desde
      FROM ficha_transformador f
      WHERE f.deleted_at IS NULL
      ORDER BY f.modelo;
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   2️⃣ NUEVO PRECIO MODELO
========================= */
router.post('/modelo', soloAdmin, async (req, res) => {
  const { ficha_id, precio, observaciones } = req.body;

  if (!ficha_id || !precio) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO precios_modelo
       (ficha_id, precio, fecha_desde, observaciones)
       VALUES ($1,$2,NOW(),$3)
       RETURNING *`,
      [ficha_id, precio, observaciones]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   3️⃣ HISTORIAL DE PRECIOS DE VENTA — TODOS LOS MODELOS
   GET /api/precios/modelo/historial?ficha_id=&desde=&hasta=
   Vista agregada para el informe de "rutas de aumento" de venta (ver
   docs/claude/modulo-reportes.md). precios_modelo no tiene columna de
   variación propia (a diferencia de historial_precios_materias): se
   calcula acá con LAG() contra la fila anterior de CADA modelo.
   IMPORTANTE: va antes de GET /modelo/:ficha_id — si no, "historial"
   matchea como si fuera un :ficha_id y esta ruta nunca se alcanza.
========================= */
function construirQueryHistorialPreciosModelo(req) {
  const { ficha_id, desde, hasta } = req.query;
  let query = `
    SELECT * FROM (
      SELECT
        pm.ficha_id, pm.precio AS precio_usd, pm.fecha_desde, pm.observaciones,
        f.modelo,
        ROUND(
          (pm.precio - LAG(pm.precio) OVER (PARTITION BY pm.ficha_id ORDER BY pm.fecha_desde, pm.id))
          / NULLIF(LAG(pm.precio) OVER (PARTITION BY pm.ficha_id ORDER BY pm.fecha_desde, pm.id), 0) * 100
        , 1) AS variacion_porcentaje
      FROM precios_modelo pm
      JOIN ficha_transformador f ON f.id = pm.ficha_id
    ) q
    WHERE 1=1
  `;
  const params = [];
  if (ficha_id) { params.push(ficha_id); query += ` AND q.ficha_id = $${params.length}`; }
  if (desde) { params.push(desde); query += ` AND q.fecha_desde >= $${params.length}`; }
  if (hasta) { params.push(hasta); query += ` AND q.fecha_desde <= $${params.length}`; }
  query += ` ORDER BY q.fecha_desde DESC, q.ficha_id DESC LIMIT 5000`;
  return { query, params };
}

router.get('/modelo/historial', soloAdmin, async (req, res) => {
  try {
    const { query, params } = construirQueryHistorialPreciosModelo(req);
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /precios/modelo/historial:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/modelo/historial/pdf', soloAdmin, async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const { query, params } = construirQueryHistorialPreciosModelo(req);
    const result = await pool.query(query, params);

    const filtros = [];
    if (desde || hasta) filtros.push(`Período: ${desde ? fmtFecha(desde) : 'inicio'} a ${hasta ? fmtFecha(hasta) : 'hoy'}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="precios-venta-${desde || 'todo'}_a_${hasta || 'hoy'}.pdf"`);
    generarPdfReporte({
      titulo: 'Evolución de precios de venta (por modelo)',
      filtrosTexto: filtros.join(' · ') || undefined,
      cols: COLS_PDF_PRECIOS_MODELO,
      filas: result.rows,
      armarCelda: (r) => ({
        fecha: fmtFecha(r.fecha_desde),
        modelo: r.modelo || '—',
        precio: 'USD ' + Number(r.precio_usd || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        variacion: r.variacion_porcentaje != null ? `${Number(r.variacion_porcentaje) > 0 ? '+' : ''}${r.variacion_porcentaje}%` : '—',
        observaciones: r.observaciones || '—'
      })
    }, res);
  } catch (err) {
    console.error('Error generando PDF de precios de venta:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   3️⃣ HISTORIAL POR MODELO
========================= */
router.get('/modelo/:ficha_id', soloAdmin, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    // La variación se calcula con LAG() sobre TODO el historial de ese
    // modelo (subquery sin filtrar) y el desde/hasta se aplica después, en
    // el WHERE de afuera — si se filtrara antes, la primera fila visible
    // perdería su precio anterior real y la variación saldría mal.
    const params = [req.params.ficha_id];
    let filtroFecha = '';
    if (desde) { params.push(desde); filtroFecha += ` AND fecha_desde >= $${params.length}`; }
    if (hasta) { params.push(hasta); filtroFecha += ` AND fecha_desde <= $${params.length}`; }

    const result = await pool.query(
      `SELECT * FROM (
         SELECT
           precio AS precio_usd, fecha_desde, observaciones,
           ROUND(
             (precio - LAG(precio) OVER (ORDER BY fecha_desde, id))
             / NULLIF(LAG(precio) OVER (ORDER BY fecha_desde, id), 0) * 100
           , 1) AS variacion_porcentaje
         FROM precios_modelo
         WHERE ficha_id = $1
       ) q
       WHERE 1=1 ${filtroFecha}
       ORDER BY fecha_desde DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   4️⃣ AUMENTO POR MODELO %
========================= */
router.post('/aumento/:ficha_id', soloAdmin, async (req, res) => {
  const porcentaje = Number(req.body.porcentaje);
  const observaciones = req.body.observaciones || null;
  const { ficha_id } = req.params;

  if (isNaN(porcentaje) || porcentaje <= 0) {
    return res.status(400).json({ error: 'Porcentaje inválido' });
  }

  try {
    const insert = await pool.query(`
      INSERT INTO precios_modelo (ficha_id, precio, fecha_desde, observaciones)
      SELECT $1,
             ROUND(precio * (1 + $2/100.0), 2),
             NOW(),
             $3
      FROM precios_modelo
      WHERE ficha_id = $1
      ORDER BY fecha_desde DESC, id DESC
      LIMIT 1
      RETURNING *
    `, [ficha_id, porcentaje, observaciones]);

    if (insert.rows.length === 0) {
      return res.status(404).json({ error: 'No hay precio base' });
    }

    res.json(insert.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   5️⃣ OBTENER CONFIGURACIÓN DE IVA - AGREGADO
   ============================================ */
router.get('/parametros/iva', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT valor FROM parametros WHERE clave = 'iva_general'"
    );
    
    if (result.rows.length === 0) {
      // Si no existe, crear con valor por defecto 21%
      const insert = await pool.query(
        `INSERT INTO parametros (clave, valor, descripcion)
         VALUES ('iva_general', '21', 'Alícuota general de IVA en porcentaje')
         RETURNING valor`
      );
      return res.json({ 
        iva: parseInt(insert.rows[0].valor),
        valor: insert.rows[0].valor,
        descripcion: 'Alícuota general de IVA'
      });
    }
    
    res.json({ 
      iva: parseInt(result.rows[0].valor),
      valor: result.rows[0].valor,
      descripcion: 'Alícuota general de IVA'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   6️⃣ ACTUALIZAR CONFIGURACIÓN DE IVA - AGREGADO
   ============================================ */
router.put('/parametros/iva', soloAdmin, async (req, res) => {
  const { valor } = req.body;
  
  if (!valor || isNaN(valor) || valor <= 0 || valor > 100) {
    return res.status(400).json({ error: 'Valor de IVA inválido (1-100)' });
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO parametros (clave, valor, descripcion)
       VALUES ('iva_general', $1, 'Alícuota general de IVA en porcentaje')
       ON CONFLICT (clave) 
       DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
       RETURNING *`,
      [valor]
    );
    
    res.json({ 
      ok: true, 
      iva: parseInt(result.rows[0].valor),
      mensaje: `✅ IVA actualizado al ${valor}%` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   7️⃣ OBTENER TIPO DE CAMBIO POR DEFECTO - AGREGADO
   ============================================ */
router.get('/parametros/tipo-cambio', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT valor FROM parametros WHERE clave = 'tipo_cambio_default'"
    );
    
    if (result.rows.length === 0) {
      return res.json({ 
        tipo_cambio: 1000,
        valor: '1000',
        descripcion: 'Tipo de cambio USD/ARS por defecto'
      });
    }
    
    res.json({ 
      tipo_cambio: parseFloat(result.rows[0].valor),
      valor: result.rows[0].valor,
      descripcion: 'Tipo de cambio USD/ARS por defecto'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   8️⃣ ACTUALIZAR TIPO DE CAMBIO POR DEFECTO - AGREGADO
   ============================================ */
router.put('/parametros/tipo-cambio', soloAdmin, async (req, res) => {
  const { valor } = req.body;
  
  if (!valor || isNaN(valor) || valor <= 0) {
    return res.status(400).json({ error: 'Valor de tipo de cambio inválido' });
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO parametros (clave, valor, descripcion)
       VALUES ('tipo_cambio_default', $1, 'Tipo de cambio USD/ARS por defecto')
       ON CONFLICT (clave) 
       DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
       RETURNING *`,
      [valor]
    );
    
    res.json({ 
      ok: true, 
      tipo_cambio: parseFloat(result.rows[0].valor),
      mensaje: `✅ Tipo de cambio por defecto actualizado a $${valor}` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* ============================================
   💲 OBTENER TIPO DE CAMBIO ACTUAL (DÓLAR BANCO)
   ============================================ */
router.get('/parametros/dolar', soloAdmin, async (req, res) => {
  try {
    // Obtener el valor del dólar del banco
    const dolarRes = await pool.query(
      "SELECT valor, updated_at FROM parametros WHERE clave = 'dolar_banco'"
    );
    
    // Si no existe, crear con valor por defecto
    if (dolarRes.rows.length === 0) {
      const insert = await pool.query(
        `INSERT INTO parametros (clave, valor, descripcion)
         VALUES ('dolar_banco', '1415.00', 'Tipo de cambio USD/ARS - Dólar Banco')
         RETURNING valor, updated_at`
      );
      
      return res.json({
        dolar: parseFloat(insert.rows[0].valor),
        fecha: insert.rows[0].updated_at,
        formato: `ARS ${parseFloat(insert.rows[0].valor).toFixed(2)} por USD 1`
      });
    }
    
    res.json({
      dolar: parseFloat(dolarRes.rows[0].valor),
      fecha: dolarRes.rows[0].updated_at,
      formato: `ARS ${parseFloat(dolarRes.rows[0].valor).toFixed(2)} por USD 1`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   💲 ACTUALIZAR TIPO DE CAMBIO (DÓLAR BANCO) - CORREGIDO
   ============================================ */
router.put('/parametros/dolar', soloAdmin, async (req, res) => {
  const { dolar } = req.body;
  const usuario_id = req.headers['usuario_id'] || req.body.usuario_id || null;
  
  if (!dolar || isNaN(dolar) || parseFloat(dolar) <= 0) {
    return res.status(400).json({ error: 'Valor de dólar inválido' });
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Verificar si el usuario existe (si se proporcionó)
    if (usuario_id) {
      const userCheck = await client.query(
        'SELECT id FROM usuarios WHERE id = $1',
        [usuario_id]
      );
      if (userCheck.rows.length === 0) {
        // Si el usuario no existe, ignorar y seguir sin updated_by
        console.log('Usuario no encontrado, continuando sin updated_by');
      }
    }

    // Actualizar el valor del dólar
    const result = await client.query(
      `INSERT INTO parametros (clave, valor, descripcion, updated_by, updated_at)
       VALUES ('dolar_banco', $1, 'Tipo de cambio USD/ARS - Dólar Banco', $2, NOW())
       ON CONFLICT (clave) 
       DO UPDATE SET 
         valor = EXCLUDED.valor,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING valor, updated_at, updated_by`,
      [dolar, usuario_id]
    );

    // El trigger `trigger_historial_dolar` (AFTER UPDATE ON parametros)
    // ya inserta la fila en historial_dolar cuando cambia el valor: insertarla
    // también acá duplicaba cada carga (hallazgo 27/09/2026).

    await client.query('COMMIT');

    res.json({
      ok: true,
      dolar: parseFloat(result.rows[0].valor),
      fecha: result.rows[0].updated_at,
      mensaje: `✅ Dólar actualizado a ARS ${parseFloat(dolar).toFixed(2)}`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error actualizando dólar:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ============================================
   💲 HISTORIAL DE TIPO DE CAMBIO - CORREGIDO
   ============================================ */
function construirQueryHistorialDolar(req) {
  const { desde, hasta } = req.query;
  let query = `
    SELECT
      h.dolar,
      h.created_at as fecha,
      COALESCE(u.nombre_usuario, 'Sistema') as usuario
    FROM historial_dolar h
    LEFT JOIN usuarios u ON u.id = h.usuario_id
    WHERE 1=1
  `;
  const params = [];
  // h.created_at es timestamp (no date): "hasta" filtra hasta el final de
  // ese día, no desde la medianoche, para no cortar las cotizaciones
  // cargadas más tarde en el día elegido como límite.
  if (desde) { params.push(desde); query += ` AND h.created_at >= $${params.length}`; }
  if (hasta) { params.push(hasta); query += ` AND h.created_at < ($${params.length}::date + interval '1 day')`; }
  // Sin paginación real: si no se filtra por fecha, este LIMIT es solo una
  // salvaguarda (antes era un recorte fijo de 50, sin avisar al usuario).
  query += ` ORDER BY h.created_at DESC LIMIT 5000`;
  return { query, params };
}

router.get('/parametros/dolar/historial', soloAdmin, async (req, res) => {
  try {
    const { query, params } = construirQueryHistorialDolar(req);
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo historial:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/parametros/dolar/historial/pdf', soloAdmin, async (req, res) => {
  const { desde, hasta } = req.query;
  try {
    const { query, params } = construirQueryHistorialDolar(req);
    const result = await pool.query(query, params);

    const filtros = [];
    if (desde || hasta) filtros.push(`Período: ${desde ? fmtFecha(desde) : 'inicio'} a ${hasta ? fmtFecha(hasta) : 'hoy'}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cotizacion-dolar-${desde || 'todo'}_a_${hasta || 'hoy'}.pdf"`);
    generarPdfReporte({
      titulo: 'Historial de cotización del dólar',
      filtrosTexto: filtros.join(' · ') || undefined,
      cols: COLS_PDF_DOLAR,
      filas: result.rows,
      armarCelda: (r) => ({
        fecha: fmtFecha(r.fecha),
        dolar: money(r.dolar),
        usuario: r.usuario || '—'
      })
    }, res);
  } catch (err) {
    console.error('Error generando PDF del historial de dólar:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

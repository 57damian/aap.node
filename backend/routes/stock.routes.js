const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin, adminYOperario } = require('../middlewares/auth');
const { segunRol } = require('../services/vista-operario');

router.use(verificarToken);

// hallazgo S7: acá tampoco había ningún authorize(...), así que cualquier
// usuario logueado podía ver el stock valorizado con precios ('/resumen').
// El operario ve CANTIDADES de materia prima (para saber si puede producir),
// pero los movimientos, los ajustes y el stock valorizado son del admin.
// Lo que sí puede leer sale filtrado por services/vista-operario.js: los
// precios y el proveedor no salen del server.
const GESTION = soloAdmin;
const LECTURA = adminYOperario;

/**
 * GET /api/stock
 * Devuelve el stock de MATERIAS PRIMAS con filtros (compatible con frontend stock.js)
 * Query params: proveedor_id, estado, search
 * NOTA: Este endpoint es solo para materias primas, no para productos terminados
 *
 * El "último proveedor" y el "último precio" se toman de materias_primas /
 * stock_movimientos (que es lo que realmente alimenta facturas-compra.routes.js),
 * no de las tablas viejas compras/compra_items/precios_materia_prima, que son
 * de una versión anterior del sistema y ya no se usan (ver nota en el doc del
 * proyecto: "Auditoría — Módulo Stock").
 */
router.get('/', LECTURA, async (req, res) => {
  try {
    const { proveedor_id, estado, search } = req.query;

    let query = `
      SELECT
        mp.id as articulo_id,
        mp.codigo,
        mp.nombre,
        mp.stock_actual,
        mp.stock_minimo,
        mp.ubicacion,
        mp.unidad_medida,
        mp.precio_referencia as ultimo_precio,
        mp.fecha_ultima_compra,
        ultimo_mov.proveedor_nombre,
        ultima_variacion.variacion_porcentaje as variacion_precio,
        ultima_variacion.precio_anterior as variacion_precio_anterior,
        ultima_variacion.fecha_cambio as variacion_fecha
      FROM materias_primas mp
      LEFT JOIN LATERAL (
        SELECT p.nombre as proveedor_nombre
        FROM stock_movimientos sm
        JOIN proveedores p ON sm.proveedor_id = p.id
        WHERE sm.materia_prima_id = mp.id AND sm.proveedor_id IS NOT NULL
        ORDER BY sm.fecha_movimiento DESC, sm.id DESC
        LIMIT 1
      ) ultimo_mov ON true
      LEFT JOIN LATERAL (
        -- Última variación de precio registrada para este material, siempre
        -- comparada contra el mismo proveedor de esa compra (ver
        -- facturas-compra.routes.js). Esto alimenta el indicador persistente
        -- de "subió/bajó" en el listado de Stock (diseño acordado 12/09/2026).
        SELECT hpm.variacion_porcentaje, hpm.precio_anterior, hpm.fecha_cambio
        FROM historial_precios_materias hpm
        WHERE hpm.materia_prima_id = mp.id
        ORDER BY hpm.fecha_cambio DESC, hpm.created_at DESC
        LIMIT 1
      ) ultima_variacion ON true
      WHERE mp.activo = true
    `;
    const params = [];
    let paramIndex = 1;

    if (proveedor_id) {
      query += ` AND EXISTS (
        SELECT 1 FROM stock_movimientos sm2
        WHERE sm2.materia_prima_id = mp.id AND sm2.proveedor_id = $${paramIndex}
      )`;
      params.push(proveedor_id);
      paramIndex++;
    }

    if (estado) {
      if (estado === 'CRITICO') {
        query += ` AND mp.stock_actual = 0`;
      } else if (estado === 'BAJO') {
        query += ` AND mp.stock_actual > 0 AND mp.stock_actual <= mp.stock_minimo`;
      } else if (estado === 'NORMAL') {
        query += ` AND mp.stock_actual > mp.stock_minimo`;
      }
    }

    if (search) {
      query += ` AND (mp.codigo ILIKE $${paramIndex} OR mp.nombre ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY mp.nombre`;

    const result = await pool.query(query, params);
    // segunRol: al operario no le llegan precio, variación ni proveedor.
    res.json(segunRol(result.rows, req.usuario.rol));
  } catch (err) {
    console.error('Error en GET /stock:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock/actual
 * Devuelve el stock actual de todas las materias primas activas
 * (equivalente a GET /materias-primas?activo=true pero más simple)
 */
router.get('/actual', LECTURA, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        mp.id, mp.codigo, mp.nombre, mp.unidad_medida,
        mp.stock_actual, mp.stock_minimo, mp.ubicacion,
        mp.precio_referencia as ultimo_precio
      FROM materias_primas mp
      WHERE mp.activo = true
      ORDER BY mp.nombre
    `);

    const rows = result.rows.map(item => ({
      ...item,
      valor_total: (item.stock_actual || 0) * (item.ultimo_precio || 0),
      estado_stock: item.stock_actual === 0 ? 'CRITICO' :
                    item.stock_actual <= item.stock_minimo ? 'BAJO' : 'NORMAL'
    }));

    // El valor_total de arriba es justamente lo que el operario no tiene que
    // ver: segunRol lo saca, junto con el precio con el que se calculó.
    res.json(segunRol(rows, req.usuario.rol));
  } catch (err) {
    console.error('Error en GET /stock/actual:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock/movimientos
 * Lista todos los movimientos con filtros opcionales
 * Query params: materia_prima_id, desde, hasta, tipo
 *
 * Incluye alias (fecha, articulo_nombre, usuario, observacion) para que
 * coincidan con lo que espera el frontend (public/js/stock.js
 * renderizarMovimientos) además de los nombres originales de columna.
 */
router.get('/movimientos', LECTURA, async (req, res) => {
  try {
    const { materia_prima_id, desde, hasta, tipo } = req.query;

    let query = `
      SELECT
        sm.*,
        sm.fecha_movimiento as fecha,
        mp.codigo as articulo_codigo,
        mp.nombre as articulo_nombre,
        u.nombre_usuario as usuario_nombre,
        u.nombre_usuario as usuario,
        sm.observaciones as observacion,
        fc.numero_factura,
        fc.fecha_emision as factura_fecha,
        p.nombre as proveedor_nombre
      FROM stock_movimientos sm
      JOIN materias_primas mp ON sm.materia_prima_id = mp.id
      LEFT JOIN usuarios u ON sm.usuario_id = u.id
      LEFT JOIN facturas_compra fc ON sm.factura_id = fc.id
      LEFT JOIN proveedores p ON sm.proveedor_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (materia_prima_id) {
      query += ` AND sm.materia_prima_id = $${paramIndex++}`;
      params.push(materia_prima_id);
    }
    if (desde) {
      query += ` AND sm.fecha_movimiento >= $${paramIndex++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND sm.fecha_movimiento <= $${paramIndex++}`;
      params.push(hasta);
    }
    if (tipo) {
      query += ` AND sm.tipo_movimiento = $${paramIndex++}`;
      params.push(tipo);
    }

    query += ` ORDER BY sm.fecha_movimiento DESC, sm.id DESC LIMIT 1000`;

    const result = await pool.query(query, params);
    // segunRol: al operario no le llegan precio, variación ni proveedor.
    res.json(segunRol(result.rows, req.usuario.rol));
  } catch (err) {
    console.error('Error en GET /stock/movimientos:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stock/materia-prima/:id/movimientos
 * Historial de movimientos de una materia prima específica
 */
router.get('/materia-prima/:id/movimientos', LECTURA, async (req, res) => {
  try {
    const { id } = req.params;
    const { desde, hasta } = req.query;

    let query = `
      SELECT
        sm.*,
        sm.fecha_movimiento as fecha,
        mp.codigo as articulo_codigo,
        mp.nombre as articulo_nombre,
        u.nombre_usuario as usuario_nombre,
        u.nombre_usuario as usuario,
        sm.observaciones as observacion,
        fc.numero_factura,
        fc.fecha_emision as factura_fecha,
        p.nombre as proveedor_nombre
      FROM stock_movimientos sm
      JOIN materias_primas mp ON sm.materia_prima_id = mp.id
      LEFT JOIN usuarios u ON sm.usuario_id = u.id
      LEFT JOIN facturas_compra fc ON sm.factura_id = fc.id
      LEFT JOIN proveedores p ON sm.proveedor_id = p.id
      WHERE sm.materia_prima_id = $1
    `;
    const params = [id];
    let paramIndex = 2;

    if (desde) {
      query += ` AND sm.fecha_movimiento >= $${paramIndex++}`;
      params.push(desde);
    }
    if (hasta) {
      query += ` AND sm.fecha_movimiento <= $${paramIndex++}`;
      params.push(hasta);
    }

    query += ` ORDER BY sm.fecha_movimiento DESC, sm.id DESC`;

    const result = await pool.query(query, params);
    // segunRol: al operario no le llegan precio, variación ni proveedor.
    res.json(segunRol(result.rows, req.usuario.rol));
  } catch (err) {
    console.error('Error en GET /stock/materia-prima/:id/movimientos:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stock/ajuste
 * Registra un ajuste manual de stock
 * Body: { materia_prima_id, cantidad (relativa), tipo_movimiento, observaciones, fecha_movimiento (opcional) }
 * La cantidad puede ser positiva (entrada) o negativa (salida)
 * Para ajuste directo (nuevo stock), se debe calcular la diferencia en el frontend
 */
router.post('/ajuste', GESTION, async (req, res) => {
  const client = await pool.connect();
  try {
    const { materia_prima_id, cantidad, tipo_movimiento, observaciones, fecha_movimiento } = req.body;

    if (!materia_prima_id || cantidad === undefined || !tipo_movimiento) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    // hallazgo D5: antes se aceptaba cualquier texto libre en tipo_movimiento.
    const TIPOS = ['ENTRADA', 'SALIDA', 'AJUSTE', 'MERMA'];
    if (!TIPOS.includes(String(tipo_movimiento).toUpperCase())) {
      await client.release();
      return res.status(400).json({ error: `Tipo de movimiento inválido: "${tipo_movimiento}"` });
    }

    const delta = parseFloat(cantidad);
    if (!Number.isFinite(delta) || delta === 0) {
      await client.release();
      return res.status(400).json({ error: 'La cantidad del ajuste tiene que ser un número distinto de cero' });
    }

    await client.query('BEGIN');

    // Obtener stock actual y unidad (con lock)
    const stockRes = await client.query(
      'SELECT stock_actual, unidad_medida FROM materias_primas WHERE id = $1 FOR UPDATE',
      [materia_prima_id]
    );
    if (stockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Materia prima no encontrada' });
    }

    const stockAnterior = parseFloat(stockRes.rows[0].stock_actual);
    const unidad = stockRes.rows[0].unidad_medida || 'UNI';
    // hallazgo D5: antes esto recortaba en silencio con Math.max(0, ...) —
    // si había 10 unidades y se pedía un ajuste de -50, el movimiento
    // quedaba grabado con cantidad=-50 pero stock_nuevo=0, y el libro de
    // movimientos dejaba de cuadrar contra el stock actual. Ahora se
    // rechaza en vez de mentir en el registro.
    const stockNuevo = stockAnterior + delta;
    if (stockNuevo < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `No se puede descontar ${Math.abs(delta)}: el stock actual es ${stockAnterior}`
      });
    }

    // Insertar movimiento
    await client.query(`
      INSERT INTO stock_movimientos
        (materia_prima_id, fecha_movimiento, tipo_movimiento, cantidad, unidad,
         stock_anterior, stock_nuevo, observaciones, usuario_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      materia_prima_id,
      fecha_movimiento || new Date(),
      tipo_movimiento,
      cantidad,
      unidad,
      stockAnterior,
      stockNuevo,
      observaciones,
      req.usuario.id
    ]);

    // Actualizar stock en materias_primas
    await client.query(
      'UPDATE materias_primas SET stock_actual = $1 WHERE id = $2',
      [stockNuevo, materia_prima_id]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      stock_anterior: stockAnterior,
      stock_nuevo: stockNuevo,
      mensaje: 'Ajuste registrado correctamente'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en POST /stock/ajuste:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/stock/resumen
 * Estadísticas generales de stock
 */
router.get('/resumen', GESTION, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_materiales,
        SUM(stock_actual) as total_unidades,
        SUM(stock_actual * COALESCE(precio_referencia, 0)) as valor_total_stock,
        COUNT(CASE WHEN stock_actual = 0 THEN 1 END) as materiales_sin_stock,
        COUNT(CASE WHEN stock_actual <= stock_minimo AND stock_actual > 0 THEN 1 END) as materiales_stock_bajo
      FROM materias_primas mp
      WHERE mp.activo = true
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /stock/resumen:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

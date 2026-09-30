/* =====================================================================
 * Movimientos de stock de materia prima: lock + validación + insert +
 * actualización de stock_actual, en un solo lugar. Extraído de
 * POST /api/stock/ajuste (30/09/2026) al sumar el descuento de material
 * por producción, para no duplicar esta lógica en dos rutas.
 *
 * `produccion_id` liga un movimiento a la carga de producción que lo
 * generó (SALIDA = material usado, MERMA = material desperdiciado); queda
 * NULL para ajustes sueltos (Ajuste de Stock, incluido el botón "Vaciar" —
 * ver docs/claude/modulo-stock.md). El endpoint de ajuste manual nunca deja
 * pasar un produccion_id del cliente: ese campo solo lo pasa internamente
 * produccion.routes.js.
 * ===================================================================== */

const TIPOS_MOVIMIENTO = ['ENTRADA', 'SALIDA', 'AJUSTE', 'MERMA'];

/**
 * Aplica un movimiento de stock dentro de una transacción ya abierta
 * (el caller hace BEGIN/COMMIT/ROLLBACK). Lanza un Error con `.status`
 * (400/404) en los casos esperados, para que el router lo traduzca directo
 * a una respuesta HTTP sin loguearlo como error 500.
 *
 * @param {import('pg').PoolClient} client
 * @param {object} opts
 * @param {number} opts.materiaPrimaId
 * @param {string} opts.tipoMovimiento - uno de TIPOS_MOVIMIENTO
 * @param {number} opts.delta - cantidad con signo (positiva = entra, negativa = sale)
 * @param {string} [opts.observaciones]
 * @param {number} opts.usuarioId
 * @param {Date|string} [opts.fechaMovimiento] - default: ahora
 * @param {number|null} [opts.produccionId] - default: null (ajuste suelto)
 * @returns {Promise<{ movimientoId: number, stockAnterior: number, stockNuevo: number, unidad: string }>}
 */
async function aplicarMovimientoStock(client, {
  materiaPrimaId,
  tipoMovimiento,
  delta,
  observaciones,
  usuarioId,
  fechaMovimiento,
  produccionId = null
}) {
  const tipo = String(tipoMovimiento || '').toUpperCase();
  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    const err = new Error(`Tipo de movimiento inválido: "${tipoMovimiento}"`);
    err.status = 400;
    throw err;
  }

  const deltaNum = parseFloat(delta);
  if (!Number.isFinite(deltaNum) || deltaNum === 0) {
    const err = new Error('La cantidad del movimiento tiene que ser un número distinto de cero');
    err.status = 400;
    throw err;
  }

  const stockRes = await client.query(
    'SELECT stock_actual, unidad_medida, nombre FROM materias_primas WHERE id = $1 FOR UPDATE',
    [materiaPrimaId]
  );
  if (stockRes.rows.length === 0) {
    const err = new Error('Materia prima no encontrada');
    err.status = 404;
    throw err;
  }

  const stockAnterior = parseFloat(stockRes.rows[0].stock_actual);
  const unidad = stockRes.rows[0].unidad_medida || 'UNI';
  const nombreMaterial = stockRes.rows[0].nombre;

  // hallazgo D5 (stock.routes.js): nunca recortar en silencio con
  // Math.max(0, ...) — si no hay stock suficiente, se rechaza en vez de
  // mentir en el registro.
  const stockNuevo = stockAnterior + deltaNum;
  if (stockNuevo < 0) {
    const err = new Error(
      `No se puede descontar ${Math.abs(deltaNum)} de "${nombreMaterial}": el stock actual es ${stockAnterior}`
    );
    err.status = 400;
    throw err;
  }

  const insert = await client.query(`
    INSERT INTO stock_movimientos
      (materia_prima_id, fecha_movimiento, tipo_movimiento, cantidad, unidad,
       stock_anterior, stock_nuevo, observaciones, usuario_id, produccion_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
  `, [
    materiaPrimaId,
    fechaMovimiento || new Date(),
    tipo,
    deltaNum,
    unidad,
    stockAnterior,
    stockNuevo,
    observaciones,
    usuarioId,
    produccionId
  ]);

  await client.query(
    'UPDATE materias_primas SET stock_actual = $1 WHERE id = $2',
    [stockNuevo, materiaPrimaId]
  );

  return { movimientoId: insert.rows[0].id, stockAnterior, stockNuevo, unidad };
}

module.exports = { TIPOS_MOVIMIENTO, aplicarMovimientoStock };

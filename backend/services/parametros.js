/* =====================================================================
 * PARÁMETROS — helper compartido para leer configuración de la tabla
 * `parametros` (clave/valor).
 * ---------------------------------------------------------------------
 * Antes había una copia de `getIVA()` en facturas.routes.js y un IVA
 * hardcodeado (0.21) en notas_credito.routes.js. Si alguien cambiaba el
 * IVA desde PUT /api/precios/parametros/iva, las facturas usaban el
 * nuevo valor y las notas de crédito seguían con el viejo. Ahora hay una
 * sola función, usada por los dos.
 * ===================================================================== */

/** Devuelve el IVA general como fracción (21 -> 0.21). Si no hay parámetro
 * cargado, devuelve 0.21 como default seguro (mismo comportamiento que
 * tenía antes cada copia). */
async function getIVA(pool) {
  try {
    const result = await pool.query(
      "SELECT valor FROM parametros WHERE clave = 'iva_general'"
    );
    return result.rows.length > 0 ? parseFloat(result.rows[0].valor) / 100 : 0.21;
  } catch (err) {
    console.error('Error obteniendo IVA:', err);
    return 0.21;
  }
}

module.exports = { getIVA };

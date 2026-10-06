/* =====================================================================
 * FECHAS DE DÉBITO DE LOS CHEQUES ENTREGADOS A PROVEEDORES
 * ---------------------------------------------------------------------
 * `cheque_fecha_cobro` es la fecha que figura en el cheque: desde ahí el
 * proveedor puede depositarlo. El débito en NUESTRA cuenta no ocurre ese
 * día: se hace entre 24 y 48 horas después de que el proveedor lo deposite
 * (y solo en días hábiles). Mostrar la fecha del cheque como "fecha de
 * débito" hacía ver como atrasado un cheque que todavía estaba en tiempo.
 *
 * Estimación por días hábiles (lunes a viernes; no considera feriados):
 *   depósito más temprano = la fecha del cheque, o el lunes si cae en fin
 *                           de semana;
 *   débito desde          = 1 día hábil después del depósito;
 *   débito hasta          = 2 días hábiles después del depósito.
 * Si el proveedor deposita más tarde, el débito también se corre: por eso
 * "hasta" es el punto a partir del cual recién tiene sentido revisar el
 * banco, no un vencimiento.
 *
 * Se expresa en SQL (sobre una columna DATE) para poder usarlo en listados,
 * alertas y totales sin traer filas a Node.
 * ===================================================================== */

/** Días a sumar a la fecha del cheque para el primer débito posible. */
function sqlDebitoDesde(fecha) {
  return `(${fecha} + CASE EXTRACT(DOW FROM ${fecha})::int
    WHEN 0 THEN 2 WHEN 5 THEN 3 WHEN 6 THEN 3 ELSE 1 END)`;
}

/** Días a sumar a la fecha del cheque para el último débito esperable. */
function sqlDebitoHasta(fecha) {
  return `(${fecha} + CASE EXTRACT(DOW FROM ${fecha})::int
    WHEN 0 THEN 3 WHEN 4 THEN 4 WHEN 5 THEN 4 WHEN 6 THEN 4 ELSE 2 END)`;
}

module.exports = { sqlDebitoDesde, sqlDebitoHasta };

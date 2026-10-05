// ============================================================================
// Unidades de medida de las materias primas.
//
// El stock de cada material se lleva en SU unidad (el alambre, en gramos),
// pero el proveedor factura como quiere (el alambre, por kg). Para que se
// pueda cargar la factura tal cual viene, sin convertir a mano, acá se resuelve
// el factor entre la unidad del renglón de la factura y la del material.
// Hoy solo se convierte peso (KG <-> GR): el resto de las unidades no tiene
// una equivalencia fija (un rollo no es un número de metros).
// ============================================================================

const ALIAS = {
  KG: 'KG', KGS: 'KG', KILO: 'KG', KILOS: 'KG', KILOGRAMO: 'KG', KILOGRAMOS: 'KG',
  GR: 'GR', GRS: 'GR', G: 'GR', GRAMO: 'GR', GRAMOS: 'GR'
};

/** Unidad en mayúsculas y sin alias ("kgs" -> "KG"). Vacío -> ''. */
function normalizarUnidad(unidad) {
  const u = String(unidad || '').trim().toUpperCase();
  return ALIAS[u] || u;
}

/**
 * Cuántas unidades del material equivalen a UNA unidad del renglón.
 *   KG -> GR : 1000      (12,19 kg  = 12.190 gr)
 *   GR -> KG : 0.001
 *   iguales o no convertibles : 1 (no se toca nada)
 */
function factorAUnidadMaterial(unidadItem, unidadMaterial) {
  const origen = normalizarUnidad(unidadItem);
  const destino = normalizarUnidad(unidadMaterial);
  if (origen === 'KG' && destino === 'GR') return 1000;
  if (origen === 'GR' && destino === 'KG') return 0.001;
  return 1;
}

/** true si las dos unidades son distintas y no hay forma de convertirlas. */
function sonIncompatibles(unidadItem, unidadMaterial) {
  const origen = normalizarUnidad(unidadItem);
  const destino = normalizarUnidad(unidadMaterial);
  if (!origen || !destino || origen === destino) return false;
  return factorAUnidadMaterial(origen, destino) === 1;
}

module.exports = { normalizarUnidad, factorAUnidadMaterial, sonIncompatibles };

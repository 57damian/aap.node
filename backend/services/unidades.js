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

// ----------------------------------------------------------------------------
// Precio de compra
//
// El alambre se lleva en stock en gramos (se consume en gramos: ~22 g por
// bobinado) pero se compra y se negocia por kg. Los precios se guardan por
// unidad de stock (materias_primas.precio_referencia, el historial y los
// movimientos); para MOSTRARLOS y editarlos, un material en GR se expresa por
// kg. El resto de las unidades no se toca.
// ----------------------------------------------------------------------------

/** Unidad en la que se expresa el precio de compra de un material. */
function unidadPrecio(unidadMaterial) {
  return normalizarUnidad(unidadMaterial) === 'GR' ? 'KG' : (unidadMaterial || '');
}

/** Precio por unidad de stock -> precio por unidad de compra (GR -> por KG). null/vacío -> null. */
function precioDeCompra(precio, unidadMaterial) {
  if (precio === null || precio === undefined || precio === '') return null;
  const n = parseFloat(precio);
  if (!isFinite(n)) return null;
  if (normalizarUnidad(unidadMaterial) !== 'GR') return n;
  // 6 decimales: 34,0335 * 1000 en coma flotante da 34033,50000000001
  return Math.round(n * 1000 * 1e6) / 1e6;
}

/**
 * Agrega a una fila los precios de compra y su unidad, sin tocar los campos
 * originales (el valorizado y la factura siguen usando el precio por unidad de
 * stock). `mapa` = { campo_nuevo: 'campo_origen' }.
 */
function agregarPrecioDeCompra(fila, mapa, unidadMaterial = fila.unidad_medida) {
  for (const [nuevo, origen] of Object.entries(mapa)) {
    fila[nuevo] = precioDeCompra(fila[origen], unidadMaterial);
  }
  fila.unidad_precio = unidadPrecio(unidadMaterial);
  return fila;
}

module.exports = {
  normalizarUnidad, factorAUnidadMaterial, sonIncompatibles,
  unidadPrecio, precioDeCompra, agregarPrecioDeCompra
};

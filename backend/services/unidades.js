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
  GR: 'GR', GRS: 'GR', G: 'GR', GRAMO: 'GR', GRAMOS: 'GR',
  CM: 'CM', CMS: 'CM', CENTIMETRO: 'CM', CENTIMETROS: 'CM',
  M: 'M', MT: 'M', MTS: 'M', METRO: 'M', METROS: 'M'
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
// Receta: cantidades por transformador
//
// La receta se anota en la unidad que le resulta natural al taller (gramos de
// alambre, cm de cinta, unidades de tornillos) y se convierte a la unidad en
// que se lleva el stock del material. Un material que se lleva por unidad
// (un rollo de cinta) puede declarar cuántos metros tiene cada rollo
// (materias_primas.metros_por_rollo): así 30 cm de cinta son 30 / (metros × 100)
// rollos.
// ----------------------------------------------------------------------------

/**
 * Unidades de receta que se pueden convertir a la unidad de este material.
 * `material` = { unidad_medida, metros_por_rollo }.
 */
function unidadesPermitidas(material) {
  const d = normalizarUnidad(material && material.unidad_medida);
  if (d === 'GR' || d === 'KG') return ['GR', 'KG'];
  if (d === 'CM' || d === 'M') return ['CM', 'M'];
  // Un material por unidad o por rollo puede declarar cuántos metros tiene cada uno.
  if (d === 'UNI' || d === 'ROLLO') return Number(material.metros_por_rollo) > 0 ? [d, 'CM', 'M'] : [d];
  return d ? [d] : [];
}

/**
 * Pasa `cantidad` (anotada en `unidadOrigen`) a la unidad de stock del material.
 * Devuelve { ok: true, cantidad } o { ok: false, error } (sin tirar excepciones:
 * el que llama decide si bloquea). No redondea: se redondea una sola vez sobre
 * el total del lote, no por unidad.
 */
function convertirAUnidadMaterial(cantidad, unidadOrigen, material) {
  const o = normalizarUnidad(unidadOrigen);
  const d = normalizarUnidad(material && material.unidad_medida);
  const n = Number(cantidad);
  if (!isFinite(n)) return { ok: false, error: 'La cantidad no es un número' };
  if (!o || !d) return { ok: false, error: 'Falta la unidad' };
  if (o === d) return { ok: true, cantidad: n };

  if ((o === 'KG' || o === 'GR') && (d === 'KG' || d === 'GR')) {
    return { ok: true, cantidad: n * factorAUnidadMaterial(o, d) };
  }

  if (o === 'CM' || o === 'M') {
    const metros = o === 'CM' ? n / 100 : n;
    if (d === 'M') return { ok: true, cantidad: metros };
    if (d === 'CM') return { ok: true, cantidad: metros * 100 };
    if (d === 'UNI' || d === 'ROLLO') {
      const porRollo = Number(material.metros_por_rollo);
      if (!(porRollo > 0)) {
        return { ok: false, error: 'El material se lleva por unidad y no tiene cargados los metros por rollo (se completan en Materias primas)' };
      }
      return { ok: true, cantidad: metros / porRollo };
    }
  }

  return { ok: false, error: `No se puede pasar de ${o} a ${d}` };
}

/** Redondeo a 4 decimales (la precisión del stock). */
function redondear4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
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
  unidadesPermitidas, convertirAUnidadMaterial, redondear4,
  unidadPrecio, precioDeCompra, agregarPrecioDeCompra
};

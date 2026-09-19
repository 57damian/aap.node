// ============================================================================
// Recorta los datos contables de una respuesta cuando quien pregunta no es
// administrador.
//
// La decisión (Damian, 17/09/2026) es que el operario ve CANTIDADES y nada
// más: ni precios, ni variaciones, ni proveedores, ni totales.
//
// Esto se hace en el server a propósito. Esconder la columna en la pantalla no
// sirve: el dato igual viaja al navegador y se lee con la consola abierta o
// mirando la respuesta de la API. Lo que no se manda, no se puede mirar.
// ============================================================================

const { ADMIN } = require('../config/roles');

// Campos que no salen del server si el que pregunta no es admin.
// Cubre los nombres que usan hoy stock, producción y fichas.
const CAMPOS_CONTABLES = [
  'precio', 'precio_referencia', 'precio_unitario', 'precio_anterior',
  'precio_promedio', 'precio_venta', 'precio_costo', 'costo',
  'ultimo_precio', 'ultimo_precio_usd', 'precio_usd',
  'variacion_precio', 'variacion_precio_anterior', 'variacion_fecha',
  'valor_total', 'valor_stock', 'valorizado',
  'subtotal', 'total', 'importe', 'monto',
  'proveedor_id', 'proveedor_nombre', 'proveedor',
  'fecha_ultima_compra', 'dolar', 'cotizacion'
];

/**
 * Devuelve los datos sin los campos contables cuando el rol no es admin.
 * Acepta un objeto, un array de objetos o un array de arrays; no toca nada si
 * el rol es admin.
 */
function segunRol(datos, rol) {
  if (rol === ADMIN) return datos;
  return limpiar(datos);
}

function limpiar(valor) {
  if (Array.isArray(valor)) return valor.map(limpiar);

  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    const salida = {};
    for (const [clave, contenido] of Object.entries(valor)) {
      if (CAMPOS_CONTABLES.includes(clave)) continue;
      salida[clave] = limpiar(contenido);
    }
    return salida;
  }

  return valor;
}

module.exports = { segunRol, CAMPOS_CONTABLES };

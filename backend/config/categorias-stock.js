// Categorías de materia prima (lista fija, 02/10/2026). Los valores van en
// MAYÚSCULAS y coinciden con el CHECK de materias_primas.categoria
// (migracion-categoria-proveedor-materias.sql). Los desplegables de
// stock.html y stock-mp.html repiten esta lista a mano: si se agrega una
// categoría hay que tocar acá, la migración (CHECK) y esos dos HTML.

const CATEGORIAS_STOCK = ['CARRETELES', 'ALAMBRES_COBRE', 'OTROS'];
const CATEGORIA_POR_DEFECTO = 'OTROS';

function esCategoriaValida(valor) {
  return CATEGORIAS_STOCK.includes(valor);
}

module.exports = { CATEGORIAS_STOCK, CATEGORIA_POR_DEFECTO, esCategoriaValida };

// ============================================================================
// Los roles del sistema, en un solo lugar.
//
// Antes cada router escribía su propia lista a mano: había 11 combinaciones
// distintas repartidas en 20 archivos, con un rol 'compras' que ni siquiera
// existía y con 'operario' incluido en la lectura de cobros, pagos y
// proveedores. El menú escondía esas pantallas, pero la API las servía igual
// a quien tuviera el token.
//
// Decisión de Damian (17/09/2026): solo dos roles.
//
//   admin     — ve y hace todo.
//   operario  — carga lo que produce, y ve CANTIDADES de transformadores y de
//               materia prima. Nunca ve precios ni nada contable: no es que la
//               pantalla los esconda, el server no se los manda (ver
//               services/vista-operario.js).
// ============================================================================

const ADMIN = 'admin';
const OPERARIO = 'operario';

// El orden importa: es el que se muestra en los desplegables.
const ROLES_VALIDOS = [ADMIN, OPERARIO];

// A dónde va cada rol al entrar.
const PANTALLA_INICIAL = {
  [ADMIN]: 'dashboard.html',
  [OPERARIO]: 'produccion.html'
};

// Pantallas que se le pueden elegir a un usuario como inicio
// (usuarios.pantalla_inicio, 27/09/2026). Lista blanca: el valor termina en
// un redirect del navegador, así que no se acepta cualquier texto. Para el
// operario no hay opciones: solo trabaja en Producción.
const PANTALLAS_INICIO = {
  [ADMIN]: [
    { url: 'dashboard.html',         nombre: 'Dashboard' },
    { url: 'oc.html',                nombre: 'Órdenes de compra' },
    { url: 'ventas.html',            nombre: 'Ventas y entregas' },
    { url: 'pedidos-proveedor.html', nombre: 'Pedidos a proveedores' },
    { url: 'ficha.html',             nombre: 'Fichas técnicas' },
    { url: 'produccion.html',        nombre: 'Producción' },
    { url: 'stock.html',             nombre: 'Stock' }
  ],
  [OPERARIO]: []
};

function pantallaValida(rol, url) {
  return (PANTALLAS_INICIO[rol] || []).some(p => p.url === url);
}

/** A dónde entra este usuario: la que tenga elegida si es válida para su
 *  rol, si no la de su rol. */
function pantallaInicioDe(usuario) {
  if (usuario.pantalla_inicio && pantallaValida(usuario.rol, usuario.pantalla_inicio)) {
    return usuario.pantalla_inicio;
  }
  return PANTALLA_INICIAL[usuario.rol] || PANTALLA_INICIAL[ADMIN];
}

module.exports = {
  ADMIN, OPERARIO, ROLES_VALIDOS, PANTALLA_INICIAL,
  PANTALLAS_INICIO, pantallaValida, pantallaInicioDe
};

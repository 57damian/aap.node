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

module.exports = { ADMIN, OPERARIO, ROLES_VALIDOS, PANTALLA_INICIAL };

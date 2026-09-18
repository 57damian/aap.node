// roleGuard.js
//
// Guardia de pantalla: decide si este usuario puede VER esta página.
//
// Ojo con qué es y qué no es: esto corre en el navegador y solo evita que
// alguien aterrice en una pantalla que no le corresponde. No es la seguridad
// del sistema. El que manda es el backend, que le responde 403 al operario en
// todo lo que no sea producción y stock, aunque se saltee esta función.
//
// Roles (17/09/2026): 'admin' y 'operario'. Los viejos 'control' y 'empleado'
// se migraron y ya no existen.

/** Pantalla inicial de cada rol. Es también a donde se lo manda si entra
 *  a una que no le corresponde. */
function pantallaInicial(rol) {
  return rol === 'operario' ? 'produccion.html' : 'dashboard.html';
}

function verificarRolPagina(rolesPermitidos) {
  const token = localStorage.getItem('token');
  const usuarioStr = localStorage.getItem('usuario');

  if (!token || !usuarioStr) {
    window.location.href = 'login.html';
    return false;
  }

  let usuario;
  try {
    usuario = JSON.parse(usuarioStr);
  } catch (e) {
    localStorage.clear();
    window.location.href = 'login.html';
    return false;
  }

  // Sin rol reconocible no se asume nada: al login.
  if (!usuario.rol) {
    localStorage.clear();
    window.location.href = 'login.html';
    return false;
  }

  if (!rolesPermitidos.includes(usuario.rol)) {
    window.location.href = pantallaInicial(usuario.rol);
    return false;
  }

  ocultarBotonesSinPermiso(usuario.rol);
  return true;
}

/**
 * Esconde, en la botonera vieja, los botones que este rol no puede usar.
 *
 * La lógica existía en js/navbar-filter.js, pero ese archivo lo cargaba una
 * sola página (y muerta), así que un operario veía en Producción los botones
 * de Clientes, Proveedores, Pagos y Usuarios: los apretaba y el sistema lo
 * rebotaba de vuelta, sin explicar nada. Acá alcanza a las 19 pantallas que
 * cargan roleGuard.
 *
 * Las pantallas ya migradas al menú lateral no tienen esta botonera: ahí el
 * filtrado lo hace shell.js con la misma lista de roles.
 */
function ocultarBotonesSinPermiso(rol) {
  // Cualquier elemento con data-roles, no solo los de la botonera: así también
  // desaparecen, por ejemplo, la pestaña "Reporte" de Producción y los paneles
  // marcados como de admin.
  document.querySelectorAll('[data-roles]').forEach(function (elemento) {
    var permitidos = (elemento.getAttribute('data-roles') || '')
      .split(',')
      .map(function (r) { return r.trim(); })
      .filter(Boolean);

    if (permitidos.length && !permitidos.includes(rol)) {
      elemento.style.display = 'none';
    }
  });

  // El logo de la botonera vieja apunta siempre al dashboard: para un operario
  // eso es un viaje de ida y vuelta (entra, lo rebotan). Se lo manda a su
  // propia pantalla.
  var marca = document.querySelector('.navbar-brand');
  if (marca && rol !== 'admin') {
    marca.setAttribute('href', pantallaInicial(rol));
  }
}

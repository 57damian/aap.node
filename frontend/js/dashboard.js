const dashboardUsuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');

  if (!token || !userStr) {
    window.location.href = 'login.html';
    return null;
  }

  try {
    const usuario = JSON.parse(userStr);
    
    // Verificar si es empleado intentando acceder al dashboard
    const currentPage = window.location.pathname.split('/').pop();
    if (usuario.rol === 'empleado' && currentPage === 'dashboard.html') {
      // Redirigir empleados a producción
      window.location.href = 'produccion.html';
      return null;
    }
    
    return usuario;
  } catch (error) {
    window.location.href = 'login.html';
    return null;
  }
})();

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  localStorage.removeItem('rol');
  localStorage.removeItem('usuario_id');
  window.location.href = 'login.html';
}

function verificarPermisosUsuario() {
  if (!dashboardUsuario) return;

  document.querySelectorAll('[data-roles]').forEach((elemento) => {
    const rolesPermitidos = (elemento.getAttribute('data-roles') || '').split(',');
    if (!rolesPermitidos.includes(dashboardUsuario.rol)) {
      elemento.classList.add('is-hidden');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop();

  document.querySelectorAll('.navbar-menu button').forEach((btn) => {
    const onClick = btn.getAttribute('onclick') || '';
    const match = onClick.match(/window\.location\.href='([^']+)'/);
    const targetPage = match ? match[1] : '';

    if (targetPage === currentPage) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  verificarPermisosUsuario();
});


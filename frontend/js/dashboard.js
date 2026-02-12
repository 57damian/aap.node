const rol = localStorage.getItem('rol');

if (!rol) {
  window.location.href = 'index.html';
}

// =====================
// NAVEGACIÓN
// =====================
function go(page) {
  window.location.href = page;
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

// =====================
// INICIALIZAR MENÚ Y ROLES
// =====================
document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop();

  // Activar botón actual
  document.querySelectorAll('.navbar-menu button').forEach(btn => {
    const targetPage = btn.getAttribute('onclick')?.match(/go\('([^']+)'/)?.[1];
    if (targetPage === currentPage) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Ocultar por rol
  document.querySelectorAll('[data-roles]').forEach(btn => {
    const roles = btn.dataset.roles.split(',');
    if (!roles.includes(rol)) {
      btn.style.display = 'none';
    }
  });
});
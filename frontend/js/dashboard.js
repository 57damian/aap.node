const rol = localStorage.getItem('rol');

if (!rol) {
  window.location.href = 'index.html';
}

// =====================
// IR A PÁGINA
// =====================
function go(page) {
  window.location.href = page;
}

// =====================
// LOGOUT
// =====================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

// =====================
// INICIALIZAR MENÚ ACTIVO (OPCIONAL)
// =====================
document.addEventListener('DOMContentLoaded', () => {
  // Si estamos en una página específica, marcar el botón correspondiente
  const currentPage = window.location.pathname.split('/').pop();
  
  document.querySelectorAll('.navbar-menu button').forEach(btn => {
    const targetPage = btn.getAttribute('onclick')?.match(/go\('([^']+)'/)?.[1];
    if (targetPage && targetPage === currentPage) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Ocultar botones según rol
  document.querySelectorAll('[data-roles]').forEach(btn => {
    const roles = btn.dataset.roles.split(',');
    if (!roles.includes(rol)) {
      btn.style.display = 'none';
    }
  });
});
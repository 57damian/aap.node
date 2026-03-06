function filtrarNavbarPorRol() {
  try {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const userRole = (usuario.rol || '').trim();

    document.querySelectorAll('.navbar-menu button[data-roles]').forEach((button) => {
      const rolesPermitidos = (button.getAttribute('data-roles') || '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);

      if (!userRole || rolesPermitidos.length === 0) {
        button.style.display = '';
        return;
      }

      button.style.display = rolesPermitidos.includes(userRole) ? '' : 'none';
    });
  } catch (e) {
    console.error('Error filtrando navbar por rol:', e);
  }
}

document.addEventListener('DOMContentLoaded', filtrarNavbarPorRol);

window.addEventListener('storage', (e) => {
  if (e.key === 'usuario') {
    filtrarNavbarPorRol();
  }
});

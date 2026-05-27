// roleGuard.js
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
  } catch(e) {
    window.location.href = 'login.html';
    return false;
  }
  
  if (!rolesPermitidos.includes(usuario.rol)) {
    // Redirigir según el rol
    if (usuario.rol === 'empleado' || usuario.rol === 'operario') {
      window.location.href = 'produccion.html';
    } else {
      window.location.href = 'dashboard.html';
    }
    return false;
  }
  return true;
}

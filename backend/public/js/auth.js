// Este script se incluye solo en el login.
// Proteger por si se carga en otra página sin #loginForm.
const loginForm = document.getElementById('loginForm');
if (loginForm) {
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const usuario = document.getElementById('usuario').value;
  const password = document.getElementById('password').value;

  try {
    // ✅ CORREGIDO: Agregado /api/ al endpoint
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password })
    });

    // Guardar token y datos del usuario
    localStorage.setItem('token', data.token);
    localStorage.setItem('usuario', JSON.stringify(data.usuario));
    localStorage.setItem('rol', data.usuario.rol);
    localStorage.setItem('usuario_id', data.usuario.id);

    // Redirigir según el rol del usuario
    if (data.usuario.rol === 'empleado') {
      // Los empleados solo tienen acceso a producción
      window.location.href = 'produccion.html';
    } else {
      // Otros roles van al dashboard
      window.location.href = 'dashboard.html';
    }
  } catch (err) {
    document.getElementById('error').innerText = err.error || 'Error de login';
  }
});
}

// Función para verificar autenticación en páginas protegidas
function verificarAuth() {
  const token = localStorage.getItem('token');
  const usuario = localStorage.getItem('usuario');
  
  if (!token || !usuario) {
    window.location.href = 'login.html';
    return null;
  }
  
  return JSON.parse(usuario);
}

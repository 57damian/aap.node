// Helpers de sesión compartidos.
//
// Antes este archivo enganchaba SU PROPIO listener al submit de #loginForm,
// que login.html también tiene en su script inline. Los dos se registraban
// sobre el mismo formulario, así que cada intento de login disparaba DOS
// POST /api/auth/login (el segundo contaba como intento extra para el límite
// de la API), y el catch de acá escribía en un elemento #error que solo
// existe en index.html, con lo cual un login fallido en login.html tiraba
// además un TypeError. El único handler de login vive ahora en login.html.

/** Devuelve el usuario logueado, o redirige al login si no hay sesión. */
function verificarAuth() {
  const token = localStorage.getItem('token');
  const usuario = localStorage.getItem('usuario');

  if (!token || !usuario) {
    window.location.href = 'login.html';
    return null;
  }

  try {
    return JSON.parse(usuario);
  } catch (e) {
    localStorage.clear();
    window.location.href = 'login.html';
    return null;
  }
}

/** Cierra la sesión y vuelve al login. */
function logout() {
  localStorage.clear();
  window.location.href = 'login.html';
}

/** ¿Hay sesión abierta? (lo usa alertas-pagos.js) */
function isAuthenticated() {
  return !!localStorage.getItem('token') && !!localStorage.getItem('usuario');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const usuario = document.getElementById('usuario').value;
  const password = document.getElementById('password').value;

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password })
    });

    localStorage.setItem('rol', data.usuario.rol);
    localStorage.setItem('usuario_id', data.usuario.id);

    window.location.href = 'dashboard.html';
  } catch (err) {
    document.getElementById('error').innerText =
      err.error || 'Error de login';
  }
});

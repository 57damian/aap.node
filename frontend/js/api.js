const API_URL = 'http://localhost:3000';

// =====================
// API FETCH CENTRALIZADO
// =====================
async function apiFetch(endpoint, options = {}) {
  const rol = localStorage.getItem('rol');

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {} // NO agregar Content-Type si es FormData
        : { 'Content-Type': 'application/json' }),
      'rol': rol || '',
      ...(options.headers || {})
    }
  });

  // Manejo global de sesión expirada
  if (response.status === 401) {
    localStorage.clear();
    window.location.href = 'index.html';
    return;
  }

  const contentType = response.headers.get('content-type');

  let data;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    throw data;
  }

  return data;
}

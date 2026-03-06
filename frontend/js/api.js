const API_URL = 'http://localhost:3000';

// =====================
// API FETCH CON JWT
// =====================
async function apiFetch(endpoint, options = {}) {
  // Obtener token del localStorage
  const token = localStorage.getItem('token');
  
  // Preparar headers
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  // Agregar token si existe
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Si es FormData, no poner Content-Type
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers
    });

    // Manejo de respuestas HTTP
    if (response.status === 401) {
      // Token expirado o inválido
      localStorage.clear();
      window.location.href = 'index.html';
      throw new Error('Sesión expirada');
    }

    if (response.status === 403) {
      throw new Error('No tiene permisos para esta acción');
    }

    // Procesar respuesta
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

  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}
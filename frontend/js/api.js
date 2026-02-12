const API_URL = 'http://localhost:3000';

async function apiFetch(endpoint, options = {}) {
  const rol = localStorage.getItem('rol');

  const response = await fetch(`http://localhost:3000${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'rol': rol,
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw data;
  }

  return data;
}

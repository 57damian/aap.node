// Detectar automáticamente la URL del API según el entorno
// En desarrollo: usa localhost:3000
// En producción (Railway): usa la URL relativa (mismo dominio)
const API_URL = (function() {
  // Si estamos en un servidor (no archivo local), usamos URL relativa
  if (window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost') {
    return ''; // URL relativa: las peticiones van al mismo dominio
  }
  return 'http://localhost:3000';
})();

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
      window.location.href = 'login.html';
      throw new Error('Sesión expirada');
    }

    if (response.status === 403) {
      // El backend responde así mientras la contraseña siga siendo la
      // temporal que entregó el administrador: no es falta de permisos, hay
      // que cambiarla antes de seguir.
      let cuerpo = null;
      try { cuerpo = await response.clone().json(); } catch (_) { /* no era JSON */ }

      if (cuerpo && cuerpo.code === 'PASSWORD_CHANGE_REQUIRED') {
        if (window.Shell && typeof Shell.pedirCambioPassword === 'function') {
          Shell.pedirCambioPassword();
        } else {
          // Pantalla vieja, todavía sin el shell: al login, que sabe abrir el
          // cambio obligatorio.
          window.location.href = 'login.html?cambiar=1';
        }
        throw new Error(cuerpo.error || 'Tenés que cambiar tu contraseña');
      }

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

// =====================
// IMÁGENES PROTEGIDAS (/uploads)
// =====================
// Las fotos subidas no son públicas: el server las entrega solo con sesión.
// Un <img src> no manda el token, así que se piden con fetch y se muestran
// como blob local.
async function cargarImagenProtegida(img, ruta) {
  if (!img || !ruta) return;
  try {
    const r = await fetch(API_URL + '/' + String(ruta).replace(/^\/+/, ''), {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const url = URL.createObjectURL(await r.blob());
    if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
    img.dataset.blobUrl = url;
    img.src = url;
  } catch (e) {
    console.warn('No se pudo cargar la imagen:', e.message);
    img.alt = 'No se pudo cargar la imagen';
  }
}

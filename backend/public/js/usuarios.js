// usuarios.js — Gestión de usuarios
//
// Antes todo este código vivía en un <script> de 670 líneas dentro de
// usuarios.html, junto con manejo manual de modales de Bootstrap (crear la
// instancia, destruirla, limpiar el backdrop a mano si quedaba pegado,
// forzar el foco con un setTimeout...). Los tres modales son ahora <dialog>
// nativos: abrir y cerrar es una sola línea, sin la ceremonia de arriba.

let usuarios = [];
let usuarioIdParaReset = null;

document.addEventListener('DOMContentLoaded', () => {
  cargarUsuarios();

  document.getElementById('searchInput')?.addEventListener('input', debounce(cargarUsuarios, 300));
  document.getElementById('filtroRol')?.addEventListener('change', cargarUsuarios);
  document.getElementById('filtroEstado')?.addEventListener('change', cargarUsuarios);

  document.getElementById('password')?.addEventListener('input', function () {
    validatePasswordStrength(this.value);
    if (document.getElementById('confirm_password').value) validatePasswordMatch();
  });
  document.getElementById('confirm_password')?.addEventListener('input', validatePasswordMatch);

  document.getElementById('btnConfirmarReset').addEventListener('click', confirmarResetPassword);
  document.getElementById('btnCopiarTemporal').addEventListener('click', copiarTemporal);
});

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* =====================
   VALIDACIÓN DE CONTRASEÑA EN VIVO
===================== */
function validatePasswordStrength(password) {
  const hint = document.getElementById('passwordHint');
  if (!hint || !password) {
    if (hint) hint.textContent = 'Mínimo 10 caracteres. No puede contener el nombre de usuario.';
    return;
  }

  let puntos = 0;
  if (password.length >= 10) puntos++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) puntos++;
  if (/\d/.test(password)) puntos++;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) puntos++;

  const niveles = ['Débil', 'Débil', 'Media', 'Buena', 'Excelente'];
  hint.textContent = `Fortaleza: ${niveles[puntos]}`;
}

function validatePasswordMatch() {
  const password = document.getElementById('password').value;
  const confirmField = document.getElementById('confirm_password');
  const coincide = confirmField.value.length === 0 || password === confirmField.value;
  confirmField.classList.toggle('is-invalid', !coincide);
}

/* =====================
   LISTADO
===================== */
async function cargarUsuarios() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('searchInput')?.value.trim() || '';
    const rol = document.getElementById('filtroRol')?.value || '';
    const estado = document.getElementById('filtroEstado')?.value || '';

    if (search) params.append('search', search);
    if (rol) params.append('rol', rol);
    if (estado) params.append('activo', estado);

    const response = await apiFetch(`/api/usuarios?${params}`);
    usuarios = response.usuarios || [];
    renderizarUsuarios();

  } catch (error) {
    Shell.error(error, 'No se pudieron cargar los usuarios');
  }
}

function renderizarUsuarios() {
  const tbody = document.getElementById('usuariosGrid');
  if (!tbody) return;

  if (usuarios.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
      'No se encontraron usuarios',
      'No hay usuarios que coincidan con los filtros aplicados.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = usuarios.map(usuario => {
    const rolTexto = getRolLabel(usuario.rol);
    const nombre = usuario.nombre_completo || usuario.nombre_usuario;

    return `
      <tr>
        <td>
          <strong>${nombre}</strong>
          <div class="muted">${usuario.nombre_usuario}</div>
        </td>
        <td data-label="Rol">${Shell.pill(rolTexto)}</td>
        <td data-label="Estado">${Shell.pill(usuario.activo ? 'ACTIVO' : 'INACTIVO')}</td>
        <td class="muted solo-escritorio" data-label="Contacto">
          ${usuario.email || '—'}${usuario.telefono ? ' · ' + usuario.telefono : ''}
        </td>
        <td class="num">
          <button class="b b-ghost b-sm" onclick="editarUsuario(${usuario.id})">Editar</button>
          <button class="b b-ghost b-sm" onclick="resetPassword(${usuario.id})">Restablecer clave</button>
          <button class="b b-ghost b-sm" onclick="eliminarUsuario(${usuario.id})">Eliminar</button>
        </td>
      </tr>`;
  }).join('');
}

function getRolLabel(rol) {
  const roles = { admin: 'Administrador', operario: 'Operario' };
  return roles[rol] || rol;
}

/* =====================
   ALTA / EDICIÓN
===================== */
function abrirModalUsuario(usuarioId = null) {
  const form = document.getElementById('usuarioForm');
  form.reset();
  form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));

  const passwordField = document.getElementById('password');
  const confirmField = document.getElementById('confirm_password');
  passwordField.type = 'password';
  confirmField.type = 'password';

  if (usuarioId) {
    // MODO EDICIÓN: la contraseña se cambia por otro lado (Restablecer clave).
    const usuario = usuarios.find(u => u.id === usuarioId);
    if (!usuario) return;

    document.getElementById('usuarioId').value = usuario.id;
    document.getElementById('nombre_usuario').value = usuario.nombre_usuario || '';
    document.getElementById('email').value = usuario.email || '';
    document.getElementById('rol').value = usuario.rol || '';
    document.getElementById('activo').value = usuario.activo ? 'true' : 'false';
    document.getElementById('nombre_completo').value = usuario.nombre_completo || '';
    document.getElementById('telefono').value = usuario.telefono || '';
    document.getElementById('observaciones').value = usuario.observaciones || '';

    document.getElementById('modalTitle').textContent = 'Editar usuario';
    document.getElementById('passwordGroup').hidden = true;
    document.getElementById('confirmGroup').hidden = true;
    passwordField.required = false;
    confirmField.required = false;

  } else {
    document.getElementById('modalTitle').textContent = 'Nuevo usuario';
    document.getElementById('usuarioId').value = '';
    document.getElementById('passwordGroup').hidden = false;
    document.getElementById('confirmGroup').hidden = false;
    passwordField.required = true;
    confirmField.required = true;
    document.getElementById('activo').value = 'true';
  }

  document.getElementById('usuarioModal').showModal();
  setTimeout(() => form.querySelector('input:not([disabled])')?.focus(), 50);
}

function validarFormulario() {
  const nombreUsuario = document.getElementById('nombre_usuario').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm_password').value;
  const rol = document.getElementById('rol').value;
  const esNuevo = !document.getElementById('usuarioId').value;

  document.querySelectorAll('#usuarioForm .input').forEach(i => i.classList.remove('is-invalid'));

  let error = '';

  if (!nombreUsuario) {
    document.getElementById('nombre_usuario').classList.add('is-invalid');
    error = 'El nombre de usuario es obligatorio';
  } else if (nombreUsuario.length < 3) {
    document.getElementById('nombre_usuario').classList.add('is-invalid');
    error = 'El nombre de usuario debe tener al menos 3 caracteres';
  }

  if (!error && !email) {
    document.getElementById('email').classList.add('is-invalid');
    error = 'El email es obligatorio';
  } else if (!error && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('email').classList.add('is-invalid');
    error = 'El formato del email no es válido';
  }

  if (!error && !rol) {
    document.getElementById('rol').classList.add('is-invalid');
    error = 'Elegí un rol';
  }

  if (!error && esNuevo) {
    if (!password) {
      document.getElementById('password').classList.add('is-invalid');
      error = 'La contraseña es obligatoria';
    } else if (password.length < 10) {
      document.getElementById('password').classList.add('is-invalid');
      error = 'La contraseña debe tener al menos 10 caracteres';
    } else if (nombreUsuario && password.toLowerCase().includes(nombreUsuario.toLowerCase())) {
      document.getElementById('password').classList.add('is-invalid');
      error = 'La contraseña no puede contener el nombre de usuario';
    } else if (password !== confirmPassword) {
      document.getElementById('confirm_password').classList.add('is-invalid');
      error = 'Las contraseñas no coinciden';
    }
  }

  if (error) Shell.toast('err', error);
  return !error;
}

async function guardarUsuario() {
  if (!validarFormulario()) return;

  const boton = document.getElementById('btnGuardarUsuario');
  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    const usuarioId = document.getElementById('usuarioId').value;
    const formData = {
      nombre_usuario: document.getElementById('nombre_usuario').value.trim(),
      email: document.getElementById('email').value.trim(),
      rol: document.getElementById('rol').value,
      activo: document.getElementById('activo').value === 'true',
      nombre_completo: document.getElementById('nombre_completo').value.trim(),
      telefono: document.getElementById('telefono').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };

    if (!usuarioId) formData.password = document.getElementById('password').value;

    await apiFetch(usuarioId ? `/api/usuarios/${usuarioId}` : '/api/usuarios', {
      method: usuarioId ? 'PUT' : 'POST',
      body: JSON.stringify(formData)
    });

    document.getElementById('usuarioModal').close();
    Shell.toast('ok', usuarioId ? 'Usuario actualizado' : 'Usuario creado');
    await cargarUsuarios();

  } catch (error) {
    Shell.error(error, 'No se pudo guardar el usuario');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar usuario';
  }
}

function editarUsuario(usuarioId) {
  abrirModalUsuario(usuarioId);
}

/* =====================
   RESTABLECER CONTRASEÑA DE OTRO USUARIO
===================== */
function resetPassword(usuarioId) {
  const usuario = usuarios.find(u => u.id === usuarioId);
  if (!usuario) return;

  usuarioIdParaReset = usuarioId;
  document.getElementById('resetUsuarioNombre').textContent = usuario.nombre_usuario;
  document.getElementById('resetUsuarioNombre2').textContent = usuario.nombre_usuario;

  // Volver al primer paso por si el modal se abrió antes para otro usuario.
  document.getElementById('resetPaso1').hidden = false;
  document.getElementById('resetPaso2').hidden = true;
  document.getElementById('resetTemporal').value = '';
  const boton = document.getElementById('btnConfirmarReset');
  boton.hidden = false;
  boton.disabled = false;
  boton.textContent = 'Generar contraseña temporal';
  document.getElementById('btnCerrarReset').textContent = 'Cancelar';

  document.getElementById('resetPasswordModal').showModal();
}

async function confirmarResetPassword() {
  const boton = document.getElementById('btnConfirmarReset');
  boton.disabled = true;
  boton.textContent = 'Generando…';

  try {
    // El backend genera la contraseña: no se le manda ninguna.
    const res = await apiFetch(`/api/usuarios/${usuarioIdParaReset}/reset-password`, { method: 'POST' });

    // Se muestra una sola vez, acá. No queda guardada en ningún lado.
    document.getElementById('resetTemporal').value = res.password_temporal;
    document.getElementById('resetPaso1').hidden = true;
    document.getElementById('resetPaso2').hidden = false;
    boton.hidden = true;
    document.getElementById('btnCerrarReset').textContent = 'Listo';

    await cargarUsuarios();
  } catch (error) {
    Shell.error(error, 'No se pudo restablecer la contraseña');
    boton.disabled = false;
    boton.textContent = 'Generar contraseña temporal';
  }
}

function copiarTemporal() {
  const campo = document.getElementById('resetTemporal');
  campo.select();
  const boton = document.getElementById('btnCopiarTemporal');
  // clipboard.writeText no funciona sin HTTPS; execCommand sirve de respaldo
  // en local y en navegadores viejos.
  const copiar = navigator.clipboard
    ? navigator.clipboard.writeText(campo.value)
    : Promise.reject();
  copiar
    .catch(() => document.execCommand('copy'))
    .then(() => { boton.textContent = 'Copiada'; })
    .catch(() => { /* el texto queda seleccionado para copiar a mano */ });
}

/* =====================
   MI PROPIA CONTRASEÑA
===================== */
function abrirModalCambiarPassword() {
  document.getElementById('cambiarPasswordForm').reset();
  document.getElementById('cambiarPasswordModal').showModal();
}

async function cambiarMiPassword() {
  const passActual = document.getElementById('pass_actual').value;
  const passNueva = document.getElementById('pass_nueva').value;
  const passConfirm = document.getElementById('pass_confirm').value;

  if (!passActual || !passNueva || !passConfirm) {
    Shell.toast('err', 'Todos los campos son obligatorios');
    return;
  }
  if (passNueva.length < 10) {
    Shell.toast('err', 'La nueva contraseña debe tener al menos 10 caracteres');
    return;
  }
  if (passNueva !== passConfirm) {
    Shell.toast('err', 'Las contraseñas nuevas no coinciden');
    return;
  }

  try {
    const res = await apiFetch('/api/usuarios/cambiar-password', {
      method: 'PUT',
      body: JSON.stringify({
        password_actual: passActual,
        password_nueva: passNueva,
        password_confirmacion: passConfirm
      })
    });

    // El backend invalida los tokens emitidos antes del cambio y devuelve
    // uno nuevo: guardarlo evita que la próxima acción caiga en un 401.
    if (res.token) localStorage.setItem('token', res.token);

    Shell.toast('ok', 'Contraseña actualizada. Las otras sesiones se cerraron.');
    document.getElementById('cambiarPasswordModal').close();
  } catch (error) {
    Shell.error(error, 'No se pudo cambiar la contraseña');
  }
}

/* =====================
   ELIMINAR
===================== */
async function eliminarUsuario(usuarioId) {
  const usuario = usuarios.find(u => u.id === usuarioId);
  if (!usuario) return;

  if (!confirm(`¿Eliminar al usuario "${usuario.nombre_usuario}"?`)) return;

  try {
    await apiFetch(`/api/usuarios/${usuarioId}`, { method: 'DELETE' });
    Shell.toast('ok', 'Usuario eliminado');
    await cargarUsuarios();
  } catch (error) {
    Shell.error(error, 'No se pudo eliminar el usuario');
  }
}

function limpiarFiltros() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filtroRol').value = '';
  document.getElementById('filtroEstado').value = '';
  cargarUsuarios();
}

function togglePassword(fieldId) {
  const campo = document.getElementById(fieldId);
  const boton = campo.nextElementSibling;
  const esOculto = campo.type === 'password';
  campo.type = esOculto ? 'text' : 'password';
  if (boton) boton.textContent = esOculto ? 'Ocultar' : 'Mostrar';
}

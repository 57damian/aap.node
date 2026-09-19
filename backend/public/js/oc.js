const lista = document.getElementById('listaOC');
const form = document.getElementById('ocForm');

// =====================
// VERIFICAR AUTENTICACION
// =====================
const usuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');

  if (!token || !userStr) {
    window.location.href = 'index.html';
    return null;
  }

  try {
    return JSON.parse(userStr);
  } catch {
    window.location.href = 'index.html';
    return null;
  }
})();

if (!usuario) {
  throw new Error('No autenticado');
}

function setFechaHoy() {
  const fechaInput = document.getElementById('fecha_oc');
  if (!fechaInput) return;
  fechaInput.value = new Date().toISOString().split('T')[0];
}

// =====================
// CARGAR CLIENTES
// =====================
async function cargarClientesSelect() {
  const select = document.getElementById('cliente_id');
  if (!select) return;

  try {
    setFechaHoy();

    const clientes = await apiFetch('/api/clientes');
    select.innerHTML = '<option value="">-- Seleccionar Cliente --</option>';

    clientes.forEach((cliente) => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Error cargando clientes:', err);
    mostrarNotificacion('Error al cargar clientes', 'error');
  }
}

// =====================
// CREAR OC
// =====================
async function handleSubmitOC(e) {
  e.preventDefault();

  const clienteId = Number.parseInt(document.getElementById('cliente_id')?.value, 10);
  const numeroOc = (document.getElementById('numero_oc')?.value || '').trim();
  const fechaOc = document.getElementById('fecha_oc')?.value;

  const data = {
    cliente_id: clienteId,
    numero_oc: numeroOc,
    fecha_oc: fechaOc
  };

  if (!data.cliente_id || !data.numero_oc || !data.fecha_oc) {
    mostrarNotificacion('Complete todos los campos obligatorios', 'warning');
    return;
  }

  try {
    await apiFetch('/api/ordenes-compra', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    if (form) form.reset();
    setFechaHoy();

    mostrarNotificacion('OC creada correctamente', 'success');
    cargarOC();
  } catch (err) {
    console.error('Error creando OC:', err);
    mostrarNotificacion(err.error || err.message || 'Error al crear OC', 'error');
  }
}

// =====================
// LISTAR OCS
// =====================
async function cargarOC() {
  if (!lista) return;

  lista.innerHTML = '<tr><td colspan="5" class="muted">Cargando…</td></tr>';

  try {
    const ocs = await apiFetch('/api/ordenes-compra');

    if (!Array.isArray(ocs) || ocs.length === 0) {
      lista.innerHTML = `<tr><td colspan="5">${Shell.vacio(
        'Todavía no hay órdenes de compra',
        'Creá la primera con el botón "Nueva orden".')}</td></tr>`;
      return;
    }

    lista.innerHTML = ocs.map((oc) => `
      <tr>
        <td><strong>${oc.numero_oc}</strong></td>
        <td data-label="Cliente">${oc.cliente || '—'}</td>
        <td class="muted solo-escritorio" data-label="Fecha">${Shell.fecha(oc.fecha_oc)}</td>
        <td data-label="Estado">${Shell.pill(oc.estado || 'pendiente')}</td>
        <td class="num">
          <button class="b b-ghost b-sm" onclick="verOC(${oc.id})">Ver</button>
        </td>
      </tr>`).join('');

  } catch (err) {
    Shell.error(err, 'No se pudieron cargar las órdenes de compra');
    lista.innerHTML = `<tr><td colspan="5">${Shell.vacio(
      'No se pudo cargar', 'Probá recargar la página.')}</td></tr>`;
  }
}

// =====================
// VER OC
// =====================
function verOC(id) {
  window.location.href = `oc_detalle.html?id=${id}`;
}

// =====================
// NOTIFICACIONES
// =====================
function mostrarNotificacion(mensaje, tipo = 'info') {
  let notificacion = document.querySelector('.notificacion');

  if (!notificacion) {
    notificacion = document.createElement('div');
    notificacion.className = 'notificacion';
    document.body.appendChild(notificacion);
  }

  notificacion.className = `notificacion notificacion-${tipo}`;
  notificacion.textContent = mensaje;
  notificacion.style.display = 'block';

  setTimeout(() => {
    notificacion.style.display = 'none';
  }, 3000);
}

// =====================
// INIT
// =====================
if (form) {
  form.addEventListener('submit', handleSubmitOC);
}

cargarClientesSelect();
cargarOC();

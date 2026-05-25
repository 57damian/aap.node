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

  lista.innerHTML = '<li class="loading"><i class="fas fa-spinner fa-spin"></i> Cargando órdenes...</li>';

  try {
    const ocs = await apiFetch('/api/ordenes-compra');

    if (!Array.isArray(ocs) || ocs.length === 0) {
      lista.innerHTML = '<li class="empty-state"><i class="fas fa-inbox"></i> No hay órdenes de compra</li>';
      return;
    }

    lista.innerHTML = '';
    ocs.forEach((oc) => {
      const li = document.createElement('li');
      li.className = 'oc-item';

      let estadoClass = 'estado-pendiente';
      let estadoIcon = 'fa-clock';

      switch (oc.estado) {
        case 'completa':
          estadoClass = 'estado-completa';
          estadoIcon = 'fa-check-circle';
          break;
        case 'parcial':
          estadoClass = 'estado-parcial';
          estadoIcon = 'fa-truck-loading';
          break;
        case 'pendiente':
        default:
          estadoClass = 'estado-pendiente';
          estadoIcon = 'fa-clock';
      }

      li.innerHTML = `
        <div class="oc-info">
          <div class="oc-header">
            <span class="oc-numero"><i class="fas fa-hashtag"></i> ${oc.numero_oc}</span>
            <span class="oc-estado ${estadoClass}"><i class="fas ${estadoIcon}"></i> ${oc.estado || 'pendiente'}</span>
          </div>
          <div class="oc-cliente"><i class="fas fa-user"></i> ${oc.cliente || '-'}</div>
          <div class="oc-fecha"><i class="fas fa-calendar"></i> ${oc.fecha_oc ? new Date(oc.fecha_oc).toLocaleDateString('es-AR') : '-'}</div>
        </div>
        <div class="oc-actions">
          <button class="btn-view" onclick="verOC(${oc.id})" title="Ver detalle">
            <i class="fas fa-eye"></i> Ver Detalle
          </button>
        </div>
      `;

      lista.appendChild(li);
    });
  } catch (err) {
    console.error('Error cargando OCs:', err);
    lista.innerHTML = `<li class="error-state"><i class="fas fa-exclamation-triangle"></i> Error cargando OCs: ${err.error || err.message || 'Error desconocido'}</li>`;
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

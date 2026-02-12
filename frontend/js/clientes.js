let editMode = false;
let currentId = null;
let currentCliente = null;

// =====================
// DEBUG INIT
// =====================
console.log('🔍 clientes.js cargado');
console.log('👤 localStorage.rol:', localStorage.getItem('rol'));

if (!localStorage.getItem('rol')) {
  console.warn('❌ No hay rol en localStorage, redirigiendo a login...');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 100);
  throw new Error('No autenticado');
}

// =====================
// INICIALIZAR
// =====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ DOMContentLoaded - Adjuntando event listeners');
  
  const form = document.getElementById('clienteForm');
  if (form) {
    form.addEventListener('submit', handleSubmit);
    console.log('✅ Event listener "submit" adjuntado al formulario');
  } else {
    console.error('❌ Formulario #clienteForm no encontrado');
  }
  
  // Cerrar modal al hacer clic fuera
  window.onclick = function(event) {
    const modal = document.getElementById('detailModal');
    if (event.target == modal) {
      closeDetailModal();
    }
  }
  
  cargarClientes();
});

// =====================
// CARGAR LISTA DE CLIENTES
// =====================
async function cargarClientes() {
  try {
    const clientes = await apiFetch('/clientes');
    const tbody = document.getElementById('clientesList');
    tbody.innerHTML = '';

    if (!clientes.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:20px;">
            No hay clientes creados
          </td>
        </tr>
      `;
      return;
    }

    clientes.forEach(cliente => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${cliente.id}</td>
        <td>${cliente.nombre}</td>
        <td>${cliente.cuit || '-'}</td>
        <td>${cliente.telefono || '-'}</td>
        <td>${getFormaPagoLabel(cliente.forma_pago)}</td>
        <td>
          <button onclick="verDetalles(${cliente.id})">Ver</button>
          <button onclick="editarCliente(${cliente.id})">Editar</button>
          ${rolPermiteEliminar() ? 
            `<button onclick="confirmarEliminar(${cliente.id}, '${cliente.nombre}')">Eliminar</button>` 
            : ''
          }
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    showAlert(err.error || err.message || 'Error cargando clientes', 'error');
  }
}


// =====================
// FUNCIÓN AUXILIAR: Obtener label de forma de pago
// =====================
// =====================
// FUNCIÓN AUXILIAR: Obtener label de forma de pago - ACTUALIZADA
// =====================
function getFormaPagoLabel(formaPago) {
  const labels = {
    'contado': 'Contado',
    'cheque': 'Cheque',
    'transferencia': 'Transferencia',
    'otro': 'Otro',
    '': '-'
  };
  return labels[formaPago] || formaPago || '-';
}
// =====================
// VER DETALLES (MODAL)
// =====================
async function verDetalles(id) {
  try {
    const cliente = await apiFetch(`/clientes/${id}`);
    currentCliente = cliente;
    
    const content = document.getElementById('detailContent');
    const title = document.getElementById('detailNombre');
    
    title.textContent = `👥 ${cliente.nombre || 'Sin nombre'} - Ficha del Cliente`;
    
    // Construir contenido del modal
    let html = `
      <!-- INFORMACIÓN GENERAL -->
      <div class="detail-section">
        <div class="detail-section-title">📋 Información General</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">ID</div>
            <div class="detail-value">#${cliente.id}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Nombre</div>
            <div class="detail-value"><strong>${cliente.nombre || '-'}</strong></div>
          </div>
          <div class="detail-item">
            <div class="detail-label">CUIT</div>
            <div class="detail-value">${cliente.cuit || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Teléfono</div>
            <div class="detail-value">${cliente.telefono || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Correo</div>
            <div class="detail-value">${cliente.correo || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Dirección</div>
            <div class="detail-value">${cliente.direccion || '-'}</div>
          </div>
        </div>
      </div>

      <!-- CONDICIONES DE PAGO -->
      <div class="detail-section">
        <div class="detail-section-title">💳 Condiciones de Pago</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">Forma de Pago</div>
            <div class="detail-value">${getFormaPagoLabel(cliente.forma_pago)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Días Máximo de Pago</div>
            <div class="detail-value">${cliente.dias_max_pago || '-'} días</div>
          </div>
        </div>
      </div>
      
      <!-- OBSERVACIONES -->
      <div class="detail-section">
        <div class="detail-section-title">📝 Observaciones</div>
        <div class="detail-value" style="white-space: pre-wrap; padding: 15px; background: #fff9e6; border-radius: 6px; min-height: 60px;">
          ${cliente.observaciones || 'Sin observaciones'}
        </div>
      </div>
    `;
    
    content.innerHTML = html;
    document.getElementById('detailModal').style.display = 'block';
  } catch (err) {
    console.error('Error al cargar detalles:', err);
    showAlert('Error al cargar detalles: ' + (err.error || err.message), 'error');
  }
}

// =====================
// CERRAR MODAL
// =====================
function closeDetailModal() {
  document.getElementById('detailModal').style.display = 'none';
  currentCliente = null;
}

// =====================
// VERIFICAR SI EL ROL PERMITE ELIMINAR
// =====================
function rolPermiteEliminar() {
  const rol = localStorage.getItem('rol');
  return rol === 'admin' || rol === 'control';
}

// =====================
// CONFIRMAR ELIMINAR
// =====================
function confirmarEliminar(id, nombre) {
  if (confirm(`⚠️ ¿Estás seguro de eliminar al cliente "${nombre}"?\n\nEsta acción no se puede deshacer.`)) {
    eliminarCliente(id);
  }
}

// =====================
// ELIMINAR CLIENTE - CORREGIDO
// =====================
async function eliminarCliente(id) {
  try {
    await apiFetch(`/clientes/${id}`, {
      method: 'DELETE'
    });

    showAlert('Cliente eliminado correctamente', 'success');
    cargarClientes();

  } catch (err) {
    showAlert(err.error || err.message || 'Error al eliminar', 'error');
  }
}

// =====================
// SUBMIT FORMULARIO
// =====================
async function handleSubmit(e) {
  e.preventDefault();
  console.log('📤 Submit del formulario (prevención activa)');
  
  const data = {
    nombre: document.getElementById('nombre').value,
    cuit: document.getElementById('cuit').value,
    telefono: document.getElementById('telefono').value,
    correo: document.getElementById('correo').value,
    direccion: document.getElementById('direccion').value,
    forma_pago: document.getElementById('forma_pago').value,
    dias_max_pago: parseInt(document.getElementById('dias_max_pago').value) || null,
    observaciones: document.getElementById('observaciones').value
  };

  try {
    let response;
    
    if (editMode) {
      // Actualizar
      response = await apiFetch(`/clientes/${currentId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      
      showAlert('Cliente actualizado correctamente', 'success');
    } else {
      // Crear
      response = await apiFetch('/clientes', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      console.log('✅ Cliente creado:', response);
      showAlert('Cliente creado correctamente', 'success');
    }

    resetForm();
    cargarClientes();
    showTab('listar');
  } catch (err) {
    console.error('❌ Error en submit:', err);
    showAlert(err.error || err.message || 'Error al guardar', 'error');
  }
}

// =====================
// EDITAR CLIENTE
// =====================
async function editarCliente(id) {
  try {
    const cliente = await apiFetch(`/clientes/${id}`);
    
    // Rellenar formulario
    document.getElementById('nombre').value = cliente.nombre || '';
    document.getElementById('cuit').value = cliente.cuit || '';
    document.getElementById('telefono').value = cliente.telefono || '';
    document.getElementById('correo').value = cliente.correo || '';
    document.getElementById('direccion').value = cliente.direccion || '';
    document.getElementById('forma_pago').value = cliente.forma_pago || '';
    document.getElementById('dias_max_pago').value = cliente.dias_max_pago || '';
    document.getElementById('observaciones').value = cliente.observaciones || '';
    
    editMode = true;
    currentId = id;
    
    showTab('crear');
    showAlert('Editando cliente ID: ' + id, 'success');
  } catch (err) {
    console.error('Error al cargar cliente:', err);
    showAlert('Error al cargar cliente: ' + (err.error || err.message), 'error');
  }
}

// =====================
// RESET FORMULARIO
// =====================
function resetForm() {
  document.getElementById('clienteForm').reset();
  editMode = false;
  currentId = null;
  document.getElementById('alert').style.display = 'none';
}

// =====================
// MOSTRAR TAB
// =====================
function showTab(tabName, event) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const tabElement = document.getElementById(tabName);
  if (tabElement) {
    tabElement.classList.add('active');
  }
  
  if (event && event.target) {
    event.target.classList.add('active');
  }
  
  if (tabName === 'listar') {
    cargarClientes();
  }
}

// =====================
// ALERTA
// =====================
function showAlert(message, type) {
  const alertDiv = document.getElementById('alert');
  alertDiv.textContent = message;
  alertDiv.className = type === 'success' ? 'alert alert-success' : 'alert alert-error';
  alertDiv.style.display = 'block';
  
  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 3000);
}

// =====================
// LOGOUT
// =====================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}
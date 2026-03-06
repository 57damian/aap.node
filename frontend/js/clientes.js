let editMode = false;
let currentId = null;
let currentCliente = null;



// =====================
// VERIFICAR AUTENTICACIÃƒâ€œN
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




if (!usuario || !usuario.rol) {
  console.warn('No hay rol de usuario vÃƒÂ¡lido, redirigiendo a login...');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 100);
  throw new Error('No autenticado');
}

// =====================
// INICIALIZAR
// =====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('Ã¢Å“â€¦ DOMContentLoaded - Adjuntando event listeners');
  
  const form = document.getElementById('clienteForm');
  if (form) {
    form.addEventListener('submit', handleSubmit);
    console.log('Ã¢Å“â€¦ Event listener "submit" adjuntado al formulario');
  } else {
    console.error('Ã¢ÂÅ’ Formulario #clienteForm no encontrado');
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
    const clientes = await apiFetch('/api/clientes');
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
// FUNCIÃƒâ€œN AUXILIAR: Obtener label de forma de pago
// =====================
// =====================
// FUNCIÃƒâ€œN AUXILIAR: Obtener label de forma de pago - ACTUALIZADA
// =====================
function getFormaPagoLabel(formaPago) {
  const labels = {
    'contado': 'Contado',
    'cheque': 'Cheque',
    'transferencia': 'Transferencia',
    'otro': 'Otro',
    '': 'No especificado'
  };
  return labels[formaPago] || formaPago || 'No especificado';
}
// =====================
// VER DETALLES (MODAL) - VERSIÃ“N MEJORADA
// =====================
async function verDetalles(id) {
  try {
    const cliente = await apiFetch(`/api/clientes/${id}`);
    currentCliente = cliente;
    
    const content = document.getElementById('detailContent');
    const title = document.getElementById('detailNombre');
    
    title.textContent = `ðŸ‘¥ ${cliente.nombre || 'Sin nombre'} - Ficha Completa`;
    
    // Determinar clase para badge de forma de pago
    const formaPagoClass = {
      'contado': 'badge-contado',
      'cheque': 'badge-cheque',
      'transferencia': 'badge-transferencia',
      'otro': 'badge-otro'
    }[cliente.forma_pago] || 'badge-otro';
    
    // Construir contenido del modal con diseÃ±o mejorado
    let html = `
      <!-- Tarjeta de informaciÃ³n general -->
      <div class="detail-card">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
          <span style="font-size: 1.5rem;">ðŸ“Œ</span>
          <h3 style="margin: 0; color: #007bff;">InformaciÃ³n General</h3>
        </div>
        
        <div class="detail-grid-modern">
          <div class="detail-item-modern">
            <div class="detail-label-modern">ID Cliente</div>
            <div class="detail-value-modern">#${cliente.id}</div>
          </div>
          
          <div class="detail-item-modern">
            <div class="detail-label-modern">Nombre</div>
            <div class="detail-value-modern"><strong>${cliente.nombre || '-'}</strong></div>
          </div>
          
          <div class="detail-item-modern">
            <div class="detail-label-modern">CUIT</div>
            <div class="detail-value-modern">${cliente.cuit || '-'}</div>
          </div>
          
          <div class="detail-item-modern">
            <div class="detail-label-modern">TelÃ©fono</div>
            <div class="detail-value-modern">
              ${cliente.telefono ? `ðŸ“ž ${cliente.telefono}` : '-'}
            </div>
          </div>
          
          <div class="detail-item-modern">
            <div class="detail-label-modern">Correo</div>
            <div class="detail-value-modern">
              ${cliente.correo ? `âœ‰ï¸ ${cliente.correo}` : '-'}
            </div>
          </div>
          
          <div class="detail-item-modern">
            <div class="detail-label-modern">DirecciÃ³n</div>
            <div class="detail-value-modern">
              ${cliente.direccion ? `ðŸ“ ${cliente.direccion}` : '-'}
            </div>
          </div>
        </div>
      </div>

      <div class="section-divider"></div>

      <!-- Tarjeta de condiciones de pago -->
      <div class="detail-card" style="border-left-color: #28a745;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
          <span style="font-size: 1.5rem;">ðŸ’³</span>
          <h3 style="margin: 0; color: #28a745;">Condiciones de Pago</h3>
        </div>
        
        <div class="detail-grid-modern">
          <div class="detail-item-modern">
            <div class="detail-label-modern">Forma de Pago</div>
            <div class="detail-value-modern">
              <span class="badge-pago ${formaPagoClass}">
                ${getFormaPagoLabel(cliente.forma_pago)}
              </span>
            </div>
          </div>
          
          <div class="detail-item-modern">
            <div class="detail-label-modern">DÃ­as MÃ¡ximo de Pago</div>
            <div class="detail-value-modern">
              ${cliente.dias_max_pago ? `
                <span style="font-weight: bold; color: #007bff;">${cliente.dias_max_pago}</span> dÃ­as
              ` : 'No especificado'}
            </div>
          </div>
        </div>
      </div>

      <div class="section-divider"></div>

      <!-- Tarjeta de observaciones -->
      <div class="detail-card" style="border-left-color: #ffc107;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
          <span style="font-size: 1.5rem;">ðŸ“</span>
          <h3 style="margin: 0; color: #856404;">Observaciones</h3>
        </div>
        
        <div class="observaciones-box">
          ${cliente.observaciones ? 
            cliente.observaciones.replace(/\n/g, '<br>') : 
            '<span style="color: #999;">Sin observaciones registradas</span>'
          }
        </div>
      </div>
    `;
    
    // Si el usuario tiene permisos, mostrar informaciÃ³n financiera adicional
    if (usuario.rol === 'admin' || usuario.rol === 'control') {
      try {
        // Intentar cargar estado financiero
        const estado = await apiFetch(`/api/clientes/${id}/estado`);
        html += `
          <div class="section-divider"></div>
          
          <!-- Tarjeta de estado financiero -->
          <div class="detail-card" style="border-left-color: #17a2b8;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
              <span style="font-size: 1.5rem;">ðŸ’°</span>
              <h3 style="margin: 0; color: #17a2b8;">Estado Financiero</h3>
            </div>
            
            <div class="detail-grid-modern">
              <div class="detail-item-modern">
                <div class="detail-label-modern">Total Facturado</div>
                <div class="detail-value-modern" style="color: #007bff;">
                  $${estado.total_facturado.toFixed(2)}
                </div>
              </div>
              
              <div class="detail-item-modern">
                <div class="detail-label-modern">Total Pagado</div>
                <div class="detail-value-modern" style="color: #28a745;">
                  $${estado.total_pagado.toFixed(2)}
                </div>
              </div>
              
              <div class="detail-item-modern">
                <div class="detail-label-modern">Saldo Pendiente</div>
                <div class="detail-value-modern" style="color: ${estado.saldo > 0 ? '#dc3545' : '#28a745'}; font-weight: bold;">
                  $${estado.saldo.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        `;
      } catch (e) {
        console.log('No se pudo cargar estado financiero:', e);
      }
    }
    
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
  return usuario.rol === 'admin' || usuario.rol === 'control';
}

// =====================
// CONFIRMAR ELIMINAR - CON MODAL PERSONALIZADO
// =====================
function confirmarEliminar(id, nombre) {
  const modalHtml = `
    <div id="confirmModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999;">
      <div style="background:white; padding:25px; border-radius:8px; max-width:400px; width:90%; box-shadow:0 4px 20px rgba(0,0,0,0.2);">
        <div style="text-align:center; margin-bottom:20px;">
          <span style="font-size:48px;">!</span>
          <h3 style="margin:10px 0; color:#721c24;">Confirmar Eliminacion</h3>
        </div>
        <p style="margin-bottom:20px; text-align:center;">
          Estas seguro de eliminar al cliente <strong>"${nombre}"</strong>?<br>
          <span style="color:#dc3545; font-size:0.9rem;">Esta accion no se puede deshacer.</span>
        </p>
        <div style="display:flex; gap:10px; justify-content:center;">
          <button id="cancelDelete" style="padding:10px 20px; background:#6c757d; color:white; border:none; border-radius:4px; cursor:pointer;">Cancelar</button>
          <button id="confirmDelete" style="padding:10px 20px; background:#dc3545; color:white; border:none; border-radius:4px; cursor:pointer;">Eliminar</button>
        </div>
      </div>
    </div>
  `;

  const modalContainer = document.createElement('div');
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  document.getElementById('cancelDelete').addEventListener('click', () => {
    document.body.removeChild(modalContainer);
  });

  document.getElementById('confirmDelete').addEventListener('click', async () => {
    document.body.removeChild(modalContainer);
    await eliminarCliente(id);
  });
}

// =====================
// ELIMINAR CLIENTE - CON FEEDBACK
// =====================
async function eliminarCliente(id) {
  try {
    showAlert('Eliminando cliente...', 'info');

    await apiFetch(`/api/clientes/${id}`, {
      method: 'DELETE'
    });

    showAlert('Cliente eliminado correctamente', 'success');
    cargarClientes();

  } catch (err) {
    if (err.error && err.error.includes('foreign key')) {
      showAlert('No se puede eliminar: El cliente tiene facturas o pagos asociados', 'error');
    } else {
      showAlert(err.error || err.message || 'Error al eliminar', 'error');
    }
  }
}

// =====================
// SUBMIT FORMULARIO
// =====================
async function handleSubmit(e) {
  e.preventDefault();
  console.log('Ã°Å¸â€œÂ¤ Submit del formulario (prevenciÃƒÂ³n activa)');
  
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
      response = await apiFetch(`/api/clientes/${currentId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      
      showAlert('Cliente actualizado correctamente', 'success');
    } else {
      // Crear
      response = await apiFetch('/api/clientes', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      
      console.log('Ã¢Å“â€¦ Cliente creado:', response);
      showAlert('Cliente creado correctamente', 'success');
    }

    resetForm();
    cargarClientes();
    showTab('listar');
  } catch (err) {
    console.error('Ã¢ÂÅ’ Error en submit:', err);
    showAlert(err.error || err.message || 'Error al guardar', 'error');
  }
}

// =====================
// EDITAR CLIENTE - VERSION MEJORADA
// =====================
async function editarCliente(id) {
  try {
    showAlert('Cargando datos del cliente...', 'info');

    const cliente = await apiFetch(`/api/clientes/${id}`);

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
    showAlert(`Editando cliente: ${cliente.nombre}`, 'success');
    document.getElementById('clienteForm').scrollIntoView({ behavior: 'smooth' });

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
// ALERTA MEJORADA
// =====================
function showAlert(message, type) {
  const alertDiv = document.getElementById('alert');

  const icons = {
    success: '[OK]',
    error: '[X]',
    info: '[i]',
    warning: '[!]'
  };

  alertDiv.innerHTML = `${icons[type] || ''} ${message}`;
  alertDiv.className = `alert alert-${type}`;
  alertDiv.style.display = 'block';

  if (type !== 'error') {
    setTimeout(() => {
      alertDiv.style.opacity = '0';
      setTimeout(() => {
        alertDiv.style.display = 'none';
        alertDiv.style.opacity = '1';
      }, 300);
    }, 3000);
  }
}

// =====================
// LOGOUT
// =====================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}





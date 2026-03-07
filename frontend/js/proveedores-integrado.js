// ===================== PROVEEDORES-INTEGRADO.JS =====================
// Este archivo maneja SOLO el ABM de proveedores
// VERIFICAR AUTENTICACIÓN
const usuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');

  if (!token || !userStr) {
    window.location.href = 'login.html';
    return null;
  }

  try {
    return JSON.parse(userStr);
  } catch {
    window.location.href = 'login.html';
    return null;
  }
})();

if (!usuario) {
  throw new Error('No autenticado');
}

// ===================== ESTADO LOCAL =====================
let proveedoresCache = [];
let proveedorActual = null;

// ===================== INICIALIZACIÓN =====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('Inicializando módulo de proveedores...');
  
  // Verificar que estamos en la página correcta
  if (!document.getElementById('proveedoresTableBody')) {
    console.warn('No se encontró la tabla de proveedores');
    return;
  }

  // Event listeners para búsquedas
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') cargarProveedores();
    });
  }

  const filtroEstado = document.getElementById('filtroEstado');
  if (filtroEstado) {
    filtroEstado.addEventListener('change', () => cargarProveedores());
  }

  // Inicializar tooltips de Bootstrap
  if (typeof bootstrap !== 'undefined') {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  }

  // Cargar datos iniciales
  cargarProveedores();
  actualizarEstadisticasIniciales();

  // Configurar fecha actual en inputs de fecha
  const hoy = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(input => {
    if (!input.value) input.value = hoy;
  });
});

// ===================== FUNCIONES DE UTILIDAD =====================
function formatearMoneda(valor) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  }).format(valor || 0);
}

function formatearFecha(fecha) {
  if (!fecha) return '-';
  return new Date(fecha).toLocaleDateString('es-AR');
}

function getBadgeEstado(estado) {
  const badges = {
    'PENDIENTE': '<span class="badge bg-warning">PENDIENTE</span>',
    'PAGADA': '<span class="badge bg-success">PAGADA</span>',
    'ANULADA': '<span class="badge bg-danger">ANULADA</span>',
    'ACTIVO': '<span class="badge bg-success">ACTIVO</span>',
    'INACTIVO': '<span class="badge bg-secondary">INACTIVO</span>'
  };
  return badges[estado] || '<span class="badge bg-secondary">' + estado + '</span>';
}

function mostrarNotificacion(mensaje, tipo = 'success') {
  const iconos = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  alert(iconos[tipo] + ' ' + mensaje);
}

function actualizarEstadisticasIniciales() {
  // Valores por defecto mientras se cargan los datos
  document.getElementById('totalProveedores').textContent = '0';
  document.getElementById('proveedoresActivos').textContent = '0';
  document.getElementById('deudaTotal').textContent = '$0';
  document.getElementById('comprasMes').textContent = '0';
}

// ===================== CARGAR PROVEEDORES =====================
async function cargarProveedores() {
  const tbody = document.getElementById('proveedoresTableBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Cargando...</span>
          </div>
        </td>
      </tr>
    `;

    const search = document.getElementById('searchInput')?.value || '';
    const estado = document.getElementById('filtroEstado')?.value || 'activos';

    const params = new URLSearchParams();
    if (search.trim() !== '') params.append('search', search.trim());
    if (estado && estado !== 'todos') params.append('estado', estado);

    const endpoint = `/api/proveedores${params.toString() ? `?${params.toString()}` : ''}`;
    console.log('Cargando proveedores desde:', endpoint);
    
    const proveedores = await apiFetch(endpoint);
    console.log('Proveedores cargados:', proveedores);
    
    proveedoresCache = Array.isArray(proveedores) ? proveedores : [];
    actualizarEstadisticasProveedores(proveedoresCache);

    tbody.innerHTML = '';

    if (!proveedoresCache.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-3">
            No se encontraron proveedores
          </td>
        </tr>
      `;
      return;
    }

    proveedoresCache.forEach((p) => {
      const tr = document.createElement('tr');
      const deuda = Number(p.deuda_pendiente || 0);
      
      tr.innerHTML = `
        <td>
          <strong>${p.nombre || '-'}</strong><br>
          <small class="text-muted">${p.cuit || ''}</small>
        </td>
        <td>
          ${p.contacto ? '<strong>Contacto:</strong> ' + p.contacto + '<br>' : ''}
          ${p.telefono ? '📞 ' + p.telefono + '<br>' : ''}
          ${p.email ? '✉️ ' + p.email : ''}
        </td>
        <td class="text-center">
          <strong>${p.total_compras || 0}</strong><br>
          <small class="text-muted">compras</small>
        </td>
        <td class="text-end">
          <strong class="${deuda > 0 ? 'text-danger' : 'text-success'}">
            ${formatearMoneda(deuda)}
          </strong>
        </td>
        <td class="text-center">
          <span class="badge ${p.activo ? 'bg-success' : 'bg-secondary'}">
            ${p.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="text-center">
          <div class="btn-group btn-group-sm" role="group">
            <button class="btn btn-outline-primary" onclick="verDetalleProveedor(${p.id})" 
                    data-bs-toggle="tooltip" title="Ver detalle">
              <i class="fas fa-eye"></i>
            </button>
            <button class="btn btn-outline-secondary" onclick="editarProveedor(${p.id})"
                    data-bs-toggle="tooltip" title="Editar">
              <i class="fas fa-edit"></i>
            </button>
            ${usuario.rol === 'admin' ? `
              <button class="btn btn-outline-danger" onclick="confirmarEliminarProveedor(${p.id}, '${(p.nombre || '').replace(/'/g, "\\'")}')"
                      data-bs-toggle="tooltip" title="Eliminar/Desactivar">
                <i class="fas fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // Reactivar tooltips
    if (typeof bootstrap !== 'undefined') {
      const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
      tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
      });
    }

  } catch (err) {
    console.error('Error cargando proveedores:', err);
    mostrarNotificacion(err.error || err.message || 'Error cargando proveedores', 'error');
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-danger py-3">
          Error al cargar proveedores: ${err.message || 'Error de conexión'}
        </td>
      </tr>
    `;
  }
}

function actualizarEstadisticasProveedores(proveedores) {
  try {
    const total = proveedores.length;
    const activos = proveedores.filter(p => p.activo).length;
    const deudaTotal = proveedores.reduce((sum, p) => sum + Number(p.deuda_pendiente || 0), 0);
    const comprasMes = proveedores.reduce((sum, p) => sum + Number(p.compras_mes || 0), 0);

    const totalEl = document.getElementById('totalProveedores');
    const activosEl = document.getElementById('proveedoresActivos');
    const deudaEl = document.getElementById('deudaTotal');
    const comprasEl = document.getElementById('comprasMes');

    if (totalEl) totalEl.textContent = total;
    if (activosEl) activosEl.textContent = activos;
    if (deudaEl) deudaEl.textContent = formatearMoneda(deudaTotal);
    if (comprasEl) comprasEl.textContent = comprasMes;
  } catch (err) {
    console.error('Error actualizando estadísticas:', err);
  }
}

// ===================== FUNCIONES DEL MODAL PROVEEDOR =====================
function abrirModalProveedor() {
  const form = document.getElementById('proveedorForm');
  if (form) form.reset();

  document.getElementById('proveedorId').value = '';
  document.getElementById('modalTitle').textContent = 'Nuevo Proveedor';
  
  const estadoField = document.getElementById('estadoField');
  if (estadoField) estadoField.style.display = 'none';

  const modalEl = document.getElementById('proveedorModal');
  if (!modalEl) return;

  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}

async function editarProveedor(id) {
  try {
    console.log('Editando proveedor ID:', id);
    
    const proveedor = await apiFetch(`/api/proveedores/${id}`);
    console.log('Datos del proveedor:', proveedor);

    document.getElementById('proveedorId').value = proveedor.id;
    document.getElementById('nombre').value = proveedor.nombre || '';
    document.getElementById('cuit').value = proveedor.cuit || '';
    document.getElementById('telefono').value = proveedor.telefono || '';
    document.getElementById('email').value = proveedor.email || '';
    document.getElementById('direccion').value = proveedor.direccion || '';
    document.getElementById('contacto').value = proveedor.contacto || '';
    document.getElementById('condicion_iva').value = proveedor.condicion_iva || 'RESPONSABLE INSCRIPTO';
    document.getElementById('observaciones').value = proveedor.observaciones || '';

    const estadoField = document.getElementById('estadoField');
    const activoSelect = document.getElementById('activo');
    if (estadoField && activoSelect) {
      estadoField.style.display = 'block';
      activoSelect.value = proveedor.activo ? 'true' : 'false';
    }

    document.getElementById('modalTitle').textContent = `Editar Proveedor: ${proveedor.nombre}`;

    const modalEl = document.getElementById('proveedorModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  } catch (err) {
    console.error('Error editando proveedor:', err);
    mostrarNotificacion(err.error || err.message || 'Error al cargar proveedor', 'error');
  }
}

async function guardarProveedor() {
  const id = document.getElementById('proveedorId').value;

  // Validación básica de CUIT (opcional)
  const cuit = document.getElementById('cuit').value.trim();
  if (cuit && !/^\d{2}-\d{8}-\d{1}$/.test(cuit)) {
    if (!confirm('El formato del CUIT no es válido (debe ser XX-XXXXXXXX-X). ¿Desea continuar de todas formas?')) {
      return;
    }
  }

  const data = {
    nombre: document.getElementById('nombre').value.trim(),
    cuit: cuit || null,
    telefono: document.getElementById('telefono').value.trim() || null,
    email: document.getElementById('email').value.trim() || null,
    direccion: document.getElementById('direccion').value.trim() || null,
    contacto: document.getElementById('contacto').value.trim() || null,
    condicion_iva: document.getElementById('condicion_iva').value || null,
    observaciones: document.getElementById('observaciones').value.trim() || null
  };

  if (!data.nombre) {
    mostrarNotificacion('El nombre es obligatorio', 'error');
    return;
  }

  // Estado sólo si se está editando
  if (id) {
    const activoSelect = document.getElementById('activo');
    if (activoSelect) {
      data.activo = activoSelect.value === 'true';
    }
  }

  try {
    console.log('Guardando proveedor:', id ? 'EDITANDO' : 'NUEVO', data);
    
    const options = {
      method: id ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    };

    const endpoint = id ? `/api/proveedores/${id}` : '/api/proveedores';
    await apiFetch(endpoint, options);

    mostrarNotificacion(id ? '✅ Proveedor actualizado correctamente' : '✅ Proveedor creado correctamente');

    const modalEl = document.getElementById('proveedorModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) modal.hide();

    cargarProveedores();
  } catch (err) {
    console.error('Error guardando proveedor:', err);
    mostrarNotificacion(err.error || err.message || 'Error al guardar proveedor', 'error');
  }
}

function confirmarEliminarProveedor(id, nombre) {
  const mensaje = `¿Está seguro de eliminar/desactivar al proveedor "${nombre}"?\n\n` +
                  `• Si tiene compras asociadas se DESACTIVARÁ\n` +
                  `• Si NO tiene compras se ELIMINARÁ permanentemente`;
  
  if (confirm(mensaje)) {
    eliminarProveedor(id);
  }
}

async function eliminarProveedor(id) {
  try {
    console.log('Eliminando/desactivando proveedor ID:', id);
    
    await apiFetch(`/api/proveedores/${id}`, { 
      method: 'DELETE' 
    });
    
    mostrarNotificacion('Operación realizada correctamente');
    cargarProveedores();
  } catch (err) {
    console.error('Error eliminando proveedor:', err);
    mostrarNotificacion(err.error || err.message || 'Error al eliminar proveedor', 'error');
  }
}

// ===================== VER DETALLE PROVEEDOR =====================
async function verDetalleProveedor(id) {
  const detalleContent = document.getElementById('detalleContent');
  if (!detalleContent) return;

  detalleContent.innerHTML = `
    <div class="text-center py-4">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Cargando...</span>
      </div>
    </div>
  `;

  try {
    console.log('Cargando detalle del proveedor ID:', id);
    
    const proveedor = proveedoresCache.find(p => p.id === id) || await apiFetch(`/api/proveedores/${id}`);
    
    // Intentar cargar datos adicionales
    let compras = [];
    let resumen = {};
    
    try {
      compras = await apiFetch(`/api/proveedores/${id}/compras`);
    } catch (err) {
      console.warn('No se pudieron cargar compras del proveedor:', err);
    }
    
    try {
      resumen = await apiFetch(`/api/proveedores/${id}/resumen`);
    } catch (err) {
      console.warn('No se pudo cargar resumen del proveedor:', err);
    }

    const deuda = Number(proveedor.deuda_pendiente || resumen.deuda_pendiente || 0);

    // Últimas 5 compras
    const ultimasCompras = (compras || []).slice(0, 5);
    let comprasHtml = '';
    if (!ultimasCompras.length) {
      comprasHtml = '<p class="text-muted mb-0">Sin compras registradas</p>';
    } else {
      comprasHtml = `
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${ultimasCompras.map(c => `
                <tr>
                  <td>${formatearFecha(c.fecha_compra)}</td>
                  <td>${c.numero_comprobante || '-'}</td>
                  <td class="text-end">${formatearMoneda(c.total)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    detalleContent.innerHTML = `
      <div class="row">
        <div class="col-md-5">
          <div class="card mb-3">
            <div class="card-header bg-primary text-white">
              <h6 class="mb-0">${proveedor.nombre}</h6>
            </div>
            <div class="card-body">
              <p><strong>CUIT:</strong> ${proveedor.cuit || '-'}</p>
              <p><strong>Dirección:</strong> ${proveedor.direccion || '-'}</p>
              <p><strong>Teléfono:</strong> ${proveedor.telefono || '-'}</p>
              <p><strong>Email:</strong> ${proveedor.email || '-'}</p>
              <p><strong>Contacto:</strong> ${proveedor.contacto || '-'}</p>
              <p><strong>Condición IVA:</strong> ${proveedor.condicion_iva || '-'}</p>
              <p><strong>Observaciones:</strong> ${proveedor.observaciones || '-'}</p>
              <p>
                <strong>Estado:</strong> 
                <span class="badge ${proveedor.activo ? 'bg-success' : 'bg-secondary'}">
                  ${proveedor.activo ? 'Activo' : 'Inactivo'}
                </span>
              </p>
            </div>
          </div>

          <div class="card">
            <div class="card-header bg-info text-white">
              <h6 class="mb-0">Resumen Financiero</h6>
            </div>
            <div class="card-body">
              <p><strong>Total compras:</strong> ${resumen.total_compras || proveedor.total_compras || 0}</p>
              <p><strong>Monto total compras:</strong> ${formatearMoneda(resumen.monto_total_compras || 0)}</p>
              <p><strong>Deuda actual:</strong> <span class="text-danger fw-bold">${formatearMoneda(deuda)}</span></p>
            </div>
          </div>
        </div>

        <div class="col-md-7">
          <h6 class="mb-3">📦 Últimas compras</h6>
          ${comprasHtml}
        </div>
      </div>
    `;

    const modalEl = document.getElementById('detalleModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

  } catch (err) {
    console.error('Error cargando detalle:', err);
    mostrarNotificacion(err.error || err.message || 'Error al cargar detalle del proveedor', 'error');
  }
}

// ===================== FUNCIONES DE FILTROS PRINCIPALES =====================
function limpiarFiltros() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filtroEstado').value = 'activos';
  cargarProveedores();
}

// ===================== FUNCIONES DE NAVEGACIÓN =====================
function logout() {
  localStorage.clear();
  window.location.href = 'login.html';
}

// ===================== EXPORTAR FUNCIONES GLOBALES =====================
// Hacer disponibles las funciones globalmente
window.abrirModalProveedor = abrirModalProveedor;
window.editarProveedor = editarProveedor;
window.guardarProveedor = guardarProveedor;
window.confirmarEliminarProveedor = confirmarEliminarProveedor;
window.eliminarProveedor = eliminarProveedor;
window.verDetalleProveedor = verDetalleProveedor;
window.limpiarFiltros = limpiarFiltros;
window.cargarProveedores = cargarProveedores;
window.logout = logout;
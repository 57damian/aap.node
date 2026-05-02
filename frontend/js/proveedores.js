// ===================== PROVEEDORES-INTEGRADO.JS =====================
// VERIFICAR AUTENTICACIÓN
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

// ===================== ESTADO LOCAL =====================
let proveedoresCache = [];
let proveedorActual = null;
let materiasPrimasCache = [];
let facturasCache = [];
let comprasCache = [];
let pagosCache = [];

// ===================== INICIALIZACIÓN =====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('Inicializando módulo de proveedores...');
  
  // Event listeners para búsquedas
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') cargarProveedores();
    });
  }

  // Event listeners para filtros
  const filtroEstado = document.getElementById('filtroEstado');
  if (filtroEstado) {
    filtroEstado.addEventListener('change', () => cargarProveedores());
  }

  const filtroDeuda = document.getElementById('filtroDeuda');
  if (filtroDeuda) {
    filtroDeuda.addEventListener('change', () => cargarProveedores());
  }

  // Inicializar tooltips de Bootstrap si existen
  if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  }

  // Cargar datos iniciales
  cargarMateriasPrimas();
  cargarProveedores();
  cargarFacturas();
  cargarCompras();
  cargarPagos();

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
    'ENTREGADA': '<span class="badge bg-info">ENTREGADA</span>'
  };
  return badges[estado] || '<span class="badge bg-secondary">' + estado + '</span>';
}

function mostrarNotificacion(mensaje, tipo = 'success') {
  // Usar alert por ahora (puedes implementar toasts después)
  if (tipo === 'success') {
    alert('✅ ' + mensaje);
  } else if (tipo === 'error') {
    alert('❌ ' + mensaje);
  } else {
    alert(mensaje);
  }
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
    const deudaFiltro = document.getElementById('filtroDeuda')?.value || 'todos';

    const params = new URLSearchParams();
    if (search.trim() !== '') params.append('search', search.trim());
    if (estado && estado !== 'todos') params.append('estado', estado);

    const endpoint = `/api/proveedores${params.toString() ? `?${params.toString()}` : ''}`;
    let proveedores = await apiFetch(endpoint);
    
    // Aplicar filtro de deuda en cliente
    if (deudaFiltro !== 'todos') {
      proveedores = proveedores.filter(p => {
        const deuda = Number(p.deuda_pendiente || 0);
        if (deudaFiltro === 'con-deuda') return deuda > 0;
        if (deudaFiltro === 'sin-deuda') return deuda === 0;
        return true;
      });
    }

    proveedoresCache = proveedores;
    actualizarEstadisticasProveedores(proveedores);

    tbody.innerHTML = '';

    if (!proveedores.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-3">
            No se encontraron proveedores
          </td>
        </tr>
      `;
      return;
    }

    proveedores.forEach((p) => {
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
            <button class="btn btn-outline-success" onclick="abrirModalCompraProveedor(${p.id})"
                    data-bs-toggle="tooltip" title="Nueva compra">
              <i class="fas fa-cart-plus"></i>
            </button>
            <button class="btn btn-outline-warning" onclick="abrirModalPagoProveedor(${p.id})"
                    data-bs-toggle="tooltip" title="Registrar pago">
              <i class="fas fa-money-bill"></i>
            </button>
            <button class="btn btn-outline-secondary" onclick="editarProveedor(${p.id})"
                    data-bs-toggle="tooltip" title="Editar">
              <i class="fas fa-edit"></i>
            </button>
            ${usuario.rol === 'admin' ? `
              <button class="btn btn-outline-danger" onclick="confirmarEliminarProveedor(${p.id}, '${(p.nombre || '').replace(/'/g, "\\'")}')"
                      data-bs-toggle="tooltip" title="Eliminar">
                <i class="fas fa-trash"></i>
              </button>
            ` : ''}
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // Activar tooltips nuevamente
    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
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
          Error al cargar proveedores
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

    document.getElementById('totalProveedores').textContent = total;
    document.getElementById('proveedoresActivos').textContent = activos;
    document.getElementById('deudaTotal').textContent = formatearMoneda(deudaTotal);
    document.getElementById('comprasMes').textContent = comprasMes;
  } catch (err) {
    console.error('Error actualizando estadísticas:', err);
  }
}

// ===================== CARGAR MATERIAS PRIMAS =====================
async function cargarMateriasPrimas() {
  try {
    const data = await apiFetch('/api/materias-primas?activo=true');
    materiasPrimasCache = Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('No se pudo cargar materias primas:', err);
    materiasPrimasCache = [];
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

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

async function editarProveedor(id) {
  try {
    const proveedor = await apiFetch(`/api/proveedores/${id}`);

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

    document.getElementById('modalTitle').textContent = `Editar Proveedor`;

    const modalEl = document.getElementById('proveedorModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  } catch (err) {
    console.error(err);
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
    const options = {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    };

    const endpoint = id ? `/api/proveedores/${id}` : '/api/proveedores';
    await apiFetch(endpoint, options);

    mostrarNotificacion(id ? 'Proveedor actualizado correctamente' : 'Proveedor creado correctamente');

    const modalEl = document.getElementById('proveedorModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    cargarProveedores();
  } catch (err) {
    console.error(err);
    mostrarNotificacion(err.error || err.message || 'Error al guardar proveedor', 'error');
  }
}

function confirmarEliminarProveedor(id, nombre) {
  if (confirm(`¿Está seguro de eliminar/desactivar al proveedor "${nombre}"?\n\nSi tiene compras asociadas se desactivará, en caso contrario se eliminará.`)) {
    eliminarProveedor(id);
  }
}

async function eliminarProveedor(id) {
  try {
    await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
    mostrarNotificacion('Operación realizada correctamente');
    cargarProveedores();
  } catch (err) {
    console.error(err);
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
    const proveedor = proveedoresCache.find(p => p.id === id) || await apiFetch(`/api/proveedores/${id}`);
    
    // Obtener datos adicionales
    const [compras, facturas] = await Promise.all([
      apiFetch(`/api/proveedores/${id}/compras`),
      apiFetch(`/api/proveedores/${id}/facturas`)
    ]);

    const deuda = Number(proveedor.deuda_pendiente || 0);

    // Últimas 5 compras
    const ultimasCompras = compras.slice(0, 5);
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

    // Facturas pendientes
    const facturasPendientes = facturas.filter(f => f.estado === 'PENDIENTE').slice(0, 5);
    let facturasHtml = '';
    if (!facturasPendientes.length) {
      facturasHtml = '<p class="text-muted mb-0">Sin facturas pendientes</p>';
    } else {
      facturasHtml = `
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Vencimiento</th>
                <th>Total</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              ${facturasPendientes.map(f => `
                <tr>
                  <td>${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}</td>
                  <td>${formatearFecha(f.fecha_vencimiento)}</td>
                  <td class="text-end">${formatearMoneda(f.total)}</td>
                  <td class="text-end">${formatearMoneda(f.saldo || f.total)}</td>
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
              <p><strong>Total compras:</strong> ${proveedor.total_compras || 0}</p>
              <p><strong>Monto total compras:</strong> ${formatearMoneda(proveedor.monto_total_compras || 0)}</p>
              <p><strong>Deuda actual:</strong> <span class="text-danger fw-bold">${formatearMoneda(deuda)}</span></p>
            </div>
          </div>
        </div>

        <div class="col-md-7">
          <ul class="nav nav-tabs mb-3" id="detalleTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#detalleCompras" type="button">
                <i class="fas fa-shopping-cart"></i> Últimas Compras
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link" data-bs-toggle="tab" data-bs-target="#detalleFacturas" type="button">
                <i class="fas fa-file-invoice"></i> Facturas Pendientes
              </button>
            </li>
          </ul>

          <div class="tab-content">
            <div class="tab-pane fade show active" id="detalleCompras">
              ${comprasHtml}
              ${compras.length > 5 ? `
                <div class="text-end mt-2">
                  <small><a href="#" onclick="cargarMasCompras(${id})">Ver todas las compras (${compras.length})</a></small>
                </div>
              ` : ''}
            </div>
            <div class="tab-pane fade" id="detalleFacturas">
              ${facturasHtml}
              ${facturasPendientes.length > 5 ? `
                <div class="text-end mt-2">
                  <small><a href="#" onclick="window.location.href='facturas-compra.html?proveedor=${id}'">Ver todas</a></small>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    const modalEl = document.getElementById('detalleModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

  } catch (err) {
    console.error(err);
    mostrarNotificacion(err.error || err.message || 'Error al cargar detalle del proveedor', 'error');
  }
}

// ===================== FUNCIONES DE FACTURAS =====================
async function cargarFacturas() {
  const tbody = document.getElementById('facturasTableBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Cargando...</span>
          </div>
        </td>
      </tr>
    `;

    const params = new URLSearchParams();
    const proveedor = document.getElementById('facturaSearch')?.value || '';
    const estado = document.getElementById('facturaEstado')?.value || 'todos';
    const desde = document.getElementById('facturaFechaDesde')?.value || '';
    const hasta = document.getElementById('facturaFechaHasta')?.value || '';

    if (proveedor) params.append('search', proveedor);
    if (estado && estado !== 'todos') params.append('estado', estado);
    if (desde) params.append('fecha_desde', desde);
    if (hasta) params.append('fecha_hasta', hasta);

    const endpoint = `/api/facturas-compra${params.toString() ? '?' + params : ''}`;
    const facturas = await apiFetch(endpoint);
    facturasCache = facturas;

    actualizarEstadisticasFacturas(facturas);

    if (!facturas.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay facturas</td></tr>';
      return;
    }

    tbody.innerHTML = facturas.map(f => {
      const saldo = (f.total || 0) - (f.pagado || 0);
      return `
        <tr>
          <td><strong>${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}</strong></td>
          <td>${f.proveedor_nombre || '-'}</td>
          <td>${formatearFecha(f.fecha_emision)}</td>
          <td>${formatearFecha(f.fecha_vencimiento)}</td>
          <td class="text-end">${formatearMoneda(f.total)}</td>
          <td class="text-end">${formatearMoneda(saldo)}</td>
          <td>${getBadgeEstado(f.estado)}</td>
          <td class="text-center">
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" onclick="verDetalleFactura(${f.id})">
                <i class="fas fa-eye"></i>
              </button>
              ${f.estado === 'PENDIENTE' ? `
                <button class="btn btn-outline-success" onclick="abrirModalPagoFactura(${f.id})">
                  <i class="fas fa-money-bill"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando facturas:', err);
    mostrarNotificacion('Error al cargar facturas', 'error');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Error al cargar facturas</td></tr>';
  }
}

function actualizarEstadisticasFacturas(facturas) {
  try {
    const total = facturas.length;
    const pendientes = facturas.filter(f => f.estado === 'PENDIENTE').length;
    const pagadas = facturas.filter(f => f.estado === 'PAGADA').length;
    const deudaTotal = facturas
      .filter(f => f.estado === 'PENDIENTE')
      .reduce((sum, f) => sum + ((f.total || 0) - (f.pagado || 0)), 0);

    document.getElementById('totalFacturas').textContent = total;
    document.getElementById('facturasPendientes').textContent = pendientes;
    document.getElementById('facturasPagadas').textContent = pagadas;
    document.getElementById('deudaTotalFacturas').textContent = formatearMoneda(deudaTotal);
  } catch (err) {
    console.error('Error actualizando estadísticas de facturas:', err);
  }
}

function limpiarFiltrosFacturas() {
  document.getElementById('facturaSearch').value = '';
  document.getElementById('facturaEstado').value = 'todos';
  document.getElementById('facturaFechaDesde').value = '';
  document.getElementById('facturaFechaHasta').value = '';
  cargarFacturas();
}

// ===================== FUNCIONES DE COMPRAS =====================
async function cargarCompras() {
  const tbody = document.getElementById('comprasTableBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Cargando...</span>
          </div>
        </td>
      </tr>
    `;

    const params = new URLSearchParams();
    const search = document.getElementById('compraSearch')?.value || '';
    const desde = document.getElementById('compraFechaDesde')?.value || '';
    const hasta = document.getElementById('compraFechaHasta')?.value || '';

    if (search) params.append('search', search);
    if (desde) params.append('fecha_desde', desde);
    if (hasta) params.append('fecha_hasta', hasta);

    const endpoint = `/api/compras${params.toString() ? '?' + params : ''}`;
    const compras = await apiFetch(endpoint);
    comprasCache = compras;

    actualizarEstadisticasCompras(compras);

    if (!compras.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay compras</td></tr>';
      return;
    }

    tbody.innerHTML = compras.map(c => `
      <tr>
        <td>${c.numero_comprobante || 'OC-' + c.id}</td>
        <td>${c.proveedor_nombre || '-'}</td>
        <td>${formatearFecha(c.fecha_compra)}</td>
        <td class="text-center">${c.total_items || 0}</td>
        <td class="text-end">${formatearMoneda(c.total)}</td>
        <td>${getBadgeEstado(c.estado || 'COMPLETADA')}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary" onclick="verDetalleCompra(${c.id})">
            <i class="fas fa-eye"></i>
          </button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    console.error('Error cargando compras:', err);
    mostrarNotificacion('Error al cargar compras', 'error');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error al cargar compras</td></tr>';
  }
}

function actualizarEstadisticasCompras(compras) {
  try {
    const total = compras.length;
    const comprasMes = compras.filter(c => {
      const fecha = new Date(c.fecha_compra);
      const hoy = new Date();
      return fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear();
    });
    const totalMes = comprasMes.reduce((sum, c) => sum + (c.total || 0), 0);
    const materiasPrimas = compras.reduce((sum, c) => sum + (c.total_items || 0), 0);

    document.getElementById('totalCompras').textContent = total;
    document.getElementById('comprasMes').textContent = comprasMes.length;
    document.getElementById('comprasTotal').textContent = formatearMoneda(totalMes);
    document.getElementById('materiasPrimas').textContent = materiasPrimas;
  } catch (err) {
    console.error('Error actualizando estadísticas de compras:', err);
  }
}

function limpiarFiltrosCompras() {
  document.getElementById('compraSearch').value = '';
  document.getElementById('compraFechaDesde').value = '';
  document.getElementById('compraFechaHasta').value = '';
  cargarCompras();
}

// ===================== FUNCIONES DE PAGOS =====================
async function cargarPagos() {
  const tbody = document.getElementById('pagosTableBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Cargando...</span>
          </div>
        </td>
      </tr>
    `;

    const params = new URLSearchParams();
    const search = document.getElementById('pagoSearch')?.value || '';
    const forma = document.getElementById('pagoForma')?.value || 'todos';
    const desde = document.getElementById('pagoFechaDesde')?.value || '';
    const hasta = document.getElementById('pagoFechaHasta')?.value || '';

    if (search) params.append('search', search);
    if (forma && forma !== 'todos') params.append('forma_pago', forma);
    if (desde) params.append('fecha_desde', desde);
    if (hasta) params.append('fecha_hasta', hasta);

    const endpoint = `/api/pagos-proveedores${params.toString() ? '?' + params : ''}`;
    const pagos = await apiFetch(endpoint);
    pagosCache = pagos;

    actualizarEstadisticasPagos(pagos);

    if (!pagos.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay pagos registrados</td></tr>';
      return;
    }

    tbody.innerHTML = pagos.map(p => `
      <tr>
        <td>${formatearFecha(p.fecha_pago)}</td>
        <td>${p.proveedor_nombre || '-'}</td>
        <td>${p.factura_numero || '-'}</td>
        <td>${p.forma_pago || '-'}</td>
        <td class="text-end">${formatearMoneda(p.monto)}</td>
        <td>${p.referencia || '-'}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-primary" onclick="verDetallePago(${p.id})">
            <i class="fas fa-eye"></i>
          </button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    console.error('Error cargando pagos:', err);
    mostrarNotificacion('Error al cargar pagos', 'error');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error al cargar pagos</td></tr>';
  }
}

function actualizarEstadisticasPagos(pagos) {
  try {
    const total = pagos.length;
    const pagosMes = pagos.filter(p => {
      const fecha = new Date(p.fecha_pago);
      const hoy = new Date();
      return fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear();
    });
    const totalMes = pagosMes.reduce((sum, p) => sum + (p.monto || 0), 0);

    document.getElementById('totalPagos').textContent = total;
    document.getElementById('pagosMes').textContent = pagosMes.length;
    document.getElementById('pagosTotal').textContent = formatearMoneda(totalMes);
  } catch (err) {
    console.error('Error actualizando estadísticas de pagos:', err);
  }
}

function limpiarFiltrosPagos() {
  document.getElementById('pagoSearch').value = '';
  document.getElementById('pagoForma').value = 'todos';
  document.getElementById('pagoFechaDesde').value = '';
  document.getElementById('pagoFechaHasta').value = '';
  cargarPagos();
}

// ===================== FUNCIONES DE COMPRA (Modal) =====================
function abrirModalCompraGlobal() {
  prepararFormularioCompra();
  const modalEl = document.getElementById('compraModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function abrirModalCompraProveedor(proveedorId) {
  prepararFormularioCompra(proveedorId);
  const modalEl = document.getElementById('compraModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function prepararFormularioCompra(preselectedProveedorId) {
  document.getElementById('compraForm').reset();
  document.getElementById('compraItemsBody').innerHTML = '';
  document.getElementById('compraTotal').textContent = formatearMoneda(0);
  document.getElementById('compraMensajeVariaciones').style.display = 'none';

  // Fecha por defecto: hoy
  const hoy = new Date().toISOString().split('T')[0];
  const fechaInput = document.getElementById('compra_fecha_compra');
  if (fechaInput && !fechaInput.value) {
    fechaInput.value = hoy;
  }

  // Rellenar combo de proveedores
  const selectProv = document.getElementById('compra_proveedor_id');
  if (selectProv) {
    const valorActual = preselectedProveedorId || selectProv.value;
    selectProv.innerHTML = '<option value="">-- Seleccionar proveedor --</option>';

    proveedoresCache.forEach(p => {
      if (!p.activo) return;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.nombre} ${p.cuit ? '- ' + p.cuit : ''}`;
      selectProv.appendChild(opt);
    });

    if (valorActual) {
      selectProv.value = valorActual;
    }
  }

  // Agregar primera fila de item
  agregarItemCompra();
}

function agregarItemCompra() {
  const tbody = document.getElementById('compraItemsBody');
  if (!tbody) return;

  const row = document.createElement('tr');

  row.innerHTML = `
    <td>
      <select class="form-select form-select-sm mp-select" onchange="onMateriaPrimaChange(this)">
        <option value="">-- Seleccionar --</option>
      </select>
      <small class="text-muted d-block mp-info"></small>
    </td>
    <td>
      <input type="text" class="form-control form-control-sm descripcion" placeholder="Descripción">
    </td>
    <td>
      <select class="form-select form-select-sm unidad">
        <option value="UNI">UNI</option>
        <option value="KG">KG</option>
      </select>
    </td>
    <td>
      <input type="number" step="0.01" min="0" class="form-control form-control-sm cantidad" oninput="recalcularSubtotalFila(this)">
    </td>
    <td>
      <input type="number" step="0.01" min="0" class="form-control form-control-sm precio" oninput="recalcularSubtotalFila(this)">
    </td>
    <td class="subtotal text-end">$ 0,00</td>
    <td class="text-center">
      <span class="badge bg-secondary d-none var-precio">=</span>
    </td>
    <td class="text-center">
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="eliminarItemCompra(this)">
        <i class="fas fa-times"></i>
      </button>
    </td>
  `;

  tbody.appendChild(row);
  llenarSelectMateriaPrima(row.querySelector('.mp-select'));
}

function llenarSelectMateriaPrima(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Seleccionar --</option>';

  materiasPrimasCache.forEach(mp => {
    if (mp.activo === false) return;
    const opt = document.createElement('option');
    opt.value = mp.id;
    opt.textContent = mp.codigo ? `${mp.codigo} - ${mp.nombre}` : mp.nombre;
    selectEl.appendChild(opt);
  });
}

function onMateriaPrimaChange(selectEl) {
  const row = selectEl.closest('tr');
  if (!row) return;

  const id = parseInt(selectEl.value, 10);
  const mp = materiasPrimasCache.find(m => m.id === id);

  const info = row.querySelector('.mp-info');
  if (mp && info) {
    info.textContent = mp.descripcion || mp.ubicacion
      ? `${mp.descripcion || ''} ${mp.ubicacion ? '· Ubic: ' + mp.ubicacion : ''}`
      : '';
  } else if (info) {
    info.textContent = '';
  }

  const unidadSelect = row.querySelector('.unidad');
  if (mp && unidadSelect) {
    unidadSelect.value = mp.unidad_medida || 'UNI';
  }
}

function eliminarItemCompra(btn) {
  const row = btn.closest('tr');
  if (!row) return;
  row.remove();
  recalcularTotalCompra();
}

function recalcularSubtotalFila(inputEl) {
  const row = inputEl.closest('tr');
  if (!row) return;

  const cantidad = parseFloat(row.querySelector('.cantidad')?.value || '0');
  const precio = parseFloat(row.querySelector('.precio')?.value || '0');
  const subtotal = cantidad * precio;

  const subtotalDiv = row.querySelector('.subtotal');
  if (subtotalDiv) {
    subtotalDiv.textContent = formatearMoneda(subtotal);
  }

  recalcularTotalCompra();
}

function recalcularTotalCompra() {
  const tbody = document.getElementById('compraItemsBody');
  const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];

  let total = 0;
  rows.forEach(row => {
    const cantidad = parseFloat(row.querySelector('.cantidad')?.value || '0');
    const precio = parseFloat(row.querySelector('.precio')?.value || '0');
    total += cantidad * precio;
  });

  const totalDiv = document.getElementById('compraTotal');
  if (totalDiv) {
    totalDiv.textContent = formatearMoneda(total);
  }
}

async function guardarCompra() {
  const proveedor_id = parseInt(document.getElementById('compra_proveedor_id').value, 10);
  const fecha_compra = document.getElementById('compra_fecha_compra').value;
  const numero_comprobante = document.getElementById('compra_numero_comprobante').value.trim();
  const moneda = document.getElementById('compra_moneda').value || 'ARS';
  const observaciones = document.getElementById('compra_observaciones').value.trim();

  if (!proveedor_id || !fecha_compra) {
    mostrarNotificacion('Proveedor y fecha de compra son obligatorios', 'error');
    return;
  }

  const tbody = document.getElementById('compraItemsBody');
  const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];

  const items = [];
  rows.forEach(row => {
    const materia_prima_id = parseInt(row.querySelector('.mp-select')?.value, 10);
    const descripcion = row.querySelector('.descripcion')?.value.trim();
    const unidad = row.querySelector('.unidad')?.value || 'UNI';
    const cantidad = parseFloat(row.querySelector('.cantidad')?.value || '0');
    const precio_unitario = parseFloat(row.querySelector('.precio')?.value || '0');

    if (!materia_prima_id || !cantidad || !precio_unitario) {
      return;
    }

    items.push({
      materia_prima_id,
      descripcion: descripcion || null,
      unidad,
      cantidad,
      precio_unitario
    });
  });

  if (!items.length) {
    mostrarNotificacion('Debe cargar al menos un item con materia prima, cantidad y precio', 'error');
    return;
  }

  try {
    const payload = {
      proveedor_id,
      fecha_compra,
      numero_comprobante: numero_comprobante || null,
      moneda,
      observaciones: observaciones || null,
      items
    };

    const resp = await apiFetch('/api/compras', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (resp.variaciones_precio?.length) {
      mostrarNotificacion(`Compra registrada con ${resp.variaciones_precio.length} variaciones de precio`, 'info');
    } else {
      mostrarNotificacion('Compra registrada correctamente');
    }

    const modalEl = document.getElementById('compraModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    cargarProveedores();
    cargarCompras();
    cargarMateriasPrimas(); // Refrescar catálogo

  } catch (err) {
    console.error('Error guardando compra:', err);
    mostrarNotificacion(err.error || err.message || 'Error al guardar la compra', 'error');
  }
}

// ===================== FUNCIONES DE MATERIA PRIMA =====================
function abrirModalNuevaMateriaPrima() {
  const form = document.getElementById('mpForm');
  if (form) form.reset();

  const modalEl = document.getElementById('mpModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

async function guardarMateriaPrimaDesdeModal() {
  const codigo = document.getElementById('mp_codigo').value.trim();
  const nombre = document.getElementById('mp_nombre').value.trim();
  const unidad_medida = document.getElementById('mp_unidad_medida').value || 'UNI';
  const stock_minimo = parseFloat(document.getElementById('mp_stock_minimo').value || '0');
  const ubicacion = document.getElementById('mp_ubicacion').value.trim();
  const descripcion = document.getElementById('mp_descripcion').value.trim();

  if (!nombre) {
    mostrarNotificacion('El nombre es obligatorio', 'error');
    return;
  }

  try {
    const nueva = await apiFetch('/api/materias-primas', {
      method: 'POST',
      body: JSON.stringify({
        codigo: codigo || null,
        nombre,
        unidad_medida,
        stock_minimo,
        ubicacion: ubicacion || null,
        descripcion: descripcion || null,
        activo: true
      })
    });

    materiasPrimasCache.push(nueva);

    document.querySelectorAll('.mp-select').forEach(sel => {
      llenarSelectMateriaPrima(sel);
    });

    const modalEl = document.getElementById('mpModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    mostrarNotificacion('Materia prima creada correctamente');

  } catch (err) {
    console.error('Error creando materia prima:', err);
    mostrarNotificacion(err.error || err.message || 'Error al crear la materia prima', 'error');
  }
}

// ===================== FUNCIONES DE FILTROS =====================
function limpiarFiltros() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filtroEstado').value = 'activos';
  document.getElementById('filtroDeuda').value = 'todos';
  cargarProveedores();
}

// ===================== FUNCIONES DE NAVEGACIÓN =====================
function logout() {
  localStorage.clear();
  window.location.href = 'login.html';
}
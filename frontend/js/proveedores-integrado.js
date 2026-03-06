// Variables globales
let proveedoresCache = [];
let facturasCache = [];
let comprasCache = [];
let pagosCache = [];

// Funciones de utilidad
function formatearMoneda(valor) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(valor || 0);
}

function formatearFecha(fecha) {
    if (!fecha) return '-';
    const date = new Date(fecha);
    return date.toLocaleDateString('es-AR');
}

function verificarRol(rolesPermitidos) {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    return rolesPermitidos.includes(usuario.rol);
}

// ==================== TAB PROVEEDORES ===================

// Cargar proveedores
async function cargarProveedores() {
    try {
        const proveedores = await apiFetch('/api/proveedores');
        proveedoresCache = proveedores;
        renderizarTablaProveedores(proveedores);
        actualizarEstadisticasProveedores(proveedores);
    } catch (error) {
        console.error('Error cargando proveedores:', error);
        document.getElementById('proveedoresTableBody').innerHTML = 
            '<tr><td colspan="6" class="text-center text-danger">Error al cargar proveedores</td></tr>';
    }
}

// Renderizar tabla de proveedores
function renderizarTablaProveedores(proveedores) {
    const tbody = document.getElementById('proveedoresTableBody');
    
    if (!proveedores || proveedores.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No se encontraron proveedores</td></tr>';
        return;
    }
    
    tbody.innerHTML = proveedores.map(p => `
        <tr>
            <td>
                <div class="fw-bold">${p.nombre}</div>
                <small class="text-muted">CUIT: ${p.cuit || '-'}</small>
            </td>
            <td>
                <div><i class="fas fa-phone"></i> ${p.telefono || '-'}</div>
                <div><i class="fas fa-envelope"></i> ${p.email || '-'}</div>
                <div><i class="fas fa-user"></i> ${p.contacto || '-'}</div>
            </td>
            <td>
                <div class="text-center">${p.total_compras || 0}</div>
            </td>
            <td>
                <div class="fw-bold text-end">${formatearMoneda(p.deuda_actual || 0)}</div>
            </td>
            <td>
                <span class="badge bg-${p.activo ? 'success' : 'danger'}">
                    ${p.activo ? 'Activo' : 'Inactivo'}
                </span>
            </td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-outline-primary" onclick="verDetalleProveedor(${p.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-warning" onclick="abrirModalProveedor(${p.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="abrirModalCompra(${p.id})">
                        <i class="fas fa-shopping-cart"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Actualizar estadísticas de proveedores
function actualizarEstadisticasProveedores(proveedores) {
    const total = proveedores.length;
    const activos = proveedores.filter(p => p.activo).length;
    const deudaTotal = proveedores.reduce((sum, p) => sum + (p.deuda_actual || 0), 0);
    const comprasMes = proveedores.reduce((sum, p) => sum + (p.compras_mes || 0), 0);
    
    document.getElementById('totalProveedores').textContent = total;
    document.getElementById('proveedoresActivos').textContent = activos;
    document.getElementById('deudaTotal').textContent = formatearMoneda(deudaTotal);
    document.getElementById('comprasMes').textContent = comprasMes;
}

// Limpiar filtros de proveedores
function limpiarFiltros() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filtroEstado').value = 'todos';
    document.getElementById('filtroDeuda').value = 'todos';
    cargarProveedores();
}

// ==================== TAB FACTURAS ===================

// Cargar facturas
async function cargarFacturas() {
    try {
        const facturas = await apiFetch('/api/facturas-compra');
        facturasCache = facturas;
        renderizarTablaFacturas(facturas);
        actualizarEstadisticasFacturas(facturas);
    } catch (error) {
        console.error('Error cargando facturas:', error);
        document.getElementById('facturasTableBody').innerHTML = 
            '<tr><td colspan="8" class="text-center text-danger">Error al cargar facturas</td></tr>';
    }
}

// Renderizar tabla de facturas
function renderizarTablaFacturas(facturas) {
    const tbody = document.getElementById('facturasTableBody');
    
    if (!facturas || facturas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No se encontraron facturas</td></tr>';
        return;
    }
    
    tbody.innerHTML = facturas.map(f => `
        <tr>
            <td>
                <div class="fw-bold">${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}</div>
            </td>
            <td>${f.proveedor_nombre || '-'}</td>
            <td>${formatearFecha(f.fecha_emision)}</td>
            <td>${formatearFecha(f.fecha_vencimiento)}</td>
            <td class="fw-bold text-end">${formatearMoneda(f.total || 0)}</td>
            <td class="fw-bold text-end">${formatearMoneda((f.total || 0) - (f.pagado || 0))}</td>
            <td>
                <span class="badge bg-${f.estado === 'PAGADA' ? 'success' : f.estado === 'ANULADA' ? 'danger' : 'warning'}">
                    ${f.estado}
                </span>
            </td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-outline-primary" onclick="verDetalleFactura(${f.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="abrirModalPagoFactura(${f.id})" ${f.estado !== 'PENDIENTE' ? 'disabled' : ''}>
                        <i class="fas fa-money-bill"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Actualizar estadísticas de facturas
function actualizarEstadisticasFacturas(facturas) {
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
}

// Limpiar filtros de facturas
function limpiarFiltrosFacturas() {
    document.getElementById('facturaSearch').value = '';
    document.getElementById('facturaEstado').value = 'todos';
    document.getElementById('facturaFechaDesde').value = '';
    document.getElementById('facturaFechaHasta').value = '';
    cargarFacturas();
}

// ==================== TAB COMPRAS ===================

// Cargar compras
async function cargarCompras() {
    try {
        const compras = await apiFetch('/api/compras');
        comprasCache = compras;
        renderizarTablaCompras(compras);
        actualizarEstadisticasCompras(compras);
    } catch (error) {
        console.error('Error cargando compras:', error);
        document.getElementById('comprasTableBody').innerHTML = 
            '<tr><td colspan="7" class="text-center text-danger">Error al cargar compras</td></tr>';
    }
}

// Renderizar tabla de compras
function renderizarTablaCompras(compras) {
    const tbody = document.getElementById('comprasTableBody');
    
    if (!compras || compras.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No se encontraron compras</td></tr>';
        return;
    }
    
    tbody.innerHTML = compras.map(c => `
        <tr>
            <td>
                <div class="fw-bold">${c.numero_comprobante || '-'}</div>
            </td>
            <td>${c.proveedor_nombre || '-'}</td>
            <td>${formatearFecha(c.fecha_compra)}</td>
            <td>${c.items_count || 0} items</td>
            <td class="fw-bold text-end">${formatearMoneda(c.total || 0)}</td>
            <td>
                <span class="badge bg-${c.estado === 'RECIBIDA' ? 'success' : 'warning'}">
                    ${c.estado || 'PENDIENTE'}
                </span>
            </td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-outline-primary" onclick="verDetalleCompra(${c.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="generarFacturaDesdeCompra(${c.id})">
                        <i class="fas fa-file-invoice"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Actualizar estadísticas de compras
function actualizarEstadisticasCompras(compras) {
    const total = compras.length;
    const comprasMes = compras.filter(c => {
        const fecha = new Date(c.fecha_compra);
        const ahora = new Date();
        return fecha.getMonth() === ahora.getMonth() && fecha.getFullYear() === ahora.getFullYear();
    }).length;
    const totalMes = compras
        .filter(c => {
            const fecha = new Date(c.fecha_compra);
            const ahora = new Date();
            return fecha.getMonth() === ahora.getMonth() && fecha.getFullYear() === ahora.getFullYear();
        })
        .reduce((sum, c) => sum + (c.total || 0), 0);
    const materiasPrimas = new Set(compras.flatMap(c => c.items || [])).size;
    
    document.getElementById('totalCompras').textContent = total;
    document.getElementById('comprasMes').textContent = comprasMes;
    document.getElementById('comprasTotal').textContent = formatearMoneda(totalMes);
    document.getElementById('materiasPrimas').textContent = materiasPrimas;
}

// Limpiar filtros de compras
function limpiarFiltrosCompras() {
    document.getElementById('compraSearch').value = '';
    document.getElementById('compraFechaDesde').value = '';
    document.getElementById('compraFechaHasta').value = '';
    cargarCompras();
}

// ==================== TAB PAGOS ===================

// Cargar pagos
async function cargarPagos() {
    try {
        const pagos = await apiFetch('/api/pagos-proveedores');
        pagosCache = pagos;
        renderizarTablaPagos(pagos);
        actualizarEstadisticasPagos(pagos);
    } catch (error) {
        console.error('Error cargando pagos:', error);
        document.getElementById('pagosTableBody').innerHTML = 
            '<tr><td colspan="7" class="text-center text-danger">Error al cargar pagos</td></tr>';
    }
}

// Renderizar tabla de pagos
function renderizarTablaPagos(pagos) {
    const tbody = document.getElementById('pagosTableBody');
    
    if (!pagos || pagos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No se encontraron pagos</td></tr>';
        return;
    }
    
    tbody.innerHTML = pagos.map(p => `
        <tr>
            <td>${formatearFecha(p.fecha_pago)}</td>
            <td>${p.proveedor_nombre || '-'}</td>
            <td>${p.factura_numero || '-'}</td>
            <td>
                <span class="badge bg-info">${p.forma_pago}</span>
            </td>
            <td class="fw-bold text-end">${formatearMoneda(p.monto || 0)}</td>
            <td>${p.referencia || '-'}</td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-outline-primary" onclick="verDetallePago(${p.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="anularPago(${p.id})" data-roles="admin">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Actualizar estadísticas de pagos
function actualizarEstadisticasPagos(pagos) {
    const total = pagos.length;
    const pagosMes = pagos.filter(p => {
        const fecha = new Date(p.fecha_pago);
        const ahora = new Date();
        return fecha.getMonth() === ahora.getMonth() && fecha.getFullYear() === ahora.getFullYear();
    }).length;
    const totalMes = pagos
        .filter(p => {
            const fecha = new Date(p.fecha_pago);
            const ahora = new Date();
            return fecha.getMonth() === ahora.getMonth() && fecha.getFullYear() === ahora.getFullYear();
        })
        .reduce((sum, p) => sum + (p.monto || 0), 0);
    
    // Calcular próximos vencimientos (facturas pendientes próximas a vencer en 30 días)
    const proximosVencimientos = facturasCache
        .filter(f => f.estado === 'PENDIENTE')
        .filter(f => {
            const vencimiento = new Date(f.fecha_vencimiento);
            const ahora = new Date();
            const dias30 = new Date();
            dias30.setDate(dias30.getDate() + 30);
            return vencimiento <= dias30 && vencimiento > ahora;
        }).length;
    
    document.getElementById('totalPagos').textContent = total;
    document.getElementById('pagosMes').textContent = pagosMes;
    document.getElementById('pagosTotal').textContent = formatearMoneda(totalMes);
    document.getElementById('proximosVencimientos').textContent = proximosVencimientos;
}

// Limpiar filtros de pagos
function limpiarFiltrosPagos() {
    document.getElementById('pagoSearch').value = '';
    document.getElementById('pagoForma').value = 'todos';
    document.getElementById('pagoFechaDesde').value = '';
    document.getElementById('pagoFechaHasta').value = '';
    cargarPagos();
}

// ==================== MODALES ===================

// Abrir modal de proveedor
function abrirModalProveedor(proveedorId = null) {
    const modal = new bootstrap.Modal(document.getElementById('proveedorModal'));
    
    if (proveedorId) {
        const proveedor = proveedoresCache.find(p => p.id === proveedorId);
        if (proveedor) {
            document.getElementById('modalTitle').textContent = 'Editar Proveedor';
            document.getElementById('proveedorId').value = proveedor.id;
            document.getElementById('nombre').value = proveedor.nombre;
            document.getElementById('cuit').value = proveedor.cuit || '';
            document.getElementById('telefono').value = proveedor.telefono || '';
            document.getElementById('email').value = proveedor.email || '';
            document.getElementById('direccion').value = proveedor.direccion || '';
            document.getElementById('contacto').value = proveedor.contacto || '';
            document.getElementById('condicion_iva').value = proveedor.condicion_iva || 'RESPONSABLE INSCRIPTO';
            document.getElementById('observaciones').value = proveedor.observaciones || '';
            document.getElementById('activo').value = proveedor.activo ? 'true' : 'false';
        }
    } else {
        document.getElementById('modalTitle').textContent = 'Nuevo Proveedor';
        document.getElementById('proveedorForm').reset();
        document.getElementById('proveedorId').value = '';
    }
    
    modal.show();
}

// Guardar proveedor
async function guardarProveedor() {
    try {
        const proveedorId = document.getElementById('proveedorId').value;
        const payload = {
            nombre: document.getElementById('nombre').value,
            cuit: document.getElementById('cuit').value,
            telefono: document.getElementById('telefono').value,
            email: document.getElementById('email').value,
            direccion: document.getElementById('direccion').value,
            contacto: document.getElementById('contacto').value,
            condicion_iva: document.getElementById('condicion_iva').value,
            observaciones: document.getElementById('observaciones').value,
            activo: document.getElementById('activo').value === 'true'
        };
        
        if (proveedorId) {
            await apiFetch(`/api/proveedores/${proveedorId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            await apiFetch('/api/proveedores', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }
        
        bootstrap.Modal.getInstance(document.getElementById('proveedorModal')).hide();
        cargarProveedores();
        
    } catch (error) {
        console.error('Error guardando proveedor:', error);
        alert('Error al guardar el proveedor');
    }
}

// Ver detalle de proveedor
async function verDetalleProveedor(proveedorId) {
    try {
        const proveedor = await apiFetch(`/api/proveedores/${proveedorId}`);
        
        const html = `
            <div class="row">
                <div class="col-md-6">
                    <h6>Información General</h6>
                    <p><strong>Nombre:</strong> ${proveedor.nombre}</p>
                    <p><strong>CUIT:</strong> ${proveedor.cuit || '-'}</p>
                    <p><strong>Teléfono:</strong> ${proveedor.telefono || '-'}</p>
                    <p><strong>Email:</strong> ${proveedor.email || '-'}</p>
                </div>
                <div class="col-md-6">
                    <h6>Información Comercial</h6>
                    <p><strong>Contacto:</strong> ${proveedor.contacto || '-'}</p>
                    <p><strong>Dirección:</strong> ${proveedor.direccion || '-'}</p>
                    <p><strong>Condición IVA:</strong> ${proveedor.condicion_iva || '-'}</p>
                    <p><strong>Estado:</strong> <span class="badge bg-${proveedor.activo ? 'success' : 'danger'}">${proveedor.activo ? 'Activo' : 'Inactivo'}</span></p>
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-12">
                    <h6>Estadísticas</h6>
                    <div class="row">
                        <div class="col-md-3">
                            <p><strong>Total Compras:</strong> ${proveedor.total_compras || 0}</p>
                        </div>
                        <div class="col-md-3">
                            <p><strong>Deuda Actual:</strong> ${formatearMoneda(proveedor.deuda_actual || 0)}</p>
                        </div>
                        <div class="col-md-3">
                            <p><strong>Compras Mes:</strong> ${proveedor.compras_mes || 0}</p>
                        </div>
                        <div class="col-md-3">
                            <p><strong>Última Compra:</strong> ${formatearFecha(proveedor.ultima_compra)}</p>
                        </div>
                    </div>
                </div>
            </div>
            ${proveedor.observaciones ? `<div class="mt-3"><h6>Observaciones</h6><p>${proveedor.observaciones}</p></div>` : ''}
        `;
        
        document.getElementById('detalleContent').innerHTML = html;
        const modal = new bootstrap.Modal(document.getElementById('detalleModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error cargando detalle:', error);
        alert('Error al cargar el detalle del proveedor');
    }
}

// Funciones placeholder para los otros módulos
function abrirModalFactura() {
    alert('Función de nueva factura será implementada');
}

function abrirModalCompra(proveedorId = null) {
    alert('Función de nueva compra será implementada');
}

function abrirModalPago() {
    alert('Función de nuevo pago será implementada');
}

function verDetalleFactura(facturaId) {
    alert('Función de detalle de factura será implementada');
}

function verDetalleCompra(compraId) {
    alert('Función de detalle de compra será implementada');
}

function verDetallePago(pagoId) {
    alert('Función de detalle de pago será implementada');
}

function abrirModalPagoFactura(facturaId) {
    alert('Función de pago de factura será implementada');
}

function generarFacturaDesdeCompra(compraId) {
    alert('Función de generar factura desde compra será implementada');
}

function anularPago(pagoId) {
    if (confirm('¿Está seguro de anular este pago?')) {
        alert('Función de anular pago será implementada');
    }
}

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    verificarAuth();
    cargarProveedores();
    
    // Aplicar filtro por roles
    document.querySelectorAll('[data-roles]').forEach(elemento => {
        const rolesPermitidos = elemento.getAttribute('data-roles').split(',');
        if (!verificarRol(rolesPermitidos)) {
            elemento.classList.add('d-none');
        }
    });
});

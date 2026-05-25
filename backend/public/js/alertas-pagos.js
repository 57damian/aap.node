// alertas-pagos.js - Sistema de alertas para facturas pendientes

let alertasData = [];
let proveedoresData = [];
let dataTable = null;

$(document).ready(function() {
    // Verificar autenticación
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    // Configurar logout
    $('#logoutBtn').click(function(e) {
        e.preventDefault();
        logout();
    });

    // Cargar datos iniciales
    cargarProveedores();
    cargarAlertas();

    // Configurar eventos
    $('#refreshBtn').click(cargarAlertas);
    $('#applyFilters').click(aplicarFiltros);
    $('#exportBtn').click(exportarReporte);

    // Configurar DataTable
    configurarDataTable();
});

function configurarDataTable() {
    dataTable = $('#alertasTable').DataTable({
        language: {
            url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/es-ES.json'
        },
        pageLength: 10,
        responsive: true,
        order: [[3, 'asc']], // Ordenar por fecha de vencimiento
        columnDefs: [
            { orderable: false, targets: [7] } // Columna de acciones no ordenable
        ]
    });
}

async function cargarProveedores() {
    try {
        const response = await apiRequest('GET', '/api/proveedores');
        if (response.success) {
            proveedoresData = response.data;
            const select = $('#filterProveedor');
            select.empty();
            select.append('<option value="">Todos los proveedores</option>');
            
            proveedoresData.forEach(proveedor => {
                select.append(`<option value="${proveedor.id}">${proveedor.nombre}</option>`);
            });
        }
    } catch (error) {
        console.error('Error cargando proveedores:', error);
        showError('Error al cargar la lista de proveedores');
    }
}

async function cargarAlertas() {
    try {
        showLoading();
        const response = await apiRequest('GET', '/api/alertas/facturas-pendientes');
        
        if (response.success) {
            alertasData = response.data;
            actualizarEstadisticas();
            renderizarAlertas();
            renderizarTarjetasMoviles();
        } else {
            showError('Error al cargar las alertas');
        }
    } catch (error) {
        console.error('Error cargando alertas:', error);
        showError('Error de conexión al cargar alertas');
    } finally {
        hideLoading();
    }
}

function actualizarEstadisticas() {
    if (!alertasData || alertasData.length === 0) {
        $('#vencidasCount').text('0');
        $('#porVencerCount').text('0');
        $('#totalPendientes').text('0');
        $('#totalMonto').text('$0');
        return;
    }

    const vencidas = alertasData.filter(a => a.estado_alerta === 'vencida').length;
    const porVencer = alertasData.filter(a => a.estado_alerta === 'por_vencer').length;
    const totalPendientes = alertasData.length;
    const totalMonto = alertasData.reduce((sum, a) => sum + parseFloat(a.saldo_pendiente || 0), 0);

    $('#vencidasCount').text(vencidas);
    $('#porVencerCount').text(porVencer);
    $('#totalPendientes').text(totalPendientes);
    $('#totalMonto').text('$' + totalMonto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

function renderizarAlertas() {
    if (dataTable) {
        dataTable.destroy();
    }

    const tbody = $('#alertasBody');
    tbody.empty();

    if (!alertasData || alertasData.length === 0) {
        tbody.append(`
            <tr>
                <td colspan="8" class="text-center py-4">
                    <i class="fas fa-check-circle text-success fa-2x mb-2"></i>
                    <p class="text-muted">No hay facturas pendientes de pago</p>
                </td>
            </tr>
        `);
        return;
    }

    alertasData.forEach(alerta => {
        const badgeClass = getBadgeClass(alerta.estado_alerta);
        const badgeText = getBadgeText(alerta.estado_alerta);
        const diasRestantes = alerta.dias_restantes !== null ? alerta.dias_restantes : 'N/A';
        const fechaVencimiento = alerta.fecha_vencimiento ? 
            new Date(alerta.fecha_vencimiento).toLocaleDateString('es-AR') : 'Sin fecha';
        
        const row = `
            <tr>
                <td>
                    <span class="badge-alerta ${badgeClass}">${badgeText}</span>
                </td>
                <td>
                    <strong>${alerta.numero_factura || 'N/A'}</strong>
                </td>
                <td>
                    <div class="fw-semibold">${alerta.proveedor_nombre || 'Proveedor desconocido'}</div>
                    <small class="text-muted">${alerta.proveedor_email || ''}</small>
                </td>
                <td>${fechaVencimiento}</td>
                <td>
                    <span class="${diasRestantes < 0 ? 'text-danger fw-bold' : diasRestantes <= 7 ? 'text-warning fw-bold' : ''}">
                        ${diasRestantes} días
                    </span>
                </td>
                <td class="fw-bold">$${parseFloat(alerta.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="fw-bold text-danger">$${parseFloat(alerta.saldo_pendiente || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="verFactura(${alerta.id})" title="Ver factura">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-outline-success" onclick="registrarPago(${alerta.id})" title="Registrar pago">
                            <i class="fas fa-money-bill-wave"></i>
                        </button>
                        <button class="btn btn-outline-info" onclick="contactarProveedor(${alerta.proveedor_id})" title="Contactar proveedor">
                            <i class="fas fa-phone"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
        tbody.append(row);
    });

    configurarDataTable();
}

function renderizarTarjetasMoviles() {
    const container = $('#alertCards');
    container.empty();

    if (!alertasData || alertasData.length === 0) {
        container.append(`
            <div class="alert alert-success text-center">
                <i class="fas fa-check-circle fa-2x mb-2"></i>
                <p class="mb-0">No hay facturas pendientes de pago</p>
            </div>
        `);
        return;
    }

    alertasData.forEach(alerta => {
        const alertClass = getAlertCardClass(alerta.estado_alerta);
        const iconClass = getAlertIconClass(alerta.estado_alerta);
        const diasRestantes = alerta.dias_restantes !== null ? alerta.dias_restantes : 'N/A';
        const fechaVencimiento = alerta.fecha_vencimiento ? 
            new Date(alerta.fecha_vencimiento).toLocaleDateString('es-AR') : 'Sin fecha';
        
        const card = `
            <div class="alert-card ${alertClass}">
                <div class="d-flex align-items-start">
                    <div class="alert-icon">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="flex-grow-1">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                                <h6 class="mb-1 fw-bold">${alerta.numero_factura || 'N/A'}</h6>
                                <p class="mb-1">${alerta.proveedor_nombre || 'Proveedor desconocido'}</p>
                            </div>
                            <span class="badge-alerta ${getBadgeClass(alerta.estado_alerta)}">
                                ${getBadgeText(alerta.estado_alerta)}
                            </span>
                        </div>
                        
                        <div class="row">
                            <div class="col-6">
                                <small class="text-muted">Vencimiento:</small>
                                <div class="fw-bold">${fechaVencimiento}</div>
                            </div>
                            <div class="col-6">
                                <small class="text-muted">Días restantes:</small>
                                <div class="fw-bold ${diasRestantes < 0 ? 'text-danger' : diasRestantes <= 7 ? 'text-warning' : ''}">
                                    ${diasRestantes} días
                                </div>
                            </div>
                        </div>
                        
                        <div class="row mt-2">
                            <div class="col-6">
                                <small class="text-muted">Total:</small>
                                <div class="fw-bold">$${parseFloat(alerta.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            </div>
                            <div class="col-6">
                                <small class="text-muted">Saldo pendiente:</small>
                                <div class="fw-bold text-danger">$${parseFloat(alerta.saldo_pendiente || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                            </div>
                        </div>
                        
                        <div class="d-flex justify-content-between mt-3">
                            <button class="btn btn-sm btn-outline-primary" onclick="verFactura(${alerta.id})">
                                <i class="fas fa-eye me-1"></i> Ver
                            </button>
                            <button class="btn btn-sm btn-outline-success" onclick="registrarPago(${alerta.id})">
                                <i class="fas fa-money-bill-wave me-1"></i> Pagar
                            </button>
                            <button class="btn btn-sm btn-outline-info" onclick="contactarProveedor(${alerta.proveedor_id})">
                                <i class="fas fa-phone me-1"></i> Contactar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.append(card);
    });
}

function aplicarFiltros() {
    const estado = $('#filterEstado').val();
    const proveedorId = $('#filterProveedor').val();
    const desde = $('#filterDesde').val();
    const hasta = $('#filterHasta').val();
    const montoMin = parseFloat($('#filterMontoMin').val()) || 0;
    const montoMax = parseFloat($('#filterMontoMax').val()) || Infinity;

    let filteredData = alertasData;

    if (estado) {
        filteredData = filteredData.filter(a => a.estado_alerta === estado);
    }

    if (proveedorId) {
        filteredData = filteredData.filter(a => a.proveedor_id == proveedorId);
    }

    if (desde) {
        const desdeDate = new Date(desde);
        filteredData = filteredData.filter(a => {
            if (!a.fecha_vencimiento) return false;
            const fechaVenc = new Date(a.fecha_vencimiento);
            return fechaVenc >= desdeDate;
        });
    }

    if (hasta) {
        const hastaDate = new Date(hasta);
        filteredData = filteredData.filter(a => {
            if (!a.fecha_vencimiento) return false;
            const fechaVenc = new Date(a.fecha_vencimiento);
            return fechaVenc <= hastaDate;
        });
    }

    filteredData = filteredData.filter(a => {
        const saldo = parseFloat(a.saldo_pendiente || 0);
        return saldo >= montoMin && saldo <= montoMax;
    });

    // Actualizar estadísticas con datos filtrados
    const vencidas = filteredData.filter(a => a.estado_alerta === 'vencida').length;
    const porVencer = filteredData.filter(a => a.estado_alerta === 'por_vencer').length;
    const totalPendientes = filteredData.length;
    const totalMonto = filteredData.reduce((sum, a) => sum + parseFloat(a.saldo_pendiente || 0), 0);

    $('#vencidasCount').text(vencidas);
    $('#porVencerCount').text(porVencer);
    $('#totalPendientes').text(totalPendientes);
    $('#totalMonto').text('$' + totalMonto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

    // Renderizar datos filtrados
    const tempData = alertasData;
    alertasData = filteredData;
    renderizarAlertas();
    renderizarTarjetasMoviles();
    alertasData = tempData;
}

function exportarReporte() {
    if (!alertasData || alertasData.length === 0) {
        showWarning('No hay datos para exportar');
        return;
    }

    // Crear contenido CSV
    let csvContent = "data:text/csv;charset=utf-8,";
    
    // Encabezados
    const headers = [
        'Factura',
        'Proveedor',
        'Email',
        'Teléfono',
        'Fecha Vencimiento',
        'Días Restantes',
        'Estado Alerta',
        'Total',
        'Saldo Pendiente'
    ];
    csvContent += headers.join(',') + '\n';
    
    // Datos
    alertasData.forEach(alerta => {
        const row = [
            `"${alerta.numero_factura || ''}"`,
            `"${alerta.proveedor_nombre || ''}"`,
            `"${alerta.proveedor_email || ''}"`,
            `"${alerta.proveedor_telefono || ''}"`,
            alerta.fecha_vencimiento || '',
            alerta.dias_restantes || '',
            alerta.estado_alerta || '',
            alerta.total || '0',
            alerta.saldo_pendiente || '0'
        ];
        csvContent += row.join(',') + '\n';
    });
    
    // Crear enlace de descarga
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `reporte_alertas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showSuccess('Reporte exportado exitosamente');
}

// Funciones auxiliares
function getBadgeClass(estado) {
    switch(estado) {
        case 'vencida': return 'badge-vencida';
        case 'por_vencer': return 'badge-por-vencer';
        default: return 'badge-normal';
    }
}

function getBadgeText(estado) {
    switch(estado) {
        case 'vencida': return 'Vencida';
        case 'por_vencer': return 'Por Vencer';
        default: return 'Normal';
    }
}

function getAlertCardClass(estado) {
    switch(estado) {
        case 'vencida': return 'alert-vencida';
        case 'por_vencer': return 'alert-por-vencer';
        default: return 'alert-normal';
    }
}

function getAlertIconClass(estado) {
    switch(estado) {
        case 'vencida': return 'fas fa-exclamation-triangle';
        case 'por_vencer': return 'fas fa-clock';
        default: return 'fas fa-check-circle';
    }
}

// Funciones de acción
function verFactura(facturaId) {
    window.location.href = `facturas-compra-corregida.html?id=${facturaId}`;
}

function registrarPago(facturaId) {
    window.location.href = `pagos-proveedores.html?factura=${facturaId}`;
}

function contactarProveedor(proveedorId) {
    const proveedor = proveedoresData.find(p => p.id == proveedorId);
    if (!proveedor) {
        showError('Proveedor no encontrado');
        return;
    }
    
    let mensaje = `Información de contacto:\n\n`;
    mensaje += `Proveedor: ${proveedor.nombre}\n`;
    if (proveedor.email) mensaje += `Email: ${proveedor.email}\n`;
    if (proveedor.telefono) mensaje += `Teléfono: ${proveedor.telefono}\n`;
    if (proveedor.direccion) mensaje += `Dirección: ${proveedor.direccion}\n`;
    
    alert(mensaje);
}

// Funciones de UI
function showLoading() {
    $('#refreshBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Cargando...');
}

function hideLoading() {
    $('#refreshBtn').prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Actualizar');
}

function showError(message) {
    alert('Error: ' + message);
}

function showSuccess(message) {
    alert('Éxito: ' + message);
}

function showWarning(message) {
    alert('Advertencia: ' + message);
}
   
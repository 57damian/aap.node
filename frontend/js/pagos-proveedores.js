// pagos-proveedores.js
let pagosCache = [];
let facturasCache = [];
let proveedoresCache = [];

// Formatear moneda
function formatearMoneda(valor) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(valor);
}

// Inicializar página
document.addEventListener('DOMContentLoaded', () => {
    verificarAuth();
    cargarProveedores();
    cargarPagos();
});

// Cargar proveedores
async function cargarProveedores() {
    try {
        const proveedores = await apiFetch('/api/proveedores');
        proveedoresCache = proveedores;
        
        const selectFiltro = document.getElementById('filtroProveedor');
        selectFiltro.innerHTML = '<option value="">Todos los proveedores</option>';
        
        proveedores.forEach(p => {
            selectFiltro.innerHTML += `<option value="${p.id}">${p.nombre}</option>`;
        });
    } catch (err) {
        console.error('Error cargando proveedores:', err);
    }
}

// Cargar pagos
async function cargarPagos() {
    try {
        const params = new URLSearchParams();
        
        const proveedor = document.getElementById('filtroProveedor')?.value;
        const fechaDesde = document.getElementById('filtroFechaDesde')?.value;
        const fechaHasta = document.getElementById('filtroFechaHasta')?.value;
        const forma = document.getElementById('filtroFormaPago')?.value;
        const search = document.getElementById('searchInput')?.value;
        
        if (proveedor) params.append('proveedor_id', proveedor);
        if (fechaDesde) params.append('fecha_desde', fechaDesde);
        if (fechaHasta) params.append('fecha_hasta', fechaHasta);
        if (forma) params.append('forma_pago', forma);
        if (search) params.append('search', search);
        
        const endpoint = `/api/pagos-proveedores${params.toString() ? '?' + params : ''}`;
        const pagos = await apiFetch(endpoint);
        pagosCache = pagos;
        
        renderizarPagosRealizados(pagos);
        cargarFacturasPendientes();
        actualizarEstadisticas(pagos);
    } catch (err) {
        console.error('Error cargando pagos:', err);
        alert(err.error || 'Error al cargar pagos');
    }
}

// Renderizar pagos realizados
function renderizarPagosRealizados(pagos) {
    const tbody = document.getElementById('pagosTableBody');
    
    if (!pagos || pagos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay pagos registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = pagos.map(p => {
        let formaBadge = '';
        switch(p.forma_pago) {
            case 'EFECTIVO': formaBadge = '<span class="badge bg-success">EFECTIVO</span>'; break;
            case 'TRANSFERENCIA': formaBadge = '<span class="badge bg-info">TRANSFERENCIA</span>'; break;
            case 'CHEQUE': formaBadge = '<span class="badge bg-warning">CHEQUE</span>'; break;
            default: formaBadge = '<span class="badge bg-secondary">' + p.forma_pago + '</span>';
        }
        
        return `
            <tr>
                <td>${p.fecha_pago || '-'}</td>
                <td>${p.proveedor_nombre || '-'}</td>
                <td>${p.factura_numero || '-'}</td>
                <td>${formatearMoneda(p.monto || 0)}</td>
                <td>${formaBadge}</td>
                <td>${p.referencia || '-'}</td>
                <td>${p.usuario || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="verDetallePago(${p.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${verificarRol(['admin']) ? `
                        <button class="btn btn-sm btn-danger" onclick="anularPago(${p.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// Cargar facturas pendientes
async function cargarFacturasPendientes() {
    try {
        const facturas = await apiFetch('/api/facturas-compra?estado=PENDIENTE');
        facturasCache = facturas;
        renderizarFacturasPendientes(facturas);
    } catch (err) {
        console.error('Error cargando facturas pendientes:', err);
    }
}

// Renderizar facturas pendientes
function renderizarFacturasPendientes(facturas) {
    const tbody = document.getElementById('pendientesTableBody');
    const hoy = new Date();
    
    if (!facturas || facturas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay facturas pendientes</td></tr>';
        return;
    }
    
    tbody.innerHTML = facturas.map(f => {
        const vencimiento = calcularVencimiento(f.fecha_emision, f.condicion_pago);
        const diasVencida = calcularDias(vencimiento, hoy);
        const saldo = (f.total || 0) - (f.pagado || 0);
        
        let rowClass = '';
        let diasText = '';
        
        if (diasVencida > 0) {
            rowClass = 'table-danger';
            diasText = `<span class="badge bg-danger">${diasVencida} días</span>`;
        } else if (diasVencida > -15) {
            rowClass = 'table-warning';
            diasText = `<span class="badge bg-warning">${Math.abs(diasVencida)} días</span>`;
        } else {
            diasText = `<span class="badge bg-info">${Math.abs(diasVencida)} días</span>`;
        }
        
        return `
            <tr class="${rowClass}">
                <td><strong>${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}</strong></td>
                <td>${f.proveedor_nombre || '-'}</td>
                <td>${vencimiento.toLocaleDateString('es-AR')}</td>
                <td>${formatearMoneda(saldo)}</td>
                <td>${diasText}</td>
                <td>
                    <button class="btn btn-sm btn-success" onclick="abrirModalPago(${f.id}, '${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}', '${f.proveedor_nombre}', ${saldo})">
                        <i class="fas fa-money-bill"></i> Pagar
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Calcular vencimiento
function calcularVencimiento(fechaEmision, condicionPago) {
    const fecha = new Date(fechaEmision);
    switch(condicionPago) {
        case 'CONTADO': return fecha;
        case 'CREDITO 30': fecha.setDate(fecha.getDate() + 30); return fecha;
        case 'CREDITO 60': fecha.setDate(fecha.getDate() + 60); return fecha;
        default: return fecha;
    }
}

// Calcular días
function calcularDias(fecha1, fecha2) {
    const d1 = new Date(fecha1);
    const d2 = new Date(fecha2);
    const diferencia = d2 - d1;
    return Math.ceil(diferencia / (1000 * 60 * 60 * 24));
}

// Actualizar estadísticas
function actualizarEstadisticas(pagos) {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();
    
    const pagadoMes = pagos
        .filter(p => {
            const fecha = new Date(p.fecha_pago);
            return fecha.getMonth() === mesActual && fecha.getFullYear() === anioActual;
        })
        .reduce((sum, p) => sum + (p.monto || 0), 0);
    
    const pendientes = facturasCache ? facturasCache.filter(f => f.estado === 'PENDIENTE').length : 0;
    
    const proximosVencimientos = facturasCache ? facturasCache.filter(f => {
        if (f.estado !== 'PENDIENTE') return false;
        const vencimiento = calcularVencimiento(f.fecha_emision, f.condicion_pago);
        const dias = calcularDias(hoy, vencimiento);
        return dias > 0 && dias <= 15;
    }).length : 0;
    
    document.getElementById('totalPagadoMes').textContent = formatearMoneda(pagadoMes);
    document.getElementById('pagosPendientes').textContent = pendientes;
    document.getElementById('proximosVencimientos').textContent = proximosVencimientos;
}

// Abrir modal de pago
function abrirModalPago(facturaId, facturaNumero, proveedorNombre, saldo) {
    document.getElementById('pago_factura_id').value = facturaId;
    document.getElementById('pago_factura_numero').value = facturaNumero;
    document.getElementById('pago_proveedor').value = proveedorNombre;
    document.getElementById('pago_saldo').value = formatearMoneda(saldo);
    document.getElementById('pago_monto').value = saldo.toFixed(2);
    document.getElementById('pago_fecha').valueAsDate = new Date();
    document.getElementById('pago_forma').value = '';
    document.getElementById('camposFormaPago').innerHTML = '';
    document.getElementById('pago_observaciones').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('pagoModal'));
    modal.show();
}

// Mostrar campos según forma de pago
function mostrarCamposFormaPago() {
    const forma = document.getElementById('pago_forma').value;
    const container = document.getElementById('camposFormaPago');
    
    container.innerHTML = '';
    
    if (forma === 'TRANSFERENCIA') {
        container.innerHTML = `
            <div class="mb-3">
                <label class="form-label">Banco</label>
                <input type="text" id="pago_banco" class="form-control" placeholder="Ej: Banco Nación">
            </div>
            <div class="mb-3">
                <label class="form-label">Referencia/CBU</label>
                <input type="text" id="pago_referencia_trans" class="form-control" placeholder="Referencia de transferencia">
            </div>
        `;
    } else if (forma === 'CHEQUE') {
        container.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <label class="form-label">N° Cheque *</label>
                    <input type="text" id="pago_numero_cheque" class="form-control" required>
                </div>
                <div class="col-md-6">
                    <label class="form-label">Banco *</label>
                    <input type="text" id="pago_banco_cheque" class="form-control" required>
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-md-6">
                    <label class="form-label">Fecha Emisión *</label>
                    <input type="date" id="pago_fecha_emision_cheque" class="form-control" required>
                </div>
                <div class="col-md-6">
                    <label class="form-label">Fecha Cobro</label>
                    <input type="date" id="pago_fecha_cobro_cheque" class="form-control">
                </div>
            </div>
        `;
    }
}

// Guardar pago
async function guardarPago() {
    try {
        const facturaId = document.getElementById('pago_factura_id').value;
        const monto = parseFloat(document.getElementById('pago_monto').value);
        const fecha = document.getElementById('pago_fecha').value;
        const forma = document.getElementById('pago_forma').value;
        const observaciones = document.getElementById('pago_observaciones').value;
        
        if (!forma) {
            alert('Debe seleccionar forma de pago');
            return;
        }
        
        let datosAdicionales = {};
        
        if (forma === 'TRANSFERENCIA') {
            datosAdicionales = {
                banco: document.getElementById('pago_banco')?.value || '',
                referencia: document.getElementById('pago_referencia_trans')?.value || ''
            };
        } else if (forma === 'CHEQUE') {
            datosAdicionales = {
                numero_cheque: document.getElementById('pago_numero_cheque')?.value || '',
                banco: document.getElementById('pago_banco_cheque')?.value || '',
                fecha_emision: document.getElementById('pago_fecha_emision_cheque')?.value || '',
                fecha_cobro: document.getElementById('pago_fecha_cobro_cheque')?.value || ''
            };
        }
        
        const payload = {
            factura_id: parseInt(facturaId),
            monto,
            fecha_pago: fecha,
            forma_pago: forma,
            referencia: datosAdicionales.referencia || datosAdicionales.numero_cheque || '',
            datos_adicionales: datosAdicionales,
            observaciones
        };
        
        await apiFetch('/api/pagos-proveedores', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        alert('Pago registrado correctamente');
        bootstrap.Modal.getInstance(document.getElementById('pagoModal')).hide();
        cargarPagos();
        
    } catch (err) {
        console.error('Error guardando pago:', err);
        alert(err.error || 'Error al registrar pago');
    }
}

// Ver detalle pago
async function verDetallePago(pagoId) {
    try {
        const pago = pagosCache.find(p => p.id === pagoId);
        if (!pago) return;
        
        let html = `
            <div class="row mb-3">
                <div class="col-md-6">
                    <p><strong>Proveedor:</strong> ${pago.proveedor_nombre}</p>
                    <p><strong>Factura:</strong> ${pago.factura_numero}</p>
                    <p><strong>Fecha Pago:</strong> ${pago.fecha_pago}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Monto:</strong> ${formatearMoneda(pago.monto)}</p>
                    <p><strong>Forma de Pago:</strong> ${pago.forma_pago}</p>
                    <p><strong>Referencia:</strong> ${pago.referencia || '-'}</p>
                </div>
            </div>
            <div class="row">
                <div class="col-md-12">
                    <p><strong>Observaciones:</strong></p>
                    <p>${pago.observaciones || '-'}</p>
                </div>
            </div>
        `;
        
        document.getElementById('detallePagoContent').innerHTML = html;
        const modal = new bootstrap.Modal(document.getElementById('detallePagoModal'));
        modal.show();
        
    } catch (err) {
        console.error('Error cargando detalle:', err);
        alert('Error al cargar detalle de pago');
    }
}

// Anular pago
async function anularPago(pagoId) {
    if (!confirm('¿Está seguro de que desea anular este pago?')) return;
    
    try {
        await apiFetch(`/api/pagos-proveedores/${pagoId}/anular`, {
            method: 'PUT'
        });
        
        alert('Pago anulado correctamente');
        cargarPagos();
        
    } catch (err) {
        console.error('Error anulando pago:', err);
        alert(err.error || 'Error al anular pago');
    }
}

// Limpiar filtros
function limpiarFiltros() {
    document.getElementById('filtroProveedor').value = '';
    document.getElementById('filtroFechaDesde').value = '';
    document.getElementById('filtroFechaHasta').value = '';
    document.getElementById('filtroFormaPago').value = '';
    document.getElementById('searchInput').value = '';
    cargarPagos();
}

// Verificar rol
function verificarRol(rolesPermitidos) {
    const rolUsuario = localStorage.getItem('rol');
    return rolesPermitidos.includes(rolUsuario);
}

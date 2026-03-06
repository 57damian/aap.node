// Funciones globales de utilidad
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

function calcularVencimiento(fechaEmision, condicionPago) {
    const fecha = new Date(fechaEmision);
    switch(condicionPago) {
        case 'CONTADO': return fecha;
        case 'CREDITO 30': 
            fecha.setDate(fecha.getDate() + 30);
            return fecha;
        case 'CREDITO 60': 
            fecha.setDate(fecha.getDate() + 60);
            return fecha;
        default: return fecha;
    }
}

function getEstadoBadge(estado) {
    const badges = {
        'PENDIENTE': '<span class="badge bg-warning">PENDIENTE</span>',
        'PAGADA': '<span class="badge bg-success">PAGADA</span>',
        'ANULADA': '<span class="badge bg-danger">ANULADA</span>'
    };
    return badges[estado] || '<span class="badge bg-secondary">SIN ESTADO</span>';
}

// Datos de ejemplo
const facturasEjemplo = [
    {
        id: 1,
        tipo_factura: 'A',
        punto_venta: '0001',
        numero_factura: '12345',
        cae: '12345678901234',
        proveedor: { id: 1, nombre: 'Proveedor SA', cuit: '30-12345678-9' },
        fecha_emision: '2024-03-15',
        fecha_vencimiento: '2024-04-14',
        subtotal: 100000,
        iva: 21000,
        total: 121000,
        pagado: 50000,
        saldo: 71000,
        estado: 'PENDIENTE',
        items: [
            { articulo: 'Alambre 0.07mm', descripcion: 'Bobina de alambre cobre', cantidad: 100, precio_unitario: 800, iva: 21, total: 80000 },
            { articulo: 'Papel aislante', descripcion: 'Rollo de papel aislante', cantidad: 50, precio_unitario: 400, iva: 21, total: 20000 }
        ]
    },
    {
        id: 2,
        tipo_factura: 'B',
        punto_venta: '0002',
        numero_factura: '67890',
        cae: '98765432109876',
        proveedor: { id: 2, nombre: 'Industrial Ltda', cuit: '30-98765432-1' },
        fecha_emision: '2024-03-10',
        fecha_vencimiento: '2024-04-09',
        subtotal: 50000,
        iva: 10500,
        total: 60500,
        pagado: 60500,
        saldo: 0,
        estado: 'PAGADA',
        items: [
            { articulo: 'Núcleo de hierro', descripcion: 'Núcleo laminado', cantidad: 20, precio_unitario: 2500, iva: 21, total: 50000 }
        ]
    },
    {
        id: 3,
        tipo_factura: 'A',
        punto_venta: '0003',
        numero_factura: '11111',
        cae: '11111111111111',
        proveedor: { id: 3, nombre: 'Componentes SA', cuit: '30-55555555-5' },
        fecha_emision: '2024-02-28',
        fecha_vencimiento: '2024-03-30',
        subtotal: 75000,
        iva: 15750,
        total: 90750,
        pagado: 0,
        saldo: 90750,
        estado: 'VENCIDA',
        items: [
            { articulo: 'Terminales', descripcion: 'Terminales de conexión', cantidad: 1000, precio_unitario: 75, iva: 21, total: 75000 }
        ]
    }
];

const proveedoresEjemplo = [
    { id: 1, nombre: 'Proveedor SA', cuit: '30-12345678-9' },
    { id: 2, nombre: 'Industrial Ltda', cuit: '30-98765432-1' },
    { id: 3, nombre: 'Componentes SA', cuit: '30-55555555-5' }
];

// Variables globales
let facturasCache = [];
let proveedoresCache = [];
let articulosCache = [];
let itemsFactura = [];

// Funciones principales
async function cargarFacturas() {
    try {
        const params = new URLSearchParams();
        
        const proveedor = document.getElementById('filtroProveedor')?.value;
        const estado = document.getElementById('filtroEstado')?.value;
        const fechaDesde = document.getElementById('filtroFechaDesde')?.value;
        const fechaHasta = document.getElementById('filtroFechaHasta')?.value;
        const search = document.getElementById('filtroBusqueda')?.value;
        
        if (proveedor) params.append('proveedor_id', proveedor);
        if (estado) params.append('estado', estado);
        if (fechaDesde) params.append('fecha_desde', fechaDesde);
        if (fechaHasta) params.append('fecha_hasta', fechaHasta);
        if (search) params.append('search', search);
        
        const endpoint = `/api/facturas-compra${params.toString() ? '?' + params : ''}`;
        const facturas = await apiFetch(endpoint);
        facturasCache = facturas;
        
        renderizarTablaFacturas(facturas);
        actualizarEstadisticas(facturas);
        renderizarProximasVencer(facturas);
        renderizarVencidas(facturas);
    } catch (err) {
        console.error('Error cargando facturas:', err);
        alert(err.error || 'Error al cargar facturas');
    }
}

function renderizarTablaFacturas(facturas) {
    const tbody = document.getElementById('tablaFacturasBody');
    if (!tbody) return;
    
    tbody.innerHTML = facturas.map(f => {
        const vencimiento = calcularVencimiento(f.fecha_emision, f.condicion_pago);
        const hoy = new Date();
        const dias = calcularDias(hoy, vencimiento);
        const saldo = (f.total || 0) - (f.pagado || 0);
        const rowClass = f.estado === 'PENDIENTE' ? 'table-warning' : '';
        const estadoBadge = getEstadoBadge(f.estado);
        
        return `
            <tr class="${rowClass}">
                <td><strong>${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}</strong></td>
                <td>${f.proveedor_nombre || '-'}</td>
                <td>${f.fecha_emision || '-'}</td>
                <td>${vencimiento.toLocaleDateString('es-AR')}</td>
                <td>${formatearMoneda(f.total || 0)}</td>
                <td>${formatearMoneda(f.pagado || 0)}</td>
                <td>${formatearMoneda(saldo)}</td>
                <td>${estadoBadge}</td>
                <td>
                    <button class="btn btn-sm btn-info" onclick="verDetalleFactura(${f.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${f.estado === 'PENDIENTE' ? `
                        <button class="btn btn-sm btn-success" onclick="abrirModalPago(${f.id})">
                            <i class="fas fa-money-bill"></i>
                        </button>
                    ` : ''}
                    ${verificarRol(['admin']) ? `
                        <button class="btn btn-sm btn-danger" onclick="anularFactura(${f.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

function renderizarProximasVencer(facturas) {
    const tbody = document.getElementById('tablaProximasBody');
    if (!tbody) return;
    
    const hoy = new Date();
    
    const proximas = facturas.filter(f => {
        if (f.estado !== 'PENDIENTE') return false;
        const vencimiento = calcularVencimiento(f.fecha_emision, f.condicion_pago);
        const dias = calcularDias(hoy, vencimiento);
        return dias > 0 && dias <= 15;
    });
    
    if (proximas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay facturas próximas a vencer</td></tr>';
        return;
    }
    
    tbody.innerHTML = proximas.map(f => {
        const vencimiento = calcularVencimiento(f.fecha_emision, f.condicion_pago);
        const dias = calcularDias(hoy, vencimiento);
        const saldo = (f.total || 0) - (f.pagado || 0);
        
        return `
            <tr class="table-warning">
                <td><strong>${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}</strong></td>
                <td>${f.proveedor_nombre || '-'}</td>
                <td>${vencimiento.toLocaleDateString('es-AR')}</td>
                <td><span class="badge bg-warning">${dias} días</span></td>
                <td>${formatearMoneda(saldo)}</td>
                <td>
                    <button class="btn btn-sm btn-success" onclick="abrirModalPago(${f.id})">
                        <i class="fas fa-money-bill"></i> Pagar
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderizarVencidas(facturas) {
    const tbody = document.getElementById('tablaVencidasBody');
    if (!tbody) return;
    
    const hoy = new Date();
    
    const vencidas = facturas.filter(f => {
        if (f.estado !== 'PENDIENTE') return false;
        const vencimiento = calcularVencimiento(f.fecha_emision, f.condicion_pago);
        const dias = calcularDias(hoy, vencimiento);
        return dias < 0;
    });
    
    if (vencidas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay facturas vencidas</td></tr>';
        return;
    }
    
    tbody.innerHTML = vencidas.map(f => {
        const vencimiento = calcularVencimiento(f.fecha_emision, f.condicion_pago);
        const dias = Math.abs(calcularDias(hoy, vencimiento));
        const saldo = (f.total || 0) - (f.pagado || 0);
        
        return `
            <tr class="table-danger">
                <td><strong>${f.tipo_factura} ${f.punto_venta || '0001'}-${f.numero_factura}</strong></td>
                <td>${f.proveedor_nombre || '-'}</td>
                <td>${vencimiento.toLocaleDateString('es-AR')}</td>
                <td><span class="badge bg-danger">${dias} días</span></td>
                <td>${formatearMoneda(saldo)}</td>
                <td>
                    <button class="btn btn-sm btn-success" onclick="abrirModalPago(${f.id})">
                        <i class="fas fa-money-bill"></i> Pagar
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function cargarProveedores() {
    try {
        proveedoresCache = await apiFetch('/api/proveedores');
        
        const select = document.getElementById('filtroProveedor');
        if (select) {
            select.innerHTML = '<option value="">Todos los proveedores</option>';
            proveedoresCache.forEach(p => {
                select.innerHTML += `<option value="${p.id}">${p.nombre}</option>`;
            });
        }
        
        // Cargar en modal de factura
        const selectModal = document.getElementById('factura_proveedor_id');
        if (selectModal) {
            selectModal.innerHTML = '<option value="">-- Seleccionar --</option>';
            proveedoresCache.forEach(p => {
                selectModal.innerHTML += `<option value="${p.id}">${p.nombre} - ${p.cuit || ''}</option>`;
            });
        }
        
        // Cargar artículos para modal de factura
        articulosCache = await apiFetch('/api/articulos');
        
    } catch (error) {
        console.error('Error cargando proveedores:', error);
        alert('Error al cargar proveedores');
    }
}

function actualizarEstadisticas(facturas) {
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
        document.getElementById('deudaTotal').textContent = formatearMoneda(deudaTotal);
        
    } catch (error) {
        console.error('Error calculando estadísticas:', error);
    }
}

// Funciones de filtros
function limpiarFiltros() {
    document.getElementById('filtroProveedor').value = '';
    document.getElementById('filtroEstado').value = '';
    document.getElementById('filtroFechaDesde').value = '';
    document.getElementById('filtroFechaHasta').value = '';
    document.getElementById('filtroBusqueda').value = '';
    
    cargarFacturas();
}

function buscarFacturas() {
    const proveedorId = document.getElementById('filtroProveedor').value;
    const estado = document.getElementById('filtroEstado').value;
    const fechaDesde = document.getElementById('filtroFechaDesde').value;
    const fechaHasta = document.getElementById('filtroFechaHasta').value;
    const busqueda = document.getElementById('filtroBusqueda').value.toLowerCase();
    
    let facturasFiltradas = facturasCache;
    
    if (proveedorId) {
        facturasFiltradas = facturasFiltradas.filter(f => f.proveedor_id == proveedorId);
    }
    
    if (estado) {
        facturasFiltradas = facturasFiltradas.filter(f => f.estado === estado);
    }
    
    if (fechaDesde) {
        facturasFiltradas = facturasFiltradas.filter(f => f.fecha_emision >= fechaDesde);
    }
    
    if (fechaHasta) {
        facturasFiltradas = facturasFiltradas.filter(f => f.fecha_emision <= fechaHasta);
    }
    
    if (busqueda) {
        facturasFiltradas = facturasFiltradas.filter(f => 
            f.numero_factura.toLowerCase().includes(busqueda) ||
            f.cae?.toLowerCase().includes(busqueda)
        );
    }
    
    facturasCache = facturasFiltradas;
    renderizarTablaFacturas(facturasCache);
    renderizarProximasVencer(facturasCache);
    renderizarVencidas(facturasCache);
    actualizarEstadisticas(facturasCache);
}

// Abrir modal de factura
function abrirModalFactura(facturaId = null) {
    itemsFactura = [];
    
    if (facturaId) {
        // Modo edición
        const factura = facturasCache.find(f => f.id === facturaId);
        if (factura) {
            document.getElementById('facturaId').value = factura.id;
            document.getElementById('factura_proveedor_id').value = factura.proveedor_id;
            document.getElementById('fecha_emision').value = factura.fecha_emision;
            document.getElementById('fecha_recepcion').value = factura.fecha_recepcion || '';
            document.getElementById('tipo_factura').value = factura.tipo_factura;
            document.getElementById('punto_venta').value = factura.punto_venta || '';
            document.getElementById('numero_factura').value = factura.numero_factura;
            document.getElementById('cae').value = factura.numero_comprobante || '';
            document.getElementById('condicion_pago').value = factura.condicion_pago;
            document.getElementById('observaciones_factura').value = factura.observaciones || '';
        }
    } else {
        // Modo nuevo
        document.getElementById('facturaForm').reset();
        document.getElementById('facturaId').value = '';
        document.getElementById('fecha_emision').valueAsDate = new Date();
    }
    
    document.getElementById('itemsBody').innerHTML = '';
    agregarItemFactura();
    
    const modal = new bootstrap.Modal(document.getElementById('facturaModal'));
    modal.show();
}

// Ver detalle factura
async function verDetalleFactura(facturaId) {
    try {
        const factura = await apiFetch(`/api/facturas-compra/${facturaId}`);
        
        const vencimiento = calcularVencimiento(factura.fecha_emision, factura.condicion_pago);
        const saldo = (factura.total || 0) - (factura.pagado || 0);
        
        let html = `
            <div class="row mb-3">
                <div class="col-md-6">
                    <p><strong>Proveedor:</strong> ${factura.proveedor_nombre}</p>
                    <p><strong>Factura:</strong> ${factura.tipo_factura} ${factura.punto_venta || '0001'}-${factura.numero_factura}</p>
                    <p><strong>Fecha Emisión:</strong> ${factura.fecha_emision}</p>
                    <p><strong>Vencimiento:</strong> ${vencimiento.toLocaleDateString('es-AR')}</p>
                </div>
                <div class="col-md-6">
                    <p><strong>Total:</strong> ${formatearMoneda(factura.total || 0)}</p>
                    <p><strong>Pagado:</strong> ${formatearMoneda(factura.pagado || 0)}</p>
                    <p><strong>Saldo:</strong> ${formatearMoneda(saldo)}</p>
                    <p><strong>Estado:</strong> <span class="badge bg-${factura.estado === 'PAGADA' ? 'success' : 'warning'}">${factura.estado}</span></p>
                </div>
            </div>
            
            <h6>Items</h6>
            <div class="table-responsive">
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Artículo</th>
                            <th>Cantidad</th>
                            <th>Precio Unit.</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(factura.items || []).map(item => `
                            <tr>
                                <td>${item.articulo_nombre || '-'}</td>
                                <td>${item.cantidad}</td>
                                <td>${formatearMoneda(item.precio_unitario)}</td>
                                <td>${formatearMoneda(item.total)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        
        document.getElementById('detalleFacturaContent').innerHTML = html;
        const modal = new bootstrap.Modal(document.getElementById('detalleFacturaModal'));
        modal.show();
        
    } catch (err) {
        console.error('Error cargando detalle:', err);
        alert('Error al cargar detalle de factura');
    }
}

// Abrir modal de pago
function abrirModalPago(facturaId) {
    const factura = facturasCache.find(f => f.id === facturaId);
    if (!factura) return;
    
    const saldo = (factura.total || 0) - (factura.pagado || 0);
    
    document.getElementById('pago_factura_id').value = facturaId;
    document.getElementById('pago_factura_numero').value = `${factura.tipo_factura} ${factura.punto_venta || '0001'}-${factura.numero_factura}`;
    document.getElementById('pago_saldo').value = formatearMoneda(saldo);
    document.getElementById('pago_monto').value = saldo.toFixed(2);
    document.getElementById('pago_fecha').valueAsDate = new Date();
    
    const modal = new bootstrap.Modal(document.getElementById('pagoModal'));
    modal.show();
}

// Anular factura
async function anularFactura(id) {
    if (!confirm('¿Está seguro que desea anular esta factura? Esta acción no se puede deshacer.')) {
        return;
    }
    
    try {
        await apiFetch(`/api/facturas-compra/${id}`, {
            method: 'DELETE'
        });
        
        alert('Factura anulada exitosamente');
        cargarFacturas();
        
    } catch (error) {
        console.error('Error anulando factura:', error);
        alert(error.error || 'Error al anular factura');
    }
}

// Guardar factura
async function guardarFacturaCompra() {
    try {
        const proveedor_id = document.getElementById('factura_proveedor_id').value;
        if (!proveedor_id) {
            alert('Debe seleccionar un proveedor');
            return;
        }
        
        const itemsValidos = itemsFactura.filter(i => i.articulo_id && i.cantidad > 0 && i.precio > 0);
        if (itemsValidos.length === 0) {
            alert('Debe cargar al menos un item válido');
            return;
        }
        
        const payload = {
            proveedor_id: parseInt(proveedor_id),
            fecha_emision: document.getElementById('fecha_emision').value,
            fecha_recepcion: document.getElementById('fecha_recepcion').value || null,
            tipo_factura: document.getElementById('tipo_factura').value,
            punto_venta: document.getElementById('punto_venta').value,
            numero_factura: document.getElementById('numero_factura').value,
            numero_comprobante: document.getElementById('cae').value || null,
            subtotal: parseFloat(document.getElementById('subtotal_factura').value.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0,
            iva: parseFloat(document.getElementById('iva_factura').value) || 0,
            percepciones: parseFloat(document.getElementById('percepciones_factura').value) || 0,
            retenciones: parseFloat(document.getElementById('retenciones_factura').value) || 0,
            total: parseFloat(document.getElementById('total_factura').value.replace(/[^0-9,-]/g, '').replace(',', '.')) || 0,
            condicion_pago: document.getElementById('condicion_pago').value,
            observaciones: document.getElementById('observaciones_factura').value,
            items: itemsValidos.map(i => ({
                articulo_id: i.articulo_id,
                descripcion: null,
                cantidad: i.cantidad,
                precio_unitario: i.precio,
                iva_porcentaje: i.iva_porcentaje,
                subtotal: i.subtotal,
                iva: i.iva,
                total: i.total
            }))
        };
        
        const resp = await apiFetch('/api/facturas-compra', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        alert('Factura registrada correctamente');
        
        // Cerrar modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('facturaModal'));
        if (modal) modal.hide();
        
        // Recargar facturas
        cargarFacturas();
        
    } catch (err) {
        console.error('Error guardando factura:', err);
        alert(err.error || err.message || 'Error al guardar la factura');
    }
}

// Guardar pago
async function guardarPago() {
    try {
        const facturaId = document.getElementById('pago_factura_id').value;
        const monto = parseFloat(document.getElementById('pago_monto').value);
        const fecha = document.getElementById('pago_fecha').value;
        const forma = document.getElementById('pago_forma').value;
        const referencia = document.getElementById('pago_referencia').value;
        
        if (!forma) {
            alert('Debe seleccionar forma de pago');
            return;
        }
        
        const payload = {
            factura_id: parseInt(facturaId),
            monto: monto,
            fecha_pago: fecha,
            forma_pago: forma,
            referencia: referencia
        };
        
        await apiFetch('/api/pagos-proveedores', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        alert('Pago registrado exitosamente');
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('pagoModal'));
        if (modal) modal.hide();
        
        cargarFacturas();
        
    } catch (error) {
        console.error('Error guardando pago:', error);
        alert(error.error || 'Error al registrar pago');
    }
}

// Calcular días entre fechas
function calcularDias(fecha1, fecha2) {
    const d1 = new Date(fecha1);
    const d2 = new Date(fecha2);
    const diferencia = d2 - d1;
    return Math.ceil(diferencia / (1000 * 60 * 60 * 24));
}

// Verificar rol
function verificarRol(rolesPermitidos) {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    return rolesPermitidos.includes(usuario.rol);
}

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    verificarAuth();
    cargarProveedores();
    cargarFacturas();
    console.log('facturas-compras.js cargado');
});

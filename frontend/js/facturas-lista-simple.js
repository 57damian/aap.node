// facturas-lista-simple.js
// Lógica completamente nueva para listar facturas de forma simple

// Variables globales
let facturasCache = [];

// Funciones de utilidad
function formatearMoneda(valor) {
    if (valor === null || valor === undefined) {
        return '$0,00';
    }
    const numero = typeof valor === 'string' ? parseFloat(valor.replace(/[^0-9.-]/g, '')) : valor;
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(numero || 0);
}

function formatearFecha(fecha) {
    if (!fecha) return '-';
    try {
        const date = new Date(fecha);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleDateString('es-AR');
    } catch (err) {
        console.error('Error formateando fecha:', err);
        return '-';
    }
}

function getEstadoBadge(estado) {
    if (!estado) return '<span class="badge bg-secondary">SIN ESTADO</span>';
    
    const estadoUpper = estado.toUpperCase();
    if (estadoUpper === 'PAGADA') {
        return '<span class="badge bg-success">PAGADA</span>';
    } else if (estadoUpper === 'PENDIENTE') {
        return '<span class="badge bg-warning">PENDIENTE</span>';
    } else if (estadoUpper === 'ANULADA') {
        return '<span class="badge bg-danger">ANULADA</span>';
    } else {
        return `<span class="badge bg-secondary">${estado}</span>`;
    }
}

// Función principal para cargar facturas
async function cargarFacturas() {
    console.log('Cargando facturas...');
    
    // Verificar autenticación
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const token = localStorage.getItem('token');
    
    if (!usuario.id || !token) {
        console.error('Usuario no autenticado');
        window.location.href = 'login.html';
        return;
    }
    
    // Mostrar estado de carga
    const tbody = document.getElementById('tablaFacturasBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    <div class="spinner-border spinner-border-sm text-primary" role="status">
                        <span class="visually-hidden">Cargando...</span>
                    </div>
                    <span class="ms-2">Cargando facturas...</span>
                </td>
            </tr>
        `;
    }
    
    // Ocultar mensajes anteriores
    document.getElementById('mensajeNoFacturas').style.display = 'none';
    document.getElementById('mensajeError').style.display = 'none';
    
    try {
        // Usar la función apiFetch si existe, sino hacer fetch manual
        let facturas;
        if (typeof apiFetch === 'function') {
            console.log('Usando apiFetch...');
            facturas = await apiFetch('/api/facturas-compra');
        } else {
            console.log('Usando fetch manual...');
            const response = await fetch(`${API_URL || 'http://localhost:3000'}/api/facturas-compra`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }
            
            facturas = await response.json();
        }
        
        console.log('Facturas recibidas:', facturas.length);
        console.log('Primera factura:', facturas[0]);
        
        // Guardar en cache
        facturasCache = facturas;
        
        // Actualizar contador
        document.getElementById('totalFacturas').textContent = facturas.length;
        document.getElementById('contadorFacturas').textContent = `Mostrando ${facturas.length} facturas`;
        
        // Renderizar tabla
        renderizarTablaFacturas(facturas);
        
        // Mostrar mensaje si no hay facturas
        if (facturas.length === 0) {
            document.getElementById('mensajeNoFacturas').style.display = 'block';
        }
        
    } catch (error) {
        console.error('Error cargando facturas:', error);
        
        // Mostrar mensaje de error
        document.getElementById('textoError').textContent = error.message || 'Error desconocido';
        document.getElementById('mensajeError').style.display = 'block';
        
        // Mostrar error en tabla
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center text-danger py-4">
                        <i class="fas fa-exclamation-triangle"></i>
                        Error al cargar facturas: ${error.message || 'Error desconocido'}
                    </td>
                </tr>
            `;
        }
    }
}

// Función para renderizar la tabla
function renderizarTablaFacturas(facturas) {
    const tbody = document.getElementById('tablaFacturasBody');
    if (!tbody) {
        console.error('No se encontró el elemento tablaFacturasBody');
        return;
    }
    
    if (facturas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    <i class="fas fa-info-circle"></i> No hay facturas registradas
                </td>
            </tr>
        `;
        return;
    }
    
    try {
        const htmlRows = facturas.map(factura => {
            // Extraer datos con valores por defecto
            const tipoFactura = factura.tipo_factura || 'A';
            const puntoVenta = factura.punto_venta || '0001';
            const numeroFactura = factura.numero_factura || '00000000';
            const proveedorNombre = factura.proveedor_nombre || factura.proveedor?.nombre || '-';
            
            // Convertir valores a números
            const total = parseFloat(factura.total) || 0;
            const pagado = parseFloat(factura.pagado) || 0;
            const saldo = parseFloat(factura.saldo) || (total - pagado);
            
            // Estado
            const estado = factura.estado || 'PENDIENTE';
            const estadoBadge = getEstadoBadge(estado);
            
            // Fecha
            const fechaEmision = formatearFecha(factura.fecha_emision);
            
            // Determinar clase de fila según estado
            let rowClass = '';
            if (estado.toUpperCase() === 'PENDIENTE') {
                rowClass = 'table-warning';
            } else if (estado.toUpperCase() === 'ANULADA') {
                rowClass = 'table-danger';
            } else if (estado.toUpperCase() === 'PAGADA') {
                rowClass = 'table-success';
            }
            
            return `
                <tr class="${rowClass}">
                    <td>
                        <strong>${tipoFactura} ${puntoVenta}-${numeroFactura}</strong>
                        ${factura.cae ? `<br><small class="text-muted">CAE: ${factura.cae}</small>` : ''}
                    </td>
                    <td>${proveedorNombre}</td>
                    <td>${fechaEmision}</td>
                    <td class="text-end">${formatearMoneda(total)}</td>
                    <td class="text-end">${formatearMoneda(pagado)}</td>
                    <td class="text-end fw-bold ${saldo > 0 ? 'text-danger' : 'text-success'}">
                        ${formatearMoneda(saldo)}
                    </td>
                    <td>${estadoBadge}</td>
                    <td>
                        <button class="btn btn-sm btn-info" onclick="verDetalleFactura(${factura.id})" title="Ver detalle">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${estado.toUpperCase() === 'PENDIENTE' ? `
                            <button class="btn btn-sm btn-success" onclick="registrarPago(${factura.id})" title="Registrar pago">
                                <i class="fas fa-money-bill"></i>
                            </button>
                        ` : ''}
                    </td>
                </tr>
            `;
        });
        
        tbody.innerHTML = htmlRows.join('');
        
    } catch (error) {
        console.error('Error renderizando tabla:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-danger py-4">
                    <i class="fas fa-exclamation-triangle"></i>
                    Error al renderizar facturas: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Función para ver detalle de factura
async function verDetalleFactura(facturaId) {
    try {
        console.log('Cargando detalle de factura:', facturaId);
        
        const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
        const token = localStorage.getItem('token');
        
        if (!usuario.id || !token) {
            alert('Usuario no autenticado');
            window.location.href = 'login.html';
            return;
        }
        
        // Buscar factura en cache primero
        let factura = facturasCache.find(f => f.id === facturaId);
        
        // Si no está en cache, cargarla de la API
        if (!factura) {
            if (typeof apiFetch === 'function') {
                factura = await apiFetch(`/api/facturas-compra/${facturaId}`);
            } else {
                const response = await fetch(`${API_URL || 'http://localhost:3000'}/api/facturas-compra/${facturaId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`Error HTTP: ${response.status}`);
                }
                
                factura = await response.json();
            }
        }
        
        // Calcular saldo
        const total = parseFloat(factura.total) || 0;
        const pagado = parseFloat(factura.pagado) || 0;
        const saldo = total - pagado;
        
        // Formatear fecha de vencimiento si existe
        let fechaVencimiento = '-';
        if (factura.fecha_vencimiento) {
            fechaVencimiento = formatearFecha(factura.fecha_vencimiento);
        } else if (factura.fecha_emision && factura.condicion_pago) {
            // Calcular vencimiento aproximado
            const fechaEmision = new Date(factura.fecha_emision);
            if (factura.condicion_pago.includes('30')) {
                fechaEmision.setDate(fechaEmision.getDate() + 30);
                fechaVencimiento = fechaEmision.toLocaleDateString('es-AR');
            } else if (factura.condicion_pago.includes('60')) {
                fechaEmision.setDate(fechaEmision.getDate() + 60);
                fechaVencimiento = fechaEmision.toLocaleDateString('es-AR');
            }
        }
        
        // Construir HTML del detalle
        let html = `
            <div class="row">
                <div class="col-md-6">
                    <h6>Información de Factura</h6>
                    <table class="table table-sm">
                        <tr>
                            <th>Factura:</th>
                            <td>${factura.tipo_factura || 'A'} ${factura.punto_venta || '0001'}-${factura.numero_factura || ''}</td>
                        </tr>
                        <tr>
                            <th>Proveedor:</th>
                            <td>${factura.proveedor_nombre || factura.proveedor?.nombre || '-'}</td>
                        </tr>
                        <tr>
                            <th>Fecha Emisión:</th>
                            <td>${formatearFecha(factura.fecha_emision)}</td>
                        </tr>
                        <tr>
                            <th>Fecha Vencimiento:</th>
                            <td>${fechaVencimiento}</td>
                        </tr>
                        <tr>
                            <th>Condición Pago:</th>
                            <td>${factura.condicion_pago || 'CONTADO'}</td>
                        </tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6>Totales</h6>
                    <table class="table table-sm">
                        <tr>
                            <th>Total Factura:</th>
                            <td class="text-end">${formatearMoneda(total)}</td>
                        </tr>
                        <tr>
                            <th>Pagado:</th>
                            <td class="text-end">${formatearMoneda(pagado)}</td>
                        </tr>
                        <tr class="fw-bold">
                            <th>Saldo Pendiente:</th>
                            <td class="text-end ${saldo > 0 ? 'text-danger' : 'text-success'}">
                                ${formatearMoneda(saldo)}
                            </td>
                        </tr>
                        <tr>
                            <th>Estado:</th>
                            <td>${getEstadoBadge(factura.estado)}</td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
        
        // Agregar items si existen
        if (factura.items && factura.items.length > 0) {
            html += `
                <hr>
                <h6>Items de la Factura</h6>
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
                            ${factura.items.map(item => `
                                <tr>
                                    <td>${item.articulo_nombre || item.descripcion || '-'}</td>
                                    <td>${item.cantidad || 0}</td>
                                    <td>${formatearMoneda(item.precio_unitario)}</td>
                                    <td>${formatearMoneda(item.total)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        // Mostrar en modal
        document.getElementById('detalleFacturaContent').innerHTML = html;
        const modal = new bootstrap.Modal(document.getElementById('detalleFacturaModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error cargando detalle:', error);
        alert('Error al cargar detalle de factura: ' + (error.message || 'Error desconocido'));
    }
}

// Función para registrar pago (simplificada)
function registrarPago(facturaId) {
    const factura = facturasCache.find(f => f.id === facturaId);
    if (!factura) {
        alert('No se encontró la factura');
        return;
    }
    
    const total = parseFloat(factura.total) || 0;
    const pagado = parseFloat(factura.pagado) || 0;
    const saldo = total - pagado;
    
    if (saldo <= 0) {
        alert('Esta factura ya está pagada completamente');
        return;
    }
    
    // Redirigir a la página de pagos con la factura seleccionada
    window.location.href = `pagos-proveedores.html?factura_id=${facturaId}`;
}

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    console.log('facturas-lista-simple.js cargado');
    
    // Verificar autenticación
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    if (!usuario.id) {
        window.location.href = 'login.html';
        return;
    }
    
    // Cargar facturas automáticamente
    setTimeout(() => {
        cargarFacturas();
    }, 100);
});
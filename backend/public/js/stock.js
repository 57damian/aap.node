// stock.js
let stockCache = [];
let proveedoresCache = [];
let movimientosCache = [];
let dolarActual = 0;

// Formatear moneda
function formatearMoneda(valor) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(valor);
}

// Formatear dólares
function formatearDolares(valor) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'USD'
    }).format(valor);
}

// Inicializar página
document.addEventListener('DOMContentLoaded', () => {
    verificarAuth();
    cargarProveedores();
    cargarDolar();
    cargarStock();
});

// Cargar dólar actual
async function cargarDolar() {
    try {
        const dolarData = await apiFetch('/api/precios/parametros/dolar');
        dolarActual = dolarData.dolar || 0;
        
        // Actualizar indicador de dólar en la interfaz
        const dolarElement = document.getElementById('dolarActual');
        if (dolarElement) {
            dolarElement.textContent = `Dólar: ARS ${dolarActual.toFixed(2)}`;
        }
    } catch (err) {
        console.error('Error cargando dólar:', err);
        dolarActual = 1415.00; // Valor por defecto
    }
}

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

// Cargar stock
async function cargarStock() {
    try {
        const params = new URLSearchParams();
        
        const proveedor = document.getElementById('filtroProveedor')?.value;
        const estado = document.getElementById('filtroEstadoStock')?.value;
        const search = document.getElementById('searchInput')?.value;
        
        if (proveedor) params.append('proveedor_id', proveedor);
        if (estado) params.append('estado', estado);
        if (search) params.append('search', search);
        
        const endpoint = `/api/stock${params.toString() ? '?' + params : ''}`;
        const stock = await apiFetch(endpoint);
        stockCache = stock;
        
        renderizarTablaStock(stock);
        actualizarEstadisticas(stock);
        renderizarStockBajo(stock);
        renderizarStockCritico(stock);
        cargarMovimientos();
    } catch (err) {
        console.error('Error cargando stock:', err);
        alert(err.error || 'Error al cargar stock');
    }
}

// Renderizar tabla de stock
function renderizarTablaStock(stock) {
    const tbody = document.getElementById('stockTableBody');
    
    if (!stock || stock.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">No hay artículos</td></tr>';
        return;
    }
    
    tbody.innerHTML = stock.map(s => {
        let estadoBadge = '';
        let rowClass = '';
        
        if (s.stock_actual === 0) {
            estadoBadge = '<span class="badge bg-danger">SIN STOCK</span>';
            rowClass = 'table-danger';
        } else if (s.stock_actual <= s.stock_minimo) {
            estadoBadge = '<span class="badge bg-warning">BAJO</span>';
            rowClass = 'table-warning';
        } else {
            estadoBadge = '<span class="badge bg-success">NORMAL</span>';
        }
        
        return `
            <tr class="${rowClass}">
                <td>${s.codigo || '-'}</td>
                <td>${s.nombre}</td>
                <td>${s.proveedor_nombre || '-'}</td>
                <td>${s.stock_actual || 0} ${s.unidad_medida || 'UNI'}</td>
                <td>${s.stock_minimo || 0} ${s.unidad_medida || 'UNI'}</td>
                <td>${s.ubicacion || '-'}</td>
                <td>${formatearMoneda(s.ultimo_precio || 0)}</td>
                <td>${s.fecha_ultima_compra || '-'}</td>
                <td>${estadoBadge}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="abrirModalAjuste(${s.articulo_id}, '${s.nombre}', ${s.stock_actual})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-info" onclick="verHistorial(${s.articulo_id})">
                        <i class="fas fa-history"></i>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="verPrecios(${s.articulo_id})">
                        <i class="fas fa-chart-line"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Renderizar stock bajo
function renderizarStockBajo(stock) {
    const tbody = document.getElementById('bajoTableBody');
    
    const bajo = stock.filter(s => s.stock_actual > 0 && s.stock_actual <= s.stock_minimo);
    
    if (bajo.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay artículos con stock bajo</td></tr>';
        return;
    }
    
    tbody.innerHTML = bajo.map(s => {
        const diferencia = s.stock_minimo - s.stock_actual;
        return `
            <tr class="table-warning">
                <td>${s.codigo || '-'}</td>
                <td>${s.nombre}</td>
                <td>${s.proveedor_nombre || '-'}</td>
                <td>${s.stock_actual} ${s.unidad_medida || 'UNI'}</td>
                <td>${s.stock_minimo} ${s.unidad_medida || 'UNI'}</td>
                <td><span class="badge bg-warning">${diferencia} falta</span></td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="abrirModalAjuste(${s.articulo_id}, '${s.nombre}', ${s.stock_actual})">
                        <i class="fas fa-edit"></i> Ajustar
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Renderizar stock crítico
function renderizarStockCritico(stock) {
    const tbody = document.getElementById('criticoTableBody');
    
    const critico = stock.filter(s => s.stock_actual === 0);
    
    if (critico.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay artículos sin stock</td></tr>';
        return;
    }
    
    tbody.innerHTML = critico.map(s => {
        return `
            <tr class="table-danger">
                <td>${s.codigo || '-'}</td>
                <td>${s.nombre}</td>
                <td>${s.proveedor_nombre || '-'}</td>
                <td>${s.fecha_ultima_compra || '-'}</td>
                <td>${formatearMoneda(s.ultimo_precio || 0)}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="abrirModalAjuste(${s.articulo_id}, '${s.nombre}', 0)">
                        <i class="fas fa-edit"></i> Ajustar
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Cargar movimientos
async function cargarMovimientos() {
    try {
        const movimientos = await apiFetch('/api/stock/movimientos');
        movimientosCache = movimientos;
        renderizarMovimientos(movimientos);
    } catch (err) {
        console.error('Error cargando movimientos:', err);
    }
}

// Renderizar movimientos
function renderizarMovimientos(movimientos) {
    const tbody = document.getElementById('movimientosTableBody');
    
    if (!movimientos || movimientos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay movimientos registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = movimientos.slice(0, 50).map(m => {
        let tipoBadge = '';
        if (m.tipo_movimiento === 'ENTRADA') {
            tipoBadge = '<span class="badge bg-success">ENTRADA</span>';
        } else if (m.tipo_movimiento === 'SALIDA') {
            tipoBadge = '<span class="badge bg-danger">SALIDA</span>';
        } else {
            tipoBadge = '<span class="badge bg-warning">AJUSTE</span>';
        }
        
        return `
            <tr>
                <td>${m.fecha || '-'}</td>
                <td>${m.articulo_nombre || '-'}</td>
                <td>${tipoBadge}</td>
                <td>${m.cantidad || 0}</td>
                <td>${m.stock_anterior || 0}</td>
                <td>${m.stock_nuevo || 0}</td>
                <td>${m.usuario || '-'}</td>
                <td>${m.observacion || '-'}</td>
            </tr>
        `;
    }).join('');
}

// Actualizar estadísticas
function actualizarEstadisticas(stock) {
    const totalArticulos = stock.length;
    const stockValorizado = stock.reduce((sum, s) => sum + ((s.stock_actual || 0) * (s.ultimo_precio || 0)), 0);
    const bajo = stock.filter(s => s.stock_actual > 0 && s.stock_actual <= s.stock_minimo).length;
    const critico = stock.filter(s => s.stock_actual === 0).length;
    
    // Calcular valor en dólares
    const stockValorizadoUSD = dolarActual > 0 ? stockValorizado / dolarActual : 0;
    
    document.getElementById('totalArticulos').textContent = totalArticulos;
    document.getElementById('stockValorizado').textContent = formatearMoneda(stockValorizado);
    document.getElementById('stockValorizadoUSD').textContent = formatearDolares(stockValorizadoUSD);
    document.getElementById('articulosStockBajo').textContent = bajo;
    document.getElementById('articulosCriticos').textContent = critico;
}

// Abrir modal de ajuste
function abrirModalAjuste(articuloId, articuloNombre, stockActual) {
    document.getElementById('ajuste_articulo_id').value = articuloId;
    document.getElementById('ajuste_articulo_nombre').value = articuloNombre;
    document.getElementById('ajuste_stock_actual').value = stockActual;
    document.getElementById('ajuste_nuevo_stock').value = stockActual;
    document.getElementById('ajuste_tipo').value = '';
    document.getElementById('ajuste_motivo').value = '';
    document.getElementById('ajuste_fecha').valueAsDate = new Date();
    
    const modal = new bootstrap.Modal(document.getElementById('ajusteModal'));
    modal.show();
}

// Guardar ajuste
async function guardarAjuste() {
    try {
        const articuloId = document.getElementById('ajuste_articulo_id').value;
        const stockActual = parseFloat(document.getElementById('ajuste_stock_actual').value);
        const nuevoStock = parseFloat(document.getElementById('ajuste_nuevo_stock').value);
        const tipo = document.getElementById('ajuste_tipo').value;
        const motivo = document.getElementById('ajuste_motivo').value;
        const fecha = document.getElementById('ajuste_fecha').value;
        
        if (!tipo) {
            alert('Debe seleccionar tipo de ajuste');
            return;
        }
        
        if (!motivo) {
            alert('Debe ingresar motivo del ajuste');
            return;
        }
        
        // Calcular la diferencia (cantidad relativa)
        const cantidad = nuevoStock - stockActual;
        
        const payload = {
            materia_prima_id: parseInt(articuloId),
            cantidad: cantidad,
            tipo_movimiento: tipo,
            observaciones: motivo,
            fecha_movimiento: fecha
        };
        
        await apiFetch('/api/stock/ajuste', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        alert('Ajuste registrado correctamente');
        bootstrap.Modal.getInstance(document.getElementById('ajusteModal')).hide();
        cargarStock();
        
    } catch (err) {
        console.error('Error guardando ajuste:', err);
        alert(err.error || 'Error al guardar ajuste');
    }
}

// Ver historial
async function verHistorial(articuloId) {
    try {
        const movimientos = await apiFetch(`/api/stock/materia-prima/${articuloId}/movimientos`);
        
        const tbody = document.getElementById('historialBody');
        if (!movimientos || movimientos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay movimientos</td></tr>';
        } else {
            tbody.innerHTML = movimientos.map(m => `
                <tr>
                    <td>${m.fecha_movimiento || '-'}</td>
                    <td>${m.tipo_movimiento || '-'}</td>
                    <td>${m.cantidad || 0}</td>
                    <td>${m.stock_anterior || 0}</td>
                    <td>${m.stock_nuevo || 0}</td>
                    <td>${m.usuario_nombre || '-'}</td>
                    <td>${m.observaciones || '-'}</td>
                </tr>
            `).join('');
        }
        
        const modal = new bootstrap.Modal(document.getElementById('historialModal'));
        modal.show();
        
    } catch (err) {
        console.error('Error cargando historial:', err);
        alert('Error al cargar historial');
    }
}

// Ver precios
async function verPrecios(articuloId) {
    try {
        const precios = await apiFetch(`/api/materias-primas/${articuloId}/historial-precios`);
        
        const tbody = document.getElementById('preciosBody');
        if (!precios || precios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No hay historial de precios</td></tr>';
        } else {
            tbody.innerHTML = precios.map(p => `
                <tr>
                    <td>${p.fecha_cambio || '-'}</td>
                    <td>${formatearMoneda(p.precio_anterior || 0)}</td>
                    <td>${formatearMoneda(p.precio_nuevo || 0)}</td>
                    <td class="${p.variacion_porcentaje > 0 ? 'text-success' : 'text-danger'}">
                        ${p.variacion_porcentaje > 0 ? '+' : ''}${p.variacion_porcentaje || 0}%
                    </td>
                    <td>${p.factura_numero || '-'}</td>
                </tr>
            `).join('');
        }
        
        const modal = new bootstrap.Modal(document.getElementById('preciosModal'));
        modal.show();
        
    } catch (err) {
        console.error('Error cargando precios:', err);
        alert('Error al cargar historial de precios');
    }
}

// Limpiar filtros
function limpiarFiltros() {
    document.getElementById('filtroProveedor').value = '';
    document.getElementById('filtroEstadoStock').value = '';
    document.getElementById('searchInput').value = '';
    cargarStock();
}

// Verificar rol
function verificarRol(rolesPermitidos) {
    const rolUsuario = localStorage.getItem('rol');
    return rolesPermitidos.includes(rolUsuario);
}

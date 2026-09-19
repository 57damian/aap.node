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
        cargarMovimientos();
    } catch (err) {
        console.error('Error cargando stock:', err);
        Shell.error(err, 'No se pudo cargar el stock');
    }
}

// Indicador persistente de variación de precio respecto a la última compra
// al mismo proveedor (diseño acordado 12/09/2026: toda suba o baja se avisa
// directamente en el listado, no solo al abrir el historial de precios).
function renderizarVariacionPrecio(s) {
    const variacion = s.variacion_precio;
    if (variacion === null || variacion === undefined) return '';

    const valor = parseFloat(variacion);
    if (isNaN(valor) || Math.abs(valor) < 0.01) return '';

    // Subió = rojo (nos cuesta más), bajó = verde. El título muestra contra
    // qué precio se compara, que es el de la compra anterior al mismo proveedor.
    const clase = valor > 0 ? 'neg' : 'pos';
    const signo = valor > 0 ? '▲' : '▼';
    const antes = formatearMoneda(s.variacion_precio_anterior || 0);
    return ` <span class="${clase}" title="Antes: ${antes}">${signo} ${Math.abs(valor).toFixed(1)}%</span>`;
}

// Renderizar tabla de stock
function renderizarTablaStock(stock) {
    const tbody = document.getElementById('stockTableBody');

    if (!stock || stock.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">${Shell.vacio(
            'No hay materiales para este filtro',
            'Probá limpiar los filtros o cargá materiales nuevos.',
            { txt: 'Administrar materiales', url: 'stock-mp.html' })}</td></tr>`;
        return;
    }

    tbody.innerHTML = stock.map(s => {
        const actual = Number(s.stock_actual) || 0;
        const minimo = Number(s.stock_minimo) || 0;
        const unidad = s.unidad_medida || '';
        const estado = actual === 0 ? 'SIN STOCK' : (actual <= minimo ? 'FALTA' : 'OK');
        const nombreSeguro = String(s.nombre || '').replace(/'/g, "\'");

        return `
            <tr>
                <td><strong>${s.nombre || '—'}</strong>${s.codigo ? ' <span class="muted">' + s.codigo + '</span>' : ''}</td>
                <td class="num ${actual === 0 ? 'neg' : ''}" data-label="Stock">${actual.toLocaleString('es-AR')} ${unidad}</td>
                <td class="num muted solo-escritorio" data-label="Mínimo">${minimo.toLocaleString('es-AR')}</td>
                <td class="num" data-label="Último precio">${formatearMoneda(s.ultimo_precio || 0)}${renderizarVariacionPrecio(s)}</td>
                <td class="muted solo-escritorio" data-label="Proveedor">${s.proveedor_nombre || '—'}</td>
                <td data-label="Estado">${Shell.pill(estado)}</td>
                <td class="num">
                    <button class="b b-ghost b-sm" onclick="abrirModalAjuste(${s.articulo_id}, '${nombreSeguro}', ${actual})">Ajustar</button>
                    <button class="b b-ghost b-sm solo-escritorio" onclick="verHistorial(${s.articulo_id})">Movimientos</button>
                    <button class="b b-ghost b-sm solo-escritorio" onclick="verPrecios(${s.articulo_id})">Precios</button>
                </td>
            </tr>`;
    }).join('');
}

// Renderizar stock bajo
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
    
    document.getElementById('ajusteModal').showModal();
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
            Shell.toast('err', 'Elegí el tipo de ajuste');
            return;
        }
        
        if (!motivo) {
            Shell.toast('err', 'Escribí el motivo del ajuste');
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
        
        Shell.toast('ok', 'Ajuste registrado');
        document.getElementById('ajusteModal').close();
        cargarStock();
        
    } catch (err) {
        console.error('Error guardando ajuste:', err);
        Shell.error(err, 'No se pudo guardar el ajuste');
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
        
        document.getElementById('historialModal').showModal();
        
    } catch (err) {
        console.error('Error cargando historial:', err);
        Shell.error(err, 'No se pudo cargar el historial');
    }
}

// Ver precios
async function verPrecios(articuloId) {
    try {
        const precios = await apiFetch(`/api/materias-primas/${articuloId}/historial-precios`);
        
        const tbody = document.getElementById('preciosBody');
        if (!precios || precios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay historial de precios</td></tr>';
        } else {
            tbody.innerHTML = precios.map(p => `
                <tr>
                    <td>${p.fecha_cambio || '-'}</td>
                    <td>${formatearMoneda(p.precio_anterior || 0)}</td>
                    <td>${formatearMoneda(p.precio_nuevo || 0)}</td>
                    <td class="${p.variacion_porcentaje > 0 ? 'text-danger' : 'text-success'}">
                        ${p.variacion_porcentaje > 0 ? '+' : ''}${p.variacion_porcentaje || 0}%
                    </td>
                    <td>${p.proveedor_nombre || '-'}</td>
                    <td>${p.factura_numero || '-'}</td>
                </tr>
            `).join('');
        }
        
        document.getElementById('preciosModal').showModal();
        
    } catch (err) {
        console.error('Error cargando precios:', err);
        Shell.error(err, 'No se pudo cargar el historial de precios');
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


// ============================================
// PESTAÑAS Y ATAJOS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab[data-tab]').forEach(boton => {
    boton.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      boton.classList.add('active');
      document.getElementById('tab-' + boton.dataset.tab)?.classList.add('active');
      if (boton.dataset.tab === 'movimientos') cargarMovimientos();
    });
  });

  // Tocar una tarjeta aplica su filtro: es el reemplazo de las dos pestañas
  // que antes repetían la misma tabla.
  document.querySelectorAll('.kpi[data-filtro]').forEach(tarjeta => {
    tarjeta.style.cursor = 'pointer';
    tarjeta.addEventListener('click', () => {
      document.getElementById('filtroEstadoStock').value = tarjeta.dataset.filtro;
      cargarStock();
    });
  });

  // Buscar con Enter, sin tener que ir hasta el botón
  document.getElementById('searchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); cargarStock(); }
  });

  // Cerrar las ventanas
  document.querySelectorAll('[data-cerrar]').forEach(b => {
    b.addEventListener('click', () => document.getElementById(b.dataset.cerrar)?.close());
  });
});

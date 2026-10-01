// stock.js
let stockCache = [];
let proveedoresCache = [];
let movimientosCache = [];
let preciosCompraCache = [];
let dolarActual = 0;

// Formatear moneda
function formatearMoneda(valor) {
    // Montos ocultos: Shell.monto lo anota para que el ojo lo oculte (shell.js).
    const texto = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(valor);
    return window.Shell && Shell.monto ? Shell.monto(texto) : texto;
}

// Formatear dólares
function formatearDolares(valor) {
    // Montos ocultos: Shell.monto lo anota para que el ojo lo oculte (shell.js).
    const texto = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'USD'
    }).format(valor);
    return window.Shell && Shell.monto ? Shell.monto(texto) : texto;
}

// Inicializar página
document.addEventListener('DOMContentLoaded', () => {
    verificarAuth();
    precargarFiltroMovFechas();
    cargarProveedores();
    cargarDolar();
    cargarStock();
});

// Por defecto el informe de Movimientos arranca acotado al mes en curso,
// para no depender nunca del LIMIT de salvaguarda del backend.
function precargarFiltroMovFechas() {
    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const aISO = d => d.toISOString().slice(0, 10);
    const campoDesde = document.getElementById('filtroMovDesde');
    const campoHasta = document.getElementById('filtroMovHasta');
    if (campoDesde) campoDesde.value = aISO(inicioMes);
    if (campoHasta) campoHasta.value = aISO(hoy);
}

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

        const opciones = proveedores.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

        const selectFiltro = document.getElementById('filtroProveedor');
        selectFiltro.innerHTML = '<option value="">Todos los proveedores</option>' + opciones;

        const selectFiltroMov = document.getElementById('filtroMovProveedor');
        if (selectFiltroMov) selectFiltroMov.innerHTML = '<option value="">Todos</option>' + opciones;

        const selectFiltroPrec = document.getElementById('filtroPrecProveedor');
        if (selectFiltroPrec) selectFiltroPrec.innerHTML = '<option value="">Todos</option>' + opciones;
    } catch (err) {
        console.error('Error cargando proveedores:', err);
    }
}

// Popula los selects de material de los filtros de Movimientos y Precios
// con el stock ya cargado.
function poblarFiltroMaterial(stock) {
    const opciones = stock.map(s => `<option value="${s.articulo_id}">${s.nombre || s.codigo || s.articulo_id}</option>`).join('');

    ['filtroMovMaterial', 'filtroPrecMaterial'].forEach(idSelect => {
        const select = document.getElementById(idSelect);
        if (!select) return;
        const seleccionado = select.value;
        select.innerHTML = '<option value="">Todos</option>' + opciones;
        select.value = seleccionado;
    });
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
        poblarFiltroMaterial(stock);
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
            'No hay materias primas para este filtro',
            'Probá limpiar los filtros o cargá materias primas nuevas.',
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

// Cargar movimientos (informe de compras/stock), con los filtros de la tab
async function cargarMovimientos() {
    try {
        const params = new URLSearchParams();

        const desde = document.getElementById('filtroMovDesde')?.value;
        const hasta = document.getElementById('filtroMovHasta')?.value;
        const proveedor = document.getElementById('filtroMovProveedor')?.value;
        const material = document.getElementById('filtroMovMaterial')?.value;
        const tipo = document.getElementById('filtroMovTipo')?.value;

        if (desde) params.append('desde', desde);
        if (hasta) params.append('hasta', hasta);
        if (proveedor) params.append('proveedor_id', proveedor);
        if (material) params.append('materia_prima_id', material);
        if (tipo) params.append('tipo', tipo);

        const endpoint = `/api/stock/movimientos${params.toString() ? '?' + params : ''}`;
        const movimientos = await apiFetch(endpoint);
        movimientosCache = movimientos;
        renderizarMovimientos(movimientos);
    } catch (err) {
        console.error('Error cargando movimientos:', err);
        Shell.error(err, 'No se pudo cargar los movimientos');
    }
}

// Renderizar movimientos (informe de compras/stock)
function renderizarMovimientos(movimientos) {
    const tbody = document.getElementById('movimientosTableBody');

    if (!movimientos || movimientos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8">${Shell.vacio(
            'No hay movimientos para este filtro',
            'Probá ampliar el rango de fechas o limpiar los filtros.')}</td></tr>`;
        return;
    }

    tbody.innerHTML = movimientos.map(m => `
        <tr>
            <td data-label="Fecha">${Shell.fecha(m.fecha)}</td>
            <td data-label="Material"><strong>${m.articulo_nombre || '-'}</strong>${m.articulo_codigo ? ' <span class="muted">' + m.articulo_codigo + '</span>' : ''}</td>
            <td data-label="Tipo">${Shell.pill(m.tipo_movimiento)}</td>
            <td class="num" data-label="Cantidad">${m.cantidad ?? 0} ${m.unidad || ''}</td>
            <td data-label="Proveedor">${m.proveedor_nombre || '—'}</td>
            <td class="solo-escritorio" data-label="N° de factura">${m.numero_factura ? (m.numero_factura + (m.factura_fecha ? ' (' + Shell.fecha(m.factura_fecha) + ')' : '')) : '—'}</td>
            <td class="solo-escritorio" data-label="Observación">${m.observacion || '—'}</td>
            <td class="num solo-escritorio" data-label="Quedó en">${m.stock_nuevo ?? '—'}</td>
        </tr>
    `).join('');
}

// Limpiar filtros de Movimientos
function limpiarFiltrosMovimientos() {
    document.getElementById('filtroMovDesde').value = '';
    document.getElementById('filtroMovHasta').value = '';
    document.getElementById('filtroMovProveedor').value = '';
    document.getElementById('filtroMovMaterial').value = '';
    document.getElementById('filtroMovTipo').value = '';
    cargarMovimientos();
}

// Exportar el informe de movimientos (ya filtrado) a CSV
function exportarMovimientosCSV() {
    if (!movimientosCache.length) {
        Shell.toast('err', 'No hay datos para exportar');
        return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    const headers = ['Fecha', 'Material', 'Código', 'Tipo', 'Cantidad', 'Unidad',
        'Precio unitario', 'Proveedor', 'N° de factura', 'Observaciones', 'Usuario'];
    csvContent += headers.join(',') + '\n';

    movimientosCache.forEach(m => {
        const fila = [
            m.fecha || '',
            `"${(m.articulo_nombre || '').replace(/"/g, '""')}"`,
            `"${(m.articulo_codigo || '').replace(/"/g, '""')}"`,
            m.tipo_movimiento || '',
            m.cantidad ?? 0,
            m.unidad || '',
            m.precio_unitario ?? '',
            `"${(m.proveedor_nombre || '').replace(/"/g, '""')}"`,
            m.numero_factura || '',
            `"${(m.observacion || '').replace(/"/g, '""')}"`,
            `"${(m.usuario || '').replace(/"/g, '""')}"`
        ];
        csvContent += fila.join(',') + '\n';
    });

    const desde = document.getElementById('filtroMovDesde')?.value;
    const hasta = document.getElementById('filtroMovHasta')?.value;
    const rango = (desde || hasta) ? `${desde || 'inicio'}_a_${hasta || 'hoy'}` : new Date().toISOString().slice(0, 10);

    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `movimientos-stock-${rango}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    Shell.toast('ok', 'Reporte exportado');
}

// ============================================
// EVOLUCIÓN DE PRECIOS DE COMPRA (tab nueva)
// ============================================
function paramsPrecios() {
    const params = new URLSearchParams();
    const desde = document.getElementById('filtroPrecDesde')?.value;
    const hasta = document.getElementById('filtroPrecHasta')?.value;
    const material = document.getElementById('filtroPrecMaterial')?.value;
    const proveedor = document.getElementById('filtroPrecProveedor')?.value;

    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);
    if (material) params.append('materia_prima_id', material);
    if (proveedor) params.append('proveedor_id', proveedor);
    return params;
}

async function cargarEvolucionPrecios() {
    try {
        const params = paramsPrecios();
        const endpoint = `/api/materias-primas/historial-precios${params.toString() ? '?' + params : ''}`;
        const precios = await apiFetch(endpoint);
        preciosCompraCache = precios || [];
        renderizarEvolucionPrecios(precios);
    } catch (err) {
        console.error('Error cargando evolución de precios:', err);
        Shell.error(err, 'No se pudo cargar la evolución de precios');
    }
}

function renderizarEvolucionPrecios(precios) {
    const tbody = document.getElementById('evolucionPreciosTableBody');

    if (!precios || precios.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">${Shell.vacio(
            'No hay cambios de precio para este filtro',
            'Probá ampliar el rango de fechas o limpiar los filtros.')}</td></tr>`;
        return;
    }

    tbody.innerHTML = precios.map(p => {
        const variacion = p.variacion_porcentaje;
        const claseVar = variacion > 0 ? 'neg' : (variacion < 0 ? 'pos' : '');
        return `
        <tr>
            <td data-label="Fecha">${Shell.fecha(p.fecha_cambio)}</td>
            <td data-label="Material"><strong>${p.material_nombre || '-'}</strong>${p.material_codigo ? ' <span class="muted">' + p.material_codigo + '</span>' : ''}</td>
            <td data-label="Proveedor">${p.proveedor_nombre || '—'}</td>
            <td class="num" data-label="Precio anterior">${p.precio_anterior != null ? formatearMoneda(p.precio_anterior) : '—'}</td>
            <td class="num" data-label="Precio nuevo">${formatearMoneda(p.precio_nuevo)}</td>
            <td class="num ${claseVar}" data-label="Variación">${variacion != null ? (variacion > 0 ? '+' : '') + Number(variacion).toFixed(1) + '%' : '—'}</td>
            <td class="solo-escritorio" data-label="N° de factura">${p.factura_numero || '—'}</td>
        </tr>`;
    }).join('');
}

function limpiarFiltrosPrecios() {
    document.getElementById('filtroPrecDesde').value = '';
    document.getElementById('filtroPrecHasta').value = '';
    document.getElementById('filtroPrecMaterial').value = '';
    document.getElementById('filtroPrecProveedor').value = '';
    cargarEvolucionPrecios();
}

function exportarPreciosCSV() {
    if (!preciosCompraCache.length) {
        Shell.toast('err', 'No hay datos para exportar');
        return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    const headers = ['Fecha', 'Material', 'Código', 'Proveedor', 'Precio anterior', 'Precio nuevo', 'Variación %', 'N° de factura'];
    csvContent += headers.join(',') + '\n';

    preciosCompraCache.forEach(p => {
        const fila = [
            p.fecha_cambio || '',
            `"${(p.material_nombre || '').replace(/"/g, '""')}"`,
            `"${(p.material_codigo || '').replace(/"/g, '""')}"`,
            `"${(p.proveedor_nombre || '').replace(/"/g, '""')}"`,
            p.precio_anterior ?? '',
            p.precio_nuevo ?? '',
            p.variacion_porcentaje ?? '',
            p.factura_numero || ''
        ];
        csvContent += fila.join(',') + '\n';
    });

    const desde = document.getElementById('filtroPrecDesde')?.value;
    const hasta = document.getElementById('filtroPrecHasta')?.value;
    const rango = (desde || hasta) ? `${desde || 'inicio'}_a_${hasta || 'hoy'}` : new Date().toISOString().slice(0, 10);

    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `precios-compra-${rango}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    Shell.toast('ok', 'Reporte exportado');
}

async function verPreciosPdf() {
    try {
        const params = paramsPrecios();
        await verArchivoProtegido(`api/materias-primas/historial-precios/pdf${params.toString() ? '?' + params : ''}`);
    } catch (err) {
        Shell.error(err, 'No se pudo abrir el PDF');
    }
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
        
        const tbody = document.getElementById('preciosTableBody');
        if (!precios || precios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay historial de precios</td></tr>';
        } else {
            tbody.innerHTML = precios.map(p => `
                <tr>
                    <td>${Shell.fecha(p.fecha_cambio)}</td>
                    <td>${formatearMoneda(p.precio_anterior || 0)}</td>
                    <td>${formatearMoneda(p.precio_nuevo || 0)}</td>
                    <td class="${p.variacion_porcentaje > 0 ? 'neg' : (p.variacion_porcentaje < 0 ? 'pos' : '')}">
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
      if (boton.dataset.tab === 'precios') cargarEvolucionPrecios();
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

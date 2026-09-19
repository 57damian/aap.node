// stock-mp.js - ABM de Materias Primas
let materiasPrimasCache = [];

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
    cargarMateriasPrimas();
});

// Cargar materias primas
async function cargarMateriasPrimas() {
    try {
        const materiasPrimas = await apiFetch('/api/materias-primas');
        materiasPrimasCache = materiasPrimas;
        renderizarTablaMateriasPrimas(materiasPrimas);
    } catch (err) {
        console.error('Error cargando materias primas:', err);
        Shell.error(err, 'No se pudieron cargar los materiales');
    }
}

// Renderizar tabla de materias primas
function renderizarTablaMateriasPrimas(materiasPrimas) {
    const tbody = document.getElementById('materiasPrimasTableBody');

    if (!materiasPrimas || materiasPrimas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">${Shell.vacio(
            'Todavía no hay materiales',
            'Cargá el primero con el botón "Nuevo material".')}</td></tr>`;
        return;
    }

    tbody.innerHTML = materiasPrimas.map(mp => {
        const actual = Number(mp.stock_actual) || 0;
        const minimo = Number(mp.stock_minimo) || 0;
        const faltante = actual === 0 || actual <= minimo;

        return `
            <tr>
                <td><strong>${mp.nombre}</strong>${mp.codigo ? ' <span class="muted">' + mp.codigo + '</span>' : ''}</td>
                <td class="muted solo-escritorio" data-label="Unidad">${mp.unidad_medida || 'UNI'}</td>
                <td class="num ${faltante ? 'neg' : ''}" data-label="Stock">${actual.toLocaleString('es-AR')}</td>
                <td class="num muted solo-escritorio" data-label="Mínimo">${minimo.toLocaleString('es-AR')}</td>
                <td class="muted solo-escritorio" data-label="Ubicación">${mp.ubicacion || '—'}</td>
                <td data-label="Estado">${Shell.pill(mp.activo ? 'ACTIVO' : 'INACTIVO')}</td>
                <td class="num">
                    <button class="b b-ghost b-sm" onclick="abrirModalEditar(${mp.id})">Editar</button>
                    <button class="b b-ghost b-sm solo-escritorio" onclick="verHistorialPrecios(${mp.id})">Precios</button>
                    <button class="b b-ghost b-sm solo-escritorio" onclick="eliminarMateriaPrima(${mp.id})">Desactivar</button>
                </td>
            </tr>`;
    }).join('');
}

// Abrir modal para crear nueva materia prima
function abrirModalCrear() {
    document.getElementById('modalTitle').textContent = 'Nuevo material';
    document.getElementById('materia_prima_id').value = '';
    document.getElementById('codigo').value = '';
    document.getElementById('nombre').value = '';
    document.getElementById('descripcion').value = '';
    document.getElementById('unidad_medida').value = '';
    document.getElementById('ubicacion').value = '';
    document.getElementById('stock_minimo').value = '0';
    document.getElementById('precio_referencia').value = '';
    document.getElementById('activo').checked = true;
    // Al crear todavía no hay stock cargado (entra por factura de compra o ajuste manual)
    document.getElementById('stockActualGroup').hidden = true;

    document.getElementById('materiaPrimaModal').showModal();
}

// Abrir modal para editar materia prima
async function abrirModalEditar(id) {
    try {
        const materiaPrima = await apiFetch(`/api/materias-primas/${id}`);
        
        document.getElementById('modalTitle').textContent = 'Editar material';
        document.getElementById('materia_prima_id').value = materiaPrima.id;
        document.getElementById('codigo').value = materiaPrima.codigo || '';
        document.getElementById('nombre').value = materiaPrima.nombre || '';
        document.getElementById('descripcion').value = materiaPrima.descripcion || '';
        document.getElementById('unidad_medida').value = materiaPrima.unidad_medida || '';
        document.getElementById('ubicacion').value = materiaPrima.ubicacion || '';
        document.getElementById('stock_minimo').value = materiaPrima.stock_minimo || 0;
        document.getElementById('precio_referencia').value = materiaPrima.precio_referencia || '';
        document.getElementById('activo').checked = materiaPrima.activo !== false;
        // Al editar se muestra el stock actual solo como referencia (de solo lectura):
        // se carga por factura de compra o por ajuste en stock.html, nunca desde acá.
        document.getElementById('stockActualGroup').hidden = false;
        document.getElementById('stock_actual_display').value = `${materiaPrima.stock_actual || 0} ${materiaPrima.unidad_medida || ''}`.trim();

        document.getElementById('materiaPrimaModal').showModal();
    } catch (err) {
        console.error('Error cargando materia prima:', err);
        Shell.error(err, 'No se pudo abrir el material');
    }
}

// Guardar materia prima (crear o actualizar)
async function guardarMateriaPrima() {
    try {
        const id = document.getElementById('materia_prima_id').value;
        const codigo = document.getElementById('codigo').value.trim();
        const nombre = document.getElementById('nombre').value.trim();
        const descripcion = document.getElementById('descripcion').value.trim();
        const unidad_medida = document.getElementById('unidad_medida').value;
        const ubicacion = document.getElementById('ubicacion').value.trim();
        const stock_minimo = parseFloat(document.getElementById('stock_minimo').value) || 0;
        const precio_referencia = document.getElementById('precio_referencia').value ? parseFloat(document.getElementById('precio_referencia').value) : null;
        const activo = document.getElementById('activo').checked;
        
        // Validaciones
        if (!codigo) {
            Shell.toast('err', 'Falta el código');
            return;
        }
        if (!nombre) {
            Shell.toast('err', 'Falta el nombre');
            return;
        }
        if (!unidad_medida) {
            Shell.toast('err', 'Elegí en qué se mide');
            return;
        }
        if (stock_minimo < 0) {
            Shell.toast('err', 'El stock mínimo no puede ser negativo');
            return;
        }
        
        const payload = {
            codigo,
            nombre,
            descripcion,
            unidad_medida,
            ubicacion,
            stock_minimo,
            activo
        };
        
        // Si hay precio referencia, lo agregamos
        if (precio_referencia !== null && precio_referencia > 0) {
            payload.precio_referencia = precio_referencia;
        }
        
        let endpoint = '/api/materias-primas';
        let method = 'POST';
        
        if (id) {
            endpoint = `/api/materias-primas/${id}`;
            method = 'PUT';
        }
        
        await apiFetch(endpoint, {
            method: method,
            body: JSON.stringify(payload)
        });
        
        Shell.toast('ok', id ? 'Material actualizado' : 'Material creado');
        document.getElementById('materiaPrimaModal').close();
        cargarMateriasPrimas();
        
    } catch (err) {
        console.error('Error guardando materia prima:', err);
        Shell.error(err, 'No se pudo guardar el material');
    }
}

// Eliminar materia prima
async function eliminarMateriaPrima(id) {
    if (!confirm('¿Está seguro de eliminar esta materia prima?')) {
        return;
    }
    
    try {
        await apiFetch(`/api/materias-primas/${id}`, {
            method: 'DELETE'
        });
        
        Shell.toast('ok', 'Material desactivado');
        cargarMateriasPrimas();
    } catch (err) {
        console.error('Error eliminando materia prima:', err);
        Shell.error(err, 'No se pudo desactivar el material');
    }
}

// Sub-línea con el valor en USD debajo del precio en pesos, si hay dólar
// cargado para esa compra (diseño acordado 12/09/2026 - cotización del dólar
// por factura). Si no hay dato en USD (facturas viejas, o factura sin dólar
// cargado), no se muestra nada.
function renderPrecioUsd(valorUsd) {
    if (valorUsd === null || valorUsd === undefined) return '';
    return `<br><small class="text-muted">USD ${parseFloat(valorUsd).toFixed(2)}</small>`;
}

function renderVariacionHistorial(p) {
    if (p.variacion_porcentaje === null || p.variacion_porcentaje === undefined) {
        return '<span class="text-muted">—</span>';
    }
    return `<span class="${p.variacion_porcentaje > 0 ? 'text-success' : 'text-danger'}">${p.variacion_porcentaje > 0 ? '+' : ''}${p.variacion_porcentaje}%</span>`;
}

// Ver historial de precios desde la tabla
async function verHistorialPrecios(id) {
    try {
        const historial = await apiFetch(`/api/materias-primas/${id}/historial-precios`);

        const materiaPrima = materiasPrimasCache.find(mp => mp.id === id);
        document.getElementById('historialPreciosModalTitle').textContent =
            materiaPrima ? `Historial de Precios — ${materiaPrima.nombre}` : 'Historial de Precios';

        const tbody = document.getElementById('historialPreciosBody');
        if (!historial || historial.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6">${Shell.vacio('Sin cambios de precio todavía','Se registran solos al cargar facturas de compra.')}</td></tr>`;
        } else {
            tbody.innerHTML = historial.map(p => `
                <tr>
                    <td>${Shell.fecha(p.fecha_cambio)}</td>
                    <td class="num" data-label="Antes">${formatearMoneda(p.precio_anterior || 0)}${renderPrecioUsd(p.precio_anterior_usd)}</td>
                    <td class="num" data-label="Después">${formatearMoneda(p.precio_nuevo || 0)}${renderPrecioUsd(p.precio_nuevo_usd)}</td>
                    <td class="num" data-label="Variación">${renderVariacionHistorial(p)}</td>
                    <td class="muted solo-escritorio" data-label="Factura">${p.factura_numero || '—'}</td>
                    <td class="muted solo-escritorio" data-label="Cargó">${p.usuario_nombre || '—'}</td>
                </tr>
            `).join('');
        }
        
        document.getElementById('historialPreciosModal').showModal();
        
    } catch (err) {
        console.error('Error cargando historial de precios:', err);
        Shell.error(err, 'No se pudo cargar el historial de precios');
    }
}

// Ver historial de precios desde el modal de edición
async function verHistorialPreciosModal() {
    const materiaPrimaId = document.getElementById('materia_prima_id').value;
    
    if (!materiaPrimaId) {
        Shell.toast('err', 'Guardá el material antes de ver su historial');
        return;
    }
    
    try {
        const historial = await apiFetch(`/api/materias-primas/${materiaPrimaId}/historial-precios`);

        const nombre = document.getElementById('nombre').value.trim();
        document.getElementById('historialPreciosModalTitle').textContent =
            nombre ? `Historial de Precios — ${nombre}` : 'Historial de Precios';

        const tbody = document.getElementById('historialPreciosBody');
        if (!historial || historial.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6">${Shell.vacio('Sin cambios de precio todavía','Se registran solos al cargar facturas de compra.')}</td></tr>`;
        } else {
            tbody.innerHTML = historial.map(p => `
                <tr>
                    <td>${Shell.fecha(p.fecha_cambio)}</td>
                    <td class="num" data-label="Antes">${formatearMoneda(p.precio_anterior || 0)}${renderPrecioUsd(p.precio_anterior_usd)}</td>
                    <td class="num" data-label="Después">${formatearMoneda(p.precio_nuevo || 0)}${renderPrecioUsd(p.precio_nuevo_usd)}</td>
                    <td class="num" data-label="Variación">${renderVariacionHistorial(p)}</td>
                    <td class="muted solo-escritorio" data-label="Factura">${p.factura_numero || '—'}</td>
                    <td class="muted solo-escritorio" data-label="Cargó">${p.usuario_nombre || '—'}</td>
                </tr>
            `).join('');
        }
        
        // Cerrar el modal de edición y abrir el de historial
        document.getElementById('materiaPrimaModal').close();
        document.getElementById('historialPreciosModal').showModal();
        
    } catch (err) {
        console.error('Error cargando historial de precios:', err);
        Shell.error(err, 'No se pudo cargar el historial de precios');
    }
}

// Buscar materias primas
function buscarMateriasPrimas() {
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase();
    
    if (!searchTerm) {
        renderizarTablaMateriasPrimas(materiasPrimasCache);
        return;
    }
    
    const filtradas = materiasPrimasCache.filter(mp => 
        (mp.codigo && mp.codigo.toLowerCase().includes(searchTerm)) ||
        (mp.nombre && mp.nombre.toLowerCase().includes(searchTerm)) ||
        (mp.descripcion && mp.descripcion.toLowerCase().includes(searchTerm))
    );
    
    renderizarTablaMateriasPrimas(filtradas);
}

// Cerrar las ventanas (reemplaza a data-bs-dismiss de Bootstrap)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-cerrar]').forEach(b => {
    b.addEventListener('click', () => document.getElementById(b.dataset.cerrar)?.close());
  });
});

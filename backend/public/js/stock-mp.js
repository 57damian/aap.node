// stock-mp.js - ABM de Materias Primas
let materiasPrimasCache = [];
let categoriasCache = [];
let guardandoCategoria = false;

// Formatear moneda
function formatearMoneda(valor) {
    // Montos ocultos: Shell.monto lo anota para que el ojo lo oculte (shell.js).
    const texto = new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(valor);
    return window.Shell && Shell.monto ? Shell.monto(texto) : texto;
}

// Inicializar página
document.addEventListener('DOMContentLoaded', () => {
    verificarAuth();
    cargarCategorias();
    cargarMateriasPrimas();
    document.getElementById('searchInput')?.addEventListener('input', buscarMateriasPrimas);
    document.getElementById('filtroCategoria')?.addEventListener('change', buscarMateriasPrimas);
    document.getElementById('categoriaNueva')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); agregarCategoria(); }
    });
});

// ============================================
// Categorías
// ============================================
async function cargarCategorias() {
    try {
        categoriasCache = await apiFetch('/api/categorias-materia-prima');
    } catch (err) {
        console.error('Error cargando categorías:', err);
        Shell.error(err, 'No se pudieron cargar las categorías');
        categoriasCache = [];
    }
    poblarSelectsCategoria();
    renderizarCategorias();
}

// Llena el filtro de arriba y el desplegable del formulario, sin perder lo elegido
function poblarSelectsCategoria() {
    const opciones = categoriasCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');

    const filtro = document.getElementById('filtroCategoria');
    if (filtro) {
        const elegida = filtro.value;
        filtro.innerHTML = '<option value="">Todas</option><option value="sin">Sin categoría</option>' + opciones;
        filtro.value = elegida;
    }

    const campo = document.getElementById('categoria_id');
    if (campo) {
        const elegida = campo.value;
        campo.innerHTML = '<option value="">Sin categoría</option>' + opciones;
        campo.value = elegida;
    }
}

function renderizarCategorias() {
    const tbody = document.getElementById('categoriasBody');
    if (!tbody) return;

    if (categoriasCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="muted">Todavía no hay categorías.</td></tr>`;
        return;
    }

    tbody.innerHTML = categoriasCache.map(c => `
        <tr>
            <td><input class="input" type="text" maxlength="60" value="${c.nombre.replace(/"/g, '&quot;')}" data-categoria-nombre="${c.id}"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();renombrarCategoria(${c.id});}"></td>
            <td class="num muted">${c.cantidad}</td>
            <td class="num">
                <button class="b b-ghost b-sm" onclick="renombrarCategoria(${c.id})">Guardar nombre</button>
                <button class="b b-ghost b-sm" onclick="pedirEliminarCategoria(${c.id})">Eliminar</button>
            </td>
        </tr>`).join('');
}

function abrirCategorias() {
    document.getElementById('categoriaNueva').value = '';
    renderizarCategorias();
    document.getElementById('categoriasModal').showModal();
}

async function agregarCategoria() {
    if (guardandoCategoria) return;
    const input = document.getElementById('categoriaNueva');
    const nombre = input.value.trim();
    if (!nombre) {
        Shell.toast('err', 'Escribí el nombre de la categoría');
        return;
    }

    guardandoCategoria = true;
    const btn = document.getElementById('btnAgregarCategoria');
    btn.disabled = true;
    try {
        await apiFetch('/api/categorias-materia-prima', {
            method: 'POST',
            body: JSON.stringify({ nombre })
        });
        input.value = '';
        Shell.toast('ok', 'Categoría agregada');
        await cargarCategorias();
    } catch (err) {
        Shell.error(err, 'No se pudo agregar la categoría');
    } finally {
        guardandoCategoria = false;
        btn.disabled = false;
    }
}

async function renombrarCategoria(id) {
    const input = document.querySelector(`[data-categoria-nombre="${id}"]`);
    const nombre = input ? input.value.trim() : '';
    if (!nombre) {
        Shell.toast('err', 'El nombre no puede quedar vacío');
        return;
    }
    try {
        await apiFetch(`/api/categorias-materia-prima/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ nombre })
        });
        Shell.toast('ok', 'Categoría actualizada');
        await cargarCategorias();
        cargarMateriasPrimas();
    } catch (err) {
        Shell.error(err, 'No se pudo guardar el nombre');
    }
}

function pedirEliminarCategoria(id) {
    const cat = categoriasCache.find(c => c.id === id);
    if (!cat) return;
    document.getElementById('categoriaEliminarId').value = id;
    document.getElementById('categoriaEliminarTexto').textContent = cat.cantidad > 0
        ? `¿Eliminar la categoría "${cat.nombre}"? Sus ${cat.cantidad} materias primas van a quedar sin categoría.`
        : `¿Eliminar la categoría "${cat.nombre}"?`;
    document.getElementById('categoriaEliminarModal').showModal();
}

async function confirmarEliminarCategoria() {
    const id = document.getElementById('categoriaEliminarId').value;
    try {
        await apiFetch(`/api/categorias-materia-prima/${id}`, { method: 'DELETE' });
        document.getElementById('categoriaEliminarModal').close();
        Shell.toast('ok', 'Categoría eliminada');
        await cargarCategorias();
        cargarMateriasPrimas();
    } catch (err) {
        Shell.error(err, 'No se pudo eliminar la categoría');
    }
}

// Cargar materias primas
async function cargarMateriasPrimas() {
    try {
        const materiasPrimas = await apiFetch('/api/materias-primas');
        materiasPrimasCache = materiasPrimas;
        buscarMateriasPrimas();
    } catch (err) {
        console.error('Error cargando materias primas:', err);
        Shell.error(err, 'No se pudieron cargar los materiales');
    }
}

// Renderizar tabla de materias primas
function renderizarTablaMateriasPrimas(materiasPrimas) {
    const tbody = document.getElementById('materiasPrimasTableBody');

    if (!materiasPrimas || materiasPrimas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8">${Shell.vacio(
            'No hay materiales para mostrar',
            'Cargá el primero con el botón "Nueva materia prima" o probá otro filtro.')}</td></tr>`;
        return;
    }

    tbody.innerHTML = materiasPrimas.map(mp => {
        const actual = Number(mp.stock_actual) || 0;
        const minimo = Number(mp.stock_minimo) || 0;
        const faltante = actual === 0 || actual <= minimo;

        return `
            <tr>
                <td><strong>${mp.nombre}</strong>${mp.codigo ? ' <span class="muted">' + mp.codigo + '</span>' : ''}</td>
                <td class="muted solo-escritorio" data-label="Categoría">${mp.categoria_nombre || '—'}</td>
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
    document.getElementById('modalTitle').textContent = 'Nueva materia prima';
    document.getElementById('materia_prima_id').value = '';
    document.getElementById('codigo').value = '';
    document.getElementById('nombre').value = '';
    document.getElementById('descripcion').value = '';
    document.getElementById('unidad_medida').value = '';
    document.getElementById('categoria_id').value = '';
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
        document.getElementById('categoria_id').value = materiaPrima.categoria_id || '';
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
            activo,
            // null = sin categoría (al editar, el servidor lo toma como "quitarla")
            categoria_id: document.getElementById('categoria_id').value || null
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
        
        Shell.toast('ok', id ? 'Materia prima actualizada' : 'Materia prima creada');
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
        
        Shell.toast('ok', 'Materia prima desactivada');
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
    // Montos ocultos: Shell.monto lo anota para que el ojo lo oculte (shell.js).
    // Un precio por gramo en USD es chico (0,0243): con 2 decimales saldría 0,02.
    const valor = parseFloat(valorUsd);
    const texto = `USD ${valor.toFixed(Math.abs(valor) < 1 ? 4 : 2)}`;
    return `<br><small class="text-muted">${window.Shell && Shell.monto ? Shell.monto(texto) : texto}</small>`;
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
        Shell.toast('err', 'Guardá la materia prima antes de ver su historial');
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

// Buscar y filtrar por categoría (sobre la lista ya cargada)
function buscarMateriasPrimas() {
    const termino = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const categoria = document.getElementById('filtroCategoria')?.value || '';

    const filtradas = materiasPrimasCache.filter(mp => {
        if (categoria === 'sin' && mp.categoria_id) return false;
        if (categoria && categoria !== 'sin' && String(mp.categoria_id) !== categoria) return false;
        if (!termino) return true;
        return (mp.codigo && mp.codigo.toLowerCase().includes(termino)) ||
               (mp.nombre && mp.nombre.toLowerCase().includes(termino)) ||
               (mp.descripcion && mp.descripcion.toLowerCase().includes(termino));
    });

    renderizarTablaMateriasPrimas(filtradas);
}

// Cerrar las ventanas (reemplaza a data-bs-dismiss de Bootstrap)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-cerrar]').forEach(b => {
    b.addEventListener('click', () => document.getElementById(b.dataset.cerrar)?.close());
  });
});

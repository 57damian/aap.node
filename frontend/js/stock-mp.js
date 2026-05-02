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
        alert(err.error || 'Error al cargar materias primas');
    }
}

// Renderizar tabla de materias primas
function renderizarTablaMateriasPrimas(materiasPrimas) {
    const tbody = document.getElementById('materiasPrimasTableBody');
    
    if (!materiasPrimas || materiasPrimas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No hay materias primas registradas</td></tr>';
        return;
    }
    
    tbody.innerHTML = materiasPrimas.map(mp => {
        let estadoBadge = mp.activo 
            ? '<span class="badge bg-success">ACTIVO</span>' 
            : '<span class="badge bg-secondary">INACTIVO</span>';
        
        let stockClass = '';
        if (mp.stock_actual === 0) {
            stockClass = 'text-danger';
        } else if (mp.stock_actual <= mp.stock_minimo) {
            stockClass = 'text-warning';
        }
        
        return `
            <tr>
                <td>${mp.codigo || '-'}</td>
                <td>${mp.nombre}</td>
                <td>${mp.unidad_medida || 'UNI'}</td>
                <td class="${stockClass}">${mp.stock_actual || 0}</td>
                <td>${mp.stock_minimo || 0}</td>
                <td>${mp.ubicacion || '-'}</td>
                <td>${estadoBadge}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="abrirModalEditar(${mp.id})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-info" onclick="verHistorialPrecios(${mp.id})">
                        <i class="fas fa-chart-line"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="eliminarMateriaPrima(${mp.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Abrir modal para crear nueva materia prima
function abrirModalCrear() {
    document.getElementById('modalTitle').innerHTML = '<i class="fas fa-box"></i> Nueva Materia Prima';
    document.getElementById('materia_prima_id').value = '';
    document.getElementById('codigo').value = '';
    document.getElementById('nombre').value = '';
    document.getElementById('descripcion').value = '';
    document.getElementById('unidad_medida').value = '';
    document.getElementById('ubicacion').value = '';
    document.getElementById('stock_actual').value = '0';
    document.getElementById('stock_minimo').value = '0';
    document.getElementById('precio_referencia').value = '';
    document.getElementById('activo').checked = true;
    
    const modal = new bootstrap.Modal(document.getElementById('materiaPrimaModal'));
    modal.show();
}

// Abrir modal para editar materia prima
async function abrirModalEditar(id) {
    try {
        const materiaPrima = await apiFetch(`/api/materias-primas/${id}`);
        
        document.getElementById('modalTitle').innerHTML = '<i class="fas fa-box"></i> Editar Materia Prima';
        document.getElementById('materia_prima_id').value = materiaPrima.id;
        document.getElementById('codigo').value = materiaPrima.codigo || '';
        document.getElementById('nombre').value = materiaPrima.nombre || '';
        document.getElementById('descripcion').value = materiaPrima.descripcion || '';
        document.getElementById('unidad_medida').value = materiaPrima.unidad_medida || '';
        document.getElementById('ubicacion').value = materiaPrima.ubicacion || '';
        document.getElementById('stock_actual').value = materiaPrima.stock_actual || 0;
        document.getElementById('stock_minimo').value = materiaPrima.stock_minimo || 0;
        document.getElementById('precio_referencia').value = materiaPrima.precio_referencia || '';
        document.getElementById('activo').checked = materiaPrima.activo !== false;
        
        const modal = new bootstrap.Modal(document.getElementById('materiaPrimaModal'));
        modal.show();
    } catch (err) {
        console.error('Error cargando materia prima:', err);
        alert('Error al cargar materia prima');
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
        const stock_actual = parseFloat(document.getElementById('stock_actual').value) || 0;
        const stock_minimo = parseFloat(document.getElementById('stock_minimo').value) || 0;
        const precio_referencia = document.getElementById('precio_referencia').value ? parseFloat(document.getElementById('precio_referencia').value) : null;
        const activo = document.getElementById('activo').checked;
        
        // Validaciones
        if (!codigo) {
            alert('El código es obligatorio');
            return;
        }
        if (!nombre) {
            alert('El nombre es obligatorio');
            return;
        }
        if (!unidad_medida) {
            alert('La unidad de medida es obligatoria');
            return;
        }
        if (stock_minimo < 0) {
            alert('El stock mínimo no puede ser negativo');
            return;
        }
        
        const payload = {
            codigo,
            nombre,
            descripcion,
            unidad_medida,
            ubicacion,
            stock_actual,
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
        
        alert(id ? 'Materia prima actualizada correctamente' : 'Materia prima creada correctamente');
        bootstrap.Modal.getInstance(document.getElementById('materiaPrimaModal')).hide();
        cargarMateriasPrimas();
        
    } catch (err) {
        console.error('Error guardando materia prima:', err);
        alert(err.error || 'Error al guardar materia prima');
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
        
        alert('Materia prima eliminada correctamente');
        cargarMateriasPrimas();
    } catch (err) {
        console.error('Error eliminando materia prima:', err);
        alert(err.error || 'Error al eliminar materia prima');
    }
}

// Ver historial de precios desde la tabla
async function verHistorialPrecios(id) {
    try {
        const historial = await apiFetch(`/api/materias-primas/${id}/historial-precios`);
        
        const tbody = document.getElementById('historialPreciosBody');
        if (!historial || historial.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay historial de precios</td></tr>';
        } else {
            tbody.innerHTML = historial.map(p => `
                <tr>
                    <td>${p.fecha_cambio || '-'}</td>
                    <td>${formatearMoneda(p.precio_anterior || 0)}</td>
                    <td>${formatearMoneda(p.precio_nuevo || 0)}</td>
                    <td class="${p.variacion_porcentaje > 0 ? 'text-success' : 'text-danger'}">
                        ${p.variacion_porcentaje > 0 ? '+' : ''}${p.variacion_porcentaje || 0}%
                    </td>
                    <td>${p.factura_numero || '-'}</td>
                    <td>${p.usuario_nombre || '-'}</td>
                </tr>
            `).join('');
        }
        
        const modal = new bootstrap.Modal(document.getElementById('historialPreciosModal'));
        modal.show();
        
    } catch (err) {
        console.error('Error cargando historial de precios:', err);
        alert('Error al cargar historial de precios');
    }
}

// Ver historial de precios desde el modal de edición
async function verHistorialPreciosModal() {
    const materiaPrimaId = document.getElementById('materia_prima_id').value;
    
    if (!materiaPrimaId) {
        alert('Primero debe guardar la materia prima para ver su historial de precios');
        return;
    }
    
    try {
        const historial = await apiFetch(`/api/materias-primas/${materiaPrimaId}/historial-precios`);
        
        const tbody = document.getElementById('historialPreciosBody');
        if (!historial || historial.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No hay historial de precios</td></tr>';
        } else {
            tbody.innerHTML = historial.map(p => `
                <tr>
                    <td>${p.fecha_cambio || '-'}</td>
                    <td>${formatearMoneda(p.precio_anterior || 0)}</td>
                    <td>${formatearMoneda(p.precio_nuevo || 0)}</td>
                    <td class="${p.variacion_porcentaje > 0 ? 'text-success' : 'text-danger'}">
                        ${p.variacion_porcentaje > 0 ? '+' : ''}${p.variacion_porcentaje || 0}%
                    </td>
                    <td>${p.factura_numero || '-'}</td>
                    <td>${p.usuario_nombre || '-'}</td>
                </tr>
            `).join('');
        }
        
        // Cerrar el modal de edición y abrir el de historial
        bootstrap.Modal.getInstance(document.getElementById('materiaPrimaModal')).hide();
        const modal = new bootstrap.Modal(document.getElementById('historialPreciosModal'));
        modal.show();
        
    } catch (err) {
        console.error('Error cargando historial de precios:', err);
        alert('Error al cargar historial de precios');
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
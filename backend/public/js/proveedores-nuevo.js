// Variables globales
let proveedoresData = [];

// Cargar proveedores con filtros
async function cargarProveedores() {
    const search = document.getElementById('searchInput').value;
    const estado = document.getElementById('filtroEstado').value;
    const deudaFiltro = document.getElementById('filtroDeuda').value;

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (estado !== 'todos') params.append('estado', estado);

    try {
        let proveedores = await apiFetch(`/api/proveedores?${params.toString()}`);
        if (deudaFiltro === 'con-deuda') {
            proveedores = proveedores.filter(p => parseFloat(p.deuda_pendiente || 0) > 0);
        } else if (deudaFiltro === 'sin-deuda') {
            proveedores = proveedores.filter(p => parseFloat(p.deuda_pendiente || 0) === 0);
        }
        proveedoresData = proveedores;
        renderTabla(proveedores);
        actualizarEstadisticas(proveedores);
    } catch (error) {
        mostrarAlerta(error.message, 'error');
    }
}

function renderTabla(proveedores) {
    const tbody = document.getElementById('proveedoresTableBody');
    if (!proveedores.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center empty-state">No se encontraron proveedores</td></tr>';
        return;
    }
    tbody.innerHTML = proveedores.map(p => `
        <tr>
            <td><strong>${escapeHtml(p.nombre)}</strong><br><small>${p.cuit || 'Sin CUIT'}</small></td>
            <td>${p.telefono ? `<i class="fas fa-phone"></i> ${p.telefono}<br>` : ''}${p.email ? `<i class="fas fa-envelope"></i> ${p.email}` : ''}</td>
            <td>${p.total_compras || 0}</td>
            <td class="${p.deuda_pendiente > 0 ? 'text-danger' : ''}">$${Number(p.deuda_pendiente || 0).toLocaleString('es-AR')}</td>
            <td><span class="badge ${p.activo ? 'badge-success' : 'badge-danger'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td class="flex">
                <button class="btn btn-sm btn-primary" onclick="verDetalle(${p.id})"><i class="fas fa-eye"></i></button>
                <button class="btn btn-sm btn-warning" onclick="editarProveedor(${p.id})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-sm btn-danger" onclick="eliminarProveedor(${p.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function actualizarEstadisticas(proveedores) {
    const total = proveedores.length;
    const activos = proveedores.filter(p => p.activo).length;
    const deudaTotal = proveedores.reduce((sum, p) => sum + (parseFloat(p.deuda_pendiente) || 0), 0);
    const totalCompras = proveedores.reduce((sum, p) => sum + (p.total_compras || 0), 0);
    document.getElementById('totalProveedores').innerText = total;
    document.getElementById('proveedoresActivos').innerText = activos;
    document.getElementById('deudaTotal').innerText = `$${deudaTotal.toLocaleString('es-AR')}`;
    document.getElementById('totalCompras').innerText = totalCompras;
}

function abrirModalProveedor(id = null) {
    const modal = document.getElementById('proveedorModal');
    const title = document.getElementById('modalTitle');
    const estadoField = document.getElementById('estadoField');
    const form = document.getElementById('proveedorForm');
    if (id) {
        title.innerText = 'Editar Proveedor';
        estadoField.style.display = 'block';
        const proveedor = proveedoresData.find(p => p.id === id);
        if (proveedor) {
            document.getElementById('proveedorId').value = proveedor.id;
            document.getElementById('nombre').value = proveedor.nombre;
            document.getElementById('cuit').value = proveedor.cuit || '';
            document.getElementById('telefono').value = proveedor.telefono || '';
            document.getElementById('email').value = proveedor.email || '';
            document.getElementById('direccion').value = proveedor.direccion || '';
            document.getElementById('contacto').value = proveedor.contacto || '';
            document.getElementById('condicion_iva').value = proveedor.condicion_iva || 'RESPONSABLE INSCRIPTO';
            document.getElementById('observaciones').value = proveedor.observaciones || '';
            document.getElementById('activo').value = proveedor.activo ? 'true' : 'false';
        }
    } else {
        title.innerText = 'Nuevo Proveedor';
        estadoField.style.display = 'none';
        form.reset();
        document.getElementById('proveedorId').value = '';
    }
    modal.style.display = 'block';
}

function cerrarModal() { document.getElementById('proveedorModal').style.display = 'none'; }
function cerrarDetalleModal() { document.getElementById('detalleModal').style.display = 'none'; }

async function guardarProveedor() {
    const id = document.getElementById('proveedorId').value;
    const data = {
        nombre: document.getElementById('nombre').value,
        cuit: document.getElementById('cuit').value,
        telefono: document.getElementById('telefono').value,
        email: document.getElementById('email').value,
        direccion: document.getElementById('direccion').value,
        contacto: document.getElementById('contacto').value,
        condicion_iva: document.getElementById('condicion_iva').value,
        observaciones: document.getElementById('observaciones').value
    };
    if (id) data.activo = document.getElementById('activo').value === 'true';
    if (!data.nombre) { mostrarAlerta('El nombre es obligatorio', 'error'); return; }

    const url = id ? `/api/proveedores/${id}` : '/api/proveedores';
    const method = id ? 'PUT' : 'POST';
    try {
        await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        mostrarAlerta('Proveedor guardado correctamente', 'success');
        cerrarModal();
        cargarProveedores();
    } catch (error) {
        mostrarAlerta(error.message, 'error');
    }
}

function editarProveedor(id) { abrirModalProveedor(id); }

async function eliminarProveedor(id) {
    if (!confirm('¿Eliminar este proveedor? Si tiene compras asociadas solo se desactivará.')) return;
    try {
        await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
        mostrarAlerta('Proveedor eliminado/desactivado', 'success');
        cargarProveedores();
    } catch (error) {
        mostrarAlerta(error.message, 'error');
    }
}

async function verDetalle(id) {
    const modal = document.getElementById('detalleModal');
    const content = document.getElementById('detalleContent');
    content.innerHTML = '<div class="loading-spinner"></div> Cargando...';
    modal.style.display = 'block';
    try {
        const data = await apiFetch(`/api/proveedores/${id}/resumen`);
        let html = `
            <h4>${escapeHtml(data.nombre)}</h4>
            <p><strong>CUIT:</strong> ${data.cuit || '-'}</p>
            <p><strong>Total compras:</strong> ${data.total_compras || 0}</p>
            <p><strong>Monto total compras:</strong> $${Number(data.monto_total_compras || 0).toLocaleString('es-AR')}</p>
            <p><strong>Deuda pendiente:</strong> $${Number(data.deuda_pendiente || 0).toLocaleString('es-AR')}</p>
            <p><strong>Endosos pendientes:</strong> ${data.endosos_pendientes || 0}</p>
            <hr><h5>Facturas pendientes</h5><div id="facturasPendientes">Cargando...</div>`;
        content.innerHTML = html;
        const facturas = await apiFetch(`/api/proveedores/${id}/facturas?estado=PENDIENTE`);
        const facturasDiv = document.getElementById('facturasPendientes');
        if (facturas.length) {
            facturasDiv.innerHTML = facturas.map(f => `<div style="border-bottom:1px solid #eee; padding:8px 0;"><strong>${f.numero_factura}</strong><br>Vencimiento: ${f.fecha_vencimiento || '-'} | Saldo: $${Number(f.saldo_pendiente).toLocaleString('es-AR')}</div>`).join('');
        } else {
            facturasDiv.innerHTML = '<p>No hay facturas pendientes</p>';
        }
    } catch (error) {
        content.innerHTML = `<p class="text-danger">Error: ${error.message}</p>`;
    }
}

function limpiarFiltros() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filtroEstado').value = 'activos';
    document.getElementById('filtroDeuda').value = 'todos';
    cargarProveedores();
}

function mostrarAlerta(mensaje, tipo) {
    const alertBox = document.getElementById('alert');
    alertBox.className = `alert alert-${tipo}`;
    alertBox.innerText = mensaje;
    alertBox.style.display = 'block';
    setTimeout(() => alertBox.style.display = 'none', 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&';
        if (m === '<') return '<';
        if (m === '>') return '>';
        return m;
    });
}

document.addEventListener('DOMContentLoaded', cargarProveedores);

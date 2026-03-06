// Variables globales
let materiales = [];
let proveedores = [];

document.addEventListener('DOMContentLoaded', () => {
  cargarEstadisticas();
  cargarCatalogo();
  cargarSelectMateriales();
  cargarSelectProveedores();
});

// ================== CATÁLOGO ==================
async function cargarCatalogo() {
  const search = document.getElementById('search-catalogo')?.value || '';
  const proveedor_id = document.getElementById('proveedor-filtro')?.value || '';
  const stockFiltro = document.getElementById('stock-filtro')?.value || '';

  let url = '/api/materias-primas?activo=true';
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (proveedor_id) url += `&proveedor_id=${proveedor_id}`;

  try {
    const response = await apiFetch(url);
    materiales = response;

    // Filtrar por estado de stock si se seleccionó
    let filtrados = materiales;
    if (stockFiltro === 'con_stock') {
      filtrados = materiales.filter(m => m.stock_actual > 0);
    } else if (stockFiltro === 'bajo') {
      filtrados = materiales.filter(m => m.estado_stock === 'BAJO');
    } else if (stockFiltro === 'critico') {
      filtrados = materiales.filter(m => m.estado_stock === 'CRITICO');
    }

    renderizarCatalogo(filtrados);
  } catch (err) {
    console.error('Error cargando catálogo:', err);
    mostrarNotificacion('Error al cargar materiales', 'error');
  }
}

function renderizarCatalogo(materiales) {
  const tbody = document.getElementById('catalogo-body');
  if (!materiales || materiales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">No hay materiales</td></tr>';
    return;
  }

  tbody.innerHTML = materiales.map(m => {
    const estadoClass = m.estado_stock === 'NORMAL' ? 'normal' : m.estado_stock === 'BAJO' ? 'bajo' : 'critico';
    return `
      <tr>
        <td>${m.codigo || '-'}</td>
        <td><strong>${m.nombre}</strong><br><small>${m.descripcion || ''}</small></td>
        <td>${m.unidad_medida}</td>
        <td>${m.stock_actual} ${m.unidad_medida}</td>
        <td>${m.stock_minimo} ${m.unidad_medida}</td>
        <td><span class="badge ${estadoClass}">${m.estado_stock}</span></td>
        <td>$${m.ultimo_precio ? m.ultimo_precio.toFixed(2) : '0.00'}</td>
        <td>$${m.valor_total ? m.valor_total.toFixed(2) : '0.00'}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="editarMaterial(${m.id})">Editar</button>
          <button class="btn btn-sm btn-warning" onclick="abrirModalAjuste(${m.id})">Ajustar</button>
          <button class="btn btn-sm btn-info" onclick="verHistorial(${m.id})">Historial</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ================== ESTADÍSTICAS ==================
async function cargarEstadisticas() {
  try {
    const res = await apiFetch('/api/stock/resumen');
    document.getElementById('total-materiales').textContent = res.total_materiales || 0;
    document.getElementById('valor-total').textContent = '$' + (res.valor_total_stock || 0).toFixed(2);
    document.getElementById('stock-bajo').textContent = res.materiales_stock_bajo || 0;
    document.getElementById('sin-stock').textContent = res.materiales_sin_stock || 0;
  } catch (err) {
    console.error('Error cargando estadísticas:', err);
  }
}

// ================== MOVIMIENTOS ==================
async function cargarMovimientos() {
  const material_id = document.getElementById('filtro-material')?.value || '';
  const desde = document.getElementById('filtro-desde')?.value || '';
  const hasta = document.getElementById('filtro-hasta')?.value || '';

  let url = '/api/stock/movimientos';
  const params = [];
  if (material_id) params.push(`materia_prima_id=${material_id}`);
  if (desde) params.push(`desde=${desde}`);
  if (hasta) params.push(`hasta=${hasta}`);
  if (params.length) url += '?' + params.join('&');

  try {
    const movimientos = await apiFetch(url);
    renderizarMovimientos(movimientos);
  } catch (err) {
    console.error('Error cargando movimientos:', err);
    mostrarNotificacion('Error al cargar movimientos', 'error');
  }
}

function renderizarMovimientos(movimientos) {
  const tbody = document.getElementById('movimientos-body');
  if (!movimientos || movimientos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">No hay movimientos</td></tr>';
    return;
  }

  tbody.innerHTML = movimientos.map(m => {
    const origen = m.compra_id ? `Factura/Compra #${m.compra_id}` : 'Manual';
    const fecha = new Date(m.fecha_movimiento).toLocaleDateString('es-AR');
    return `
      <tr>
        <td>${fecha}</td>
        <td>${m.materia_prima_id} (ID)</td>
        <td>${m.tipo_movimiento}</td>
        <td>${m.cantidad}</td>
        <td>${m.stock_anterior}</td>
        <td>${m.stock_nuevo}</td>
        <td>${origen}</td>
        <td>${m.usuario_nombre || 'Sistema'}</td>
        <td>${m.observaciones || '-'}</td>
      </tr>
    `;
  }).join('');
}

// ================== SELECTS ==================
async function cargarSelectMateriales() {
  try {
    const materiales = await apiFetch('/api/materias-primas?activo=true');
    const selectMaterial = document.getElementById('filtro-material');
    const selectAjuste = document.getElementById('ajuste-material');
    selectMaterial.innerHTML = '<option value="">Todos</option>';
    selectAjuste.innerHTML = '<option value="">-- Seleccionar --</option>';

    materiales.forEach(m => {
      const option = `<option value="${m.id}">${m.nombre} (${m.codigo || 'sin código'})</option>`;
      selectMaterial.innerHTML += option;
      selectAjuste.innerHTML += option;
    });
  } catch (err) {
    console.error('Error cargando materiales para selects:', err);
  }
}

async function cargarSelectProveedores() {
  try {
    const proveedores = await apiFetch('/api/proveedores?activo=true');
    const select = document.getElementById('proveedor-filtro');
    select.innerHTML = '<option value="">Todos</option>';
    proveedores.forEach(p => {
      select.innerHTML += `<option value="${p.id}">${p.nombre}</option>`;
    });
  } catch (err) {
    console.error('Error cargando proveedores:', err);
  }
}

// ================== CRUD MATERIALES ==================
function abrirModalNuevoMaterial() {
  document.getElementById('modal-material-title').textContent = 'Nuevo Material';
  document.getElementById('form-material').reset();
  document.getElementById('material-id').value = '';
  document.getElementById('material-activo-group').style.display = 'none';
  document.getElementById('modal-material').style.display = 'block';
}

function editarMaterial(id) {
  const material = materiales.find(m => m.id === id);
  if (!material) return;

  document.getElementById('modal-material-title').textContent = 'Editar Material';
  document.getElementById('material-id').value = material.id;
  document.getElementById('material-codigo').value = material.codigo || '';
  document.getElementById('material-nombre').value = material.nombre;
  document.getElementById('material-descripcion').value = material.descripcion || '';
  document.getElementById('material-unidad').value = material.unidad_medida;
  document.getElementById('material-stock-minimo').value = material.stock_minimo;
  document.getElementById('material-ubicacion').value = material.ubicacion || '';
  document.getElementById('material-activo').value = material.activo ? 'true' : 'false';
  document.getElementById('material-activo-group').style.display = 'block';

  document.getElementById('modal-material').style.display = 'block';
}

function cerrarModalMaterial() {
  document.getElementById('modal-material').style.display = 'none';
}

async function guardarMaterial() {
  const id = document.getElementById('material-id').value;
  const data = {
    codigo: document.getElementById('material-codigo').value || null,
    nombre: document.getElementById('material-nombre').value,
    descripcion: document.getElementById('material-descripcion').value || null,
    unidad_medida: document.getElementById('material-unidad').value,
    stock_minimo: parseFloat(document.getElementById('material-stock-minimo').value) || 0,
    ubicacion: document.getElementById('material-ubicacion').value || null
  };
  if (id) {
    data.activo = document.getElementById('material-activo').value === 'true';
  }

  try {
    if (id) {
      await apiFetch(`/api/materias-primas/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      mostrarNotificacion('Material actualizado', 'success');
    } else {
      await apiFetch('/api/materias-primas', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      mostrarNotificacion('Material creado', 'success');
    }
    cerrarModalMaterial();
    cargarCatalogo();
    cargarEstadisticas();
    cargarSelectMateriales();
  } catch (err) {
    console.error('Error guardando material:', err);
    mostrarNotificacion(err.error || 'Error al guardar', 'error');
  }
}

// ================== AJUSTE MANUAL ==================
function abrirModalAjuste(materialId = null) {
  document.getElementById('form-ajuste').reset();
  if (materialId) {
    document.getElementById('ajuste-material').value = materialId;
  }
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('ajuste-fecha').value = hoy;
  document.getElementById('modal-ajuste').style.display = 'block';
}

function cerrarModalAjuste() {
  document.getElementById('modal-ajuste').style.display = 'none';
}

async function guardarAjuste() {
  const data = {
    materia_prima_id: parseInt(document.getElementById('ajuste-material').value),
    cantidad: parseFloat(document.getElementById('ajuste-cantidad').value),
    tipo_movimiento: document.getElementById('ajuste-tipo').value,
    observaciones: document.getElementById('ajuste-observaciones').value || null,
    fecha_movimiento: document.getElementById('ajuste-fecha').value || null
  };

  if (!data.materia_prima_id || isNaN(data.cantidad) || !data.tipo_movimiento) {
    mostrarNotificacion('Complete todos los campos', 'error');
    return;
  }

  try {
    await apiFetch('/api/stock/ajuste', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    mostrarNotificacion('Ajuste registrado', 'success');
    cerrarModalAjuste();
    cargarCatalogo();
    cargarEstadisticas();
    cargarMovimientos();
  } catch (err) {
    console.error('Error en ajuste:', err);
    mostrarNotificacion(err.error || 'Error al ajustar', 'error');
  }
}

// ================== HISTORIAL (popup simple) ==================
async function verHistorial(id) {
  try {
    const movimientos = await apiFetch(`/api/stock/materia-prima/${id}/movimientos`);
    if (movimientos.length === 0) {
      alert('No hay movimientos para este material');
      return;
    }
    // Mostrar en una ventana emergente simple (puedes mejorarlo con un modal)
    let mensaje = 'Historial de movimientos:\n';
    movimientos.forEach(m => {
      mensaje += `${m.fecha_movimiento} - ${m.tipo_movimiento}: ${m.cantidad} (stock: ${m.stock_anterior}->${m.stock_nuevo}) ${m.observaciones ? '- ' + m.observaciones : ''}\n`;
    });
    alert(mensaje);
  } catch (err) {
    console.error('Error cargando historial:', err);
    mostrarNotificacion('Error al cargar historial', 'error');
  }
}

// ================== UTILIDADES ==================
function showTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  if (tabName === 'catalogo') {
    document.querySelector('.tab').classList.add('active');
    document.getElementById('tab-catalogo').classList.add('active');
  } else {
    document.querySelectorAll('.tab')[1].classList.add('active');
    document.getElementById('tab-movimientos').classList.add('active');
    cargarMovimientos();
  }
}

function mostrarNotificacion(mensaje, tipo) {
  // Simple alert por ahora, puedes usar una mejor
  alert(`${tipo.toUpperCase()}: ${mensaje}`);
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}
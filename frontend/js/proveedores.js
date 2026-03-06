// =====================
// VERIFICAR AUTENTICACIÓN
// =====================
const usuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');

  if (!token || !userStr) {
    window.location.href = 'index.html';
    return null;
  }

  try {
    return JSON.parse(userStr);
  } catch {
    window.location.href = 'index.html';
    return null;
  }
})();

if (!usuario) {
  throw new Error('No autenticado');
}

// =====================
// ESTADO LOCAL
// =====================
let proveedoresCache = [];
let proveedorActual = null;
let materiasPrimasCache = [];

// =====================
// INICIALIZAR
// =====================
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const filtroEstado = document.getElementById('filtroEstado');

  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        cargarProveedores();
      }
    });
  }

  if (filtroEstado) {
    filtroEstado.addEventListener('change', () => cargarProveedores());
  }

  cargarProveedores();
  cargarMateriasPrimas();
});

// =====================
// CARGAR PROVEEDORES
// =====================
async function cargarProveedores() {
  const tbody = document.getElementById('proveedoresTableBody');
  if (!tbody) return;

  try {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Cargando...</span>
          </div>
        </td>
      </tr>
    `;

    const search = document.getElementById('searchInput')?.value || '';
    const estado = document.getElementById('filtroEstado')?.value || 'activos';

    const params = new URLSearchParams();
    if (search.trim() !== '') params.append('search', search.trim());
    if (estado && estado !== 'todos') params.append('estado', estado);

    const endpoint = `/api/proveedores${params.toString() ? `?${params.toString()}` : ''}`;
    const proveedores = await apiFetch(endpoint);
    proveedoresCache = proveedores;

    tbody.innerHTML = '';

    if (!proveedores.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center py-3">
            No se encontraron proveedores
          </td>
        </tr>
      `;
      return;
    }

    proveedores.forEach((p) => {
      const tr = document.createElement('tr');
      const deuda = Number(p.deuda_pendiente || 0);
      const deudaStr = deuda.toLocaleString('es-AR', {
        style: 'currency',
        currency: 'ARS'
      });

      tr.innerHTML = `
        <td>${p.nombre || '-'}</td>
        <td>${p.cuit || '-'}</td>
        <td>${p.contacto || '-'}</td>
        <td>${p.telefono || '-'}</td>
        <td>${p.email || '-'}</td>
        <td>${p.total_compras || 0}</td>
        <td>${deudaStr}</td>
        <td>
          <span class="${p.activo ? 'badge-activo' : 'badge-inactivo'}">
            ${p.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td>
          <button class="btn btn-sm btn-outline-primary btn-action" onclick="verDetalleProveedor(${p.id})">
            <i class="fas fa-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-success btn-action" onclick="abrirModalCompraProveedor(${p.id})">
            <i class="fas fa-cart-plus"></i>
          </button>
          <button class="btn btn-sm btn-outline-secondary btn-action" onclick="editarProveedor(${p.id})">
            <i class="fas fa-edit"></i>
          </button>
          ${usuario.rol === 'admin'
            ? `<button class="btn btn-sm btn-outline-danger btn-action" onclick="confirmarEliminarProveedor(${p.id}, '${(p.nombre || '').replace(/'/g, "\\'")}')">
                 <i class="fas fa-trash"></i>
               </button>`
            : ''
          }
        </td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    alert(err.error || err.message || 'Error cargando proveedores');
  }
}

// =====================
// CARGAR MATERIAS PRIMAS
// =====================
async function cargarMateriasPrimas() {
  try {
    const data = await apiFetch('/api/materias-primas');
    materiasPrimasCache = Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('No se pudo cargar materias primas:', err);
    materiasPrimasCache = [];
  }
}

// =====================
// ABRIR MODAL NUEVO
// =====================
function abrirModalProveedor() {
  const form = document.getElementById('proveedorForm');
  if (form) form.reset();

  document.getElementById('proveedorId').value = '';
  document.getElementById('modalTitle').textContent = 'Nuevo Proveedor';

  const estadoField = document.getElementById('estadoField');
  if (estadoField) estadoField.style.display = 'none';

  const modalEl = document.getElementById('proveedorModal');
  if (!modalEl) return;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

// =====================
// NUEVA COMPRA - ABRIR MODAL (GLOBAL)
// =====================
function abrirModalCompraGlobal() {
  // Proveedor libre, se elige en el select
  prepararFormularioCompra();
  const modalEl = document.getElementById('compraModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

// =====================
// NUEVA COMPRA DESDE UN PROVEEDOR
// =====================
function abrirModalCompraProveedor(proveedorId) {
  prepararFormularioCompra(proveedorId);
  const modalEl = document.getElementById('compraModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

// =====================
// PREPARAR FORMULARIO COMPRA
// =====================
function prepararFormularioCompra(preselectedProveedorId) {
  document.getElementById('compraForm').reset();
  document.getElementById('compraItemsBody').innerHTML = '';
  document.getElementById('compraTotal').textContent = '$ 0,00';
  document.getElementById('compraMensajeVariaciones').style.display = 'none';

  // Fecha por defecto: hoy
  const hoy = new Date().toISOString().split('T')[0];
  const fechaInput = document.getElementById('compra_fecha_compra');
  if (fechaInput && !fechaInput.value) {
    fechaInput.value = hoy;
  }

  // Rellenar combo de proveedores (usando cache actual)
  const selectProv = document.getElementById('compra_proveedor_id');
  if (selectProv) {
    const valorActual = preselectedProveedorId || selectProv.value;
    selectProv.innerHTML = '<option value="">-- Seleccionar proveedor --</option>';

    proveedoresCache.forEach(p => {
      if (!p.activo) return;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.nombre} ${p.cuit ? '- ' + p.cuit : ''}`;
      selectProv.appendChild(opt);
    });

    if (valorActual) {
      selectProv.value = valorActual;
    }
  }

  // Agregar primera fila de item por defecto
  agregarItemCompra();
}

// =====================
// AGREGAR FILA DE ITEM
// =====================
function agregarItemCompra() {
  const tbody = document.getElementById('compraItemsBody');
  if (!tbody) return;

  const row = document.createElement('tr');

  row.innerHTML = `
    <td>
      <select class="form-select form-select-sm mp-select" onchange="onMateriaPrimaChange(this)">
        <option value="">-- Seleccionar --</option>
      </select>
      <small class="text-muted d-block mp-info"></small>
    </td>
    <td>
      <input type="text" class="form-control form-control-sm descripcion" placeholder="Descripción / detalle">
    </td>
    <td>
      <select class="form-select form-select-sm unidad">
        <option value="UNI">UNI</option>
        <option value="KG">KG</option>
      </select>
    </td>
    <td>
      <input type="number" step="0.01" min="0" class="form-control form-control-sm cantidad" oninput="recalcularSubtotalFila(this)">
    </td>
    <td>
      <input type="number" step="0.01" min="0" class="form-control form-control-sm precio" oninput="recalcularSubtotalFila(this)">
    </td>
    <td>
      <div class="subtotal text-end">$ 0,00</div>
    </td>
    <td>
      <span class="badge bg-secondary d-none var-precio">=</span>
    </td>
    <td class="text-center">
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="eliminarItemCompra(this)">
        <i class="fas fa-times"></i>
      </button>
    </td>
  `;

  tbody.appendChild(row);

  // Rellenar el select de materia prima con el catálogo
  const select = row.querySelector('.mp-select');
  if (select) {
    llenarSelectMateriaPrima(select);
  }
}

// =====================
// LLENAR SELECT DE MATERIA PRIMA
// =====================
function llenarSelectMateriaPrima(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Seleccionar --</option>';

  materiasPrimasCache.forEach(mp => {
    if (mp.activo === false) return;
    const opt = document.createElement('option');
    opt.value = mp.id;
    opt.textContent = mp.codigo
      ? `${mp.codigo} - ${mp.nombre}`
      : mp.nombre;
    selectEl.appendChild(opt);
  });
}

// =====================
// CAMBIO DE MATERIA PRIMA EN FILA
// =====================
function onMateriaPrimaChange(selectEl) {
  const row = selectEl.closest('tr');
  if (!row) return;

  const id = parseInt(selectEl.value, 10);
  const mp = materiasPrimasCache.find(m => m.id === id);

  const info = row.querySelector('.mp-info');
  if (mp && info) {
    info.textContent = mp.descripcion || mp.ubicacion
      ? `${mp.descripcion || ''} ${mp.ubicacion ? ' · Ubicación: ' + mp.ubicacion : ''}`
      : '';
  } else if (info) {
    info.textContent = '';
  }

  // Ajustar unidad por defecto según la materia prima
  const unidadSelect = row.querySelector('.unidad');
  if (mp && unidadSelect) {
    unidadSelect.value = mp.unidad_medida || 'UNI';
  }
}

// =====================
// ELIMINAR FILA DE ITEM
// =====================
function eliminarItemCompra(btn) {
  const row = btn.closest('tr');
  if (!row) return;
  row.remove();
  recalcularTotalCompra();
}

// =====================
// RECALCULAR SUBTOTAL DE UNA FILA
// =====================
function recalcularSubtotalFila(inputEl) {
  const row = inputEl.closest('tr');
  if (!row) return;

  const cantidad = parseFloat(row.querySelector('.cantidad')?.value || '0');
  const precio = parseFloat(row.querySelector('.precio')?.value || '0');
  const subtotal = cantidad * precio;

  const subtotalDiv = row.querySelector('.subtotal');
  if (subtotalDiv) {
    subtotalDiv.textContent = subtotal.toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS'
    });
  }

  recalcularTotalCompra();
}

// =====================
// RECALCULAR TOTAL COMPRA
// =====================
function recalcularTotalCompra() {
  const tbody = document.getElementById('compraItemsBody');
  const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];

  let total = 0;
  rows.forEach(row => {
    const cantidad = parseFloat(row.querySelector('.cantidad')?.value || '0');
    const precio = parseFloat(row.querySelector('.precio')?.value || '0');
    total += cantidad * precio;
  });

  const totalDiv = document.getElementById('compraTotal');
  if (totalDiv) {
    totalDiv.textContent = total.toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS'
    });
  }
}

// =====================
// GUARDAR COMPRA
// =====================
async function guardarCompra() {
  const proveedor_id = parseInt(document.getElementById('compra_proveedor_id').value, 10);
  const fecha_compra = document.getElementById('compra_fecha_compra').value;
  const numero_comprobante = document.getElementById('compra_numero_comprobante').value.trim();
  const moneda = document.getElementById('compra_moneda').value || 'ARS';
  const observaciones = document.getElementById('compra_observaciones').value.trim();

  if (!proveedor_id || !fecha_compra) {
    alert('Proveedor y fecha de compra son obligatorios.');
    return;
  }

  const tbody = document.getElementById('compraItemsBody');
  const rows = tbody ? Array.from(tbody.querySelectorAll('tr')) : [];

  const items = [];
  rows.forEach(row => {
    const materia_prima_id = parseInt(row.querySelector('.mp-select')?.value, 10);
    const descripcion = row.querySelector('.descripcion')?.value.trim();
    const unidad = row.querySelector('.unidad')?.value || 'UNI';
    const cantidad = parseFloat(row.querySelector('.cantidad')?.value || '0');
    const precio_unitario = parseFloat(row.querySelector('.precio')?.value || '0');

    if (!materia_prima_id || !cantidad || !precio_unitario) {
      return;
    }

    items.push({
      materia_prima_id,
      descripcion,
      unidad,
      cantidad,
      precio_unitario
    });
  });

  if (!items.length) {
    alert('Debe cargar al menos un item de compra con materia prima, cantidad y precio.');
    return;
  }

  try {
    const payload = {
      proveedor_id,
      fecha_compra,
      numero_comprobante: numero_comprobante || null,
      moneda,
      observaciones: observaciones || null,
      items
    };

    const resp = await apiFetch('/api/compras', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // Marcar variaciones de precio en la grilla si el backend devolvió info
    if (resp.variaciones_precio && Array.isArray(resp.variaciones_precio) && resp.variaciones_precio.length) {
      const mensaje = `Hubo ${resp.variaciones_precio.length} variación(es) de precio respecto al último valor registrado.`;
      const msgDiv = document.getElementById('compraMensajeVariaciones');
      if (msgDiv) {
        msgDiv.textContent = mensaje;
        msgDiv.style.display = 'block';
      }
      // No tenemos mapeo 1:1 a filas sin recargar, así que solo mostramos el mensaje global.
    }

    alert('Compra registrada correctamente.');

    // Cerrar modal
    const modalEl = document.getElementById('compraModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    // Refrescar resumen del proveedor si estamos en detalle
    cargarProveedores();
  } catch (err) {
    console.error('Error guardando compra:', err);
    alert(err.error || err.message || 'Error al guardar la compra');
  }
}

// =====================
// NUEVA MATERIA PRIMA DESDE MODAL
// =====================
function abrirModalNuevaMateriaPrima() {
  const form = document.getElementById('mpForm');
  if (form) form.reset();

  const modalEl = document.getElementById('mpModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

async function guardarMateriaPrimaDesdeModal() {
  const codigo = document.getElementById('mp_codigo').value.trim();
  const nombre = document.getElementById('mp_nombre').value.trim();
  const unidad_medida = document.getElementById('mp_unidad_medida').value || 'UNI';
  const stock_minimo = parseFloat(document.getElementById('mp_stock_minimo').value || '0');
  const ubicacion = document.getElementById('mp_ubicacion').value.trim();
  const descripcion = document.getElementById('mp_descripcion').value.trim();

  if (!nombre) {
    alert('El nombre es obligatorio.');
    return;
  }

  try {
    const nueva = await apiFetch('/api/materias-primas', {
      method: 'POST',
      body: JSON.stringify({
        codigo: codigo || null,
        nombre,
        unidad_medida,
        stock_minimo,
        ubicacion: ubicacion || null,
        descripcion: descripcion || null
      })
    });

    // Agregar al catálogo en memoria y refrescar selects
    materiasPrimasCache.push(nueva);

    document.querySelectorAll('.mp-select').forEach(sel => {
      llenarSelectMateriaPrima(sel);
    });

    // Cerrar modal
    const modalEl = document.getElementById('mpModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    alert('Materia prima creada correctamente.');
  } catch (err) {
    console.error('Error creando materia prima:', err);
    alert(err.error || err.message || 'Error al crear la materia prima');
  }
}

// =====================
// EDITAR PROVEEDOR
// =====================
async function editarProveedor(id) {
  try {
    const proveedor = await apiFetch(`/api/proveedores/${id}`);

    document.getElementById('proveedorId').value = proveedor.id;
    document.getElementById('nombre').value = proveedor.nombre || '';
    document.getElementById('cuit').value = proveedor.cuit || '';
    document.getElementById('telefono').value = proveedor.telefono || '';
    document.getElementById('email').value = proveedor.email || '';
    document.getElementById('direccion').value = proveedor.direccion || '';
    document.getElementById('contacto').value = proveedor.contacto || '';
    document.getElementById('condicion_iva').value = proveedor.condicion_iva || 'RESPONSABLE INSCRIPTO';
    document.getElementById('observaciones').value = proveedor.observaciones || '';

    const estadoField = document.getElementById('estadoField');
    const activoSelect = document.getElementById('activo');
    if (estadoField && activoSelect) {
      estadoField.style.display = 'block';
      activoSelect.value = proveedor.activo ? 'true' : 'false';
    }

    document.getElementById('modalTitle').textContent = `Editar Proveedor`;

    const modalEl = document.getElementById('proveedorModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  } catch (err) {
    console.error(err);
    alert(err.error || err.message || 'Error al cargar proveedor');
  }
}

// =====================
// GUARDAR PROVEEDOR
// =====================
async function guardarProveedor() {
  const id = document.getElementById('proveedorId').value;

  const data = {
    nombre: document.getElementById('nombre').value.trim(),
    cuit: document.getElementById('cuit').value.trim() || null,
    telefono: document.getElementById('telefono').value.trim() || null,
    email: document.getElementById('email').value.trim() || null,
    direccion: document.getElementById('direccion').value.trim() || null,
    contacto: document.getElementById('contacto').value.trim() || null,
    condicion_iva: document.getElementById('condicion_iva').value || null,
    observaciones: document.getElementById('observaciones').value.trim() || null
  };

  if (!data.nombre) {
    alert('El nombre es obligatorio');
    return;
  }

  // Estado sólo si se está editando
  if (id) {
    const activoSelect = document.getElementById('activo');
    if (activoSelect) {
      data.activo = activoSelect.value === 'true';
    }
  }

  try {
    const options = {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    };

    const endpoint = id ? `/api/proveedores/${id}` : '/api/proveedores';
    await apiFetch(endpoint, options);

    alert(id ? 'Proveedor actualizado correctamente' : 'Proveedor creado correctamente');

    const modalEl = document.getElementById('proveedorModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.hide();

    cargarProveedores();
  } catch (err) {
    console.error(err);
    alert(err.error || err.message || 'Error al guardar proveedor');
  }
}

// =====================
// ELIMINAR / DESACTIVAR
// =====================
function confirmarEliminarProveedor(id, nombre) {
  const mensaje = `⚠️ ¿Estás seguro de eliminar/desactivar al proveedor "${nombre}"?\n\nSi tiene compras asociadas se desactivará, en caso contrario se eliminará.`;
  if (confirm(mensaje)) {
    eliminarProveedor(id);
  }
}

async function eliminarProveedor(id) {
  try {
    await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
    alert('Operación realizada correctamente');
    cargarProveedores();
  } catch (err) {
    console.error(err);
    alert(err.error || err.message || 'Error al eliminar proveedor');
  }
}

// =====================
// VER DETALLE PROVEEDOR
// =====================
async function verDetalleProveedor(id) {
  const detalleContent = document.getElementById('detalleContent');
  if (!detalleContent) return;

  detalleContent.innerHTML = `
    <div class="text-center py-4">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Cargando...</span>
      </div>
    </div>
  `;

  try {
    const proveedor = proveedoresCache.find(p => p.id === id) || await apiFetch(`/api/proveedores/${id}`);

    const [resumen, compras, facturas, cuentaCorriente] = await Promise.all([
      apiFetch(`/api/proveedores/${id}/resumen`),
      apiFetch(`/api/proveedores/${id}/compras`),
      apiFetch(`/api/proveedores/${id}/facturas?estado=PENDIENTE`),
      apiFetch(`/api/proveedores/${id}/cuenta-corriente`)
    ]);

    const deuda = Number(resumen.deuda_pendiente || 0);
    const deudaStr = deuda.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

    const montoCompras = Number(resumen.monto_total_compras || 0).toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS'
    });

    const saldoPendiente = Number(cuentaCorriente.saldo_pendiente || 0).toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS'
    });

    let comprasHtml = '';
    if (!compras.length) {
      comprasHtml = `<p class="text-muted mb-0">Sin compras registradas.</p>`;
    } else {
      comprasHtml = `
        <div class="table-responsive">
          <table class="table table-sm table-hover">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>OC / Ref</th>
                <th>Total</th>
                <th>Facturado</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              ${compras.map(c => `
                <tr>
                  <td>${c.fecha_compra || '-'}</td>
                  <td>${c.numero_oc || c.id}</td>
                  <td>${(c.total || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</td>
                  <td>${(c.facturado || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</td>
                  <td>${c.total_items || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    let facturasHtml = '';
    if (!facturas.length) {
      facturasHtml = `<p class="text-muted mb-0">Sin facturas pendientes.</p>`;
    } else {
      facturasHtml = `
        <div class="table-responsive">
          <table class="table table-sm table-hover">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Compra</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${facturas.map(f => `
                <tr>
                  <td>${f.numero || '-'}</td>
                  <td>${f.fecha_emision || '-'}</td>
                  <td>${f.compra_id || '-'}</td>
                  <td>${(f.total || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</td>
                  <td>${f.estado || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    detalleContent.innerHTML = `
      <div class="row">
        <div class="col-md-4">
          <div class="stat-card">
            <div class="stat-label">Proveedor</div>
            <div class="stat-value">${proveedor.nombre || '-'}</div>
            <div class="mt-2">
              <small>CUIT: ${proveedor.cuit || '-'}</small><br>
              <small>Tel: ${proveedor.telefono || '-'}</small><br>
              <small>Email: ${proveedor.email || '-'}</small>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Total Compras</div>
            <div class="stat-value">${resumen.total_compras || 0}</div>
            <div class="mt-1">
              <small>Monto total compras:</small><br>
              <strong>${montoCompras}</strong>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-label">Deuda / Saldo</div>
            <div class="stat-value" style="color:#dc3545;">${deudaStr}</div>
            <div class="mt-1">
              <small>Saldo pendiente (cta cte):</small><br>
              <strong>${saldoPendiente}</strong>
            </div>
          </div>
        </div>

        <div class="col-md-8">
          <h6>📦 Últimas compras</h6>
          ${comprasHtml}

          <hr>

          <h6>🧾 Facturas proveedor pendientes</h6>
          ${facturasHtml}
        </div>
      </div>
    `;

    const modalEl = document.getElementById('detalleModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  } catch (err) {
    console.error(err);
    alert(err.error || err.message || 'Error al cargar detalle del proveedor');
  }
}


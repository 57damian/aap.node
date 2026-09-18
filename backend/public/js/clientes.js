/* =====================================================================
 * clientes.js — Alta y listado de clientes
 * Migrado al shell (F1.4 del plan de rediseño): misma lógica de negocio,
 * la ficha de detalle pasa del modal centrado a la misma pantalla lateral
 * (drawer) que usan Cobros y Pagos a proveedores, para que "ver detalle"
 * se sienta igual en toda la app.
 * ===================================================================== */

let editMode = false;
let currentId = null;

const usuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');

  if (!token || !userStr) {
    window.location.href = 'login.html';
    return null;
  }

  try {
    return JSON.parse(userStr);
  } catch {
    window.location.href = 'login.html';
    return null;
  }
})();

if (!usuario || !usuario.rol) {
  window.location.href = 'login.html';
  throw new Error('No autenticado');
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('clienteForm');
  if (form) form.addEventListener('submit', handleSubmit);

  document.getElementById('btnCerrarDrawer').addEventListener('click', cerrarDrawer);
  document.getElementById('drawerBg').addEventListener('click', cerrarDrawer);

  cargarClientes();
});

/* ---------------------- listado ---------------------- */

async function cargarClientes() {
  const tbody = document.getElementById('clientesList');
  try {
    const clientes = await apiFetch('/api/clientes');

    if (!clientes.length) {
      tbody.innerHTML = '<tr><td colspan="5">' + Shell.vacio(
        'No hay clientes creados aún',
        'Cargá el primero desde "Crear nuevo".',
        { txt: 'Crear nuevo', url: '#' }
      ) + '</td></tr>';
      return;
    }

    tbody.innerHTML = clientes.map(cliente => `
      <tr>
        <td><strong>${cliente.nombre}</strong></td>
        <td class="muted" data-label="CUIT">${cliente.cuit || '—'}</td>
        <td data-label="Teléfono">${cliente.telefono || '—'}</td>
        <td data-label="Forma de pago">${getFormaPagoLabel(cliente.forma_pago)}</td>
        <td data-label="Acciones">
          <button class="b b-ghost b-sm" onclick="verDetalles(${cliente.id})">Ver</button>
          <button class="b b-ghost b-sm" onclick="editarCliente(${cliente.id})">Editar</button>
          ${rolPermiteEliminar() ?
            `<button class="b b-danger b-sm" onclick="confirmarEliminar(${cliente.id}, '${cliente.nombre.replace(/'/g, "\\'")}')">Eliminar</button>`
            : ''
          }
        </td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los clientes');
    tbody.innerHTML = '<tr><td colspan="5">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

function getFormaPagoLabel(formaPago) {
  const labels = {
    contado: 'Contado', cheque: 'Cheque', transferencia: 'Transferencia', otro: 'Otro', '': 'No especificado'
  };
  return labels[formaPago] || formaPago || 'No especificado';
}

/* ---------------------- ficha del cliente (drawer) ---------------------- */

async function verDetalles(id) {
  abrirDrawer('Cargando...', '', '');
  try {
    const cliente = await apiFetch(`/api/clientes/${id}`);

    let html = `
      <div class="panel">
        <div class="panel-head">Información general</div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="field"><label>CUIT</label><div>${cliente.cuit || '—'}</div></div>
            <div class="field"><label>Teléfono</label><div>${cliente.telefono || '—'}</div></div>
            <div class="field"><label>Correo</label><div>${cliente.correo || '—'}</div></div>
            <div class="field ancho-total"><label>Dirección</label><div>${cliente.direccion || '—'}</div></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">Condiciones de pago</div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="field"><label>Forma de pago</label><div>${getFormaPagoLabel(cliente.forma_pago)}</div></div>
            <div class="field"><label>Días máximo de pago</label><div>${cliente.dias_max_pago ? cliente.dias_max_pago + ' días' : 'No especificado'}</div></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">Observaciones</div>
        <div class="panel-body">
          ${cliente.observaciones ? String(cliente.observaciones).replace(/\n/g, '<br>') : '<span class="muted">Sin observaciones registradas</span>'}
        </div>
      </div>`;

    if (usuario.rol === 'admin' || usuario.rol === 'control') {
      try {
        const estado = await apiFetch(`/api/clientes/${id}/estado`);
        html += `
          <div class="kpi-row">
            <div class="kpi"><div class="kpi-k">Total facturado</div><div class="kpi-v">${Shell.money(estado.total_facturado)}</div></div>
            <div class="kpi is-success"><div class="kpi-k">Total pagado</div><div class="kpi-v">${Shell.money(estado.total_pagado)}</div></div>
            <div class="kpi ${estado.saldo > 0 ? 'is-danger' : 'is-success'}">
              <div class="kpi-k">Saldo pendiente <button type="button" class="ayuda" data-ayuda="saldo">?</button></div>
              <div class="kpi-v">${Shell.money(estado.saldo)}</div>
            </div>
          </div>`;
      } catch (e) { /* estado financiero es opcional: si falla, se omite sin romper la ficha */ }
    }

    abrirDrawer(cliente.nombre || 'Sin nombre', 'Ficha del cliente', html);
  } catch (err) {
    abrirDrawer('Error', '', '<div class="notice notice-err">No se pudo cargar la ficha de este cliente.</div>');
    Shell.error(err, 'No se pudo cargar el cliente');
  }
}

function abrirDrawer(titulo, meta, cuerpo) {
  document.getElementById('drawerTitulo').textContent = titulo;
  document.getElementById('drawerMeta').textContent = meta;
  document.getElementById('drawerCuerpo').innerHTML = cuerpo;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerBg').classList.add('open');
}

function cerrarDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerBg').classList.remove('open');
}

function rolPermiteEliminar() {
  return usuario.rol === 'admin' || usuario.rol === 'control';
}

function confirmarEliminar(id, nombre) {
  if (!confirm(`¿Eliminar al cliente "${nombre}"? Esta acción no se puede deshacer.`)) return;
  eliminarCliente(id);
}

async function eliminarCliente(id) {
  try {
    await apiFetch(`/api/clientes/${id}`, { method: 'DELETE' });
    Shell.toast('ok', 'Cliente eliminado correctamente.');
    cargarClientes();
  } catch (err) {
    if (err && err.error && err.error.includes('foreign key')) {
      Shell.toast('err', 'No se puede eliminar: el cliente tiene facturas o pagos asociados.');
    } else {
      Shell.error(err, 'No se pudo eliminar el cliente');
    }
  }
}

/* ---------------------- alta / edición ---------------------- */

async function handleSubmit(e) {
  e.preventDefault();

  const data = {
    nombre: document.getElementById('nombre').value,
    cuit: document.getElementById('cuit').value,
    telefono: document.getElementById('telefono').value,
    correo: document.getElementById('correo').value,
    direccion: document.getElementById('direccion').value,
    forma_pago: document.getElementById('forma_pago').value,
    dias_max_pago: parseInt(document.getElementById('dias_max_pago').value) || null,
    observaciones: document.getElementById('observaciones').value
  };

  try {
    if (editMode) {
      await apiFetch(`/api/clientes/${currentId}`, { method: 'PUT', body: JSON.stringify(data) });
      Shell.toast('ok', 'Cliente actualizado correctamente.');
    } else {
      await apiFetch('/api/clientes', { method: 'POST', body: JSON.stringify(data) });
      Shell.toast('ok', 'Cliente creado correctamente.');
    }

    resetForm();
    cargarClientes();
    showTab('listar');
  } catch (err) {
    Shell.error(err, 'No se pudo guardar el cliente');
  }
}

async function editarCliente(id) {
  try {
    const cliente = await apiFetch(`/api/clientes/${id}`);

    document.getElementById('nombre').value = cliente.nombre || '';
    document.getElementById('cuit').value = cliente.cuit || '';
    document.getElementById('telefono').value = cliente.telefono || '';
    document.getElementById('correo').value = cliente.correo || '';
    document.getElementById('direccion').value = cliente.direccion || '';
    document.getElementById('forma_pago').value = cliente.forma_pago || '';
    document.getElementById('dias_max_pago').value = cliente.dias_max_pago || '';
    document.getElementById('observaciones').value = cliente.observaciones || '';

    editMode = true;
    currentId = id;

    showTab('crear');
    Shell.toast('ok', `Editando cliente: ${cliente.nombre}`);
    document.getElementById('clienteForm').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el cliente');
  }
}

function resetForm() {
  document.getElementById('clienteForm').reset();
  editMode = false;
  currentId = null;
}

function showTab(tabName, event) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));

  const tabElement = document.getElementById(tabName);
  if (tabElement) tabElement.classList.add('active');
  if (event && event.target) event.target.classList.add('active');

  if (tabName === 'listar') cargarClientes();
}

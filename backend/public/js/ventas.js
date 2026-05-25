const tablaVentas = document.getElementById('tablaVentas');
const filtroCliente = document.getElementById('filtroCliente');

// =====================
// VERIFICAR AUTENTICACION
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

function mostrarNotificacion(mensaje, tipo = 'info') {
  let notificacion = document.querySelector('.notificacion');

  if (!notificacion) {
    notificacion = document.createElement('div');
    notificacion.className = 'notificacion';
    document.body.appendChild(notificacion);
  }

  notificacion.className = `notificacion notificacion-${tipo}`;
  notificacion.textContent = mensaje;
  notificacion.style.display = 'block';

  setTimeout(() => {
    notificacion.style.display = 'none';
  }, 3000);
}

function formatFecha(fecha) {
  if (!fecha) return '-';
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return fecha;
  return date.toLocaleDateString('es-AR');
}

function renderLoadingTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `
    <tr>
      <td colspan="7" style="text-align:center; padding: 32px;">
        <div class="loading">Cargando ventas...</div>
      </td>
    </tr>
  `;
}

function renderEmptyTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `
    <tr>
      <td colspan="7" class="empty-state">
        No hay ventas para los filtros seleccionados
      </td>
    </tr>
  `;
}

function renderErrorTabla(mensaje) {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `
    <tr>
      <td colspan="7" class="error-state">
        Error cargando ventas: ${mensaje}
      </td>
    </tr>
  `;
}

/* =====================
   CARGAR CLIENTES
===================== */
async function cargarClientes() {
  if (!filtroCliente) return;

  try {
    const clientes = await apiFetch('/api/clientes');

    filtroCliente.innerHTML = '<option value="">Todos los clientes</option>';
    clientes.forEach((cliente) => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      filtroCliente.appendChild(option);
    });
  } catch (err) {
    console.error('Error cargando clientes:', err);
    mostrarNotificacion('Error cargando clientes', 'error');
  }
}

/* =====================
   CARGAR VENTAS
===================== */
async function cargarVentas() {
  if (!tablaVentas) return;

  try {
    renderLoadingTabla();

    const clienteId = filtroCliente ? filtroCliente.value : '';
    let endpoint = '/api/ventas';
    if (clienteId) endpoint += `?cliente_id=${clienteId}`;

    const ventas = await apiFetch(endpoint);
    tablaVentas.innerHTML = '';

    if (!ventas || ventas.length === 0) {
      renderEmptyTabla();
      return;
    }

    ventas.forEach((venta) => {
      const facturada = Boolean(venta.numero_factura);
      const estadoHtml = facturada
        ? '<span class="badge success">Facturada</span>'
        : '<span class="badge warning">Pendiente</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${venta.id}</td>
        <td>${formatFecha(venta.fecha)}</td>
        <td>${venta.cliente || '-'}</td>
        <td>${venta.numero_oc || '-'}</td>
        <td>${venta.numero_factura || '-'}</td>
        <td>${estadoHtml}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="verVenta(${venta.id})">Ver</button>
          ${!facturada ? `<button class="btn btn-success btn-sm" onclick="facturarVenta(${venta.id})">Facturar</button>` : ''}
        </td>
      `;

      tablaVentas.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando ventas:', err);
    renderErrorTabla(err.error || err.message || 'Error desconocido');
    mostrarNotificacion(err.error || err.message || 'Error cargando ventas', 'error');
  }
}

/* =====================
   VER DETALLE
===================== */
function verVenta(id) {
  window.location.href = `venta_detalle.html?id=${id}`;
}

/* =====================
   FACTURAR
===================== */
async function facturarVenta(id) {
  if (!confirm('¿Facturar esta venta?')) return;

  try {
    await apiFetch('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({ venta_id: id })
    });

    mostrarNotificacion('Factura generada correctamente', 'success');
    cargarVentas();
  } catch (err) {
    console.error('Error facturando venta:', err);
    mostrarNotificacion(err.error || err.message || 'Error al facturar', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  cargarClientes();
  cargarVentas();
});

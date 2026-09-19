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

// Esta pantalla tenía su propio sistema de notificaciones (un div flotante
// inventado acá). Ahora usa el toast del shell, igual que el resto.
function mostrarNotificacion(mensaje, tipo = 'info') {
  Shell.toast(tipo === 'error' ? 'err' : 'ok', mensaje);
}

function formatFecha(fecha) {
  if (!fecha) return '-';
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return fecha;
  return date.toLocaleDateString('es-AR');
}

function renderLoadingTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = '<tr><td colspan="6" class="muted">Cargando…</td></tr>';
}

function renderEmptyTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `<tr><td colspan="6">${Shell.vacio(
    'No hay ventas para este filtro',
    'Las ventas se generan al entregar una orden de compra.',
    { txt: 'Ver órdenes de compra', url: 'oc.html' })}</td></tr>`;
}

function renderErrorTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `<tr><td colspan="6">${Shell.vacio(
    'No se pudieron cargar las ventas',
    'Probá recargar la página.')}</td></tr>`;
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

    const soloSinFacturar = document.getElementById('filtroSinFacturar')?.checked;
    const visibles = soloSinFacturar
      ? ventas.filter(v => !v.numero_factura)
      : ventas;

    if (!visibles.length) {
      renderEmptyTabla();
      return;
    }

    tablaVentas.innerHTML = visibles.map((venta) => {
      const facturada = Boolean(venta.numero_factura);
      return `
        <tr>
          <td><strong>${venta.cliente || 'Sin cliente'}</strong></td>
          <td data-label="Fecha">${Shell.fecha(venta.fecha)}</td>
          <td class="muted solo-escritorio" data-label="OC">${venta.numero_oc || '—'}</td>
          <td class="muted solo-escritorio" data-label="Factura">${venta.numero_factura || '—'}</td>
          <td data-label="Estado">${Shell.pill(facturada ? 'FACTURADA' : 'PENDIENTE')}</td>
          <td class="num">
            <button class="b b-ghost b-sm" onclick="verVenta(${venta.id})">
              ${facturada ? 'Ver' : 'Facturar'}
            </button>
          </td>
        </tr>`;
    }).join('');

  } catch (err) {
    console.error('Error cargando ventas:', err);
    renderErrorTabla();
    Shell.error(err, 'No se pudieron cargar las ventas');
  }
}

/* =====================
   VER DETALLE
===================== */
function verVenta(id) {
  window.location.href = `venta_detalle.html?id=${id}`;
}

/* =====================
   FACTURAR: redirige al detalle de la venta (allí está el modal completo)
===================== */
function facturarVenta(id) {
  window.location.href = `venta_detalle.html?id=${id}`;
}


document.addEventListener('DOMContentLoaded', () => {
  cargarClientes();
  cargarVentas();
});

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
  tablaVentas.innerHTML = '<tr><td colspan="9" class="muted">Cargando…</td></tr>';
}

function renderEmptyTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `<tr><td colspan="9">${Shell.vacio(
    'No hay remitos para este filtro',
    'Los remitos se generan al registrar una entrega en una orden de compra.',
    { txt: 'Ver órdenes de compra', url: 'oc.html' })}</td></tr>`;
}

function renderErrorTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `<tr><td colspan="9">${Shell.vacio(
    'No se pudieron cargar las ventas',
    'Probá recargar la página.')}</td></tr>`;
}

// Texto "Modelo x2, Otro modelo x1" a partir de items (ya viene del backend
// con modelo/cantidad, ver ventas.routes.js).
function modelosTexto(venta) {
  if (!venta.items || !venta.items.length) return '—';
  return venta.items.map(i => `${i.modelo} x${i.cantidad}`).join(', ');
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
let ventasCache = [];

function paramsVentas() {
  const clienteId = filtroCliente ? filtroCliente.value : '';
  const desde = document.getElementById('filtroDesde')?.value;
  const hasta = document.getElementById('filtroHasta')?.value;

  const params = new URLSearchParams();
  if (clienteId) params.append('cliente_id', clienteId);
  if (desde) params.append('desde', desde);
  if (hasta) params.append('hasta', hasta);
  return params;
}

async function cargarVentas() {
  if (!tablaVentas) return;

  try {
    renderLoadingTabla();

    const params = paramsVentas();
    const endpoint = `/api/ventas${params.toString() ? '?' + params : ''}`;

    const ventas = await apiFetch(endpoint);
    ventasCache = ventas || [];
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
          <td class="muted solo-escritorio" data-label="Remito">${venta.remito_numero || '—'}</td>
          <td class="muted solo-escritorio" data-label="OC">${venta.numero_oc || '—'}</td>
          <td class="muted solo-escritorio" data-label="Modelos / cantidad">${modelosTexto(venta)}</td>
          <td class="muted solo-escritorio" data-label="Factura">${venta.numero_factura || '—'}</td>
          <td class="muted solo-escritorio" data-label="Observaciones">${venta.remito_observaciones || '—'}</td>
          <td data-label="Estado">${Shell.pill(facturada ? 'FACTURADA' : 'SIN_FACTURAR')}</td>
          <td class="num">
            <button class="b b-ghost b-sm" onclick="verVenta(${venta.id})">
              ${facturada ? 'Ver' : 'Ver / facturar'}
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

function limpiarFiltrosVentas() {
  if (filtroCliente) filtroCliente.value = '';
  document.getElementById('filtroDesde').value = '';
  document.getElementById('filtroHasta').value = '';
  document.getElementById('filtroSinFacturar').checked = false;
  cargarVentas();
}

// Exportar lo ya filtrado (mismo patrón que stock.js:exportarMovimientosCSV)
function exportarVentasCSV() {
  if (!ventasCache.length) {
    Shell.toast('err', 'No hay datos para exportar');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,';
  const headers = ['Fecha', 'Cliente', 'Remito', 'Orden de compra', 'Modelos y cantidad', 'Factura', 'Observaciones', 'Estado'];
  csvContent += headers.join(',') + '\n';

  ventasCache.forEach(v => {
    const fila = [
      v.fecha || '',
      `"${(v.cliente || '').replace(/"/g, '""')}"`,
      v.remito_numero || '',
      v.numero_oc || '',
      `"${modelosTexto(v).replace(/"/g, '""')}"`,
      v.numero_factura || '',
      `"${(v.remito_observaciones || '').replace(/"/g, '""')}"`,
      v.numero_factura ? 'FACTURADA' : 'PENDIENTE'
    ];
    csvContent += fila.join(',') + '\n';
  });

  const desde = document.getElementById('filtroDesde')?.value;
  const hasta = document.getElementById('filtroHasta')?.value;
  const rango = (desde || hasta) ? `${desde || 'inicio'}_a_${hasta || 'hoy'}` : new Date().toISOString().slice(0, 10);

  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `remitos-${rango}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  Shell.toast('ok', 'Reporte exportado');
}

// Previsualizar/descargar el informe (mismos filtros aplicados) en PDF
async function verVentasPdf() {
  try {
    const params = paramsVentas();
    await verArchivoProtegido(`api/ventas/reporte/pdf${params.toString() ? '?' + params : ''}`);
  } catch (err) {
    Shell.error(err, 'No se pudo abrir el PDF');
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

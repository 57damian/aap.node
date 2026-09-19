// alertas-pagos.js - Sistema de alertas para facturas pendientes
//
// Reescrito para sacar jQuery y DataTables (hallazgo F1.19 del plan de
// interfaz): la CSP del server no permite cargarlos desde code.jquery.com ni
// cdn.datatables.net, así que la pantalla funcionaba abierta con Live Server
// y quedaba en blanco servida desde el puerto 3000. La tabla ahora es la
// misma table.t que usa el resto del sistema (se ve como tarjetas en
// teléfono, sin una segunda vista de tarjetas hecha a mano aparte).

let alertasData = [];
let proveedoresData = [];

document.addEventListener('DOMContentLoaded', () => {
  cargarProveedores();
  cargarAlertas();

  document.getElementById('refreshBtn').addEventListener('click', cargarAlertas);
  document.getElementById('applyFilters').addEventListener('click', aplicarFiltros);
  document.getElementById('clearFilters').addEventListener('click', limpiarFiltros);
  document.getElementById('exportBtn').addEventListener('click', exportarReporte);
});

async function cargarProveedores() {
  try {
    // GET /api/proveedores devuelve un array plano, no {success, data}.
    const proveedores = await apiFetch('/api/proveedores');
    proveedoresData = Array.isArray(proveedores) ? proveedores : [];

    const select = document.getElementById('filterProveedor');
    select.innerHTML = '<option value="">Todos los proveedores</option>' +
      proveedoresData.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
  } catch (error) {
    Shell.error(error, 'No se pudo cargar la lista de proveedores');
  }
}

async function cargarAlertas() {
  const boton = document.getElementById('refreshBtn');
  boton.disabled = true;
  boton.textContent = 'Cargando…';

  try {
    // Este endpoint sí devuelve {success, data, ...} (a propósito, para esta
    // pantalla — ver pagos-proveedores.routes.js). Contrato distinto al de
    // /api/proveedores: no asumir uno solo.
    const response = await apiFetch('/api/pagos-proveedores/alertas/facturas-pendientes');

    if (response && response.success) {
      alertasData = response.data || [];
      renderizarAlertas(alertasData);
    } else {
      Shell.toast('err', 'No se pudieron cargar las alertas');
    }
  } catch (error) {
    Shell.error(error, 'No se pudieron cargar las alertas');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Actualizar';
  }
}

function actualizarEstadisticas(datos) {
  const vencidas = datos.filter(a => a.estado_alerta === 'vencida').length;
  const porVencer = datos.filter(a => a.estado_alerta === 'por_vencer').length;
  const totalMonto = datos.reduce((sum, a) => sum + (parseFloat(a.saldo_pendiente) || 0), 0);

  document.getElementById('vencidasCount').textContent = vencidas;
  document.getElementById('porVencerCount').textContent = porVencer;
  document.getElementById('totalPendientes').textContent = datos.length;
  document.getElementById('totalMonto').textContent = Shell.money(totalMonto);
}

function renderizarAlertas(datos) {
  actualizarEstadisticas(datos);

  const tbody = document.getElementById('alertasBody');

  if (!datos.length) {
    tbody.innerHTML = `<tr><td colspan="8">${Shell.vacio(
      'No hay facturas pendientes de pago',
      'Todo al día: no hay nada vencido ni por vencer.')}</td></tr>`;
    return;
  }

  tbody.innerHTML = datos.map(alerta => {
    const dias = alerta.dias_restantes !== null && alerta.dias_restantes !== undefined
      ? alerta.dias_restantes : null;
    const diasClase = dias === null ? '' : (dias < 0 ? 'neg' : (dias <= 7 ? '' : 'pos'));

    return `
      <tr>
        <td data-label="Estado">${Shell.pill(getEstadoTexto(alerta.estado_alerta))}</td>
        <td><strong>${alerta.numero_factura || 'S/N'}</strong></td>
        <td data-label="Proveedor">${alerta.proveedor_nombre || 'Proveedor desconocido'}</td>
        <td class="muted" data-label="Vencimiento">${Shell.fecha(alerta.fecha_vencimiento)}</td>
        <td class="num ${diasClase}" data-label="Días">${dias === null ? '—' : dias}</td>
        <td class="num muted solo-escritorio" data-label="Total">${Shell.money(alerta.total)}</td>
        <td class="num neg" data-label="Saldo"><strong>${Shell.money(alerta.saldo_pendiente)}</strong></td>
        <td class="num">
          <button class="b b-ghost b-sm" onclick="verFactura(${alerta.id})">Ver</button>
          <button class="b b-ghost b-sm" onclick="registrarPago(${alerta.id})">Pagar</button>
        </td>
      </tr>`;
  }).join('');
}

function aplicarFiltros() {
  const estado = document.getElementById('filterEstado').value;
  const proveedorId = document.getElementById('filterProveedor').value;
  const desde = document.getElementById('filterDesde').value;
  const hasta = document.getElementById('filterHasta').value;
  const montoMin = parseFloat(document.getElementById('filterMontoMin').value) || 0;
  const montoMax = parseFloat(document.getElementById('filterMontoMax').value) || Infinity;

  let filtrados = alertasData;

  if (estado) filtrados = filtrados.filter(a => a.estado_alerta === estado);
  if (proveedorId) filtrados = filtrados.filter(a => a.proveedor_id == proveedorId);

  if (desde) {
    const desdeDate = new Date(desde);
    filtrados = filtrados.filter(a => a.fecha_vencimiento && new Date(a.fecha_vencimiento) >= desdeDate);
  }
  if (hasta) {
    const hastaDate = new Date(hasta);
    filtrados = filtrados.filter(a => a.fecha_vencimiento && new Date(a.fecha_vencimiento) <= hastaDate);
  }

  filtrados = filtrados.filter(a => {
    const saldo = parseFloat(a.saldo_pendiente) || 0;
    return saldo >= montoMin && saldo <= montoMax;
  });

  renderizarAlertas(filtrados);
}

function limpiarFiltros() {
  document.getElementById('filterEstado').value = '';
  document.getElementById('filterProveedor').value = '';
  document.getElementById('filterDesde').value = '';
  document.getElementById('filterHasta').value = '';
  document.getElementById('filterMontoMin').value = '';
  document.getElementById('filterMontoMax').value = '';
  renderizarAlertas(alertasData);
}

function exportarReporte() {
  if (!alertasData.length) {
    Shell.toast('err', 'No hay datos para exportar');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,';
  const headers = ['Factura', 'Proveedor', 'Email', 'Teléfono', 'Fecha vencimiento',
    'Días restantes', 'Estado', 'Total', 'Saldo pendiente'];
  csvContent += headers.join(',') + '\n';

  alertasData.forEach(a => {
    const fila = [
      `"${a.numero_factura || ''}"`,
      `"${a.proveedor_nombre || ''}"`,
      `"${a.proveedor_email || ''}"`,
      `"${a.proveedor_telefono || ''}"`,
      a.fecha_vencimiento || '',
      a.dias_restantes ?? '',
      a.estado_alerta || '',
      a.total || '0',
      a.saldo_pendiente || '0'
    ];
    csvContent += fila.join(',') + '\n';
  });

  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `alertas-de-pago-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  Shell.toast('ok', 'Reporte exportado');
}

function getEstadoTexto(estado) {
  if (estado === 'vencida') return 'VENCIDA';
  if (estado === 'por_vencer') return 'POR VENCER';
  return 'NORMAL';
}

// Funciones de acción
function verFactura(facturaId) {
  // facturas-compra-corregida.html es un archivo muerto que se va a borrar
  // (era una copia de facturas-compra.html); esta pantalla la usaba en el
  // link "Ver".
  window.location.href = `facturas-compra.html?id=${facturaId}`;
}

function registrarPago(facturaId) {
  window.location.href = `pagos-proveedores.html?factura=${facturaId}`;
}

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

// Todo lo que viene de la base o de una persona se escapa antes de pintarlo.
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const num = (v) => Number(v || 0).toLocaleString('es-AR');

function renderLoadingTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = '<tr><td colspan="8" class="muted">Cargando…</td></tr>';
}

function renderEmptyTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `<tr><td colspan="8">${Shell.vacio(
    'No hay remitos para este filtro',
    'Los remitos se generan al registrar una entrega a un cliente.')}</td></tr>`;
}

function renderErrorTabla() {
  if (!tablaVentas) return;
  tablaVentas.innerHTML = `<tr><td colspan="8">${Shell.vacio(
    'No se pudieron cargar los remitos',
    'Probá recargar la página.')}</td></tr>`;
}

// Texto "Modelo x2, Otro modelo x1" a partir de items (ya viene del backend
// con modelo/cantidad, ver services/remitos.js).
function modelosTexto(venta) {
  if (!venta.items || !venta.items.length) return '—';
  return venta.items.map(i => `${i.modelo} x${i.cantidad}`).join(', ');
}

function pillFacturacion(estado) {
  // "Parcial" solo ocurre con un remito que cubre varias OC y se facturó una.
  if (estado === 'PARCIAL') return '<span class="pill pill-warn">FACTURADA EN PARTE</span>';
  return Shell.pill(estado === 'FACTURADA' ? 'FACTURADA' : 'SIN_FACTURAR');
}

/* =====================
   CARGAR CLIENTES (filtro y nueva entrega)
===================== */
async function cargarClientes() {
  try {
    const clientes = await apiFetch('/api/clientes');
    const opciones = (vacio) => `<option value="">${vacio}</option>` +
      clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('');

    if (filtroCliente) filtroCliente.innerHTML = opciones('Todos los clientes');
    document.getElementById('entCliente').innerHTML = opciones('Elegí un cliente…');
  } catch (err) {
    console.error('Error cargando clientes:', err);
    mostrarNotificacion('Error cargando clientes', 'error');
  }
}

/* =====================
   CARGAR REMITOS
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

// Lo que falta facturar, sobre el listado ya filtrado por cliente y fechas.
function pintarKpis() {
  const kpi = document.getElementById('kpiRemitos');
  const sin = ventasCache.filter(v => v.estado_facturacion !== 'FACTURADA');
  const unidades = sin.reduce((a, v) => a + Number(v.unidades || 0), 0);
  const filtrando = document.getElementById('filtroSinFacturar')?.checked;
  kpi.innerHTML = `
    <button type="button" class="kpi ${sin.length ? 'is-warning' : 'is-success'}" id="kpiSinFacturar"
            style="text-align:left;cursor:pointer" title="Tocá para ${filtrando ? 'ver todos' : 'ver solo los que faltan'}">
      <div class="kpi-k">Remitos sin facturar</div>
      <div class="kpi-v">${num(sin.length)}</div>
      <div class="kpi-sub">${num(unidades)} unidades${filtrando ? ' · filtrando' : ''}</div>
    </button>
    <div class="kpi">
      <div class="kpi-k">Remitos en este listado</div>
      <div class="kpi-v">${num(ventasCache.length)}</div>
    </div>`;
  document.getElementById('kpiSinFacturar').addEventListener('click', () => {
    const chk = document.getElementById('filtroSinFacturar');
    chk.checked = !chk.checked;
    pintarVentas();
    pintarKpis();
  });
}

function pintarVentas() {
  const soloSinFacturar = document.getElementById('filtroSinFacturar')?.checked;
  const visibles = soloSinFacturar
    ? ventasCache.filter(v => v.estado_facturacion !== 'FACTURADA')
    : ventasCache;

  if (!visibles.length) {
    renderEmptyTabla();
    return;
  }

  tablaVentas.innerHTML = visibles.map((venta) => {
    const sinFacturar = venta.estado_facturacion !== 'FACTURADA';
    const unTramo = (venta.tramos || []).length === 1;
    return `
      <tr>
        <td><strong>${esc(venta.cliente || 'Sin cliente')}</strong></td>
        <td data-label="Fecha">${Shell.fecha(venta.fecha)}</td>
        <td class="solo-escritorio" data-label="Remito">${esc(venta.remito_numero || '—')}</td>
        <td class="muted solo-escritorio" data-label="OC">${esc(venta.numero_oc || '—')}</td>
        <td class="muted solo-escritorio" data-label="Modelos / cantidad">${esc(modelosTexto(venta))}</td>
        <td class="muted solo-escritorio" data-label="Factura">${esc(venta.numero_factura || '—')}</td>
        <td data-label="Estado">${pillFacturacion(venta.estado_facturacion)}</td>
        <td class="num">
          <button class="b b-ghost b-sm" onclick="verRemitoPdf(${Number(venta.id)})">PDF</button>
          ${sinFacturar ? `<button class="b b-primary b-sm" onclick="facturarRemito(${Number(venta.id)})">Facturar</button>` : ''}
          ${unTramo ? `<button class="b b-ghost b-sm" onclick="verVenta(${Number(venta.id)})">Ver</button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

async function cargarVentas() {
  if (!tablaVentas) return;

  try {
    renderLoadingTabla();

    const params = paramsVentas();
    const endpoint = `/api/ventas${params.toString() ? '?' + params : ''}`;

    ventasCache = (await apiFetch(endpoint)) || [];
    pintarKpis();

    if (!ventasCache.length) {
      renderEmptyTabla();
      return;
    }
    pintarVentas();
  } catch (err) {
    console.error('Error cargando ventas:', err);
    renderErrorTabla();
    Shell.error(err, 'No se pudieron cargar los remitos');
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
      `"${(v.numero_oc || '').replace(/"/g, '""')}"`,
      `"${modelosTexto(v).replace(/"/g, '""')}"`,
      `"${(v.numero_factura || '').replace(/"/g, '""')}"`,
      `"${(v.remito_observaciones || '').replace(/"/g, '""')}"`,
      v.estado_facturacion === 'FACTURADA' ? 'FACTURADA' : (v.estado_facturacion === 'PARCIAL' ? 'FACTURADA EN PARTE' : 'SIN FACTURAR')
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

async function verRemitoPdf(ventaId) {
  try {
    await verArchivoProtegido(`api/ventas/${ventaId}/pdf`);
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
   FACTURAR UN REMITO
   Una factura es de una sola OC (el wizard junta los remitos pendientes de
   esa OC y deja destildar los que no van). Un remito que cubre varias OC se
   factura una por una.
===================== */
function abrirWizardFactura(ocId) {
  document.getElementById('facturarOcModal').close();
  FacturarWizard.abrir({ ocId, onListo: cargarVentas });
}

function facturarRemito(ventaId) {
  const venta = ventasCache.find(v => v.id === ventaId);
  if (!venta) return;
  const pendientes = (venta.tramos || []).filter(t => t.items_sin_facturar > 0);
  if (!pendientes.length) {
    Shell.toast('warn', 'Este remito ya está facturado.');
    return;
  }
  if (pendientes.length === 1) {
    abrirWizardFactura(pendientes[0].orden_compra_id);
    return;
  }
  const lista = document.getElementById('facturarOcLista');
  lista.innerHTML = pendientes.map(t => `
    <button type="button" class="b b-ghost" data-oc="${Number(t.orden_compra_id)}">
      Facturar OC ${esc(t.numero_oc || t.orden_compra_id)}
    </button>`).join('');
  lista.querySelectorAll('[data-oc]').forEach(b =>
    b.addEventListener('click', () => abrirWizardFactura(Number(b.dataset.oc))));
  document.getElementById('facturarOcModal').showModal();
}

/* =====================
   NUEVA ENTREGA
===================== */
const panelEntrega = document.getElementById('panelNuevaEntrega');
const selEntCliente = document.getElementById('entCliente');
let entData = null;          // respuesta de /api/ventas/entrega/pendientes
let entOcPrioritaria = null; // OC desde la que se abrió la pantalla (se imputa primero)
let entEnviando = false;
let ultimaEntrega = null;    // para los botones del diálogo final

function hoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// El mismo reparto que hace el servidor, solo para mostrarlo: la OC
// prioritaria primero y después la más vieja (ya vienen ordenadas por fecha).
function repartoPreview(modelo, cantidad) {
  const orden = [...modelo.ordenes].sort((a, b) =>
    (b.oc_id === entOcPrioritaria) - (a.oc_id === entOcPrioritaria));
  const partes = [];
  let resto = cantidad;
  for (const oc of orden) {
    if (resto <= 0) break;
    const toma = Math.min(resto, oc.pendiente);
    partes.push({ numero_oc: oc.numero_oc, cantidad: toma });
    resto -= toma;
  }
  return partes;
}

function maxEntregable(m) {
  return Math.max(0, Math.min(Number(m.pendiente), Number(m.stock_disponible) || 0));
}

function pintarItemsEntrega() {
  const tbody = document.getElementById('entItems');
  const modelos = entData?.modelos || [];

  if (!modelos.length) {
    tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
      'Este cliente no tiene nada pendiente',
      'Todas sus órdenes de compra vigentes ya se entregaron.')}</td></tr>`;
    document.getElementById('entResumen').textContent = '';
    return;
  }

  tbody.innerHTML = modelos.map((m) => {
    const max = maxEntregable(m);
    const sinStock = max <= 0;
    return `
      <tr>
        <td><strong>${esc(m.modelo)}</strong>
          <span class="muted"> · ${m.ordenes.length} OC</span></td>
        <td class="num" data-label="Pendiente">${num(m.pendiente)}</td>
        <td class="num muted" data-label="Stock disponible">${num(m.stock_disponible)}</td>
        <td data-label="Entregar ahora">
          <input type="number" class="input ent-cantidad" min="0" max="${max}" step="1"
                 data-ficha-id="${Number(m.ficha_id)}" placeholder="0" ${sinStock ? 'disabled' : ''}>
          ${sinStock ? `<small class="muted">Sin stock —
            <a href="produccion.html?ficha_id=${Number(m.ficha_id)}" target="_blank" rel="noopener">registrar producción</a></small>` : ''}
        </td>
        <td class="muted solo-escritorio" data-label="Se imputa a"><small class="ent-reparto" data-ficha-id="${Number(m.ficha_id)}">—</small></td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.ent-cantidad').forEach((i) => i.addEventListener('input', actualizarEntrega));
  actualizarEntrega();
}

// Lee la cantidad escrita, la topa en lo entregable y devuelve [{modelo, cantidad}].
function cantidadesEntrega({ corregir = false } = {}) {
  const lineas = [];
  document.querySelectorAll('.ent-cantidad').forEach((input) => {
    const m = entData.modelos.find(x => x.ficha_id === Number(input.dataset.fichaId));
    let c = Number.parseInt(input.value, 10);
    if (!c || c < 0) c = 0;
    const max = maxEntregable(m);
    if (c > max) {
      c = max;
      if (corregir) input.value = max;
    }
    if (c > 0) lineas.push({ modelo: m, cantidad: c });
  });
  return lineas;
}

function actualizarEntrega() {
  if (!entData) return;
  const lineas = cantidadesEntrega({ corregir: true });
  const porFicha = new Map(lineas.map(l => [l.modelo.ficha_id, l]));

  document.querySelectorAll('.ent-reparto').forEach((el) => {
    const l = porFicha.get(Number(el.dataset.fichaId));
    el.textContent = l
      ? repartoPreview(l.modelo, l.cantidad).map(p => `${p.cantidad} → OC ${p.numero_oc}`).join(' · ')
      : '—';
  });

  const unidades = lineas.reduce((a, l) => a + l.cantidad, 0);
  document.getElementById('entResumen').textContent = unidades
    ? `A entregar: ${num(unidades)} unidad${unidades === 1 ? '' : 'es'} de ${lineas.length} modelo${lineas.length === 1 ? '' : 's'}`
    : 'Cargá las cantidades que le llevás al cliente.';
}

async function cargarPendientesEntrega() {
  const clienteId = selEntCliente.value;
  const cont = document.getElementById('entPendientes');
  entData = null;
  if (!clienteId) { cont.hidden = true; return; }

  try {
    entData = await apiFetch(`/api/ventas/entrega/pendientes?cliente_id=${encodeURIComponent(clienteId)}`);
  } catch (err) {
    cont.hidden = true;
    Shell.error(err, 'No se pudo cargar lo pendiente del cliente');
    return;
  }

  cont.hidden = false;
  const numeroInput = document.getElementById('entRemitoNumero');
  numeroInput.value = '';
  numeroInput.placeholder = entData.proximo_remito ? `Automático: ${entData.proximo_remito}` : 'Automático';
  const fecha = document.getElementById('entRemitoFecha');
  if (!fecha.value) fecha.value = hoyISO();
  const dolar = document.getElementById('entCotizacion');
  dolar.value = entData.dolar ? Number(entData.dolar).toFixed(2) : '';
  pintarItemsEntrega();
}

function abrirNuevaEntrega({ clienteId = '', ocId = null } = {}) {
  entOcPrioritaria = ocId ? Number(ocId) : null;
  panelEntrega.hidden = false;
  if (clienteId) selEntCliente.value = String(clienteId);
  if (selEntCliente.value) cargarPendientesEntrega();
  panelEntrega.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!selEntCliente.value) selEntCliente.focus();
}

function cerrarNuevaEntrega() {
  panelEntrega.hidden = true;
  entOcPrioritaria = null;
  entData = null;
  selEntCliente.value = '';
  document.getElementById('entPendientes').hidden = true;
  document.getElementById('entRemitoNumero').value = '';
  document.getElementById('entObservaciones').value = '';
}

async function registrarEntrega(e) {
  e.preventDefault();
  if (entEnviando || !entData) return;

  const lineas = cantidadesEntrega();
  if (!lineas.length) {
    Shell.toast('warn', 'Cargá la cantidad de al menos un modelo');
    return;
  }
  const fecha = document.getElementById('entRemitoFecha').value;
  if (!fecha) {
    Shell.toast('warn', 'La fecha del remito es obligatoria');
    return;
  }
  const cotizacion = Number(document.getElementById('entCotizacion').value);

  const btn = document.getElementById('btnRegistrarEntrega');
  entEnviando = true;
  btn.disabled = true;
  try {
    const r = await apiFetch('/api/ventas/entrega', {
      method: 'POST',
      body: JSON.stringify({
        cliente_id: Number(selEntCliente.value),
        orden_compra_id: entOcPrioritaria,
        remito_numero: document.getElementById('entRemitoNumero').value.trim() || null,
        remito_fecha: fecha,
        tipo_cambio: cotizacion > 0 ? cotizacion : null,
        remito_observaciones: document.getElementById('entObservaciones').value.trim() || null,
        lineas: lineas.map(l => ({ ficha_id: l.modelo.ficha_id, cantidad: l.cantidad }))
      })
    });

    ultimaEntrega = r;
    const unidades = lineas.reduce((a, l) => a + l.cantidad, 0);
    document.getElementById('entregaListaTexto').textContent =
      `Remito ${r.remito_numero}: ${num(unidades)} unidades entregadas` +
      (r.ventas.length > 1 ? `, repartidas en ${r.ventas.length} órdenes de compra.` : '.');
    document.getElementById('entregaListaModal').showModal();

    // La pantalla queda lista para la próxima entrega del mismo cliente.
    document.getElementById('entRemitoNumero').value = '';
    document.getElementById('entObservaciones').value = '';
    await Promise.all([cargarPendientesEntrega(), cargarVentas()]);
  } catch (err) {
    console.error('Error registrando entrega:', err);
    Shell.error(err, 'No se pudo registrar la entrega');
  } finally {
    entEnviando = false;
    btn.disabled = false;
  }
}

function inicializarEntrega() {
  document.getElementById('btnNuevaEntrega').addEventListener('click', () => {
    if (panelEntrega.hidden) abrirNuevaEntrega({});
    else cerrarNuevaEntrega();
  });
  document.getElementById('btnCancelarEntrega').addEventListener('click', cerrarNuevaEntrega);
  selEntCliente.addEventListener('change', () => { entOcPrioritaria = null; cargarPendientesEntrega(); });
  document.getElementById('entregaForm').addEventListener('submit', registrarEntrega);

  document.getElementById('btnTodoDisponible').addEventListener('click', () => {
    document.querySelectorAll('.ent-cantidad:not(:disabled)').forEach((i) => {
      const m = entData.modelos.find(x => x.ficha_id === Number(i.dataset.fichaId));
      i.value = maxEntregable(m) || '';
    });
    actualizarEntrega();
  });
  document.getElementById('btnLimpiarCantidades').addEventListener('click', () => {
    document.querySelectorAll('.ent-cantidad').forEach((i) => { i.value = ''; });
    actualizarEntrega();
  });

  document.getElementById('btnEntregaPdf').addEventListener('click', async () => {
    if (!ultimaEntrega) return;
    try {
      await verArchivoProtegido(`api/ventas/${ultimaEntrega.ventas[0].id}/pdf`);
    } catch (err) {
      Shell.error(err, 'No se pudo abrir el PDF');
    }
  });
  document.getElementById('btnEntregaFacturar').addEventListener('click', () => {
    if (!ultimaEntrega) return;
    document.getElementById('entregaListaModal').close();
    const ocs = ultimaEntrega.ventas.map(v => v.orden_compra_id);
    if (ocs.length === 1) { abrirWizardFactura(ocs[0]); return; }
    // Varias OC: la lista de remitos ya sabe cuáles tienen pendiente.
    const venta = ventasCache.find(v => v.ids?.includes(ultimaEntrega.ventas[0].id));
    if (venta) facturarRemito(venta.id);
  });

  document.getElementById('filtroSinFacturar').addEventListener('change', () => { pintarVentas(); pintarKpis(); });
  document.querySelectorAll('[data-cerrar]').forEach((b) => {
    b.addEventListener('click', () => document.getElementById(b.dataset.cerrar)?.close());
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  inicializarEntrega();
  await cargarClientes();
  cargarVentas();

  // Accesos directos desde Órdenes de compra: ?nueva=1&cliente=X&oc=Y
  const q = new URLSearchParams(location.search);
  if (q.get('nueva') || q.get('cliente')) {
    abrirNuevaEntrega({ clienteId: q.get('cliente') || '', ocId: q.get('oc') });
  }
});

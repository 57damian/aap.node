const lista = document.getElementById('listaOC');
const form = document.getElementById('ocForm');

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

function setFechaHoy() {
  const fechaInput = document.getElementById('fecha_oc');
  if (!fechaInput) return;
  fechaInput.value = new Date().toISOString().split('T')[0];
}

// =====================
// ITEMS DEL PEDIDO (antes se cargaban aparte, en oc_detalle.html; ver
// handleSubmitOC más abajo)
// =====================
let fichasDisponibles = [];

async function cargarFichasParaOC() {
  try {
    fichasDisponibles = await apiFetch('/api/ficha-transformador');
  } catch (err) {
    console.error('Error cargando modelos:', err);
    mostrarNotificacion('Error al cargar los modelos disponibles', 'error');
    fichasDisponibles = [];
  }
}

function opcionesFichaOC() {
  return '<option value="">Elegí un modelo…</option>' +
    fichasDisponibles.map((f) => `<option value="${f.id}">${f.modelo}</option>`).join('');
}

function agregarFilaItemOC() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="input" data-campo="ficha_id" required>${opcionesFichaOC()}</select></td>
    <td><input class="input" type="number" data-campo="cantidad_pedida" min="1" step="1" required></td>
    <td><button type="button" class="b b-ghost b-sm" data-quitar-item-oc>Quitar</button></td>
  `;
  tr.querySelector('[data-quitar-item-oc]').addEventListener('click', () => tr.remove());
  document.getElementById('oc_itemsBody')?.appendChild(tr);
}

function recolectarItemsOC() {
  const filas = [...(document.getElementById('oc_itemsBody')?.querySelectorAll('tr') || [])];
  return filas
    .map((fila) => ({
      ficha_id: fila.querySelector('[data-campo="ficha_id"]').value,
      cantidad_pedida: fila.querySelector('[data-campo="cantidad_pedida"]').value
    }))
    .filter((it) => it.ficha_id && it.cantidad_pedida);
}

function resetFormOC() {
  form?.reset();
  setFechaHoy();
  const itemsBody = document.getElementById('oc_itemsBody');
  if (itemsBody) itemsBody.innerHTML = '';
  agregarFilaItemOC();
}

// =====================
// CARGAR CLIENTES
// =====================
async function cargarClientesSelect() {
  const select = document.getElementById('cliente_id');
  if (!select) return;

  try {
    setFechaHoy();

    const clientes = await apiFetch('/api/clientes');
    select.innerHTML = '<option value="">-- Seleccionar Cliente --</option>';
    const filtroPend = document.getElementById('pendCliente');

    clientes.forEach((cliente) => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
      // El mismo listado alimenta el filtro de "Pendientes por cliente".
      filtroPend?.appendChild(option.cloneNode(true));
    });
  } catch (err) {
    console.error('Error cargando clientes:', err);
    mostrarNotificacion('Error al cargar clientes', 'error');
  }
}

// =====================
// CREAR OC
// =====================
// Sin esta guarda, un doble click en "Crear orden" (o una conexión lenta que
// hace tentador clickear de nuevo) mandaba dos POST idénticos y quedaban dos
// OC iguales: no hay UNIQUE en ordenes_compra.numero_oc que lo evite (hallazgo
// 27/09/2026). Mismo patrón que btnRegistrarEntrega en oc_detalle.js.
let ocEnviando = false;

async function handleSubmitOC(e) {
  e.preventDefault();
  if (ocEnviando) return;

  const clienteId = Number.parseInt(document.getElementById('cliente_id')?.value, 10);
  const numeroOc = (document.getElementById('numero_oc')?.value || '').trim();
  const fechaOc = document.getElementById('fecha_oc')?.value;
  const items = recolectarItemsOC();

  const data = {
    cliente_id: clienteId,
    numero_oc: numeroOc,
    fecha_oc: fechaOc,
    items
  };

  if (!data.cliente_id || !data.numero_oc || !data.fecha_oc) {
    mostrarNotificacion('Complete todos los campos obligatorios', 'warning');
    return;
  }
  if (!items.length) {
    mostrarNotificacion('Agregá al menos un ítem con modelo y cantidad', 'warning');
    return;
  }

  ocEnviando = true;
  const btn = form.querySelector('button[type="submit"]');
  const textoBoton = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Creando…'; }

  try {
    const oc = await apiFetch('/api/ordenes-compra', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    mostrarNotificacion('OC creada correctamente', 'success');
    // Antes quedabas en esta lista y había que ubicar la fila recién creada
    // y clickear "Ver" para poder cargar los items — ahora ya se cargaron
    // acá arriba, así que se navega directo al detalle para seguir con
    // entregas/remitos/facturación.
    window.location.href = `oc_detalle.html?id=${oc.id}`;
  } catch (err) {
    console.error('Error creando OC:', err);
    mostrarNotificacion(err.error || err.message || 'Error al crear OC', 'error');
    ocEnviando = false;
    if (btn) { btn.disabled = false; btn.textContent = textoBoton; }
  }
}

// =====================
// LISTAR OCS
// =====================
// Se guarda la lista cruda tal como la trae el servidor (ya ordenada por
// oc.id DESC, orden real de alta) y el buscador filtra acá, en el cliente,
// sin volver a pedir nada — mismo patrón que las pestañas de
// Remitos/Órdenes en correcciones.js (contiene() + pintar...()).
let ocsCache = [];

// Una OC cerrada o anulada ya no espera entregas: no se muestran pendientes.
function modelosPendientesOC(oc) {
  return oc.estado === 'cerrada' || oc.estado === 'anulada' ? [] : (oc.modelos_pendientes || []);
}

function contieneOC(oc, texto) {
  const campos = [oc.numero_oc, oc.cliente, ...(oc.remitos || []),
    ...modelosPendientesOC(oc).map((m) => m.modelo)];
  return campos.join(' ').toLowerCase().includes(texto.toLowerCase());
}

function celdaPendiente(oc) {
  const modelos = modelosPendientesOC(oc);
  if (!modelos.length) return '<span class="muted">Nada pendiente</span>';
  return modelos
    .map((m) => `${escOC(m.modelo)} <strong>×${numOC(m.pendiente)}</strong>`)
    .join('<br>');
}

function pintarOC() {
  if (!lista) return;

  const texto = document.getElementById('filtroOC')?.value.trim() || '';
  const ocs = texto ? ocsCache.filter((oc) => contieneOC(oc, texto)) : ocsCache;

  if (!ocsCache.length) {
    lista.innerHTML = `<tr><td colspan="7">${Shell.vacio(
      'Todavía no hay órdenes de compra',
      'Creá la primera con el botón "Nueva orden".')}</td></tr>`;
    return;
  }

  if (!ocs.length) {
    lista.innerHTML = `<tr><td colspan="7">${Shell.vacio(
      'No hay resultados', 'Probá con otra búsqueda.')}</td></tr>`;
    return;
  }

  lista.innerHTML = ocs.map((oc) => {
    const remitos = oc.remitos || [];
    const celdaRemitos = remitos.length
      ? `<a href="oc_detalle.html?id=${oc.id}&tab=facturas">${remitos.join(', ')}</a>`
      : '<span class="muted">Sin entregas</span>';
    return `
      <tr>
        <td><strong>${oc.numero_oc}</strong></td>
        <td data-label="Cliente">${oc.cliente || '—'}</td>
        <td class="muted solo-escritorio" data-label="Fecha">${Shell.fecha(oc.fecha_oc)}</td>
        <td data-label="Estado">${Shell.pill(oc.estado || 'pendiente')}</td>
        <td data-label="Pendiente de entregar">${celdaPendiente(oc)}</td>
        <td data-label="Remitos">${celdaRemitos}</td>
        <td class="num">
          ${modelosPendientesOC(oc).length
            ? `<a class="b b-primary b-sm" href="ventas.html?nueva=1&cliente=${Number(oc.cliente_id)}&oc=${Number(oc.id)}">Entregar</a>`
            : ''}
          <button class="b b-ghost b-sm" onclick="verOC(${oc.id})">Ver</button>
        </td>
      </tr>`;
  }).join('');
}

async function cargarOC() {
  if (!lista) return;

  lista.innerHTML = '<tr><td colspan="7" class="muted">Cargando…</td></tr>';

  try {
    ocsCache = await apiFetch('/api/ordenes-compra');
    pintarOC();
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar las órdenes de compra');
    lista.innerHTML = `<tr><td colspan="7">${Shell.vacio(
      'No se pudo cargar', 'Probá recargar la página.')}</td></tr>`;
  }
}

// =====================
// PENDIENTES POR CLIENTE (18/11/2026)
// =====================
// Lo pedido y no entregado de las OC vigentes, sumado por modelo, con el
// desglose por OC. Lo arma el servidor (services/oc-pendientes.js); acá solo
// se pinta. El mismo filtro de cliente se usa para el PDF.
function escOC(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const numOC = (v) => Number(v || 0).toLocaleString('es-AR');
let pendTodoAbierto = false;

function pintarPendientes(clientes) {
  const cont = document.getElementById('pendResultado');
  if (!clientes.length) {
    cont.innerHTML = Shell.vacio('No hay entregas pendientes',
      'No hay órdenes de compra vigentes con modelos sin entregar.');
    return;
  }

  cont.innerHTML = clientes.map((cli) => `
    <div class="panel" style="margin-bottom:var(--space-4)">
      <div class="panel-head">
        <h2>${escOC(cli.cliente)}</h2>
        <span class="muted">${numOC(cli.total_pendiente)} unidades pendientes · ${cli.modelos.length} modelo${cli.modelos.length === 1 ? '' : 's'}</span>
        <a class="b b-primary b-sm" href="ventas.html?nueva=1&cliente=${Number(cli.cliente_id)}">Entregar</a>
      </div>
      <div class="panel-body flush"><div class="table-wrap">
        <table class="t">
          <thead><tr>
            <th>Modelo</th>
            <th class="num">Pedido</th>
            <th class="num">Entregado</th>
            <th class="num">Pendiente</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${cli.modelos.map((m) => `
              <tr>
                <td><strong>${escOC(m.modelo)}</strong>
                  <span class="muted"> · ${m.ordenes.length} OC</span></td>
                <td class="num" data-label="Pedido">${numOC(m.pedido)}</td>
                <td class="num" data-label="Entregado">${numOC(m.entregado)}</td>
                <td class="num" data-label="Pendiente"><strong>${numOC(m.pendiente)}</strong></td>
                <td class="num"><button type="button" class="b b-ghost b-sm" data-desglose>Ver OC</button></td>
              </tr>
              ${m.ordenes.map((o) => `
                <tr class="pend-oc" hidden>
                  <td class="muted" style="padding-left:var(--space-5)">↳
                    <a href="oc_detalle.html?id=${o.oc_id}">OC ${escOC(o.numero_oc)}</a>
                    · ${Shell.fecha(o.fecha_oc)}</td>
                  <td class="num muted">${numOC(o.pedido)}</td>
                  <td class="num muted">${numOC(o.entregado)}</td>
                  <td class="num">${numOC(o.pendiente)}</td>
                  <td></td>
                </tr>`).join('')}
            `).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="3"><strong>Total pendiente</strong></td>
            <td class="num"><strong>${numOC(cli.total_pendiente)}</strong></td>
            <td></td>
          </tr></tfoot>
        </table>
      </div></div>
    </div>`).join('');

  // "Ver OC" abre/cierra las filas de desglose que siguen a ese modelo.
  cont.querySelectorAll('[data-desglose]').forEach((btn) => {
    btn.addEventListener('click', () => {
      let fila = btn.closest('tr').nextElementSibling;
      const abrir = fila && fila.hidden;
      while (fila && fila.classList.contains('pend-oc')) {
        fila.hidden = !abrir;
        fila = fila.nextElementSibling;
      }
      btn.textContent = abrir ? 'Ocultar OC' : 'Ver OC';
    });
  });
  pendTodoAbierto = false;
  document.getElementById('btnPendToggle').textContent = 'Expandir todo';
}

async function cargarPendientes() {
  const cont = document.getElementById('pendResultado');
  const clienteId = document.getElementById('pendCliente').value;
  cont.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    const qs = clienteId ? `?cliente_id=${encodeURIComponent(clienteId)}` : '';
    pintarPendientes(await apiFetch('/api/ordenes-compra/pendientes' + qs));
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los pendientes');
    cont.innerHTML = Shell.vacio('No se pudo cargar', 'Probá recargar la página.');
  }
}

function alternarDesgloseTodo() {
  pendTodoAbierto = !pendTodoAbierto;
  document.querySelectorAll('#pendResultado .pend-oc').forEach((f) => { f.hidden = !pendTodoAbierto; });
  document.querySelectorAll('#pendResultado [data-desglose]').forEach((b) => {
    b.textContent = pendTodoAbierto ? 'Ocultar OC' : 'Ver OC';
  });
  document.getElementById('btnPendToggle').textContent = pendTodoAbierto ? 'Contraer todo' : 'Expandir todo';
}

let pdfPendEnCurso = false;
async function descargarPdfPendientes() {
  if (pdfPendEnCurso) return;
  pdfPendEnCurso = true;
  const btn = document.getElementById('btnPendPdf');
  btn.disabled = true;
  try {
    const clienteId = document.getElementById('pendCliente').value;
    const qs = clienteId ? `?cliente_id=${encodeURIComponent(clienteId)}` : '';
    const hoy = new Date().toISOString().slice(0, 10);
    await descargarArchivoProtegido('/api/ordenes-compra/pendientes/pdf' + qs, `Pendientes-${hoy}.pdf`);
  } catch (err) {
    Shell.error(err, 'No se pudo descargar el PDF');
  } finally {
    pdfPendEnCurso = false;
    btn.disabled = false;
  }
}

document.querySelectorAll('.tabs .tab').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-content').forEach((c) => {
      c.classList.toggle('active', c.id === 'tab-' + b.dataset.tab);
    });
    // Siempre se vuelve a pedir al abrir la solapa: lo pendiente cambia con cada entrega.
    if (b.dataset.tab === 'pendientes') cargarPendientes();
  });
});
document.getElementById('pendCliente')?.addEventListener('change', cargarPendientes);
document.getElementById('btnPendToggle')?.addEventListener('click', alternarDesgloseTodo);
document.getElementById('btnPendPdf')?.addEventListener('click', descargarPdfPendientes);

// =====================
// VER OC
// =====================
function verOC(id) {
  window.location.href = `oc_detalle.html?id=${id}`;
}

// =====================
// NOTIFICACIONES
// =====================
// Antes esta pantalla armaba su propio div flotante. Ahora usa el toast del
// shell, igual que el resto del sistema (oc_detalle.js incluido).
function mostrarNotificacion(mensaje, tipo = 'info') {
  const mapaTipo = { success: 'ok', error: 'err', warning: 'warn' };
  Shell.toast(mapaTipo[tipo] || 'ok', mensaje);
}

// =====================
// INIT
// =====================
if (form) {
  form.addEventListener('submit', handleSubmitOC);
}
document.getElementById('btnAgregarItemOC')?.addEventListener('click', agregarFilaItemOC);
document.getElementById('filtroOC')?.addEventListener('input', pintarOC);

cargarClientesSelect();
cargarFichasParaOC().then(resetFormOC);
cargarOC();

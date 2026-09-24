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

    clientes.forEach((cliente) => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Error cargando clientes:', err);
    mostrarNotificacion('Error al cargar clientes', 'error');
  }
}

// =====================
// CREAR OC
// =====================
async function handleSubmitOC(e) {
  e.preventDefault();

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

function contieneOC(oc, texto) {
  const campos = [oc.numero_oc, oc.cliente, ...(oc.remitos || [])];
  return campos.join(' ').toLowerCase().includes(texto.toLowerCase());
}

function pintarOC() {
  if (!lista) return;

  const texto = document.getElementById('filtroOC')?.value.trim() || '';
  const ocs = texto ? ocsCache.filter((oc) => contieneOC(oc, texto)) : ocsCache;

  if (!ocsCache.length) {
    lista.innerHTML = `<tr><td colspan="6">${Shell.vacio(
      'Todavía no hay órdenes de compra',
      'Creá la primera con el botón "Nueva orden".')}</td></tr>`;
    return;
  }

  if (!ocs.length) {
    lista.innerHTML = `<tr><td colspan="6">${Shell.vacio(
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
        <td data-label="Remitos">${celdaRemitos}</td>
        <td class="num">
          <button class="b b-ghost b-sm" onclick="verOC(${oc.id})">Ver</button>
        </td>
      </tr>`;
  }).join('');
}

async function cargarOC() {
  if (!lista) return;

  lista.innerHTML = '<tr><td colspan="6" class="muted">Cargando…</td></tr>';

  try {
    ocsCache = await apiFetch('/api/ordenes-compra');
    pintarOC();
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar las órdenes de compra');
    lista.innerHTML = `<tr><td colspan="6">${Shell.vacio(
      'No se pudo cargar', 'Probá recargar la página.')}</td></tr>`;
  }
}

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

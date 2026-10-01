// =====================
// VERIFICAR AUTENTICACION
// =====================
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

if (!usuario) {
  throw new Error('No autenticado');
}

// =====================
// VARIABLES GLOBALES
// =====================
let ocId = null;
// Items de la OC tal como los devolvió /detalle, por id (para las ventanas
// de editar/eliminar).
let itemsDetalle = new Map();
let itemSeleccionado = null;

// =====================
// NOTIFICACIONES
// =====================
// Antes esta pantalla armaba su propio div flotante. Ahora usa el toast del
// shell, igual que el resto del sistema.
function mostrarNotificacion(mensaje, tipo = 'info') {
  Shell.toast(tipo === 'error' ? 'err' : 'ok', mensaje);
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('es-AR');
}

// =====================
// CARGAR FICHAS SELECT
// =====================
async function cargarFichasSelect() {
  try {
    const fichas = await apiFetch('/api/ficha-transformador');
    const select = document.getElementById('ficha_id');
    if (!select) return;

    select.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Seleccionar Modelo --';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    select.appendChild(defaultOption);

    fichas.forEach((ficha) => {
      const option = document.createElement('option');
      option.value = ficha.id;
      option.textContent = `${ficha.modelo} (${ficha.voltaje_entrada || '-'}V / ${ficha.voltaje_salida || '-'}V)`;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Error cargando fichas:', err);
    mostrarNotificacion('Error cargando modelos', 'error');
  }
}

// =====================
// CARGAR RESUMEN
// =====================
async function cargarResumen() {
  try {
    const data = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/resumen`);

    const titulo = document.getElementById('oc-titulo');
    if (titulo) {
      titulo.textContent = `${data.numero_oc || '—'} · ${data.cliente || '—'}`;
    }

    const resumen = document.getElementById('resumen');
    if (!resumen) return;

    const saldoPositivo = Number(data.saldo) > 0;

    // Antes era una lista de 6 filas "etiqueta: valor" apiladas. Ahora son
    // KPIs, el mismo componente que usa el resto del sistema.
    resumen.innerHTML = `
      <div class="kpi">
        <div class="kpi-k">Estado</div>
        <div class="kpi-v" style="font-size:1.1rem">${Shell.pill(data.estado || 'pendiente')}</div>
      </div>
      <div class="kpi">
        <div class="kpi-k">Total facturado</div>
        <div class="kpi-v">${Shell.money(data.total_facturado)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-k">Total cobrado</div>
        <div class="kpi-v">${Shell.money(data.total_cobrado)}</div>
      </div>
      <div class="kpi ${saldoPositivo ? 'is-warning' : 'is-success'}">
        <div class="kpi-k">Saldo</div>
        <div class="kpi-v">${Shell.money(data.saldo)}</div>
      </div>
    `;
  } catch (err) {
    console.error('Error cargando resumen:', err);
  }
}

// =====================
// CARGAR DETALLE (alimenta la tabla "Detalle e items" y la de "Registrar
// entrega" con un solo fetch: antes cada pestaña pedía por separado el
// mismo /detalle, que ya trae todo lo que necesitan las dos)
// =====================
async function cargarDetalle() {
  try {
    const items = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/detalle`);
    itemsDetalle = new Map(items.map((item) => [String(item.id), item]));

    const tbody = document.getElementById('detalle');
    if (tbody) {
      tbody.innerHTML = '';
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
          'Esta orden no tiene items',
          'Agregá el primero con el formulario de arriba.')}</td></tr>`;
      } else {
        items.forEach((item) => {
          const tr = document.createElement('tr');
          const pendienteClass = Number(item.pendiente) > 0 ? 'neg' : 'pos';
          const entregado = Number(item.cantidad_entregada) > 0;
          tr.innerHTML = `
            <td><strong>${item.modelo}</strong></td>
            <td class="num" data-label="Pedido">${item.cantidad_pedida}</td>
            <td class="num muted" data-label="Entregado">${item.cantidad_entregada}</td>
            <td class="num ${pendienteClass}" data-label="Pendiente"><strong>${item.pendiente}</strong></td>
            <td class="num" data-label="Acciones">
              <button type="button" class="b b-ghost b-sm" data-editar-item="${item.id}">Editar</button>
              <button type="button" class="b b-ghost b-sm" data-eliminar-item="${item.id}"
                ${entregado ? 'disabled title="Ya tiene entregas: solo se puede bajar la cantidad hasta lo entregado"' : ''}>Eliminar</button>
            </td>
          `;
          tbody.appendChild(tr);
        });
      }
    }

    pintarEntregaItems(items);
  } catch (err) {
    console.error('Error cargando detalle:', err);
  }
}

// =====================
// EDITAR / ELIMINAR ITEM DE LA OC
// =====================
function abrirEditarItem(itemId) {
  const item = itemsDetalle.get(String(itemId));
  if (!item) return;
  itemSeleccionado = item;

  const entregado = Number(item.cantidad_entregada) || 0;
  const input = document.getElementById('editar_cantidad');
  input.value = item.cantidad_pedida;
  input.min = Math.max(1, entregado);
  document.getElementById('editarItemTexto').textContent = entregado > 0
    ? `${item.modelo} — ya se entregaron ${entregado}: la cantidad no puede ser menor.`
    : item.modelo;

  document.getElementById('editarItemModal').showModal();
}

async function guardarItem() {
  if (!itemSeleccionado) return;
  const cantidad = Number.parseInt(document.getElementById('editar_cantidad').value, 10);
  const entregado = Number(itemSeleccionado.cantidad_entregada) || 0;

  if (!cantidad || cantidad <= 0) {
    mostrarNotificacion('Ingresá una cantidad válida', 'warning');
    return;
  }
  if (cantidad < entregado) {
    mostrarNotificacion(`Ya se entregaron ${entregado}: la cantidad no puede ser menor`, 'error');
    return;
  }

  try {
    await apiFetch(`/api/ordenes-compra/${ocId}/items/${itemSeleccionado.id}`, {
      method: 'PUT',
      body: JSON.stringify({ cantidad_pedida: cantidad })
    });
    document.getElementById('editarItemModal').close();
    itemSeleccionado = null;
    mostrarNotificacion('Item actualizado', 'success');
    await Promise.all([cargarDetalle(), cargarResumen()]);
  } catch (err) {
    console.error('Error actualizando item:', err);
    mostrarNotificacion(err.error || err.message || 'Error al actualizar el item', 'error');
  }
}

function abrirEliminarItem(itemId) {
  const item = itemsDetalle.get(String(itemId));
  if (!item) return;
  itemSeleccionado = item;
  document.getElementById('eliminarItemTexto').textContent =
    `¿Eliminar ${item.modelo} (${item.cantidad_pedida} u.) de esta orden?`;
  document.getElementById('eliminarItemModal').showModal();
}

async function eliminarItem() {
  if (!itemSeleccionado) return;
  try {
    await apiFetch(`/api/ordenes-compra/${ocId}/items/${itemSeleccionado.id}`, {
      method: 'DELETE'
    });
    document.getElementById('eliminarItemModal').close();
    itemSeleccionado = null;
    mostrarNotificacion('Item eliminado', 'success');
    await Promise.all([cargarDetalle(), cargarResumen()]);
  } catch (err) {
    console.error('Error eliminando item:', err);
    mostrarNotificacion(err.error || err.message || 'Error al eliminar el item', 'error');
  }
}

// =====================
// PINTAR ITEMS PARA ENTREGA (a partir de los items que ya trajo cargarDetalle)
// =====================
function pintarEntregaItems(items) {
  const tbody = document.getElementById('entregaItems');
  if (!tbody) return;

  tbody.innerHTML = '';
  const pendientes = items.filter((item) => Number(item.pendiente) > 0);

  if (!pendientes.length) {
    tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
      'No hay nada pendiente de entrega',
      'Todos los items de esta orden ya se entregaron.')}</td></tr>`;
    return;
  }

  pendientes.forEach((item) => {
    const stockDisponible = Number(item.stock_disponible) || 0;
    const maxEntrega = Math.max(0, Math.min(Number(item.pendiente), stockDisponible));
    const sinStock = maxEntrega <= 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${item.modelo}</strong></td>
      <td class="num" data-label="Pendiente">${item.pendiente}</td>
      <td class="num muted" data-label="Stock disponible">${stockDisponible}</td>
      <td data-label="Entregar ahora">
        <input
          type="number"
          min="1"
          max="${maxEntrega}"
          value="${maxEntrega || ''}"
          data-ficha-id="${item.ficha_id}"
          class="entrega-cantidad input"
          placeholder="Cantidad"
          ${sinStock ? 'disabled' : ''}
        />
        ${sinStock ? `<small class="muted">Sin stock producido todavía —
          <a href="produccion.html?ficha_id=${item.ficha_id}" target="_blank" rel="noopener">registrar producción</a></small>` : ''}
      </td>
      <td data-label="Incluir">
        <label class="check">
          <input type="checkbox" class="entrega-check" data-ficha-id="${item.ficha_id}" ${sinStock ? 'disabled' : 'checked'}><span></span>
        </label>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// =====================
// CARGAR FACTURAS CON DETALLE DE ITEMS
// =====================
async function cargarFacturas() {
  try {
    const facturas = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/facturas`);
    const tbody = document.getElementById('facturas');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!facturas.length) {
      tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
        'Todavía no hay facturas',
        'Van a aparecer acá cuando factures los remitos de esta orden.')}</td></tr>`;
      return;
    }

    // Una fila por factura (puede agrupar varios remitos) y debajo sus
    // renglones por modelo, al precio facturado.
    facturas.forEach((factura) => {
      // Una factura anulada se ve como tal y no ofrece más acciones; una
      // vigente enlaza a Correcciones, donde se anula con confirmación.
      const anulada = String(factura.estado || '').toUpperCase() === 'ANULADA';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="5" class="muted" style="background:var(--gray-50,#f8fafc)">
          <strong class="${anulada ? 'tachado' : ''}">Factura ${factura.tipo_factura || ''} ${factura.numero_factura || '—'}</strong>
          ${anulada ? Shell.pill('ANULADA') : ''}
          · ${Shell.fecha(factura.fecha_factura)}
          · Remitos: ${factura.remitos || '—'}
          · Total ${Shell.money(factura.total_factura)} (con IVA)
          · <a href="#" onclick="verFacturaPdf(${factura.factura_id}); return false;">PDF</a>
          ${anulada ? '' : `· Cobrado ${Shell.money(factura.total_cobrado)}
          · <a href="correcciones.html?factura=${encodeURIComponent(factura.factura_id)}">Anular…</a>`}
        </td>
      `;
      tbody.appendChild(tr);

      if (anulada) return;

      if (factura.items && factura.items.length) {
        factura.items.forEach((item) => {
          const itemRow = document.createElement('tr');
          itemRow.innerHTML = `
            <td>${item.modelo}</td>
            <td class="num" data-label="Cantidad">${item.cantidad}</td>
            <td class="num muted solo-escritorio" data-label="Precio unitario">${Shell.money(item.precio_unitario)}</td>
            <td class="num" data-label="Subtotal">${Shell.money(item.subtotal)}</td>
            <td></td>
          `;
          tbody.appendChild(itemRow);
        });
      } else {
        const emptyRow = document.createElement('tr');
        emptyRow.innerHTML = '<td colspan="5" class="muted">Sin items</td>';
        tbody.appendChild(emptyRow);
      }
    });
  } catch (err) {
    console.error('Error cargando facturas:', err);
  }
}

async function verFacturaPdf(facturaId) {
  try {
    await verArchivoProtegido(`api/facturas/${facturaId}/pdf`);
  } catch (err) {
    mostrarNotificacion(err.error || err.message || 'No se pudo abrir el PDF', 'error');
  }
}

async function verRemitoPdf(ventaId) {
  try {
    await verArchivoProtegido(`api/ventas/${ventaId}/pdf`);
  } catch (err) {
    mostrarNotificacion(err.error || err.message || 'No se pudo abrir el PDF', 'error');
  }
}

// =====================
// FACTURAR REMITOS (UNA FACTURA PARA VARIOS REMITOS)
// =====================
// Remitos pendientes de facturar de esta OC (para el contador y el botón).
let pendienteFacturar = null;

async function cargarPendienteFacturar() {
  const texto = document.getElementById('pendienteFacturarTexto');
  const boton = document.getElementById('btnFacturarRemitos');
  try {
    pendienteFacturar = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/pendiente-facturar`);
    const remitos = pendienteFacturar.remitos || [];
    if (boton) boton.disabled = !remitos.length;
    if (texto) {
      // El detalle remito por remito ya se ve al abrir el wizard (paso 1);
      // acá alcanza con la cantidad para no repetir una oración larga.
      texto.textContent = remitos.length
        ? `${remitos.length} remito(s) pendientes de facturar.`
        : 'No hay remitos pendientes de facturar.';
    }
  } catch (err) {
    console.error('Error cargando pendiente de facturar:', err);
    if (texto) texto.textContent = 'No se pudo cargar lo pendiente de facturar.';
  }
}

function abrirFacturarRemitos() {
  FacturarWizard.abrir({
    ocId,
    onListo: () => Promise.all([cargarResumen(), cargarFacturas(), cargarRemitos(), cargarPendienteFacturar()])
  });
}

// =====================
// CARGAR REMITOS ASOCIADOS
// =====================
async function cargarRemitos() {
  try {
    const ventas = await apiFetch(`/api/ventas?orden_compra_id=${ocId}`);
    const tbody = document.getElementById('remitosList');
    if (!tbody) return;

    tbody.innerHTML = '';

    const ventasConRemito = (ventas || []).filter((v) => v.remito_numero);
    if (!ventasConRemito.length) {
      tbody.innerHTML = `<tr><td colspan="7">${Shell.vacio(
        'Todavía no hay remitos',
        'Se registran al entregar items en la pestaña "Registrar entrega".')}</td></tr>`;
      return;
    }

    ventasConRemito.forEach((venta) => {
      const items = venta.items || [];
      const tr = document.createElement('tr');
      const itemsHtml = items.length
        ? items.map((item) => `${item.cantidad} x ${item.modelo}`).join('<br>')
        : '—';

      tr.innerHTML = `
        <td><strong>${venta.remito_numero}</strong></td>
        <td data-label="Fecha">${Shell.fecha(venta.remito_fecha)}</td>
        <td class="muted solo-escritorio" data-label="Venta">#${venta.id}</td>
        <td data-label="Ítems">${itemsHtml}</td>
        <td data-label="Factura">${venta.numero_factura
          ? `<strong>${venta.numero_factura}</strong>`
          : Shell.pill('PENDIENTE')}</td>
        <td class="muted solo-escritorio" data-label="Observaciones">${venta.remito_observaciones || '—'}</td>
        <td><button type="button" class="b b-ghost b-sm" onclick="verRemitoPdf(${venta.id})">PDF</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando remitos:', err);
  }
}

// Cotización del día, para precargar el campo de "Registrar entrega" apenas
// se abre la pantalla (antes recién se pedía al final, en un modal aparte,
// después de completar remito y cantidades).
async function cargarCotizacionEntrega() {
  const input = document.getElementById('entrega_cotizacion');
  const texto = document.getElementById('entregaDolarActual');
  if (!input) return;
  try {
    const dolarData = await apiFetch('/api/precios/parametros/dolar');
    const dolarActual = Number(dolarData.dolar || 0);
    input.value = dolarActual ? dolarActual.toFixed(2) : '';
    if (texto) {
      texto.textContent = dolarActual
        ? `Cargada hoy en Precios: ARS ${dolarActual.toFixed(2)}`
        : 'No hay cotización cargada en Precios';
    }
  } catch (err) {
    console.error('Error cargando cotización:', err);
    if (texto) texto.textContent = 'No se pudo cargar la cotización actual';
  }
}

let entregaEnviando = false;

async function registrarEntrega() {
  if (entregaEnviando) return;

  const remitoNumero = document.getElementById('remito_numero')?.value?.trim();
  const remitoFecha = document.getElementById('remito_fecha')?.value;
  const remitoObservaciones = document.getElementById('remito_observaciones')?.value?.trim() || null;
  const tipoCambio = Number(document.getElementById('entrega_cotizacion')?.value);

  if (!remitoNumero) {
    mostrarNotificacion('El número de remito es obligatorio', 'warning');
    return;
  }

  if (!remitoFecha) {
    mostrarNotificacion('La fecha del remito es obligatoria', 'warning');
    return;
  }

  if (!tipoCambio || Number.isNaN(tipoCambio) || tipoCambio <= 0) {
    mostrarNotificacion('Ingresá la cotización del dólar', 'warning');
    return;
  }

  const checkboxes = document.querySelectorAll('.entrega-check:checked');
  if (!checkboxes.length) {
    mostrarNotificacion('Seleccione al menos un modelo para entregar', 'warning');
    return;
  }

  const itemsEntrega = [];
  for (const checkbox of checkboxes) {
    const fichaId = checkbox.dataset.fichaId;
    const inputCantidad = document.querySelector(`.entrega-cantidad[data-ficha-id="${fichaId}"]`);
    const cantidad = Number.parseInt(inputCantidad?.value, 10);
    const maxDisponible = Number.parseInt(inputCantidad?.max, 10);

    if (!cantidad || cantidad <= 0) {
      mostrarNotificacion('Ingrese cantidad válida para todos los items seleccionados', 'warning');
      return;
    }

    if (Number.isFinite(maxDisponible) && cantidad > maxDisponible) {
      mostrarNotificacion(
        `No hay suficiente stock: pidió ${cantidad} pero solo hay ${maxDisponible} disponibles`,
        'warning'
      );
      return;
    }

    itemsEntrega.push({
      ficha_id: Number.parseInt(fichaId, 10),
      cantidad
    });
  }

  entregaEnviando = true;
  const btn = document.getElementById('btnRegistrarEntrega');
  const textoBoton = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }

  try {
    // La venta y sus items se crean juntos, en una sola transacción del
    // backend: si algún item falla (por ejemplo stock insuficiente) no
    // queda un remito a medio registrar.
    const venta = await apiFetch('/api/ventas', {
      method: 'POST',
      body: JSON.stringify({
        orden_compra_id: Number.parseInt(ocId, 10),
        tipo_cambio: tipoCambio,
        remito_numero: remitoNumero,
        remito_fecha: remitoFecha,
        remito_observaciones: remitoObservaciones,
        items: itemsEntrega
      })
    });

    mostrarNotificacion(
      `Entrega registrada correctamente | Remito: ${remitoNumero} | Dólar: ARS ${tipoCambio.toFixed(2)} | Venta N°: ${venta.id}`,
      'success'
    );

    const remitoNumeroInput = document.getElementById('remito_numero');
    const remitoObsInput = document.getElementById('remito_observaciones');
    if (remitoNumeroInput) remitoNumeroInput.value = '';
    if (remitoObsInput) remitoObsInput.value = '';
    // La cotización queda como está: suele registrarse más de un remito
    // seguido al mismo tipo de cambio, así que no tiene sentido borrarla.

    await Promise.all([
      cargarDetalle(),
      cargarResumen(),
      cargarFacturas(),
      cargarRemitos(),
      cargarPendienteFacturar()
    ]);
  } catch (err) {
    console.error('Error registrando entrega:', err);
    mostrarNotificacion(err.error || err.message || 'Error al registrar entrega', 'error');
  } finally {
    entregaEnviando = false;
    if (btn) { btn.disabled = false; btn.textContent = textoBoton; }
  }
}

function inicializarEventos() {
  const itemForm = document.getElementById('itemForm');
  const btnRegistrarEntrega = document.getElementById('btnRegistrarEntrega');
  const btnVolver = document.getElementById('btnVolver');
  const remitoFecha = document.getElementById('remito_fecha');

  if (remitoFecha) {
    remitoFecha.value = new Date().toISOString().split('T')[0];
  }

  if (itemForm) {
    itemForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const fichaId = document.getElementById('ficha_id')?.value;
      const cantidad = Number.parseInt(document.getElementById('cantidad_pedida')?.value, 10);

      if (!fichaId || !cantidad || cantidad <= 0) {
        mostrarNotificacion('Seleccione un modelo y cantidad válida', 'warning');
        return;
      }

      try {
        await apiFetch(`/api/ordenes-compra/${ocId}/items`, {
          method: 'POST',
          body: JSON.stringify({
            ficha_id: Number.parseInt(fichaId, 10),
            cantidad_pedida: cantidad
          })
        });

        itemForm.reset();
        mostrarNotificacion('Item agregado correctamente', 'success');
        await cargarDetalle();
      } catch (err) {
        console.error('Error agregando item:', err);
        mostrarNotificacion(err.error || err.message || 'Error al agregar item', 'error');
      }
    });
  }

  if (btnRegistrarEntrega) {
    btnRegistrarEntrega.addEventListener('click', registrarEntrega);
  }

  // Editar / eliminar items de la OC (botones que arma cargarDetalle)
  document.getElementById('detalle')?.addEventListener('click', (e) => {
    const editar = e.target.closest('[data-editar-item]');
    const eliminar = e.target.closest('[data-eliminar-item]');
    if (editar) abrirEditarItem(editar.dataset.editarItem);
    if (eliminar && !eliminar.disabled) abrirEliminarItem(eliminar.dataset.eliminarItem);
  });
  document.getElementById('btnGuardarItem')?.addEventListener('click', guardarItem);
  document.getElementById('btnConfirmarEliminarItem')?.addEventListener('click', eliminarItem);

  // Botones "Cancelar" de los <dialog> de esta pantalla (cierran por id, sin
  // recargar nada) — mismo patrón que precios.js/stock.js/venta_detalle.js.
  document.querySelectorAll('[data-cerrar]').forEach((b) => {
    b.addEventListener('click', () => document.getElementById(b.dataset.cerrar)?.close());
  });

  // Facturar remitos: el wizard vive en facturar-wizard.js (compartido con la
  // ficha del cliente).
  document.getElementById('btnFacturarRemitos')?.addEventListener('click', abrirFacturarRemitos);

  if (btnVolver) {
    btnVolver.addEventListener('click', () => {
      window.location.href = 'oc.html';
    });
  }
}

// =====================
// INIT
// =====================
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  ocId = params.get('id');

  if (!ocId) {
    mostrarNotificacion('OC no especificada', 'error');
    setTimeout(() => {
      window.location.href = 'oc.html';
    }, 1500);
    return;
  }

  inicializarEventos();

  await Promise.all([
    cargarFichasSelect(),
    cargarResumen(),
    cargarDetalle(),
    cargarFacturas(),
    cargarRemitos(),
    cargarPendienteFacturar(),
    cargarCotizacionEntrega()
  ]);
});

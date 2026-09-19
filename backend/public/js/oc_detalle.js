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
// CARGAR DETALLE
// =====================
async function cargarDetalle() {
  try {
    const items = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/detalle`);
    const tbody = document.getElementById('detalle');
    if (!tbody) return;

    tbody.innerHTML = '';
    itemsDetalle = new Map(items.map((item) => [String(item.id), item]));

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
        'Esta orden no tiene items',
        'Agregá el primero con el formulario de arriba.')}</td></tr>`;
      return;
    }

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
    await Promise.all([cargarDetalle(), cargarEntregaItems(), cargarResumen()]);
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
    await Promise.all([cargarDetalle(), cargarEntregaItems(), cargarResumen()]);
  } catch (err) {
    console.error('Error eliminando item:', err);
    mostrarNotificacion(err.error || err.message || 'Error al eliminar el item', 'error');
  }
}

// =====================
// CARGAR ITEMS PARA ENTREGA
// =====================
async function cargarEntregaItems() {
  try {
    const items = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/detalle`);
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
          ${sinStock ? '<small class="muted">Sin stock producido todavía</small>' : ''}
        </td>
        <td data-label="Incluir">
          <label class="check">
            <input type="checkbox" class="entrega-check" data-ficha-id="${item.ficha_id}" ${sinStock ? 'disabled' : 'checked'}><span></span>
          </label>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando entrega items:', err);
  }
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
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="5" class="muted" style="background:var(--gray-50,#f8fafc)">
          <strong>Factura ${factura.tipo_factura || ''} ${factura.numero_factura || '—'}</strong>
          · ${Shell.fecha(factura.fecha_factura)}
          · Remitos: ${factura.remitos || '—'}
          · Total ${Shell.money(factura.total_factura)} (con IVA)
          · Cobrado ${Shell.money(factura.total_cobrado)}
        </td>
      `;
      tbody.appendChild(tr);

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

// =====================
// FACTURAR REMITOS (UNA FACTURA PARA VARIOS REMITOS)
// =====================
// Lo que devolvió /pendiente-facturar: remitos con items sin facturar,
// precios de lista, dólar e IVA vigentes.
let pendienteFacturar = null;
// Renglones de la factura, uno por modelo: { ficha_id, modelo, cantidad,
// precio_entrega_usd, usd, pesos, pesosManual }. Se conservan los valores
// editados al marcar/desmarcar remitos.
let renglonesFactura = new Map();

async function cargarPendienteFacturar() {
  const texto = document.getElementById('pendienteFacturarTexto');
  const boton = document.getElementById('btnFacturarRemitos');
  try {
    pendienteFacturar = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/pendiente-facturar`);
    const remitos = pendienteFacturar.remitos || [];
    if (boton) boton.disabled = !remitos.length;
    if (texto) {
      texto.textContent = remitos.length
        ? `${remitos.length} remito(s) entregado(s) sin facturar: ${remitos
            .map((r) => r.remito_numero || `venta #${r.venta_id}`).join(', ')}. Se facturan juntos en una sola factura.`
        : 'No hay remitos pendientes de facturar.';
    }
  } catch (err) {
    console.error('Error cargando pendiente de facturar:', err);
    if (texto) texto.textContent = 'No se pudo cargar lo pendiente de facturar.';
  }
}

function remitosSeleccionados() {
  const ids = [...document.querySelectorAll('.facturar-remito:checked')]
    .map((c) => Number(c.dataset.ventaId));
  return (pendienteFacturar?.remitos || []).filter((r) => ids.includes(r.venta_id));
}

function cotizacionFactura() {
  return Number(document.getElementById('facturar_cotizacion').value) || 0;
}

function redondear2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function abrirFacturarRemitos() {
  const remitos = pendienteFacturar?.remitos || [];
  if (!remitos.length) {
    mostrarNotificacion('No hay remitos pendientes de facturar', 'warning');
    return;
  }

  renglonesFactura = new Map();

  document.getElementById('facturarRemitos').innerHTML = remitos.map((r) => `
    <tr>
      <td data-label="Incluir">
        <label class="check">
          <input type="checkbox" class="facturar-remito" data-venta-id="${r.venta_id}" checked><span></span>
        </label>
      </td>
      <td><strong>${r.remito_numero || `venta #${r.venta_id}`}</strong></td>
      <td data-label="Fecha">${Shell.fecha(r.remito_fecha)}</td>
      <td data-label="Items">${r.items.map((i) => `${i.cantidad} x ${i.modelo}`).join('<br>')}</td>
    </tr>
  `).join('');

  const dolar = Number(pendienteFacturar.dolar_actual) || 0;
  document.getElementById('facturar_cotizacion').value = dolar ? dolar.toFixed(2) : '';
  document.getElementById('facturarDolarActual').textContent = dolar
    ? `Cotización cargada hoy en el sistema: ARS ${dolar.toFixed(2)}`
    : 'No hay cotización cargada en Precios';
  document.getElementById('facturarIvaLabel').textContent =
    `IVA ${Math.round((pendienteFacturar.iva || 0) * 100)}%`;
  document.getElementById('facturar_fecha').value = new Date().toISOString().split('T')[0];

  armarRenglonesFactura();
  document.getElementById('facturarModal').showModal();
}

// Arma un renglón por modelo sumando las cantidades de los remitos
// marcados. Si el renglón ya existía, conserva los precios editados.
function armarRenglonesFactura() {
  const anteriores = renglonesFactura;
  renglonesFactura = new Map();
  const cotizacion = cotizacionFactura();

  remitosSeleccionados().forEach((remito) => {
    remito.items.forEach((item) => {
      const key = String(item.ficha_id);
      let renglon = renglonesFactura.get(key);
      if (!renglon) {
        const previo = anteriores.get(key);
        const precioLista = pendienteFacturar.precios_lista?.[item.ficha_id];
        const usd = previo
          ? previo.usd
          : Number(precioLista ?? item.precio_unitario_usd) || 0;
        renglon = {
          ficha_id: item.ficha_id,
          modelo: item.modelo,
          cantidad: 0,
          precio_entrega_usd: Number(item.precio_unitario_usd) || 0,
          usd,
          pesos: previo ? previo.pesos : redondear2(usd * cotizacion),
          pesosManual: previo ? previo.pesosManual : false
        };
        renglonesFactura.set(key, renglon);
      }
      renglon.cantidad += Number(item.cantidad);
      // Si en distintos remitos se entregó a distinto precio, mostrar el más reciente.
      renglon.precio_entrega_usd = Number(item.precio_unitario_usd) || renglon.precio_entrega_usd;
    });
  });

  const tbody = document.getElementById('facturarRenglones');
  if (!renglonesFactura.size) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Marcá al menos un remito.</td></tr>';
    actualizarTotalesFactura();
    return;
  }

  tbody.innerHTML = [...renglonesFactura.values()].map((r) => `
    <tr>
      <td><strong>${r.modelo}</strong></td>
      <td class="num" data-label="Cantidad">${r.cantidad}</td>
      <td class="num muted solo-escritorio" data-label="Precio entrega">US$ ${r.precio_entrega_usd.toFixed(2)}</td>
      <td class="num" data-label="Precio USD">
        <input class="input facturar-usd" type="number" step="0.01" min="0" data-ficha-id="${r.ficha_id}"
          value="${r.usd.toFixed(2)}" style="max-width:120px">
      </td>
      <td class="num" data-label="Precio ARS s/IVA">
        <input class="input facturar-pesos" type="number" step="0.01" min="0.01" data-ficha-id="${r.ficha_id}"
          value="${r.pesos.toFixed(2)}" style="max-width:150px">
      </td>
      <td class="num" data-label="Subtotal" data-subtotal-ficha="${r.ficha_id}">${Shell.money(r.cantidad * r.pesos)}</td>
    </tr>
  `).join('');

  actualizarTotalesFactura();
}

function recalcularPesosFactura() {
  const cotizacion = cotizacionFactura();
  renglonesFactura.forEach((r) => {
    if (r.pesosManual) return;
    r.pesos = redondear2(r.usd * cotizacion);
    const input = document.querySelector(`.facturar-pesos[data-ficha-id="${r.ficha_id}"]`);
    if (input) input.value = r.pesos.toFixed(2);
  });
  actualizarTotalesFactura();
}

function actualizarTotalesFactura() {
  const iva = Number(pendienteFacturar?.iva) || 0;
  let subtotal = 0;
  let ivaTotal = 0;
  renglonesFactura.forEach((r) => {
    const sub = redondear2(r.cantidad * redondear2(r.pesos));
    subtotal += sub;
    ivaTotal += redondear2(sub * iva);
    const celda = document.querySelector(`[data-subtotal-ficha="${r.ficha_id}"]`);
    if (celda) celda.textContent = Shell.money(sub);
  });
  document.getElementById('facturarSubtotal').textContent = Shell.money(subtotal);
  document.getElementById('facturarIva').textContent = Shell.money(ivaTotal);
  document.getElementById('facturarTotal').textContent = Shell.money(subtotal + ivaTotal);
}

async function confirmarFacturaRemitos() {
  const remitos = remitosSeleccionados();
  const numero_factura = document.getElementById('facturar_numero').value.trim();
  const tipo_factura = document.getElementById('facturar_tipo').value;
  const fecha = document.getElementById('facturar_fecha').value;
  const dias_credito = Number.parseInt(document.getElementById('facturar_dias_credito').value, 10) || 0;
  const tipo_cambio = cotizacionFactura();

  if (!remitos.length) return mostrarNotificacion('Marcá al menos un remito', 'error');
  if (!numero_factura) return mostrarNotificacion('El número de factura es obligatorio', 'error');
  if (!tipo_factura) return mostrarNotificacion('El tipo de factura es obligatorio', 'error');
  if (!fecha) return mostrarNotificacion('La fecha es obligatoria', 'error');

  const precios = [...renglonesFactura.values()].map((r) => ({
    ficha_id: r.ficha_id,
    precio_unitario_usd: r.usd,
    precio_unitario_pesos: redondear2(r.pesos)
  }));
  const sinPrecio = [...renglonesFactura.values()].find((r) => !(r.pesos > 0));
  if (sinPrecio) return mostrarNotificacion(`Falta el precio de ${sinPrecio.modelo}`, 'error');

  try {
    const factura = await apiFetch('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        venta_ids: remitos.map((r) => r.venta_id),
        numero_factura,
        tipo_factura,
        fecha,
        dias_credito,
        tipo_cambio: tipo_cambio || null,
        precios
      })
    });

    document.getElementById('facturarModal').close();
    document.getElementById('facturar_numero').value = '';
    document.getElementById('facturar_tipo').value = '';
    document.getElementById('facturar_dias_credito').value = '0';
    mostrarNotificacion(
      `Factura ${factura.numero_factura} generada por ${remitos.length} remito(s)`,
      'success'
    );

    await Promise.all([cargarResumen(), cargarFacturas(), cargarRemitos(), cargarPendienteFacturar()]);
  } catch (err) {
    console.error('Error generando factura:', err);
    mostrarNotificacion(err.error || err.message || 'Error al generar la factura', 'error');
  }
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
      tbody.innerHTML = `<tr><td colspan="6">${Shell.vacio(
        'Todavía no hay remitos',
        'Se registran al entregar items en la pestaña "Registrar entrega".')}</td></tr>`;
      return;
    }

    const ventasConItems = await Promise.all(
      ventasConRemito.map(async (venta) => {
        const detalle = await apiFetch(`/api/ventas/${venta.id}`);
        return { venta, items: detalle.items || [] };
      })
    );

    ventasConItems.forEach(({ venta, items }) => {
      const tr = document.createElement('tr');
      const itemsHtml = items.length
        ? items.map((item) => `${item.cantidad} x ${item.modelo}`).join('<br>')
        : '—';

      tr.innerHTML = `
        <td><strong>${venta.remito_numero}</strong></td>
        <td data-label="Fecha">${Shell.fecha(venta.remito_fecha)}</td>
        <td class="muted solo-escritorio" data-label="Venta">#${venta.id}</td>
        <td data-label="Items">${itemsHtml}</td>
        <td data-label="Factura">${venta.numero_factura
          ? `<strong>${venta.numero_factura}</strong>`
          : Shell.pill('PENDIENTE')}</td>
        <td class="muted solo-escritorio" data-label="Observaciones">${venta.remito_observaciones || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando remitos:', err);
  }
}

// Datos de la entrega ya validados, en espera de que se confirme la
// cotización en #cotizacionModal (ver confirmarEntregaConCotizacion).
let entregaPendiente = null;

async function registrarEntrega() {
  const remitoNumero = document.getElementById('remito_numero')?.value?.trim();
  const remitoFecha = document.getElementById('remito_fecha')?.value;
  const remitoObservaciones = document.getElementById('remito_observaciones')?.value?.trim() || null;

  if (!remitoNumero) {
    mostrarNotificacion('El número de remito es obligatorio', 'warning');
    return;
  }

  if (!remitoFecha) {
    mostrarNotificacion('La fecha del remito es obligatoria', 'warning');
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

  try {
    const dolarData = await apiFetch('/api/precios/parametros/dolar');
    const dolarActual = Number(dolarData.dolar || 0);

    entregaPendiente = { remitoNumero, remitoFecha, remitoObservaciones, itemsEntrega };

    const textoActual = document.getElementById('cotizacionActualTexto');
    const inputCotizacion = document.getElementById('cotizacion_valor');
    if (textoActual) textoActual.textContent = `Cotización actual del dólar: ARS ${dolarActual.toFixed(2)}`;
    if (inputCotizacion) inputCotizacion.value = dolarActual.toFixed(2);

    document.getElementById('cotizacionModal')?.showModal();
  } catch (err) {
    console.error('Error obteniendo cotización:', err);
    mostrarNotificacion(err.error || err.message || 'Error al obtener la cotización del dólar', 'error');
  }
}

async function confirmarEntregaConCotizacion() {
  if (!entregaPendiente) return;

  const inputCotizacion = document.getElementById('cotizacion_valor');
  const tipoCambio = Number(inputCotizacion?.value);

  if (!tipoCambio || Number.isNaN(tipoCambio) || tipoCambio <= 0) {
    mostrarNotificacion('Ingrese una cotización válida', 'warning');
    return;
  }

  const { remitoNumero, remitoFecha, remitoObservaciones, itemsEntrega } = entregaPendiente;

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

    document.getElementById('cotizacionModal')?.close();
    entregaPendiente = null;

    mostrarNotificacion(
      `Entrega registrada correctamente | Remito: ${remitoNumero} | Dólar: ARS ${tipoCambio.toFixed(2)} | Venta N°: ${venta.id}`,
      'success'
    );

    const remitoNumeroInput = document.getElementById('remito_numero');
    const remitoObsInput = document.getElementById('remito_observaciones');
    if (remitoNumeroInput) remitoNumeroInput.value = '';
    if (remitoObsInput) remitoObsInput.value = '';

    await Promise.all([
      cargarDetalle(),
      cargarResumen(),
      cargarFacturas(),
      cargarEntregaItems(),
      cargarRemitos(),
      cargarPendienteFacturar()
    ]);
  } catch (err) {
    console.error('Error registrando entrega:', err);
    mostrarNotificacion(err.error || err.message || 'Error al registrar entrega', 'error');
  }
}

function inicializarEventos() {
  const itemForm = document.getElementById('itemForm');
  const btnRegistrarEntrega = document.getElementById('btnRegistrarEntrega');
  const btnConfirmarCotizacion = document.getElementById('btnConfirmarCotizacion');
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
        await Promise.all([cargarDetalle(), cargarEntregaItems()]);
      } catch (err) {
        console.error('Error agregando item:', err);
        mostrarNotificacion(err.error || err.message || 'Error al agregar item', 'error');
      }
    });
  }

  if (btnRegistrarEntrega) {
    btnRegistrarEntrega.addEventListener('click', registrarEntrega);
  }

  if (btnConfirmarCotizacion) {
    btnConfirmarCotizacion.addEventListener('click', confirmarEntregaConCotizacion);
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

  // Facturar remitos
  document.getElementById('btnFacturarRemitos')?.addEventListener('click', abrirFacturarRemitos);
  document.getElementById('btnConfirmarFactura')?.addEventListener('click', confirmarFacturaRemitos);
  document.getElementById('facturarRemitos')?.addEventListener('change', (e) => {
    if (e.target.classList.contains('facturar-remito')) armarRenglonesFactura();
  });
  document.getElementById('facturar_cotizacion')?.addEventListener('input', recalcularPesosFactura);
  document.getElementById('facturarRenglones')?.addEventListener('input', (e) => {
    const renglon = renglonesFactura.get(String(e.target.dataset.fichaId));
    if (!renglon) return;
    if (e.target.classList.contains('facturar-usd')) {
      renglon.usd = Number(e.target.value) || 0;
      // Cambiar el USD vuelve a calcular el precio en pesos del renglón.
      renglon.pesosManual = false;
      recalcularPesosFactura();
    } else if (e.target.classList.contains('facturar-pesos')) {
      renglon.pesos = Number(e.target.value) || 0;
      renglon.pesosManual = true;
      actualizarTotalesFactura();
    }
  });

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
    cargarEntregaItems(),
    cargarRemitos(),
    cargarPendienteFacturar()
  ]);
});

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
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="4">${Shell.vacio(
        'Esta orden no tiene items',
        'Agregá el primero con el formulario de arriba.')}</td></tr>`;
      return;
    }

    items.forEach((item) => {
      const tr = document.createElement('tr');
      const pendienteClass = Number(item.pendiente) > 0 ? 'neg' : 'pos';
      tr.innerHTML = `
        <td><strong>${item.modelo}</strong></td>
        <td class="num" data-label="Pedido">${item.cantidad_pedida}</td>
        <td class="num muted" data-label="Entregado">${item.cantidad_entregada}</td>
        <td class="num ${pendienteClass}" data-label="Pendiente"><strong>${item.pendiente}</strong></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando detalle:', err);
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
      tbody.innerHTML = `<tr><td colspan="4">${Shell.vacio(
        'No hay nada pendiente de entrega',
        'Todos los items de esta orden ya se entregaron.')}</td></tr>`;
      return;
    }

    pendientes.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.modelo}</strong></td>
        <td class="num" data-label="Pendiente">${item.pendiente}</td>
        <td data-label="Entregar ahora">
          <input
            type="number"
            min="1"
            max="${item.pendiente}"
            value="${item.pendiente}"
            data-ficha-id="${item.ficha_id}"
            class="entrega-cantidad input"
            placeholder="Cantidad"
          />
        </td>
        <td data-label="Incluir">
          <label class="check">
            <input type="checkbox" class="entrega-check" data-ficha-id="${item.ficha_id}" checked><span></span>
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
        'Van a aparecer acá cuando factures una venta de esta orden.')}</td></tr>`;
      return;
    }

    facturas.forEach((factura) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="5" class="muted" style="background:var(--gray-50,#f8fafc)">
          <strong>Factura ${factura.numero_factura || '—'}</strong>
          · ${Shell.fecha(factura.fecha_factura)}
          · Total ${Shell.money(factura.total_factura)}
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
      tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
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
        <td class="muted solo-escritorio" data-label="Observaciones">${venta.remito_observaciones || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando remitos:', err);
  }
}

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

  try {
    const dolarData = await apiFetch('/api/precios/parametros/dolar');
    const dolarActual = Number(dolarData.dolar || 0);

    const usarActual = confirm(
      `Cotización actual del dólar: ARS ${dolarActual.toFixed(2)}\n\n` +
      `¿Desea usar este valor?\n` +
      `• Aceptar = Usar ARS ${dolarActual.toFixed(2)}\n` +
      `• Cancelar = Ingresar otra cotización`
    );

    let tipoCambio = dolarActual;
    if (!usarActual) {
      const ingresado = prompt('Ingrese el tipo de cambio USD/ARS:', dolarActual.toFixed(2));
      if (!ingresado || Number.isNaN(Number(ingresado)) || Number(ingresado) <= 0) {
        mostrarNotificacion('Operación cancelada', 'info');
        return;
      }
      tipoCambio = Number(ingresado);
    }

    const itemsEntrega = [];
    for (const checkbox of checkboxes) {
      const fichaId = checkbox.dataset.fichaId;
      const inputCantidad = document.querySelector(`.entrega-cantidad[data-ficha-id="${fichaId}"]`);
      const cantidad = Number.parseInt(inputCantidad?.value, 10);

      if (!cantidad || cantidad <= 0) {
        mostrarNotificacion('Ingrese cantidad válida para todos los items seleccionados', 'warning');
        return;
      }

      itemsEntrega.push({
        ficha_id: Number.parseInt(fichaId, 10),
        cantidad
      });
    }

    const venta = await apiFetch('/api/ventas', {
      method: 'POST',
      body: JSON.stringify({
        orden_compra_id: Number.parseInt(ocId, 10),
        tipo_cambio: tipoCambio,
        remito_numero: remitoNumero,
        remito_fecha: remitoFecha,
        remito_observaciones: remitoObservaciones
      })
    });

    for (const item of itemsEntrega) {
      await apiFetch(`/api/ventas/${venta.id}/items`, {
        method: 'POST',
        body: JSON.stringify(item)
      });
    }

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
      cargarRemitos()
    ]);
  } catch (err) {
    console.error('Error registrando entrega:', err);
    mostrarNotificacion(err.error || err.message || 'Error al registrar entrega', 'error');
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
    cargarRemitos()
  ]);
});

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

// =====================
// VARIABLES GLOBALES
// =====================
let ocId = null;

// =====================
// NOTIFICACIONES
// =====================
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
      titulo.innerHTML = `
        <i class="fas fa-hashtag"></i> ${data.numero_oc || '-'} |
        <i class="fas fa-user"></i> ${data.cliente || '-'}
      `;
    }

    let estadoClass = 'estado-pendiente';
    let estadoIcon = 'fa-clock';
    if (data.estado === 'completa') {
      estadoClass = 'estado-completa';
      estadoIcon = 'fa-check-circle';
    } else if (data.estado === 'parcial') {
      estadoClass = 'estado-parcial';
      estadoIcon = 'fa-truck-loading';
    }

    const resumen = document.getElementById('resumen');
    if (!resumen) return;

    resumen.innerHTML = `
      <div class="resumen-item">
        <span class="resumen-label"><i class="fas fa-hashtag"></i> N° OC:</span>
        <span class="resumen-value">${data.numero_oc || '-'}</span>
      </div>
      <div class="resumen-item">
        <span class="resumen-label"><i class="fas fa-user"></i> Cliente:</span>
        <span class="resumen-value">${data.cliente || '-'}</span>
      </div>
      <div class="resumen-item">
        <span class="resumen-label"><i class="fas fa-tag"></i> Estado:</span>
        <span class="resumen-value"><span class="estado-badge ${estadoClass}"><i class="fas ${estadoIcon}"></i> ${data.estado || 'pendiente'}</span></span>
      </div>
      <div class="resumen-item">
        <span class="resumen-label"><i class="fas fa-dollar-sign"></i> Total facturado:</span>
        <span class="resumen-value">$${formatMoney(data.total_facturado)}</span>
      </div>
      <div class="resumen-item">
        <span class="resumen-label"><i class="fas fa-check-circle"></i> Total cobrado:</span>
        <span class="resumen-value">$${formatMoney(data.total_cobrado)}</span>
      </div>
      <div class="resumen-item">
        <span class="resumen-label"><i class="fas fa-clock"></i> Saldo:</span>
        <span class="resumen-value ${Number(data.saldo) > 0 ? 'text-warning' : 'text-success'}">$${formatMoney(data.saldo)}</span>
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
      tbody.innerHTML = '<tr><td colspan="4" class="empty-table"><i class="fas fa-box-open"></i> No hay items en esta orden</td></tr>';
      return;
    }

    items.forEach((item) => {
      const tr = document.createElement('tr');
      const pendienteClass = Number(item.pendiente) > 0 ? 'text-warning' : 'text-success';
      tr.innerHTML = `
        <td><strong>${item.modelo}</strong></td>
        <td class="text-center">${item.cantidad_pedida}</td>
        <td class="text-center">${item.cantidad_entregada}</td>
        <td class="text-center ${pendienteClass}"><strong>${item.pendiente}</strong></td>
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
      tbody.innerHTML = '<tr><td colspan="4" class="empty-table"><i class="fas fa-check-circle"></i> No hay items pendientes para entregar</td></tr>';
      return;
    }

    pendientes.forEach((item) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.modelo}</strong></td>
        <td class="text-center"><span class="badge badge-warning">${item.pendiente}</span></td>
        <td>
          <input
            type="number"
            min="1"
            max="${item.pendiente}"
            value="${item.pendiente}"
            data-ficha-id="${item.ficha_id}"
            class="entrega-cantidad form-control form-control-sm"
            placeholder="Cantidad"
          />
        </td>
        <td class="text-center">
          <input type="checkbox" class="entrega-check" data-ficha-id="${item.ficha_id}" checked />
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
      tbody.innerHTML = '<tr><td colspan="5" class="empty-table"><i class="fas fa-file-invoice"></i> No hay facturas asociadas</td></tr>';
      return;
    }

    facturas.forEach((factura) => {
      const tr = document.createElement('tr');
      tr.className = 'factura-header';
      tr.innerHTML = `
        <td colspan="5">
          <div class="factura-info">
            <span><i class="fas fa-file-invoice"></i> <strong>Factura: ${factura.numero_factura || '-'}</strong></span>
            <span><i class="fas fa-calendar"></i> ${formatDate(factura.fecha_factura)}</span>
            <span><i class="fas fa-dollar-sign"></i> Total: $${formatMoney(factura.total_factura)}</span>
            <span><i class="fas fa-check-circle"></i> Cobrado: $${formatMoney(factura.total_cobrado)}</span>
          </div>
        </td>
      `;
      tbody.appendChild(tr);

      if (factura.items && factura.items.length) {
        factura.items.forEach((item) => {
          const itemRow = document.createElement('tr');
          itemRow.className = 'factura-item';
          itemRow.innerHTML = `
            <td><i class="fas fa-arrow-right"></i> ${item.modelo}</td>
            <td class="text-center">${item.cantidad}</td>
            <td class="text-right">$${formatMoney(item.precio_unitario)}</td>
            <td class="text-right">$${formatMoney(item.subtotal)}</td>
            <td class="text-center">
              <button class="btn-icon" title="Ver detalle" onclick="alert('Detalle de factura en construcción')">
                <i class="fas fa-eye"></i>
              </button>
            </td>
          `;
          tbody.appendChild(itemRow);
        });
      } else {
        const emptyRow = document.createElement('tr');
        emptyRow.className = 'factura-item';
        emptyRow.innerHTML = '<td colspan="5" class="text-muted"><i class="fas fa-arrow-right"></i> Sin items</td>';
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

    if (!ventas || !ventas.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-table"><i class="fas fa-file-invoice"></i> No hay remitos asociados</td></tr>';
      return;
    }

    const ventasConRemito = ventas.filter((v) => v.remito_numero);
    if (!ventasConRemito.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-table"><i class="fas fa-file-invoice"></i> No hay remitos asociados</td></tr>';
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
        : '-';

      tr.innerHTML = `
        <td><strong>${venta.remito_numero}</strong></td>
        <td>${formatDate(venta.remito_fecha)}</td>
        <td>#${venta.id}</td>
        <td>${itemsHtml}</td>
        <td>${venta.remito_observaciones || '-'}</td>
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

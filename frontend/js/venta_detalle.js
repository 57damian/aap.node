let ventaId = null;
let ventaData = null;

document.addEventListener('DOMContentLoaded', async () => {

  const params = new URLSearchParams(window.location.search);
  ventaId = params.get('id');

  if (!ventaId) {
    alert('Venta no especificada');
    window.location.href = 'ventas.html';
    return;
  }

  await cargarVenta();
  await cargarEstadoFacturacion();
});

/* =====================
   CARGAR VENTA
===================== */
async function cargarVenta() {
  try {

    const venta = await apiFetch(`/ventas/${ventaId}`);
    ventaData = venta;

    document.getElementById('cabecera').innerHTML = `
      <p><b>Cliente:</b> ${venta.cliente}</p>
      <p><b>OC:</b> ${venta.numero_oc}</p>
      <p><b>Tipo Cambio:</b> ${venta.tipo_cambio}</p>
    `;

    document.getElementById('remito_numero').value = venta.remito_numero || '';
    document.getElementById('remito_fecha').value =
      venta.remito_fecha ? venta.remito_fecha.split('T')[0] : '';

    document.getElementById('remito_obs').value = venta.remito_observaciones || '';

    const tbody = document.getElementById('tablaItems');
    tbody.innerHTML = '';

    venta.items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.modelo}</td>
        <td>${item.cantidad}</td>
        <td>${item.precio_unitario_usd}</td>
        <td>${item.precio_unitario_pesos}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    alert(err.error || 'Error cargando venta');
  }
}

/* =====================
   ESTADO FACTURACIÓN
===================== */
async function cargarEstadoFacturacion() {
  try {

    const estado = await apiFetch(`/ventas/${ventaId}/estado-facturacion`);

    const div = document.getElementById('facturacion');

    if (estado.facturada) {
      div.innerHTML = `
        <h3>🧾 Estado: FACTURADA</h3>
      `;
    } else {
      div.innerHTML = `
        <h3>🧾 Estado: PENDIENTE</h3>
        <button onclick="facturarVenta()">Facturar Venta</button>
      `;
    }

  } catch (err) {
    console.error(err);
    alert('Error verificando estado de facturación');
  }
}

/* =====================
   GUARDAR REMITO
===================== */
async function guardarRemito() {
  try {

    await apiFetch(`/ventas/${ventaId}/remito`, {
      method: 'PUT',
      body: JSON.stringify({
        remito_numero: document.getElementById('remito_numero').value,
        remito_fecha: document.getElementById('remito_fecha').value,
        remito_observaciones: document.getElementById('remito_obs').value
      })
    });

    alert('Remito guardado correctamente');

  } catch (err) {
    alert(err.error || 'Error guardando remito');
  }
}

/* =====================
   FACTURAR COMPLETA
===================== */
async function facturarVenta() {

  if (!ventaData) {
    alert("Venta no cargada");
    return;
  }

  const numero_factura = prompt('Número factura (ej 0001-00001234):');
  const tipo_factura = prompt('Tipo factura (A/B/C):');
  const fecha = prompt('Fecha (YYYY-MM-DD):');
  const dias_credito = prompt('Días crédito:', 0);

  if (!numero_factura || !tipo_factura || !fecha) {
    alert('Datos incompletos');
    return;
  }

  try {

    const items = ventaData.items.map(i => ({
      venta_item_id: i.id
    }));

    if (!items.length) {
      alert("La venta no tiene items.");
      return;
    }

    await apiFetch('/facturas', {
      method: 'POST',
      body: JSON.stringify({
        cliente_id: ventaData.cliente_id,
        numero_factura,
        tipo_factura,
        fecha,
        dias_credito: parseInt(dias_credito) || 0,
        items
      })
    });

    alert('Factura generada correctamente');
    await cargarEstadoFacturacion();

  } catch (err) {
    alert(err.error || 'Error facturando');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  cargarClientes();
  cargarVentas();
});

/* =====================
   CARGAR CLIENTES
===================== */
async function cargarClientes() {
  try {
    const clientes = await apiFetch('/clientes');
    const select = document.getElementById('filtroCliente');

    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
    });

  } catch (err) {
    alert('Error cargando clientes');
  }
}

/* =====================
   CARGAR VENTAS
===================== */
async function cargarVentas() {
  try {
    const clienteId = document.getElementById('filtroCliente').value;

    let endpoint = '/ventas';
    if (clienteId) endpoint += `?cliente_id=${clienteId}`;

    const ventas = await apiFetch(endpoint);

    const tbody = document.getElementById('tablaVentas');
    tbody.innerHTML = '';

    if (!ventas.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;">
            No hay ventas
          </td>
        </tr>
      `;
      return;
    }

    ventas.forEach(v => {
      const estado = v.numero_factura
        ? 'Facturada'
        : 'Pendiente facturar';

      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${v.id}</td>
        <td>${v.fecha || '-'}</td>
        <td>${v.cliente || '-'}</td>
        <td>${v.numero_oc || '-'}</td>
        <td>${v.numero_factura || '-'}</td>
        <td>${estado}</td>
        <td>
          <button onclick="verVenta(${v.id})">
            Ver
          </button>
          ${!v.numero_factura ? `
            <button onclick="facturarVenta(${v.id})">
              Facturar
            </button>
          ` : ''}
        </td>
      `;

      tbody.appendChild(tr);
    });

  } catch (err) {
    alert(err.error || 'Error cargando ventas');
  }
}

/* =====================
   VER DETALLE
===================== */
function verVenta(id) {
  window.location.href = `venta_detalle.html?id=${id}`;
}

/* =====================
   FACTURAR
===================== */
async function facturarVenta(id) {
  if (!confirm('¿Facturar esta venta?')) return;

  try {
    await apiFetch('/facturas', {
      method: 'POST',
      body: JSON.stringify({
        venta_id: id
      })
    });

    alert('Factura generada');
    cargarVentas();

  } catch (err) {
    alert(err.error || 'Error al facturar');
  }
}

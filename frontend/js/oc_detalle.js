document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const ocId = params.get('id');
  
  if (!ocId) {
    alert('OC no especificada');
    window.location.href = 'oc.html';
    return;
  }



  // =====================
  // CARGAR FICHAS EN SELECT
  // =====================
async function cargarFichasSelect() {
  try {
    const fichas = await apiFetch('/ficha-transformador');
    const select = document.getElementById('ficha_id');
    console.log('Fichas recibidas:', fichas);
    
    // Limpiar select
    select.innerHTML = '';

    // Agregar opción por defecto
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Seleccionar Modelo --';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    select.appendChild(defaultOption);

    fichas.forEach(ficha => {
      const option = document.createElement('option');
      option.value = ficha.id;
      option.textContent = `${ficha.modelo} (${ficha.voltaje_entrada || '-'}V/${ficha.voltaje_salida || '-'}V)`;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Error cargando fichas:', err);
  }
}

  // =====================
  // RESUMEN
  // =====================
  async function cargarResumen() {
    try {
      const data = await apiFetch(`/reportes/orden-compra/${ocId}/resumen`);
      
      document.getElementById('resumen').innerHTML = `
        <p><b>OC:</b> ${data.numero_oc}</p>
        <p><b>Cliente:</b> ${data.cliente}</p>
        <p><b>Estado:</b> ${data.estado}</p>
        <p><b>Total facturado:</b> $${data.total_facturado || 0}</p>
        <p><b>Total cobrado:</b> $${data.total_cobrado || 0}</p>
        <p><b>Saldo:</b> $${data.saldo || 0}</p>
      `;
    } catch (err) {
      console.error('Error cargando resumen:', err);
    }
  }

  // =====================
  // DETALLE
  // =====================
  async function cargarDetalle() {
    try {
      const items = await apiFetch(`/reportes/orden-compra/${ocId}/detalle`);
      const tbody = document.getElementById('detalle');
      tbody.innerHTML = '';
      
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No hay items</td></tr>';
        return;
      }

      items.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${item.modelo}</td>
          <td>${item.cantidad_pedida}</td>
          <td>${item.cantidad_entregada}</td>
          <td>${item.pendiente}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Error cargando detalle:', err);
    }
  }

  // =====================
  // MODELOS PENDIENTES PARA ENTREGA
  // =====================
  async function cargarEntregaItems() {
    try {
      const items = await apiFetch(`/reportes/orden-compra/${ocId}/detalle`);
      const tbody = document.getElementById('entregaItems');
      tbody.innerHTML = '';
      
      const pendientes = items.filter(item => item.pendiente > 0);
      
      if (pendientes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No hay pendientes para entregar</td></tr>';
        return;
      }

      pendientes.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${item.modelo}</td>
          <td>${item.pendiente}</td>
          <td>
            <input
              type="number"
              min="1"
              max="${item.pendiente}"
              data-ficha-id="${item.ficha_id}"
              class="entrega-cantidad"
              placeholder="0"
            />
          </td>
          <td>
            <input type="checkbox" class="entrega-check" data-ficha-id="${item.ficha_id}" />
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Error cargando entrega items:', err);
    }
  }

  // =====================
  // FACTURAS
  // =====================
  async function cargarFacturas() {
    try {
      const facturas = await apiFetch(`/reportes/orden-compra/${ocId}/facturas`);
      const tbody = document.getElementById('facturas');
      tbody.innerHTML = '';
      
      if (facturas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No hay facturas</td></tr>';
        return;
      }

      facturas.forEach(factura => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${factura.numero_factura || '-'}</td>
          <td>${factura.fecha_factura || '-'}</td>
          <td>$${factura.total_factura || 0}</td>
          <td>$${factura.total_cobrado || 0}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Error cargando facturas:', err);
    }
  }

  // =====================
  // AGREGAR ITEM A OC
  // =====================
  document.getElementById('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fichaId = document.getElementById('ficha_id').value;
    const cantidad = document.getElementById('cantidad_pedida').value;
    
    if (!fichaId || !cantidad || cantidad <= 0) {
      alert('Seleccione un modelo y cantidad válida');
      return;
    }

    try {
      await apiFetch(`/ordenes-compra/${ocId}/items`, {
        method: 'POST',
        body: JSON.stringify({
          ficha_id: parseInt(fichaId),
          cantidad_pedida: parseInt(cantidad)
        })
      });

      e.target.reset();
      alert('Item agregado correctamente');
      cargarDetalle();
    } catch (err) {
      alert(err.error || 'Error al agregar item');
    }
  });

  // =====================
  // REGISTRAR ENTREGA
  // =====================
  document.getElementById('btnRegistrarEntrega').addEventListener('click', async () => {
    // Obtener items seleccionados
    const checkboxes = document.querySelectorAll('.entrega-check:checked');
    
    if (checkboxes.length === 0) {
      alert('Seleccione al menos un modelo para entregar');
      return;
    }

    const itemsEntrega = [];
    
    checkboxes.forEach(checkbox => {
      const fichaId = checkbox.dataset.fichaId;
      const inputCantidad = document.querySelector(`.entrega-cantidad[data-ficha-id="${fichaId}"]`);
      const cantidad = parseInt(inputCantidad.value);
      
      if (!cantidad || cantidad <= 0) {
        alert('Ingrese cantidad válida');
        return;
      }

      itemsEntrega.push({
        ficha_id: parseInt(fichaId),
        cantidad: cantidad
      });
    });

    if (itemsEntrega.length === 0) return;

    try {
      // Crear venta
      const venta = await apiFetch('/ventas', {
        method: 'POST',
        body: JSON.stringify({
          orden_compra_id: parseInt(ocId),
          tipo_cambio: 1
        })
      });

      // Agregar items a la venta
      for (const item of itemsEntrega) {
        await apiFetch(`/ventas/${venta.id}/items`, {
          method: 'POST',
          body: JSON.stringify(item)
        });
      }

      alert('Entrega registrada correctamente');
      
      // Recargar datos
      cargarDetalle();
      cargarResumen();
      cargarFacturas();
      cargarEntregaItems();
      
    } catch (err) {
      alert(err.error || 'Error al registrar entrega');
    }
  });

  // =====================
  // VOLVER
  // =====================
  document.getElementById('btnVolver').addEventListener('click', () => {
    window.location.href = 'oc.html';
  });

  // =====================
  // INIT
  // =====================
  
  cargarFichasSelect();
  cargarResumen();
  cargarDetalle();
  cargarFacturas();
  cargarEntregaItems();
  

});
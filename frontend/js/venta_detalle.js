let ventaId = null;
let ventaData = null;
let facturaData = null;

// =====================
// VERIFICAR AUTENTICACIÓN
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

// Ahora puedes usar usuario.rol en lugar de localStorage.getItem('rol')



document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  ventaId = params.get('id');

  if (!ventaId) {
    alert('Venta no especificada');
    window.location.href = 'ventas.html';
    return;
  }

  document.getElementById('ventaId').textContent = ventaId;
  
  // Setear fecha actual en el modal
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('factura_fecha').value = hoy;

  await cargarVenta();
  await cargarEstadoFacturacion();
  await cargarFacturaAsociada();
});

/* =====================
   CARGAR VENTA
===================== */
async function cargarVenta() {
  try {
    ventaData = await apiFetch(`/api/ventas/${ventaId}`);
    
    // Actualizar info del cliente
    document.getElementById('clienteNombre').textContent = ventaData.cliente || 'Sin cliente';
    document.getElementById('ocNumero').textContent = ventaData.numero_oc || '-';
    document.getElementById('fechaVenta').textContent = ventaData.fecha ? ventaData.fecha.split('T')[0] : '-';
    document.getElementById('tipoCambio').textContent = `$${ventaData.tipo_cambio || 1}`;

    // Cargar datos de remito
    document.getElementById('remito_numero').value = ventaData.remito_numero || '';
    document.getElementById('remito_fecha').value = ventaData.remito_fecha ? ventaData.remito_fecha.split('T')[0] : '';
    document.getElementById('remito_obs').value = ventaData.remito_observaciones || '';

    // Cargar items
    cargarItemsTabla(ventaData.items || []);
    
    // Preparar modal con datos de la venta
    prepararModalFactura();

  } catch (err) {
    console.error('Error cargando venta:', err);
    mostrarAlerta('Error cargando venta: ' + (err.error || err.message), 'error');
  }
}

/* =====================
   CARGAR ITEMS EN TABLA
===================== */
function cargarItemsTabla(items) {
  const tbody = document.getElementById('tablaItems');
  tbody.innerHTML = '';

  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px; color: #666;">
          No hay items en esta venta
        </td>
      </tr>
    `;
    return;
  }

  let totalGeneral = 0;
  
  items.forEach(item => {
    const subtotal = item.cantidad * item.precio_unitario_pesos;
    totalGeneral += subtotal;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${item.modelo || 'Sin modelo'}</strong></td>
      <td>${item.cantidad}</td>
      <td>USD ${Number(item.precio_unitario_usd).toFixed(2)}</td>
      <td>$${Number(item.precio_unitario_pesos).toFixed(2)}</td>
      <td>$${Number(subtotal).toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Fila de total
  const trTotal = document.createElement('tr');
  trTotal.className = 'total-row';
  trTotal.innerHTML = `
    <td colspan="4" style="text-align: right;">TOTAL VENTA:</td>
    <td>$${Number(totalGeneral).toFixed(2)}</td>
  `;
  tbody.appendChild(trTotal);
  
  // Guardar total para la factura
  ventaData.totalVenta = totalGeneral;
}

/* =====================
   PREPARAR MODAL DE FACTURA
===================== */
function prepararModalFactura() {
  if (!ventaData) return;
  
  document.getElementById('modalCliente').textContent = ventaData.cliente || '-';
  document.getElementById('modalOC').textContent = ventaData.numero_oc || '-';
  
  const total = ventaData.totalVenta || 0;
  const iva = total * 0.21;
  const totalConIVA = total + iva;
  
  document.getElementById('modalTotal').textContent = `$${totalConIVA.toFixed(2)}`;
  document.getElementById('resumenSubtotal').textContent = `$${total.toFixed(2)}`;
  document.getElementById('resumenIVA').textContent = `$${iva.toFixed(2)}`;
  document.getElementById('resumenTotal').textContent = `$${totalConIVA.toFixed(2)}`;
}

/* =====================
   ESTADO FACTURACIÓN
===================== */
async function cargarEstadoFacturacion() {
  try {
    const estado = await apiFetch(`/api/ventas/${ventaId}/estado-facturacion`);
    const divEstado = document.getElementById('estadoFacturacion');
    
    if (estado.facturada) {
      divEstado.innerHTML = `
        <div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">✅</span>
            <div>
              <strong style="font-size: 16px;">Venta Facturada</strong>
              <div style="font-size: 14px; margin-top: 5px;">Esta venta ya tiene una factura asociada</div>
            </div>
          </div>
          <span class="badge badge-facturada">FACTURADA</span>
        </div>
      `;
      
      // Bloquear remito
      bloquearCamposRemito(true);
      
    } else {
      divEstado.innerHTML = `
        <div style="background: #fff3cd; color: #856404; padding: 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">⚠️</span>
            <div>
              <strong style="font-size: 16px;">Pendiente de Facturación</strong>
              <div style="font-size: 14px; margin-top: 5px;">Esta venta aún no ha sido facturada</div>
            </div>
          </div>
          <button class="btn btn-success" onclick="abrirModalFactura()">
            🧾 Facturar Venta
          </button>
        </div>
      `;
      
      bloquearCamposRemito(false);
    }
  } catch (err) {
    console.error('Error verificando estado:', err);
  }
}

/* =====================
   CARGAR FACTURA ASOCIADA
===================== */
async function cargarFacturaAsociada() {
  try {
    // Este endpoint deberías crearlo en el backend
    const factura = await apiFetch(`/api/ventas/${ventaId}/factura`);
    
    if (factura) {
      facturaData = factura;
      document.getElementById('facturaAsociada').style.display = 'block';
      
      document.getElementById('detalleFactura').innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
          <div>
            <div class="factura-label">Número</div>
            <div style="font-size: 18px; font-weight: bold;">${factura.numero_factura || '-'}</div>
          </div>
          <div>
            <div class="factura-label">Tipo</div>
            <div>Factura ${factura.tipo_factura || '-'}</div>
          </div>
          <div>
            <div class="factura-label">Fecha</div>
            <div>${factura.fecha ? factura.fecha.split('T')[0] : '-'}</div>
          </div>
          <div>
            <div class="factura-label">Total</div>
            <div style="font-size: 18px; color: #28a745; font-weight: bold;">$${Number(factura.total || 0).toFixed(2)}</div>
          </div>
          <div>
            <div class="factura-label">Subtotal</div>
            <div>$${Number(factura.subtotal_sin_iva || 0).toFixed(2)}</div>
          </div>
          <div>
            <div class="factura-label">IVA 21%</div>
            <div>$${Number(factura.iva_21 || 0).toFixed(2)}</div>
          </div>
          ${factura.dias_credito ? `
            <div>
              <div class="factura-label">Días Crédito</div>
              <div>${factura.dias_credito} días</div>
            </div>
          ` : ''}
        </div>
      `;
    }
  } catch (err) {
    // No hay factura asociada, no mostrar nada
    console.log('No hay factura asociada');
  }
}

/* =====================
   MODAL DE FACTURACIÓN
===================== */
function abrirModalFactura() {
  if (!ventaData) {
    mostrarAlerta('Error: No se puede cargar la venta', 'error');
    return;
  }
  
  // Actualizar fechas
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('factura_fecha').value = hoy;
  
  document.getElementById('facturaModal').style.display = 'block';
}

function cerrarModalFactura() {
  document.getElementById('facturaModal').style.display = 'none';
  
  // Limpiar formulario
  document.getElementById('factura_numero').value = '';
  document.getElementById('factura_tipo').value = '';
  document.getElementById('factura_dias_credito').value = '0';
}

/* =====================
   CONFIRMAR FACTURACIÓN
===================== */
async function confirmarFacturacion() {
  const numero_factura = document.getElementById('factura_numero').value;
  const tipo_factura = document.getElementById('factura_tipo').value;
  const fecha = document.getElementById('factura_fecha').value;
  const dias_credito = document.getElementById('factura_dias_credito').value;

  // Validaciones
  if (!numero_factura) {
    mostrarAlerta('El número de factura es obligatorio', 'error');
    return;
  }
  
  if (!tipo_factura) {
    mostrarAlerta('El tipo de factura es obligatorio', 'error');
    return;
  }
  
  if (!fecha) {
    mostrarAlerta('La fecha es obligatoria', 'error');
    return;
  }

  try {
    const response = await apiFetch('/api/facturas', {
      method: 'POST',
      body: JSON.stringify({
        venta_id: parseInt(ventaId),
        numero_factura,
        tipo_factura,
        fecha,
        dias_credito: parseInt(dias_credito) || 0
      })
    });

    mostrarAlerta('✅ Factura generada correctamente', 'success');
    cerrarModalFactura();
    
    // Recargar todo
    await cargarEstadoFacturacion();
    await cargarFacturaAsociada();
    
  } catch (err) {
    console.error('Error facturando:', err);
    mostrarAlerta(err.error || 'Error al generar la factura', 'error');
  }
}

/* =====================
   GUARDAR REMITO
===================== */
async function guardarRemito() {
  const remito_numero = document.getElementById('remito_numero').value;
  const remito_fecha = document.getElementById('remito_fecha').value;
  const remito_obs = document.getElementById('remito_obs').value;

  if (!remito_numero || !remito_fecha) {
    mostrarAlerta('Número y fecha de remito son obligatorios', 'error');
    return;
  }

  try {
    await apiFetch(`/api/ventas/${ventaId}/remito`, {
      method: 'PUT',
      body: JSON.stringify({
        remito_numero,
        remito_fecha,
        remito_observaciones: remito_obs
      })
    });

    mostrarAlerta('✅ Remito guardado correctamente', 'success');

  } catch (err) {
    mostrarAlerta(err.error || 'Error guardando remito', 'error');
  }
}

/* =====================
   BLOQUEAR CAMPOS DE REMITO
===================== */
function bloquearCamposRemito(bloquear) {
  const campos = [
    'remito_numero',
    'remito_fecha',
    'remito_obs'
  ];
  
  campos.forEach(id => {
    const campo = document.getElementById(id);
    if (campo) {
      campo.disabled = bloquear;
    }
  });
  
  const btnRemito = document.getElementById('btnGuardarRemito');
  if (btnRemito) {
    btnRemito.disabled = bloquear;
    if (bloquear) {
      btnRemito.title = 'No se puede modificar remito de venta facturada';
    }
  }
}

/* =====================
   MOSTRAR ALERTA
===================== */
function mostrarAlerta(mensaje, tipo) {
  const alertDiv = document.getElementById('alert');
  alertDiv.textContent = mensaje;
  alertDiv.className = `alert alert-${tipo}`;
  alertDiv.style.display = 'block';
  
  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 5000);
}

/* =====================
   LOGOUT
===================== */
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}
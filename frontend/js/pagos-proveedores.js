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

// =====================
// VARIABLES GLOBALES
// =====================
let pagoItems = []; // Items del pago actual
let pagoId = null; // ID del pago creado
let facturasPendientes = [];
let facturasSeleccionadas = [];

// =====================
// INICIALIZACIÓN
// =====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('✅ pagos-proveedores.js cargado');

  // Setear fecha actual
  const hoy = new Date().toISOString().split('T')[0];
  const fechaPago = document.getElementById('fecha_pago');
  
  if (fechaPago) fechaPago.value = hoy;

  // Cargar datos iniciales
  await cargarProveedores();
  await verificarAlertasChequesProveedor();

  // Event listeners
  const proveedorSelect = document.getElementById('proveedor_id');
  if (proveedorSelect) {
    proveedorSelect.addEventListener('change', async (e) => {
      if (e.target.value) {
        await cargarFacturasPendientesProveedor(e.target.value);
      }
    });
  }

  const btnGuardarPago = document.getElementById('btnGuardarPagoProveedor');
  if (btnGuardarPago) btnGuardarPago.addEventListener('click', guardarPagoProveedor);

  const btnAplicarPago = document.getElementById('btnAplicarPagoProveedor');
  if (btnAplicarPago) btnAplicarPago.addEventListener('click', aplicarPagoProveedor);

  // Cargar listados iniciales
  cargarPagosProveedor();
  cargarChequesProveedor();
});

// =====================
// CARGAR PROVEEDORES
// =====================
async function cargarProveedores() {
  try {
    const proveedores = await apiFetch('/api/proveedores');
    
    // Select para pago
    const selectPago = document.getElementById('proveedor_id');
    if (selectPago) {
      selectPago.innerHTML = '<option value="">-- Seleccionar Proveedor --</option>';
      proveedores.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        selectPago.appendChild(option);
      });
    }
    
    // Select para filtro de pagos
    const selectFiltro = document.getElementById('filtroProveedorPagos');
    if (selectFiltro) {
      selectFiltro.innerHTML = '<option value="">Todos los proveedores</option>';
      proveedores.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        selectFiltro.appendChild(option);
      });
    }
    
    // Select para filtro de cheques
    const selectChequeFiltro = document.getElementById('filtroChequeProveedor');
    if (selectChequeFiltro) {
      selectChequeFiltro.innerHTML = '<option value="">Todos los proveedores</option>';
      proveedores.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        selectChequeFiltro.appendChild(option);
      });
    }
    
    // Select para estado de cuenta
    const selectEstadoCuenta = document.getElementById('filtroEstadoCuentaProveedor');
    if (selectEstadoCuenta) {
      selectEstadoCuenta.innerHTML = '<option value="">Seleccionar proveedor</option>';
      proveedores.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        selectEstadoCuenta.appendChild(option);
      });
    }
    
  } catch (err) {
    console.error('Error cargando proveedores:', err);
    mostrarAlertaProveedor('Error cargando proveedores', 'error');
  }
}

// =====================
// CARGAR FACTURAS PENDIENTES PROVEEDOR
// =====================
async function cargarFacturasPendientesProveedor(proveedorId) {
  try {
    facturasPendientes = await apiFetch(`/api/facturas-compra/proveedor/${proveedorId}/pendientes`);
    actualizarTablaFacturasProveedor();
    await cargarEstadoCuentaProveedor(proveedorId);
  } catch (err) {
    console.error('Error cargando facturas:', err);
    mostrarAlertaProveedor('Error cargando facturas pendientes', 'error');
  }
}

// =====================
// CARGAR ESTADO DE CUENTA DEL PROVEEDOR
// =====================
async function cargarEstadoCuentaProveedor(proveedorId) {
  try {
    const estado = await apiFetch(`/api/pagos-proveedores/estado-cuenta/${proveedorId}`);

    let resumenDiv = document.getElementById('resumen-cuenta-proveedor');
    if (!resumenDiv) {
      resumenDiv = document.createElement('div');
      resumenDiv.id = 'resumen-cuenta-proveedor';
      resumenDiv.className = 'resumen-cuenta';

      const formSection = document.querySelector('.form-section');
      if (formSection && formSection.parentNode) {
        formSection.parentNode.insertBefore(resumenDiv, formSection);
      }
    }

    resumenDiv.innerHTML = `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #dc3545;">
        <h4 style="margin: 0 0 10px 0;">Resumen de Cuenta - Proveedor</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
          <div>
            <span style="font-size: 0.85rem; color: #666;">Total Facturado</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: #dc3545;">$${estado.total_facturado?.toFixed(2) || '0.00'}</div>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #666;">Total Pagado</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: #28a745;">$${estado.total_pagado?.toFixed(2) || '0.00'}</div>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #666;">Saldo Actual</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: ${(estado.saldo_actual || 0) > 0 ? '#dc3545' : '#28a745'};">$${(estado.saldo_actual || 0).toFixed(2)}</div>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #666;">Deuda Vencida</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: ${(estado.deuda_vencida || 0) > 0 ? '#dc3545' : '#28a745'};">$${(estado.deuda_vencida || 0).toFixed(2)}</div>
          </div>
          ${estado.proximas_a_vencer?.cantidad > 0 ? `
          <div>
            <span style="font-size: 0.85rem; color: #666;">Proximas a Vencer</span>
            <div style="font-size: 1rem; font-weight: bold; color: #ffc107;">
              ${estado.proximas_a_vencer.cantidad} factura(s) - $${estado.proximas_a_vencer.total?.toFixed(2) || '0.00'}
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error cargando estado de cuenta:', err);
  }
}

// =====================
// CARGAR ORDENES DE PAGO
// =====================
async function cargarOrdenesPago() {
  try {
    const proveedor_id = document.getElementById('filtroProveedorOrdenes')?.value;
    const desde = document.getElementById('filtroOrdenesDesde')?.value;
    const hasta = document.getElementById('filtroOrdenesHasta')?.value;
    const estado = document.getElementById('filtroEstadoOrdenes')?.value;

    let url = '/api/pagos-proveedores/ordenes';
    const params = [];
    
    if (proveedor_id) params.push(`proveedor_id=${proveedor_id}`);
    if (desde) params.push(`fecha_desde=${desde}`);
    if (hasta) params.push(`fecha_hasta=${hasta}`);
    if (estado) params.push(`estado=${estado}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const ordenes = await apiFetch(url);
    const tbody = document.getElementById('ordenesPagoList');
    if (!tbody) return;
    
    if (!ordenes || ordenes.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px;">
            No hay órdenes de pago registradas
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = ordenes.map(o => {
      let estadoClass = 'badge-pendiente';
      if (o.estado === 'autorizada') estadoClass = 'badge-autorizada';
      if (o.estado === 'pagada') estadoClass = 'badge-pagada';
      if (o.estado === 'cancelada') estadoClass = 'badge-cancelada';

      return `
        <tr>
          <td><strong>OP-${String(o.id).padStart(4, '0')}</strong></td>
          <td>${o.fecha ? new Date(o.fecha).toLocaleDateString('es-AR') : '-'}</td>
          <td>${o.proveedor_nombre || '-'}</td>
          <td>$${Number(o.monto || 0).toFixed(2)}</td>
          <td><span class="badge ${estadoClass}">${o.estado || 'pendiente'}</span></td>
          <td>
            <button class="btn btn-info btn-sm" onclick="verOrdenPago(${o.id})">👁️ Ver</button>
            ${o.estado === 'pendiente' ? `
              <button class="btn btn-success btn-sm" onclick="autorizarOrdenPago(${o.id})">✅ Autorizar</button>
              <button class="btn btn-danger btn-sm" onclick="cancelarOrdenPago(${o.id})">❌ Cancelar</button>
            ` : ''}
            ${o.estado === 'autorizada' ? `
              <button class="btn btn-primary btn-sm" onclick="generarPagoDesdeOrden(${o.id})">💰 Generar Pago</button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando órdenes de pago:', err);
  }
}

// =====================
// NUEVA ORDEN DE PAGO
// =====================
async function nuevaOrdenPago() {
  const proveedor_id = prompt('ID del proveedor:');
  if (!proveedor_id) return;

  const monto = parseFloat(prompt('Monto de la orden:'));
  if (!monto || monto <= 0) {
    mostrarAlertaProveedor('Monto inválido', 'error');
    return;
  }

  const motivo = prompt('Motivo de la orden de pago:');
  if (!motivo) return;

  try {
    const response = await apiFetch('/api/pagos-proveedores/ordenes', {
      method: 'POST',
      body: JSON.stringify({
        proveedor_id: parseInt(proveedor_id),
        monto,
        motivo,
        fecha: new Date().toISOString().split('T')[0]
      })
    });

    mostrarAlertaProveedor('✅ Orden de pago creada correctamente', 'success');
    cargarOrdenesPago();

  } catch (err) {
    console.error('Error creando orden de pago:', err);
    mostrarAlertaProveedor(err.error || 'Error creando orden de pago', 'error');
  }
}

// =====================
// VER ORDEN DE PAGO
// =====================
async function verOrdenPago(id) {
  try {
    const orden = await apiFetch(`/api/pagos-proveedores/ordenes/${id}`);
    
    const detalle = document.getElementById('ordenPagoDetalle');
    if (!detalle) return;
    
    detalle.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h4>Orden de Pago #${orden.id}</h4>
        <p><strong>Fecha:</strong> ${orden.fecha ? new Date(orden.fecha).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Proveedor:</strong> ${orden.proveedor_nombre || '-'}</p>
        <p><strong>Monto:</strong> $${Number(orden.monto || 0).toFixed(2)}</p>
        <p><strong>Motivo:</strong> ${orden.motivo || '-'}</p>
        <p><strong>Estado:</strong> <span class="badge badge-${orden.estado || 'pendiente'}">${orden.estado || 'pendiente'}</span></p>
        ${orden.autorizado_por ? `<p><strong>Autorizado por:</strong> ${orden.autorizado_por}</p>` : ''}
        ${orden.fecha_autorizacion ? `<p><strong>Fecha autorización:</strong> ${new Date(orden.fecha_autorizacion).toLocaleDateString('es-AR')}</p>` : ''}
        ${orden.pago_id ? `<p><strong>Pago generado:</strong> #${orden.pago_id}</p>` : ''}
      </div>

      ${orden.estado === 'pendiente' ? `
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button class="btn btn-success" onclick="autorizarOrdenPago(${orden.id})">✅ Autorizar</button>
          <button class="btn btn-danger" onclick="cancelarOrdenPago(${orden.id})">❌ Cancelar</button>
        </div>
      ` : ''}

      ${orden.estado === 'autorizada' ? `
        <div style="margin-top: 20px;">
          <button class="btn btn-primary" onclick="generarPagoDesdeOrden(${orden.id})">💰 Generar Pago</button>
        </div>
      ` : ''}
    `;

    const modal = document.getElementById('ordenPagoModal');
    if (modal) modal.style.display = 'block';

  } catch (err) {
    console.error('Error cargando orden de pago:', err);
    mostrarAlertaProveedor('Error cargando orden de pago', 'error');
  }
}

// =====================
// AUTORIZAR ORDEN DE PAGO
// =====================
async function autorizarOrdenPago(id) {
  if (!confirm('¿Confirmar autorización de la orden de pago?')) return;

  try {
    await apiFetch(`/api/pagos-proveedores/ordenes/${id}/autorizar`, {
      method: 'PUT'
    });

    mostrarAlertaProveedor('✅ Orden de pago autorizada', 'success');
    cerrarModalProveedor('ordenPagoModal');
    cargarOrdenesPago();

  } catch (err) {
    console.error('Error autorizando orden de pago:', err);
    mostrarAlertaProveedor(err.error || 'Error autorizando orden de pago', 'error');
  }
}

// =====================
// CANCELAR ORDEN DE PAGO
// =====================
async function cancelarOrdenPago(id) {
  const motivo = prompt('Motivo de cancelación:');
  if (!motivo) return;

  try {
    await apiFetch(`/api/pagos-proveedores/ordenes/${id}/cancelar`, {
      method: 'PUT',
      body: JSON.stringify({ motivo })
    });

    mostrarAlertaProveedor('✅ Orden de pago cancelada', 'success');
    cerrarModalProveedor('ordenPagoModal');
    cargarOrdenesPago();

  } catch (err) {
    console.error('Error cancelando orden de pago:', err);
    mostrarAlertaProveedor(err.error || 'Error cancelando orden de pago', 'error');
  }
}

// =====================
// GENERAR PAGO DESDE ORDEN
// =====================
async function generarPagoDesdeOrden(ordenId) {
  try {
    const response = await apiFetch(`/api/pagos-proveedores/ordenes/${ordenId}/generar-pago`, {
      method: 'POST'
    });

    mostrarAlertaProveedor('✅ Pago generado correctamente desde la orden', 'success');
    cerrarModalProveedor('ordenPagoModal');
    cargarOrdenesPago();
    cargarPagosProveedor();

  } catch (err) {
    console.error('Error generando pago desde orden:', err);
    mostrarAlertaProveedor(err.error || 'Error generando pago desde orden', 'error');
  }
}

// =====================
// CARGAR ESTADO DE CUENTA COMPLETO
// =====================
async function cargarEstadoCuenta() {
  try {
    const proveedor_id = document.getElementById('filtroEstadoCuentaProveedor')?.value;
    const desde = document.getElementById('filtroEstadoCuentaDesde')?.value;
    const hasta = document.getElementById('filtroEstadoCuentaHasta')?.value;

    if (!proveedor_id) {
      mostrarAlertaProveedor('Seleccione un proveedor', 'error');
      return;
    }

    let url = `/api/pagos-proveedores/estado-cuenta/${proveedor_id}`;
    const params = [];
    
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const estado = await apiFetch(url);
    
    // Actualizar resumen
    const saldoAnterior = document.getElementById('saldo-anterior');
    const totalCompras = document.getElementById('total-compras');
    const totalPagos = document.getElementById('total-pagos');
    const saldoActual = document.getElementById('saldo-actual');
    
    if (saldoAnterior) saldoAnterior.textContent = `$${(estado.saldo_anterior || 0).toFixed(2)}`;
    if (totalCompras) totalCompras.textContent = `$${(estado.total_compras || 0).toFixed(2)}`;
    if (totalPagos) totalPagos.textContent = `$${(estado.total_pagos || 0).toFixed(2)}`;
    if (saldoActual) saldoActual.textContent = `$${(estado.saldo_actual || 0).toFixed(2)}`;
    
    // Actualizar tabla de detalle
    const tbody = document.getElementById('estadoCuentaDetalle');
    if (tbody && estado.movimientos) {
      if (estado.movimientos.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 40px;">
              No hay movimientos en el período seleccionado
            </td>
          </tr>
        `;
        return;
      }
      
      let saldoAcumulado = estado.saldo_anterior || 0;
      
      tbody.innerHTML = estado.movimientos.map(mov => {
        saldoAcumulado += (mov.debe || 0) - (mov.haber || 0);
        
        return `
          <tr>
            <td>${mov.fecha ? new Date(mov.fecha).toLocaleDateString('es-AR') : '-'}</td>
            <td>${mov.documento || '-'}</td>
            <td>${mov.descripcion || '-'}</td>
            <td>${mov.debe ? `$${Number(mov.debe).toFixed(2)}` : '-'}</td>
            <td>${mov.haber ? `$${Number(mov.haber).toFixed(2)}` : '-'}</td>
            <td>$${saldoAcumulado.toFixed(2)}</td>
          </tr>
        `;
      }).join('');
    }
    
  } catch (err) {
    console.error('Error cargando estado de cuenta:', err);
    mostrarAlertaProveedor('Error cargando estado de cuenta', 'error');
  }
}

// =====================
// IMPRIMIR ESTADO DE CUENTA
// =====================
function imprimirEstadoCuenta() {
  const proveedor_id = document.getElementById('filtroEstadoCuentaProveedor')?.value;
  if (!proveedor_id) {
    mostrarAlertaProveedor('Seleccione un proveedor', 'error');
    return;
  }
  
  const desde = document.getElementById('filtroEstadoCuentaDesde')?.value;
  const hasta = document.getElementById('filtroEstadoCuentaHasta')?.value;
  
  let url = `/api/pagos-proveedores/estado-cuenta/${proveedor_id}/imprimir`;
  const params = [];
  
  if (desde) params.push(`desde=${desde}`);
  if (hasta) params.push(`hasta=${hasta}`);
  
  if (params.length > 0) {
    url += '?' + params.join('&');
  }
  
  window.open(url, '_blank');
}

// =====================
// ACTUALIZAR TABLA DE FACTURAS PROVEEDOR
// =====================
function actualizarTablaFacturasProveedor() {
  const tbody = document.getElementById('facturasPendientesListProveedor');
  if (!tbody) return;
  
  if (!facturasPendientes || facturasPendientes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px;">
          No hay facturas pendientes para este proveedor
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = facturasPendientes.map(f => {
    const hoy = new Date();
    const vencimiento = new Date(f.fecha_vencimiento);
    const diasVencida = Math.ceil((hoy - vencimiento) / (1000 * 60 * 60 * 24));
    
    let estadoClass = '';
    let estadoText = '';
    
    if (diasVencida > 0) {
      estadoClass = 'badge-danger';
      estadoText = `VENCIDA (${diasVencida} dias)`;
    } else {
      const diasRestantes = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));
      if (diasRestantes <= 3) {
        estadoClass = 'badge-warning';
        estadoText = `Vence en ${diasRestantes} dias`;
      } else {
        estadoClass = 'badge-info';
        estadoText = 'Pendiente';
      }
    }
    
    return `
    <tr>
      <td><input type="checkbox" class="factura-check-proveedor" data-id="${f.id}" data-saldo="${f.saldo_pendiente}" onchange="seleccionarFacturaProveedor(this)"></td>
      <td><strong>${f.numero_factura || f.id}</strong></td>
      <td>${f.tipo_factura || 'FC'}</td>
      <td>${new Date(f.fecha_factura).toLocaleDateString('es-AR')}</td>
      <td>$${Number(f.total).toFixed(2)}</td>
      <td>$${Number(f.saldo_pendiente).toFixed(2)}</td>
      <td><span class="badge ${estadoClass}">${estadoText}</span></td>
    </tr>
  `;
  }).join('');
}

// =====================
// SELECCIONAR FACTURA PROVEEDOR
// =====================
function seleccionarFacturaProveedor(checkbox) {
  const id = parseInt(checkbox.dataset.id);
  const saldo = parseFloat(checkbox.dataset.saldo);
  
  if (checkbox.checked) {
    const totalPago = calcularTotalPagoProveedor();
    const totalSeleccionado = facturasSeleccionadas.reduce((sum, f) => sum + f.monto, 0);
    
    if (totalSeleccionado + saldo > totalPago && totalPago > 0) {
      mostrarAlertaProveedor(`El monto seleccionado ($${(totalSeleccionado + saldo).toFixed(2)}) supera el pago ($${totalPago.toFixed(2)})`, 'error');
      checkbox.checked = false;
      return;
    }
    
    facturasSeleccionadas.push({
      factura_id: id,
      monto: saldo,
      saldo: saldo
    });
  } else {
    facturasSeleccionadas = facturasSeleccionadas.filter(f => f.factura_id !== id);
  }
  
  actualizarTablaAplicacionProveedor();
}

// =====================
// ACTUALIZAR TABLA DE APLICACIÓN PROVEEDOR
// =====================
function actualizarTablaAplicacionProveedor() {
  const tbody = document.getElementById('facturasAplicarListProveedor');
  if (!tbody) return;
  
  if (facturasSeleccionadas.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px;">
          Seleccione facturas para aplicar el pago
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = facturasSeleccionadas.map((f, index) => `
    <tr>
      <td>Factura #${f.factura_id}</td>
      <td>$${f.saldo.toFixed(2)}</td>
      <td>
        <input type="number" 
               class="monto-aplicar-proveedor" 
               data-index="${index}"
               value="${f.monto.toFixed(2)}"
               min="0.01"
               max="${f.saldo}"
               step="0.01"
               onchange="actualizarMontoAplicarProveedor(${index}, this.value)">
      </td>
      <td>
        <button class="btn-remove" onclick="eliminarFacturaSeleccionadaProveedor(${index})">X</button>
      </td>
    </tr>
  `).join('');

  calcularTotalAplicarProveedor();
}

// =====================
// ACTUALIZAR MONTO A APLICAR PROVEEDOR
// =====================
function actualizarMontoAplicarProveedor(index, monto) {
  if (facturasSeleccionadas[index]) {
    facturasSeleccionadas[index].monto = parseFloat(monto) || 0;
    calcularTotalAplicarProveedor();
  }
}

// =====================
// ELIMINAR FACTURA SELECCIONADA PROVEEDOR
// =====================
function eliminarFacturaSeleccionadaProveedor(index) {
  const factura = facturasSeleccionadas[index];
  const checkbox = document.querySelector(`.factura-check-proveedor[data-id="${factura.factura_id}"]`);
  if (checkbox) checkbox.checked = false;
  
  facturasSeleccionadas.splice(index, 1);
  actualizarTablaAplicacionProveedor();
}

// =====================
// CALCULAR TOTAL A APLICAR PROVEEDOR
// =====================
function calcularTotalAplicarProveedor() {
  const total = facturasSeleccionadas.reduce((sum, f) => sum + f.monto, 0);
  const totalElement = document.getElementById('total-aplicar-proveedor');
  if (totalElement) totalElement.textContent = `$${total.toFixed(2)}`;
  return total;
}

// =====================
// AGREGAR ITEM DE PAGO PROVEEDOR
// =====================
function agregarItemPagoProveedor() {
  const container = document.getElementById('pago-items-container-proveedor');
  if (!container) return;
  
  const index = pagoItems.length;
  
  const div = document.createElement('div');
  div.className = 'item-row';
  div.id = `pago-item-proveedor-${index}`;
  div.innerHTML = `
    <select id="item-tipo-proveedor-${index}" class="item-input item-tipo" onchange="cambiarTipoItemProveedor(${index})">
      <option value="EFECTIVO">Efectivo</option>
      <option value="CHEQUE">Cheque Propio</option>
      <option value="TRANSFERENCIA">Transferencia</option>
    </select>
    <input type="number" id="item-monto-proveedor-${index}" class="item-input item-monto" placeholder="Monto" step="0.01" min="0" onchange="calcularTotalPagoProveedor()">
    <div id="item-detalle-proveedor-${index}" class="item-detalle"></div>
    <button type="button" class="btn-remove" onclick="eliminarItemPagoProveedor(${index})">X</button>
  `;
  
  container.appendChild(div);
  pagoItems.push({ index, tipo: 'EFECTIVO', monto: 0 });
  cambiarTipoItemProveedor(index);
}

// =====================
// CAMBIAR TIPO DE ITEM PROVEEDOR
// =====================
function cambiarTipoItemProveedor(index) {
  const tipo = document.getElementById(`item-tipo-proveedor-${index}`)?.value;
  const detalleDiv = document.getElementById(`item-detalle-proveedor-${index}`);
  if (!detalleDiv) return;
  
  let html = '';
  if (tipo === 'CHEQUE') {
    html = `
      <input type="text" class="item-input" id="item-cheque-numero-proveedor-${index}" placeholder="Nro Cheque">
      <input type="text" class="item-input" id="item-cheque-banco-proveedor-${index}" placeholder="Banco">
      <input type="date" class="item-input" id="item-cheque-fecha-emision-proveedor-${index}">
      <input type="date" class="item-input" id="item-cheque-fecha-cobro-proveedor-${index}">
    `;
  } else if (tipo === 'TRANSFERENCIA') {
    html = `
      <input type="text" class="item-input" id="item-transferencia-origen-proveedor-${index}" placeholder="Banco Origen">
      <input type="text" class="item-input" id="item-transferencia-destino-proveedor-${index}" placeholder="Banco Destino">
      <input type="text" class="item-input" id="item-transferencia-operacion-proveedor-${index}" placeholder="Nro Operacion">
      <input type="date" class="item-input" id="item-transferencia-fecha-proveedor-${index}">
    `;
  }
  
  detalleDiv.innerHTML = html;
  
  const item = pagoItems.find(i => i.index === index);
  if (item) item.tipo = tipo;
}

// =====================
// ELIMINAR ITEM DE PAGO PROVEEDOR
// =====================
function eliminarItemPagoProveedor(index) {
  const item = document.getElementById(`pago-item-proveedor-${index}`);
  if (item) item.remove();
  pagoItems = pagoItems.filter(item => item.index !== index);
  calcularTotalPagoProveedor();
}

// =====================
// CALCULAR TOTAL DEL PAGO PROVEEDOR
// =====================
function calcularTotalPagoProveedor() {
  let total = 0;
  
  pagoItems.forEach(item => {
    const input = document.getElementById(`item-monto-proveedor-${item.index}`);
    const monto = parseFloat(input?.value) || 0;
    if (monto < 0) {
      mostrarAlertaProveedor('El monto no puede ser negativo', 'error');
      if (input) input.value = 0;
      return;
    }
    total += monto;
  });
  
  const totalElement = document.getElementById('total-pago-proveedor');
  if (totalElement) {
    totalElement.textContent = `$${total.toFixed(2)}`;
    totalElement.style.color = total === 0 ? '#999' : '#28a745';
  }
  
  if (facturasSeleccionadas.length > 0) {
    const totalSeleccionado = facturasSeleccionadas.reduce((sum, f) => sum + f.monto, 0);
    if (totalSeleccionado > total) {
      mostrarAlertaProveedor('El pago es menor a las facturas seleccionadas', 'warning');
    }
  }
  
  return total;
}

// =====================
// GUARDAR PAGO PROVEEDOR
// =====================
async function guardarPagoProveedor() {
  const proveedor_id = document.getElementById('proveedor_id')?.value;
  const fecha_pago = document.getElementById('fecha_pago')?.value;
  
  if (!proveedor_id || !fecha_pago) {
    mostrarAlertaProveedor('Complete los datos del proveedor y fecha', 'error');
    return;
  }

  const items = [];
  for (const item of pagoItems) {
    const monto = parseFloat(document.getElementById(`item-monto-proveedor-${item.index}`)?.value);
    if (!monto || monto <= 0) continue;
    
    const tipo = document.getElementById(`item-tipo-proveedor-${item.index}`)?.value;
    const itemData = {
      tipo,
      monto,
      observaciones: ''
    };
    
    if (tipo === 'CHEQUE') {
      itemData.cheque_numero = document.getElementById(`item-cheque-numero-proveedor-${item.index}`)?.value;
      itemData.cheque_banco = document.getElementById(`item-cheque-banco-proveedor-${item.index}`)?.value;
      itemData.cheque_fecha_emision = document.getElementById(`item-cheque-fecha-emision-proveedor-${item.index}`)?.value;
      itemData.cheque_fecha_cobro = document.getElementById(`item-cheque-fecha-cobro-proveedor-${item.index}`)?.value;
      
      if (!itemData.cheque_numero || !itemData.cheque_banco || !itemData.cheque_fecha_cobro) {
        mostrarAlertaProveedor('Complete todos los datos del cheque', 'error');
        return;
      }
    }
    
    if (tipo === 'TRANSFERENCIA') {
      itemData.transferencia_banco_origen = document.getElementById(`item-transferencia-origen-proveedor-${item.index}`)?.value;
      itemData.transferencia_banco_destino = document.getElementById(`item-transferencia-destino-proveedor-${item.index}`)?.value;
      itemData.transferencia_numero_operacion = document.getElementById(`item-transferencia-operacion-proveedor-${item.index}`)?.value;
      itemData.transferencia_fecha = document.getElementById(`item-transferencia-fecha-proveedor-${item.index}`)?.value || fecha_pago;
    }
    
    items.push(itemData);
  }

  if (items.length === 0) {
    mostrarAlertaProveedor('Agregue al menos un item de pago', 'error');
    return;
  }

  const data = {
    proveedor_id: parseInt(proveedor_id),
    fecha_pago,
    observaciones: document.getElementById('observaciones_pago_proveedor')?.value || null,
    items
  };

  try {
    const response = await apiFetch('/api/pagos-proveedores', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    pagoId = response.id;
    mostrarAlertaProveedor('✅ Pago registrado correctamente', 'success');
    
    const pagoIdSpan = document.getElementById('pago-id-proveedor');
    const montoPagoSpan = document.getElementById('monto-pago-proveedor');
    const pagoAplicarSection = document.getElementById('pago-aplicar-section-proveedor');
    
    if (pagoIdSpan) pagoIdSpan.textContent = pagoId;
    if (montoPagoSpan) montoPagoSpan.textContent = `$${calcularTotalPagoProveedor().toFixed(2)}`;
    if (pagoAplicarSection) pagoAplicarSection.style.display = 'block';
    
    const container = document.getElementById('pago-items-container-proveedor');
    if (container) container.innerHTML = '';
    pagoItems = [];
    calcularTotalPagoProveedor();

  } catch (err) {
    console.error('Error guardando pago:', err);
    mostrarAlertaProveedor(err.error || 'Error guardando pago', 'error');
  }
}

// =====================
// APLICAR PAGO PROVEEDOR
// =====================
async function aplicarPagoProveedor() {
  if (!pagoId) {
    mostrarAlertaProveedor('Primero debe crear un pago', 'error');
    return;
  }

  if (facturasSeleccionadas.length === 0) {
    mostrarAlertaProveedor('Seleccione al menos una factura', 'error');
    return;
  }

  const aplicaciones = facturasSeleccionadas.map(f => ({
    factura_compra_id: f.factura_id,
    monto_aplicado: f.monto
  }));

  try {
    const response = await apiFetch(`/api/pagos-proveedores/${pagoId}/aplicar`, {
      method: 'POST',
      body: JSON.stringify({ aplicaciones })
    });

    mostrarAlertaProveedor('✅ Pago aplicado correctamente', 'success');
    
    const proveedorId = document.getElementById('proveedor_id')?.value;
    if (proveedorId) await cargarFacturasPendientesProveedor(proveedorId);
    
    facturasSeleccionadas = [];
    actualizarTablaAplicacionProveedor();
    
    cargarPagosProveedor();

  } catch (err) {
    console.error('Error aplicando pago:', err);
    mostrarAlertaProveedor(err.error || 'Error aplicando pago', 'error');
  }
}

// =====================
// CARGAR PAGOS PROVEEDOR
// =====================
async function cargarPagosProveedor() {
  try {
    const proveedor_id = document.getElementById('filtroProveedorPagos')?.value;
    const desde = document.getElementById('filtroDesdePagos')?.value;
    const hasta = document.getElementById('filtroHastaPagos')?.value;
    const estado = document.getElementById('filtroEstadoPagos')?.value;

    let url = '/api/pagos-proveedores';
    const params = [];
    
    if (proveedor_id) params.push(`proveedor_id=${proveedor_id}`);
    if (desde) params.push(`fecha_desde=${desde}`);
    if (hasta) params.push(`fecha_hasta=${hasta}`);
    if (estado) params.push(`estado=${estado}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const pagos = await apiFetch(url);
    const tbody = document.getElementById('pagosListProveedor');
    if (!tbody) return;
    
    if (!pagos || pagos.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px;">
            No hay pagos registrados
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = pagos.map(p => {
      const itemsHtml = p.items && Array.isArray(p.items) && p.items.length > 0 
        ? p.items.map(i => `<span class="badge badge-${(i.tipo || '').toLowerCase()}">${i.tipo || ''}</span>`).join('')
        : '-';
      
      return `
        <tr>
          <td>#${p.id}</td>
          <td>${p.fecha ? new Date(p.fecha).toLocaleDateString('es-AR') : '-'}</td>
          <td>${p.proveedor_nombre || '-'}</td>
          <td>$${Number(p.monto || 0).toFixed(2)}</td>
          <td>${itemsHtml}</td>
          <td><span class="badge badge-${p.estado || 'pendiente'}">${p.estado || 'pendiente'}</span></td>
          <td>
            <button class="btn btn-info btn-sm" onclick="verPagoProveedor(${p.id})">👁️ Ver</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando pagos:', err);
  }
}

// =====================
// CARGAR CHEQUES PROVEEDOR
// =====================
async function cargarChequesProveedor() {
  try {
    const proveedor_id = document.getElementById('filtroChequeProveedor')?.value;
    const estado = document.getElementById('filtroChequeEstadoProveedor')?.value;
    const desde = document.getElementById('filtroChequeDesdeProveedor')?.value;
    const hasta = document.getElementById('filtroChequeHastaProveedor')?.value;

    let url = '/api/pagos-proveedores/cheques';
    const params = [];
    
    if (proveedor_id) params.push(`proveedor_id=${proveedor_id}`);
    if (estado) params.push(`estado=${estado}`);
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const cheques = await apiFetch(url);
    const tbody = document.getElementById('chequesListProveedor');
    if (!tbody) return;
    
    if (!cheques || cheques.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 40px;">
            No hay cheques emitidos
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = cheques.map(c => {
      const diasRestantes = c.fecha_cobro ? Math.ceil((new Date(c.fecha_cobro) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
      let estadoClass = 'badge-pendiente';
      if (c.estado === 'depositado') estadoClass = 'badge-depositado';
      if (c.estado === 'acreditado') estadoClass = 'badge-acreditado';
      if (c.estado === 'rechazado') estadoClass = 'badge-rechazado';

      return `
        <tr>
          <td><strong>${c.numero_cheque || '-'}</strong></td>
          <td>${c.banco || '-'}</td>
          <td>${c.proveedor_nombre || '-'}</td>
          <td>$${Number(c.monto || 0).toFixed(2)}</td>
          <td>${c.fecha_emision ? new Date(c.fecha_emision).toLocaleDateString('es-AR') : '-'}</td>
          <td>
            ${c.fecha_cobro ? new Date(c.fecha_cobro).toLocaleDateString('es-AR') : '-'}
            ${diasRestantes <= 3 && c.estado === 'pendiente' ? 
              `<br><span style="color: #dc3545; font-size: 12px;">⚠️ Vence en ${diasRestantes} días</span>` : ''}
          </td>
          <td><span class="badge ${estadoClass}">${c.estado || 'pendiente'}</span></td>
          <td>
            <button class="btn btn-info btn-sm" onclick="verChequeProveedor(${c.id})">👁️ Ver</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando cheques:', err);
  }
}

// =====================
// VERIFICAR ALERTAS DE CHEQUES PROVEEDOR
// =====================
async function verificarAlertasChequesProveedor() {
  try {
    const alertas = await apiFetch('/api/pagos-proveedores/cheques/alertas?dias=3');
    
    if (alertas.total > 0) {
      const alertaDiv = document.getElementById('alertas-cheques-proveedor');
      const alertaCount = document.getElementById('alertasChequesCountProveedor');
      if (alertaDiv && alertaCount) {
        alertaCount.textContent = `(${alertas.total} cheque${alertas.total > 1 ? 's' : ''} próximo${alertas.total > 1 ? 's' : ''} a vencer)`;
        alertaDiv.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Error verificando alertas:', err);
  }
}

// =====================
// VER ALERTAS DE CHEQUES PROVEEDOR
// =====================
function verAlertasChequesProveedor() {
  showTabProveedor('cheques-proveedores-list');
  const filtroEstado = document.getElementById('filtroChequeEstadoProveedor');
  if (filtroEstado) filtroEstado.value = 'pendiente';
  cargarChequesProveedor();
}

// =====================
// VER PAGO PROVEEDOR
// =====================
async function verPagoProveedor(id) {
  try {
    const pago = await apiFetch(`/api/pagos-proveedores/${id}`);
    
    const detalle = document.getElementById('pagoDetalleProveedor');
    if (!detalle) return;
    
    detalle.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h4>Pago #${pago.id}</h4>
        <p><strong>Fecha:</strong> ${pago.fecha ? new Date(pago.fecha).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Proveedor:</strong> ${pago.proveedor_nombre || '-'}</p>
        <p><strong>Total:</strong> $${Number(pago.monto || 0).toFixed(2)}</p>
        <p><strong>Estado:</strong> <span class="badge badge-${pago.estado || 'pendiente'}">${pago.estado || 'pendiente'}</span></p>
      </div>

      <h5>Items</h5>
      <table style="width: 100%; margin-bottom: 20px;">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Detalle</th>
            <th>Monto</th>
          </tr>
        </thead>
        <tbody>
          ${pago.items && pago.items.length > 0 ? pago.items.map(i => `
            <tr>
              <td>${i.tipo || '-'}</td>
              <td>
                ${i.tipo === 'CHEQUE' ? `${i.cheque_banco || ''} - N° ${i.cheque_numero || ''}` : 
                  i.tipo === 'TRANSFERENCIA' ? `Op: ${i.transferencia_numero_operacion || ''}` : 
                  '-'}
              </td>
              <td>$${Number(i.monto || 0).toFixed(2)}</td>
            </tr>
          `).join('') : '<tr><td colspan="3">Sin items</td></tr>'}
        </tbody>
      </table>
    `;

    const modal = document.getElementById('pagoModalProveedor');
    if (modal) modal.style.display = 'block';

  } catch (err) {
    console.error('Error cargando pago:', err);
    mostrarAlertaProveedor('Error cargando detalle del pago', 'error');
  }
}

// =====================
// VER CHEQUE PROVEEDOR
// =====================
async function verChequeProveedor(id) {
  try {
    const cheque = await apiFetch(`/api/pagos-proveedores/cheques/${id}`);
    
    const detalle = document.getElementById('chequeDetalleProveedor');
    if (!detalle) return;
    
    detalle.innerHTML = `
      <div style="margin-bottom: 20px;">
        <p><strong>Cheque N°:</strong> ${cheque.numero_cheque || '-'}</p>
        <p><strong>Banco:</strong> ${cheque.banco || '-'}</p>
        <p><strong>Proveedor:</strong> ${cheque.proveedor_nombre || '-'}</p>
        <p><strong>Monto:</strong> $${Number(cheque.monto || 0).toFixed(2)}</p>
        <p><strong>Fecha Emisión:</strong> ${cheque.fecha_emision ? new Date(cheque.fecha_emision).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Fecha Cobro:</strong> ${cheque.fecha_cobro ? new Date(cheque.fecha_cobro).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Estado:</strong> <span class="badge badge-${cheque.estado || 'pendiente'}">${cheque.estado || 'pendiente'}</span></p>
        ${cheque.fecha_depositado ? `<p><strong>Fecha Depósito:</strong> ${new Date(cheque.fecha_depositado).toLocaleDateString('es-AR')}</p>` : ''}
        ${cheque.gasto_comision ? `<p><strong>Gasto Comisión:</strong> $${Number(cheque.gasto_comision).toFixed(2)}</p>` : ''}
        ${cheque.motivo_rechazo ? `<p><strong>Motivo Rechazo:</strong> ${cheque.motivo_rechazo}</p>` : ''}
      </div>

      ${cheque.estado === 'pendiente' ? `
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button class="btn btn-info" onclick="depositarChequeProveedor(${cheque.id})">🏦 Depositar</button>
          <button class="btn btn-danger" onclick="rechazarChequeProveedor(${cheque.id})">❌ Rechazar</button>
        </div>
      ` : ''}

      ${cheque.estado === 'depositado' ? `
        <div style="margin-top: 20px;">
          <button class="btn btn-success" onclick="acreditarChequeProveedor(${cheque.id})">✅ Acreditar</button>
        </div>
      ` : ''}
    `;

    const modal = document.getElementById('chequeModalProveedor');
    if (modal) modal.style.display = 'block';

  } catch (err) {
    console.error('Error cargando cheque:', err);
    mostrarAlertaProveedor('Error cargando cheque', 'error');
  }
}

// =====================
// DEPOSITAR CHEQUE PROVEEDOR
// =====================
async function depositarChequeProveedor(id) {
  const fecha = prompt('Ingrese fecha de depósito (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
  if (!fecha) return;

  try {
    await apiFetch(`/api/pagos-proveedores/cheques/${id}/depositar`, {
      method: 'POST',
      body: JSON.stringify({ fecha_depositado: fecha })
    });

    mostrarAlertaProveedor('✅ Cheque depositado correctamente', 'success');
    cerrarModalProveedor('chequeModalProveedor');
    cargarChequesProveedor();
    verificarAlertasChequesProveedor();

  } catch (err) {
    console.error('Error depositando cheque:', err);
    mostrarAlertaProveedor(err.error || 'Error depositando cheque', 'error');
  }
}

// =====================
// RECHAZAR CHEQUE PROVEEDOR
// =====================
async function rechazarChequeProveedor(id) {
  const motivo = prompt('Motivo del rechazo:');
  if (!motivo) return;

  const comision = prompt('Gasto de comisión ($):', '0');
  const tieneReemplazo = confirm('¿Se entregó un cheque de reemplazo?');

  let nuevoCheque = null;
  if (tieneReemplazo) {
    nuevoCheque = {
      pago_id: parseInt(prompt('ID del pago original:')),
      numero_cheque: prompt('Nuevo número de cheque:'),
      banco: prompt('Banco del nuevo cheque:'),
      fecha_emision: prompt('Fecha emisión nuevo cheque (YYYY-MM-DD):'),
      fecha_cobro: prompt('Fecha cobro nuevo cheque (YYYY-MM-DD):'),
      monto: parseFloat(prompt('Monto del nuevo cheque:')),
      observaciones: 'Cheque de reemplazo'
    };
  }

  try {
    await apiFetch(`/api/pagos-proveedores/cheques/${id}/rechazar`, {
      method: 'POST',
      body: JSON.stringify({
        motivo_rechazo: motivo,
        gasto_comision: parseFloat(comision) || 0,
        nuevo_cheque: nuevoCheque
      })
    });

    mostrarAlertaProveedor('✅ Cheque rechazado registrado', 'success');
    cerrarModalProveedor('chequeModalProveedor');
    cargarChequesProveedor();

  } catch (err) {
    console.error('Error rechazando cheque:', err);
    mostrarAlertaProveedor(err.error || 'Error rechazando cheque', 'error');
  }
}

// =====================
// ACREDITAR CHEQUE PROVEEDOR
// =====================
async function acreditarChequeProveedor(id) {
  if (!confirm('¿Confirmar acreditación del cheque?')) return;

  try {
    await apiFetch(`/api/pagos-proveedores/cheques/${id}/acreditar`, {
      method: 'PUT'
    });

    mostrarAlertaProveedor('✅ Cheque acreditado correctamente', 'success');
    cerrarModalProveedor('chequeModalProveedor');
    cargarChequesProveedor();

  } catch (err) {
    console.error('Error acreditando cheque:', err);
    mostrarAlertaProveedor(err.error || 'Error acreditando cheque', 'error');
  }
}

// =====================
// CERRAR MODAL PROVEEDOR
// =====================
function cerrarModalProveedor(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

// =====================
// MOSTRAR TAB PROVEEDOR
// =====================
function showTabProveedor(tabName, event) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const tabElement = document.getElementById(tabName);
  if (tabElement) tabElement.classList.add('active');
  
  if (event && event.target) {
    event.target.classList.add('active');
  }
  
  // Cargar datos según tab
  if (tabName === 'pagos-proveedores-list') {
    cargarPagosProveedor();
  }
  if (tabName === 'cheques-proveedores-list') {
    cargarChequesProveedor();
  }
  if (tabName === 'estado-cuenta-proveedor') {
    const proveedorId = document.getElementById('filtroEstadoCuentaProveedor')?.value;
    if (proveedorId) cargarEstadoCuentaProveedor(proveedorId);
  }
}

// =====================
// MOSTRAR ALERTA PROVEEDOR
// =====================
function mostrarAlertaProveedor(mensaje, tipo) {
  const alertDiv = document.getElementById('globalAlertProveedor');
  if (!alertDiv) return;
  
  alertDiv.textContent = mensaje;
  alertDiv.className = `alert alert-${tipo}`;
  alertDiv.style.display = 'block';
  
  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 5000);
}

// =====================
// RESET FORMS PROVEEDOR
// =====================
function resetFormsProveedor() {
  const itemsContainer = document.getElementById('pago-items-container-proveedor');
  if (itemsContainer) itemsContainer.innerHTML = '';
  
  const pagoAplicarSection = document.getElementById('pago-aplicar-section-proveedor');
  if (pagoAplicarSection) pagoAplicarSection.style.display = 'none';
  
  pagoItems = [];
  facturasSeleccionadas = [];
  pagoId = null;
}

// =====================
// LOGOUT
// =====================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

// pagos-proveedores-mejorado.js
// Implementación mejorada de pagos a proveedores basada en la lógica de pagos clientes

// =====================
// VERIFICAR AUTENTICACIÓN
// =====================
function verificarAuth() {
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
}

// =====================
// VARIABLES GLOBALES
// =====================
let pagosProveedoresCache = [];
let facturasPendientesCache = [];
let proveedoresCache = [];
let chequesProveedoresCache = [];
let ordenesPagoCache = [];
let aplicacionesPago = [];
let pagoActualId = null;

// =====================
// INICIALIZACIÓN
// =====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('✅ pagos-proveedores-mejorado.js cargado');

  // Verificar autenticación
  const usuario = verificarAuth();
  if (!usuario) return;

  // Setear fecha actual
  const hoy = new Date().toISOString().split('T')[0];
  const fechaPago = document.getElementById('fecha_pago');
  if (fechaPago) fechaPago.value = hoy;

  // Cargar datos iniciales
  await cargarProveedores();
  await cargarAlertasCheques();

  // Event listeners
  const proveedorSelect = document.getElementById('proveedor_id');
  if (proveedorSelect) {
    proveedorSelect.addEventListener('change', async (e) => {
      if (e.target.value) {
        await cargarEstadoCuentaProveedor(e.target.value);
      }
    });
  }

  const btnGuardarPago = document.getElementById('btnGuardarPagoProveedor');
  if (btnGuardarPago) btnGuardarPago.addEventListener('click', guardarPagoProveedor);

  const btnAplicarPago = document.getElementById('btnAplicarPagoProveedor');
  if (btnAplicarPago) btnAplicarPago.addEventListener('click', aplicarPagoProveedor);

  const btnGenerarOrden = document.getElementById('btnGenerarOrdenPago');
  if (btnGenerarOrden) btnGenerarOrden.addEventListener('click', generarOrdenPago);

  // Cargar listados iniciales
  cargarPagosProveedores();
  cargarOrdenesPago();
  cargarChequesProveedores();
});

// =====================
// CARGAR PROVEEDORES
// =====================
async function cargarProveedores() {
  try {
    const proveedores = await apiFetch('/api/proveedores');
    proveedoresCache = proveedores;
    
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
    const selectFiltro = document.getElementById('filtroProveedorLista');
    if (selectFiltro) {
      selectFiltro.innerHTML = '<option value="">Todos los proveedores</option>';
      proveedores.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        selectFiltro.appendChild(option);
      });
    }
    
    // Select para filtro de órdenes de pago
    const selectOrdenFiltro = document.getElementById('filtroOrdenProveedor');
    if (selectOrdenFiltro) {
      selectOrdenFiltro.innerHTML = '<option value="">Todos los proveedores</option>';
      proveedores.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        selectOrdenFiltro.appendChild(option);
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
    
    // Select para filtro de estado de cuenta
    const selectEstadoCuentaFiltro = document.getElementById('filtroEstadoCuentaProveedor');
    if (selectEstadoCuentaFiltro) {
      selectEstadoCuentaFiltro.innerHTML = '<option value="">Todos los proveedores</option>';
      proveedores.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        selectEstadoCuentaFiltro.appendChild(option);
      });
    }
    
  } catch (err) {
    console.error('Error cargando proveedores:', err);
    mostrarAlerta('Error cargando proveedores', 'error');
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
      <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #007bff;">
        <h4 style="margin: 0 0 10px 0;">Resumen de Cuenta - Proveedor</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
          <div>
            <span style="font-size: 0.85rem; color: #666;">Total Facturado</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: #007bff;">$${estado.total_facturado.toFixed(2)}</div>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #666;">Total Pagado</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: #28a745;">$${estado.total_pagado.toFixed(2)}</div>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #666;">Saldo Actual</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: ${estado.saldo_actual > 0 ? '#dc3545' : '#28a745'};">$${estado.saldo_actual.toFixed(2)}</div>
          </div>
          <div>
            <span style="font-size: 0.85rem; color: #666;">Deuda Vencida</span>
            <div style="font-size: 1.2rem; font-weight: bold; color: ${estado.deuda_vencida > 0 ? '#dc3545' : '#28a745'};">$${estado.deuda_vencida.toFixed(2)}</div>
          </div>
          ${estado.proximas_a_vencer.cantidad > 0 ? `
          <div>
            <span style="font-size: 0.85rem; color: #666;">Proximas a Vencer</span>
            <div style="font-size: 1rem; font-weight: bold; color: #ffc107;">
              ${estado.proximas_a_vencer.cantidad} factura(s) - $${estado.proximas_a_vencer.total.toFixed(2)}
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    // Cargar facturas pendientes
    await cargarFacturasPendientesProveedor(proveedorId);
    
  } catch (err) {
    console.error('Error cargando estado de cuenta:', err);
    mostrarAlerta('Error cargando estado de cuenta del proveedor', 'error');
  }
}

// =====================
// CARGAR FACTURAS PENDIENTES DEL PROVEEDOR
// =====================
async function cargarFacturasPendientesProveedor(proveedorId) {
  try {
    const facturas = await apiFetch(`/api/facturas-compra?proveedor_id=${proveedorId}&estado=PENDIENTE`);
    facturasPendientesCache = facturas;
    actualizarTablaFacturasProveedor();
  } catch (err) {
    console.error('Error cargando facturas:', err);
    mostrarAlerta('Error cargando facturas pendientes', 'error');
  }
}

// =====================
// ACTUALIZAR TABLA DE FACTURAS PROVEEDOR
// =====================
function actualizarTablaFacturasProveedor() {
  const tbody = document.getElementById('facturasPendientesListProveedor');
  if (!tbody) return;
  
  if (!facturasPendientesCache || facturasPendientesCache.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px;">
          No hay facturas pendientes para este proveedor
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = facturasPendientesCache.map(f => {
    const hoy = new Date();
    const fechaEmision = new Date(f.fecha_emision);
    let fechaVencimiento = new Date(fechaEmision);
    
    // Calcular vencimiento según condición de pago
    switch(f.condicion_pago) {
      case 'CREDITO 30':
        fechaVencimiento.setDate(fechaVencimiento.getDate() + 30);
        break;
      case 'CREDITO 60':
        fechaVencimiento.setDate(fechaVencimiento.getDate() + 60);
        break;
      default:
        fechaVencimiento = fechaEmision;
    }
    
    const diasVencida = Math.ceil((hoy - fechaVencimiento) / (1000 * 60 * 60 * 24));
    const saldo = (f.total || 0) - (f.pagado || 0);
    
    let estadoClass = '';
    let estadoText = '';
    
    if (diasVencida > 0) {
      estadoClass = 'badge-danger';
      estadoText = `VENCIDA (${diasVencida} dias)`;
    } else {
      const diasRestantes = Math.ceil((fechaVencimiento - hoy) / (1000 * 60 * 60 * 24));
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
      <td><input type="checkbox" class="factura-check-proveedor" data-id="${f.id}" data-saldo="${saldo}" onchange="seleccionarFacturaProveedor(this)"></td>
      <td><strong>${f.tipo_factura || 'A'} ${f.punto_venta || '0001'}-${f.numero_factura}</strong></td>
      <td>${f.tipo_factura || 'A'}</td>
      <td>${new Date(f.fecha_emision).toLocaleDateString('es-AR')}</td>
      <td>$${Number(f.total || 0).toFixed(2)}</td>
      <td>$${Number(saldo).toFixed(2)}</td>
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
    const totalSeleccionado = aplicacionesPago.reduce((sum, f) => sum + f.monto_aplicar, 0);
    
    if (totalSeleccionado + saldo > totalPago && totalPago > 0) {
      mostrarAlerta(`El monto seleccionado ($${(totalSeleccionado + saldo).toFixed(2)}) supera el pago ($${totalPago.toFixed(2)})`, 'error');
      checkbox.checked = false;
      return;
    }
    
    aplicacionesPago.push({
      factura_id: id,
      monto_aplicar: saldo,
      saldo: saldo
    });
  } else {
    aplicacionesPago = aplicacionesPago.filter(f => f.factura_id !== id);
  }
  
  actualizarTablaAplicacionProveedor();
}

// =====================
// ACTUALIZAR TABLA DE APLICACIÓN PROVEEDOR
// =====================
function actualizarTablaAplicacionProveedor() {
  const tbody = document.getElementById('facturasAplicarListProveedor');
  if (!tbody) return;
  
  if (aplicacionesPago.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px;">
          Seleccione facturas para aplicar el pago
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = aplicacionesPago.map((f, index) => {
    const factura = facturasPendientesCache.find(fact => fact.id === f.factura_id);
    const facturaNumero = factura ? `${factura.tipo_factura || 'A'} ${factura.punto_venta || '0001'}-${factura.numero_factura}` : `Factura #${f.factura_id}`;
    
    return `
    <tr>
      <td>${facturaNumero}</td>
      <td>$${f.saldo.toFixed(2)}</td>
      <td>
        <input type="number" 
               class="monto-aplicar-proveedor" 
               data-index="${index}"
               value="${f.monto_aplicar.toFixed(2)}"
               min="0.01"
               max="${f.saldo}"
               step="0.01"
               onchange="actualizarMontoAplicarProveedor(${index}, this.value)">
      </td>
      <td>
        <button class="btn-remove" onclick="eliminarFacturaSeleccionadaProveedor(${index})">X</button>
      </td>
    </tr>
  `}).join('');

  calcularTotalAplicarProveedor();
}

// =====================
// ACTUALIZAR MONTO A APLICAR PROVEEDOR
// =====================
function actualizarMontoAplicarProveedor(index, monto) {
  if (aplicacionesPago[index]) {
    aplicacionesPago[index].monto_aplicar = parseFloat(monto) || 0;
    calcularTotalAplicarProveedor();
  }
}

// =====================
// ELIMINAR FACTURA SELECCIONADA PROVEEDOR
// =====================
function eliminarFacturaSeleccionadaProveedor(index) {
  const factura = aplicacionesPago[index];
  const checkbox = document.querySelector(`.factura-check-proveedor[data-id="${factura.factura_id}"]`);
  if (checkbox) checkbox.checked = false;
  
  aplicacionesPago.splice(index, 1);
  actualizarTablaAplicacionProveedor();
}

// =====================
// CALCULAR TOTAL A APLICAR PROVEEDOR
// =====================
function calcularTotalAplicarProveedor() {
  const total = aplicacionesPago.reduce((sum, f) => sum + f.monto_aplicar, 0);
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
  
  const index = pagoItemsProveedor ? pagoItemsProveedor.length : 0;
  
  const div = document.createElement('div');
  div.className = 'item-row';
  div.id = `pago-item-proveedor-${index}`;
  div.innerHTML = `
    <select id="item-tipo-proveedor-${index}" class="item-input item-tipo" onchange="cambiarTipoItemProveedor(${index})">
      <option value="EFECTIVO">Efectivo</option>
      <option value="CHEQUE">Cheque</option>
      <option value="TRANSFERENCIA">Transferencia</option>
    </select>
    <input type="number" id="item-monto-proveedor-${index}" class="item-input item-monto" placeholder="Monto" step="0.01" min="0" onchange="calcularTotalPagoProveedor()">
    <div id="item-detalle-proveedor-${index}" class="item-detalle"></div>
    <button type="button" class="btn-remove" onclick="eliminarItemPagoProveedor(${index})">X</button>
  `;
  
  container.appendChild(div);
  
  if (!pagoItemsProveedor) pagoItemsProveedor = [];
  pagoItemsProveedor.push({ index, tipo: 'EFECTIVO', monto: 0 });
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
  
  const item = pagoItemsProveedor?.find(i => i.index === index);
  if (item) item.tipo = tipo;
}

// =====================
// ELIMINAR ITEM DE PAGO PROVEEDOR
// =====================
function eliminarItemPagoProveedor(index) {
  const item = document.getElementById(`pago-item-proveedor-${index}`);
  if (item) item.remove();
  if (pagoItemsProveedor) {
    pagoItemsProveedor = pagoItemsProveedor.filter(item => item.index !== index);
  }
  calcularTotalPagoProveedor();
}

// =====================
// CALCULAR TOTAL DEL PAGO PROVEEDOR
// =====================
function calcularTotalPagoProveedor() {
  let total = 0;
  
  if (pagoItemsProveedor) {
    pagoItemsProveedor.forEach(item => {
      const input = document.getElementById(`item-monto-proveedor-${item.index}`);
      const monto = parseFloat(input?.value) || 0;
      if (monto < 0) {
        mostrarAlerta('El monto no puede ser negativo', 'error');
        if (input) input.value = 0;
        return;
      }
      total += monto;
    });
  }
  
  const totalElement = document.getElementById('total-pago-proveedor');
  if (totalElement) {
    totalElement.textContent = `$${total.toFixed(2)}`;
    totalElement.style.color = total === 0 ? '#999' : '#28a745';
  }
  
  if (aplicacionesPago.length > 0) {
    const totalSeleccionado = aplicacionesPago.reduce((sum, f) => sum + f.monto_aplicar, 0);
    if (totalSeleccionado > total) {
      mostrarAlerta('El pago es menor a las facturas seleccionadas', 'warning');
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
    mostrarAlerta('Complete los datos del proveedor y fecha', 'error');
    return;
  }

  const items = [];
  if (pagoItemsProveedor) {
    for (const item of pagoItemsProveedor) {
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
          mostrarAlerta('Complete todos los datos del cheque', 'error');
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
  }

  if (items.length === 0) {
    mostrarAlerta('Agregue al menos un item de pago', 'error');
    return;
  }

  const data = {
    proveedor_id: parseInt(proveedor_id),
    fecha_pago,
    observaciones: document.getElementById('observaciones_pago_proveedor')?.value || null,
    items
  };

  try {
    const response = await apiFetch('/api/pagos-proveedores/pagos', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    pagoActualId = response.pago.id;
    mostrarAlerta('✅ Pago registrado correctamente', 'success');
    
    const pagoIdSpan = document.getElementById('pago-id-proveedor');
    const montoPagoSpan = document.getElementById('monto-pago-proveedor');
    const pagoAplicarSection = document.getElementById('pago-aplicar-section-proveedor');
    
    if (pagoIdSpan) pagoIdSpan.textContent = pagoActualId;
    if (montoPagoSpan) montoPagoSpan.textContent = `$${calcularTotalPagoProveedor().toFixed(2)}`;
    if (pagoAplicarSection) pagoAplicarSection.style.display = 'block';
    
    const container = document.getElementById('pago-items-container-proveedor');
    if (container) container.innerHTML = '';
    pagoItemsProveedor = [];
    calcularTotalPagoProveedor();

  } catch (err) {
    console.error('Error guardando pago:', err);
    mostrarAlerta(err.error || 'Error guardando pago', 'error');
  }
}

// =====================
// APLICAR PAGO PROVEEDOR
// =====================
async function aplicarPagoProveedor() {
  if (!pagoActualId) {
    mostrarAlerta('Primero debe crear un pago', 'error');
    return;
  }

  if (aplicacionesPago.length === 0) {
    mostrarAlerta('Seleccione al menos una factura', 'error');
    return;
  }

  const aplicaciones = aplicacionesPago.map(f => ({
    factura_id: f.factura_id,
    monto_aplicado: f.monto_aplicar
  }));

  try {
    const response = await apiFetch(`/api/pagos-proveedores/pagos/${pagoActualId}/aplicar`, {
      method: 'POST',
      body: JSON.stringify({ aplicaciones })
    });

    mostrarAlerta('✅ Pago aplicado correctamente', 'success');
    
    const proveedorId = document.getElementById('proveedor_id')?.value;
    if (proveedorId) await cargarEstadoCuentaProveedor(proveedorId);
    
    aplicacionesPago = [];
    actualizarTablaAplicacionProveedor();
    
    const ordenSection = document.getElementById('orden-pago-section');
    if (ordenSection) ordenSection.style.display = 'block';

  } catch (err) {
    console.error('Error aplicando pago:', err);
    mostrarAlerta(err.error || 'Error aplicando pago', 'error');
  }
}

// =====================
// GENERAR ORDEN DE PAGO
// =====================
async function generarOrdenPago() {
  const numero_orden = document.getElementById('numero_orden_pago')?.value;
  const fecha_orden = document.getElementById('fecha_orden_pago')?.value;
  const proveedor_id = document.getElementById('proveedor_id')?.value;
  
  if (!numero_orden || !fecha_orden || !proveedor_id) {
    mostrarAlerta('Complete número, fecha y proveedor de la orden', 'error');
    return;
  }

  const data = {
    numero_orden,
    proveedor_id: parseInt(proveedor_id),
    fecha_orden,
    pago_ids: [pagoActualId],
    observaciones: document.getElementById('observaciones_orden_pago')?.value || null
  };

  try {
    const response = await apiFetch('/api/pagos-proveedores/ordenes', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    mostrarAlerta('✅ Orden de pago generada correctamente', 'success');
    
    const ordenSection = document.getElementById('orden-pago-section');
    const pagoAplicarSection = document.getElementById('pago-aplicar-section-proveedor');
    
    if (ordenSection) ordenSection.style.display = 'none';
    if (pagoAplicarSection) pagoAplicarSection.style.display = 'none';
    
    const numeroOrdenInput = document.getElementById('numero_orden_pago');
    const observacionesOrdenInput = document.getElementById('observaciones_orden_pago');
    if (numeroOrdenInput) numeroOrdenInput.value = '';
    if (observacionesOrdenInput) observacionesOrdenInput.value = '';
    
    cargarPagosProveedores();
    cargarOrdenesPago();

  } catch (err) {
    console.error('Error generando orden de pago:', err);
    mostrarAlerta(err.error || 'Error generando orden de pago', 'error');
  }
}

// =====================
// CARGAR PAGOS PROVEEDORES
// =====================
async function cargarPagosProveedores() {
  try {
    const proveedor_id = document.getElementById('filtroProveedorLista')?.value;
    const desde = document.getElementById('filtroDesdeLista')?.value;
    const hasta = document.getElementById('filtroHastaLista')?.value;
    const estado = document.getElementById('filtroEstadoLista')?.value;

    let url = '/api/pagos-proveedores/pagos';
    const params = [];
    
    if (proveedor_id) params.push(`proveedor_id=${proveedor_id}`);
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    if (estado) params.push(`estado=${estado}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const pagos = await apiFetch(url);
    pagosProveedoresCache = pagos;
    const tbody = document.getElementById('pagosProveedoresList');
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
          <td>${p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString('es-AR') : '-'}</td>
          <td>${p.proveedor_nombre || '-'}</td>
          <td>$${Number(p.monto_total || 0).toFixed(2)}</td>
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
// CARGAR ORDENES DE PAGO
// =====================
async function cargarOrdenesPago() {
  try {
    const proveedor_id = document.getElementById('filtroOrdenProveedor')?.value;
    const desde = document.getElementById('filtroOrdenDesde')?.value;
    const hasta = document.getElementById('filtroOrdenHasta')?.value;

    let url = '/api/pagos-proveedores/ordenes';
    const params = [];
    
    if (proveedor_id) params.push(`proveedor_id=${proveedor_id}`);
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const ordenes = await apiFetch(url);
    ordenesPagoCache = ordenes;
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
      const pagosHtml = o.pagos && Array.isArray(o.pagos) && o.pagos.length > 0 
        ? o.pagos.map(p => `<span class="badge badge-info">Pago #${p.id}</span>`).join(' ')
        : '-';
      
      return `
        <tr>
          <td>${o.numero_orden}</td>
          <td>${o.fecha_orden ? new Date(o.fecha_orden).toLocaleDateString('es-AR') : '-'}</td>
          <td>${o.proveedor_nombre || '-'}</td>
          <td>$${Number(o.monto_total || 0).toFixed(2)}</td>
          <td>${pagosHtml}</td>
          <td>
            <button class="btn btn-info btn-sm" onclick="verOrdenPago(${o.id})">👁️ Ver</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando órdenes de pago:', err);
  }
}

// =====================
// CARGAR CHEQUES PROVEEDORES
// =====================
async function cargarChequesProveedores() {
  try {
    const proveedor_id = document.getElementById('filtroChequeProveedor')?.value;
    const estado = document.getElementById('filtroChequeEstado')?.value;
    const desde = document.getElementById('filtroChequeDesde')?.value;
    const hasta = document.getElementById('filtroChequeHasta')?.value;

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
    chequesProveedoresCache = cheques;
    const tbody = document.getElementById('chequesProveedoresList');
    if (!tbody) return;
    
    if (!cheques || cheques.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 40px;">
            No hay cheques registrados
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = cheques.map(c => {
      let estadoClass = '';
      let estadoText = '';
      
      switch(c.estado) {
        case 'PENDIENTE':
          estadoClass = 'badge-warning';
          estadoText = 'Pendiente';
          break;
        case 'COBRADO':
          estadoClass = 'badge-success';
          estadoText = 'Cobrado';
          break;
        case 'RECHAZADO':
          estadoClass = 'badge-danger';
          estadoText = 'Rechazado';
          break;
        default:
          estadoClass = 'badge-secondary';
          estadoText = c.estado || 'Desconocido';
      }
      
      const hoy = new Date();
      const fechaCobro = new Date(c.fecha_cobro);
      const diasRestantes = Math.ceil((fechaCobro - hoy) / (1000 * 60 * 60 * 24));
      
      let alertaClass = '';
      if (diasRestantes <= 3 && diasRestantes >= 0) {
        alertaClass = 'table-warning';
      } else if (diasRestantes < 0) {
        alertaClass = 'table-danger';
      }
      
      return `
        <tr class="${alertaClass}">
          <td>${c.numero_cheque}</td>
          <td>${c.banco}</td>
          <td>${c.proveedor_nombre || '-'}</td>
          <td>$${Number(c.monto || 0).toFixed(2)}</td>
          <td>${c.fecha_emision ? new Date(c.fecha_emision).toLocaleDateString('es-AR') : '-'}</td>
          <td>${c.fecha_cobro ? new Date(c.fecha_cobro).toLocaleDateString('es-AR') : '-'}</td>
          <td><span class="badge ${estadoClass}">${estadoText}</span></td>
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
// CARGAR ALERTAS DE CHEQUES
// =====================
async function cargarAlertasCheques() {
  try {
    const alertas = await apiFetch('/api/pagos-proveedores/alertas-cheques');
    
    const alertasContainer = document.getElementById('alertas-cheques-proveedor');
    if (!alertasContainer) return;
    
    if (!alertas || alertas.length === 0) {
      alertasContainer.innerHTML = `
        <div class="alert alert-success">
          No hay alertas de cheques pendientes
        </div>
      `;
      return;
    }

    alertasContainer.innerHTML = alertas.map(a => {
      let alertClass = 'alert-warning';
      let icon = '⚠️';
      let mensaje = '';
      
      const hoy = new Date();
      const fechaCobro = new Date(a.fecha_cobro);
      const diasRestantes = Math.ceil((fechaCobro - hoy) / (1000 * 60 * 60 * 24));
      
      if (diasRestantes < 0) {
        alertClass = 'alert-danger';
        icon = '🚨';
        mensaje = `Cheque #${a.numero_cheque} VENCIDO hace ${Math.abs(diasRestantes)} días`;
      } else if (diasRestantes <= 3) {
        alertClass = 'alert-warning';
        icon = '⚠️';
        mensaje = `Cheque #${a.numero_cheque} vence en ${diasRestantes} días`;
      } else {
        alertClass = 'alert-info';
        icon = 'ℹ️';
        mensaje = `Cheque #${a.numero_cheque} vence en ${diasRestantes} días`;
      }
      
      return `
        <div class="alert ${alertClass}">
          ${icon} ${mensaje} - ${a.banco} - $${Number(a.monto || 0).toFixed(2)} - Proveedor: ${a.proveedor_nombre || 'Desconocido'}
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando alertas de cheques:', err);
  }
}

// =====================
// VER PAGO PROVEEDOR
// =====================
async function verPagoProveedor(pagoId) {
  try {
    const pago = await apiFetch(`/api/pagos-proveedores/pagos/${pagoId}`);
    
    const modal = document.getElementById('modalVerPagoProveedor');
    if (!modal) return;
    
    const modalBody = modal.querySelector('.modal-body');
    if (!modalBody) return;
    
    modalBody.innerHTML = `
      <div class="pago-detalle">
        <h4>Pago #${pago.id}</h4>
        <div class="detalle-grid">
          <div><strong>Proveedor:</strong> ${pago.proveedor_nombre || '-'}</div>
          <div><strong>Fecha:</strong> ${pago.fecha_pago ? new Date(pago.fecha_pago).toLocaleDateString('es-AR') : '-'}</div>
          <div><strong>Monto Total:</strong> $${Number(pago.monto_total || 0).toFixed(2)}</div>
          <div><strong>Estado:</strong> <span class="badge badge-${pago.estado || 'pendiente'}">${pago.estado || 'pendiente'}</span></div>
          <div><strong>Observaciones:</strong> ${pago.observaciones || '-'}</div>
        </div>
        
        <h5>Items de Pago</h5>
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Monto</th>
              <th>Detalles</th>
            </tr>
          </thead>
          <tbody>
            ${pago.items && Array.isArray(pago.items) ? pago.items.map(item => `
              <tr>
                <td>${item.tipo}</td>
                <td>$${Number(item.monto || 0).toFixed(2)}</td>
                <td>
                  ${item.tipo === 'CHEQUE' ? `
                    Cheque #${item.cheque_numero || '-'} - ${item.cheque_banco || '-'}<br>
                    Emisión: ${item.cheque_fecha_emision ? new Date(item.cheque_fecha_emision).toLocaleDateString('es-AR') : '-'}<br>
                    Cobro: ${item.cheque_fecha_cobro ? new Date(item.cheque_fecha_cobro).toLocaleDateString('es-AR') : '-'}
                  ` : ''}
                  ${item.tipo === 'TRANSFERENCIA' ? `
                    ${item.transferencia_banco_origen || '-'} → ${item.transferencia_banco_destino || '-'}<br>
                    Operación: ${item.transferencia_numero_operacion || '-'}<br>
                    Fecha: ${item.transferencia_fecha ? new Date(item.transferencia_fecha).toLocaleDateString('es-AR') : '-'}
                  ` : ''}
                  ${item.tipo === 'EFECTIVO' ? 'Efectivo' : ''}
                </td>
              </tr>
            `).join('') : '<tr><td colspan="3">No hay items</td></tr>'}
          </tbody>
        </table>
        
        <h5>Facturas Aplicadas</h5>
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Factura</th>
              <th>Monto Aplicado</th>
              <th>Fecha Aplicación</th>
            </tr>
          </thead>
          <tbody>
            ${pago.aplicaciones && Array.isArray(pago.aplicaciones) ? pago.aplicaciones.map(a => `
              <tr>
                <td>${a.factura_numero || `Factura #${a.factura_id}`}</td>
                <td>$${Number(a.monto_aplicado || 0).toFixed(2)}</td>
                <td>${a.fecha_aplicacion ? new Date(a.fecha_aplicacion).toLocaleDateString('es-AR') : '-'}</td>
              </tr>
            `).join('') : '<tr><td colspan="3">No hay aplicaciones</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    
    $(modal).modal('show');
    
  } catch (err) {
    console.error('Error cargando pago:', err);
    mostrarAlerta('Error cargando detalles del pago', 'error');
  }
}

// =====================
// VER ORDEN DE PAGO
// =====================
async function verOrdenPago(ordenId) {
  try {
    const orden = await apiFetch(`/api/pagos-proveedores/ordenes/${ordenId}`);
    
    const modal = document.getElementById('modalVerOrdenPago');
    if (!modal) return;
    
    const modalBody = modal.querySelector('.modal-body');
    if (!modalBody) return;
    
    modalBody.innerHTML = `
      <div class="orden-detalle">
        <h4>Orden de Pago #${orden.numero_orden}</h4>
        <div class="detalle-grid">
          <div><strong>Proveedor:</strong> ${orden.proveedor_nombre || '-'}</div>
          <div><strong>Fecha:</strong> ${orden.fecha_orden ? new Date(orden.fecha_orden).toLocaleDateString('es-AR') : '-'}</div>
          <div><strong>Monto Total:</strong> $${Number(orden.monto_total || 0).toFixed(2)}</div>
          <div><strong>Observaciones:</strong> ${orden.observaciones || '-'}</div>
        </div>
        
        <h5>Pagos Incluidos</h5>
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Pago ID</th>
              <th>Fecha</th>
              <th>Monto</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${orden.pagos && Array.isArray(orden.pagos) ? orden.pagos.map(p => `
              <tr>
                <td>#${p.id}</td>
                <td>${p.fecha_pago ? new Date(p.fecha_pago).toLocaleDateString('es-AR') : '-'}</td>
                <td>$${Number(p.monto_total || 0).toFixed(2)}</td>
                <td><span class="badge badge-${p.estado || 'pendiente'}">${p.estado || 'pendiente'}</span></td>
              </tr>
            `).join('') : '<tr><td colspan="4">No hay pagos</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    
    $(modal).modal('show');
    
  } catch (err) {
    console.error('Error cargando orden de pago:', err);
    mostrarAlerta('Error cargando detalles de la orden de pago', 'error');
  }
}

// =====================
// VER CHEQUE PROVEEDOR
// =====================
async function verChequeProveedor(chequeId) {
  try {
    const cheque = await apiFetch(`/api/pagos-proveedores/cheques/${chequeId}`);
    
    const modal = document.getElementById('modalVerChequeProveedor');
    if (!modal) return;
    
    const modalBody = modal.querySelector('.modal-body');
    if (!modalBody) return;
    
    modalBody.innerHTML = `
      <div class="cheque-detalle">
        <h4>Cheque #${cheque.numero_cheque}</h4>
        <div class="detalle-grid">
          <div><strong>Banco:</strong> ${cheque.banco}</div>
          <div><strong>Proveedor:</strong> ${cheque.proveedor_nombre || '-'}</div>
          <div><strong>Monto:</strong> $${Number(cheque.monto || 0).toFixed(2)}</div>
          <div><strong>Estado:</strong> <span class="badge badge-${cheque.estado || 'pendiente'}">${cheque.estado || 'pendiente'}</span></div>
          <div><strong>Fecha Emisión:</strong> ${cheque.fecha_emision ? new Date(cheque.fecha_emision).toLocaleDateString('es-AR') : '-'}</div>
          <div><strong>Fecha Cobro:</strong> ${cheque.fecha_cobro ? new Date(cheque.fecha_cobro).toLocaleDateString('es-AR') : '-'}</div>
          <div><strong>Pago ID:</strong> ${cheque.pago_id ? `#${cheque.pago_id}` : '-'}</div>
          <div><strong>Observaciones:</strong> ${cheque.observaciones || '-'}</div>
        </div>
        
        <h5>Información del Pago</h5>
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Fecha Pago</th>
              <th>Proveedor</th>
              <th>Monto Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${cheque.pago_fecha ? new Date(cheque.pago_fecha).toLocaleDateString('es-AR') : '-'}</td>
              <td>${cheque.proveedor_nombre || '-'}</td>
              <td>$${Number(cheque.pago_monto_total || 0).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    
    $(modal).modal('show');
    
  } catch (err) {
    console.error('Error cargando cheque:', err);
    mostrarAlerta('Error cargando detalles del cheque', 'error');
  }
}

// =====================
// FUNCIONES AUXILIARES
// =====================

// Mostrar alerta
function mostrarAlerta(mensaje, tipo = 'info') {
  const alertaDiv = document.createElement('div');
  alertaDiv.className = `alert alert-${tipo} alert-dismissible fade show`;
  alertaDiv.innerHTML = `
    ${mensaje}
    <button type="button" class="close" data-dismiss="alert" aria-label="Close">
      <span aria-hidden="true">&times;</span>
    </button>
  `;
  
  const container = document.getElementById('alert-container-proveedor');
  if (container) {
    container.appendChild(alertaDiv);
    setTimeout(() => {
      if (alertaDiv.parentNode) {
        $(alertaDiv).alert('close');
      }
    }, 5000);
  } else {
    alert(mensaje);
  }
}

// API Fetch wrapper
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('token');
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    }
  };
  
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  };
  
  const response = await fetch(url, mergedOptions);
  
  if (!response.ok) {
    let errorMessage = `Error ${response.status}: ${response.statusText}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // Si no se puede parsear como JSON, usar el mensaje por defecto
    }
    throw new Error(errorMessage);
  }
  
  return response.json();
}

// =====================
// INICIALIZAR VARIABLES
// =====================
let pagoItemsProveedor = [];



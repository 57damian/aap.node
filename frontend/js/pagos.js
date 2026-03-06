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
  console.log('✅ pagos.js cargado');

  // Setear fecha actual
  const hoy = new Date().toISOString().split('T')[0];
  const fechaRecepcion = document.getElementById('fecha_recepcion');
  const fechaEmision = document.getElementById('fecha_emision');
  
  if (fechaRecepcion) fechaRecepcion.value = hoy;
  if (fechaEmision) fechaEmision.value = hoy;

  // Cargar datos iniciales
  await cargarClientes();
  await cargarTalonarios();
  await verificarAlertasCheques();

  // Event listeners
  const clienteSelect = document.getElementById('cliente_id');
  if (clienteSelect) {
    clienteSelect.addEventListener('change', async (e) => {
      if (e.target.value) {
        await cargarFacturasPendientes(e.target.value);
      }
    });
  }

  const btnGuardarPago = document.getElementById('btnGuardarPago');
  if (btnGuardarPago) btnGuardarPago.addEventListener('click', guardarPago);

  const btnAplicarPago = document.getElementById('btnAplicarPago');
  if (btnAplicarPago) btnAplicarPago.addEventListener('click', aplicarPago);

  const btnGenerarRecibo = document.getElementById('btnGenerarRecibo');
  if (btnGenerarRecibo) btnGenerarRecibo.addEventListener('click', generarRecibo);

  // Cargar listados iniciales
  cargarPagos();
  cargarRecibos();
  cargarCheques();
});

// =====================
// CARGAR CLIENTES - VERSIÓN CORREGIDA
// =====================
async function cargarClientes() {
  try {
    const clientes = await apiFetch('/api/clientes');
    
    // Select para pago
    const selectPago = document.getElementById('cliente_id');
    if (selectPago) {
      selectPago.innerHTML = '<option value="">-- Seleccionar Cliente --</option>';
      clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.id;
        option.textContent = cliente.nombre;
        selectPago.appendChild(option);
      });
    }
    
    // Select para filtro de pagos
    const selectFiltro = document.getElementById('filtroCliente');
    if (selectFiltro) {
      selectFiltro.innerHTML = '<option value="">Todos los clientes</option>';
      clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.id;
        option.textContent = cliente.nombre;
        selectFiltro.appendChild(option);
      });
    }
    
    // Select para filtro de recibos
    const selectReciboFiltro = document.getElementById('filtroReciboCliente');
    if (selectReciboFiltro) {
      selectReciboFiltro.innerHTML = '<option value="">Todos los clientes</option>';
      clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.id;
        option.textContent = cliente.nombre;
        selectReciboFiltro.appendChild(option);
      });
    }
    
    // Select para filtro de cheques
    const selectChequeFiltro = document.getElementById('filtroChequeCliente');
    if (selectChequeFiltro) {
      selectChequeFiltro.innerHTML = '<option value="">Todos los clientes</option>';
      clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.id;
        option.textContent = cliente.nombre;
        selectChequeFiltro.appendChild(option);
      });
    }
    
  } catch (err) {
    console.error('Error cargando clientes:', err);
    mostrarAlerta('Error cargando clientes', 'error');
  }
}

// =====================
// CARGAR TALONARIOS
// =====================
async function cargarTalonarios() {
  try {
    const talonarios = await apiFetch('/api/pagos/talonarios');
    const select = document.getElementById('talonario_id');
    if (select) {
      select.innerHTML = '<option value="">-- Seleccionar Talonario --</option>';
      talonarios.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.numero_talonario;
        select.appendChild(option);
      });
    }
  } catch (err) {
    console.error('Error cargando talonarios:', err);
  }
}

// =====================
// CARGAR FACTURAS PENDIENTES - VERSION MEJORADA
// =====================
async function cargarFacturasPendientes(clienteId) {
  try {
    facturasPendientes = await apiFetch(`/api/pagos/facturas-pendientes/${clienteId}`);
    actualizarTablaFacturas();
    await cargarEstadoCuenta(clienteId);
  } catch (err) {
    console.error('Error cargando facturas:', err);
    mostrarAlerta('Error cargando facturas pendientes', 'error');
  }
}

// =====================
// CARGAR ESTADO DE CUENTA DEL CLIENTE (NUEVO)
// =====================
async function cargarEstadoCuenta(clienteId) {
  try {
    const estado = await apiFetch(`/api/pagos/estado-cuenta/${clienteId}`);

    let resumenDiv = document.getElementById('resumen-cuenta');
    if (!resumenDiv) {
      resumenDiv = document.createElement('div');
      resumenDiv.id = 'resumen-cuenta';
      resumenDiv.className = 'resumen-cuenta';

      const formSection = document.querySelector('.form-section');
      if (formSection && formSection.parentNode) {
        formSection.parentNode.insertBefore(resumenDiv, formSection);
      }
    }

    resumenDiv.innerHTML = `
      <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #007bff;">
        <h4 style="margin: 0 0 10px 0;">Resumen de Cuenta</h4>
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
  } catch (err) {
    console.error('Error cargando estado de cuenta:', err);
  }
}

// =====================
// ACTUALIZAR TABLA DE FACTURAS - VERSION MEJORADA
// =====================
function actualizarTablaFacturas() {
  const tbody = document.getElementById('facturasPendientesList');
  if (!tbody) return;
  
  if (!facturasPendientes || facturasPendientes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px;">
          No hay facturas pendientes para este cliente
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
    
    if (f.estado_pago === 'vencida') {
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
      <td><input type="checkbox" class="factura-check" data-id="${f.id}" data-saldo="${f.saldo}" onchange="seleccionarFactura(this)"></td>
      <td><strong>${f.numero_factura}</strong></td>
      <td>${f.tipo_factura || 'A'}</td>
      <td>${new Date(f.fecha).toLocaleDateString('es-AR')}</td>
      <td>$${Number(f.total).toFixed(2)}</td>
      <td>$${Number(f.saldo).toFixed(2)}</td>
      <td><span class="badge ${estadoClass}">${estadoText}</span></td>
    </tr>
  `;
  }).join('');
}

// =====================
// SELECCIONAR FACTURA - CON VALIDACION DE MONTO
// =====================
function seleccionarFactura(checkbox) {
  const id = parseInt(checkbox.dataset.id);
  const saldo = parseFloat(checkbox.dataset.saldo);
  
  if (checkbox.checked) {
    const totalPago = calcularTotalPago();
    const totalSeleccionado = facturasSeleccionadas.reduce((sum, f) => sum + f.monto, 0);
    
    if (totalSeleccionado + saldo > totalPago && totalPago > 0) {
      mostrarAlerta(`El monto seleccionado ($${(totalSeleccionado + saldo).toFixed(2)}) supera el pago ($${totalPago.toFixed(2)})`, 'error');
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
  
  actualizarTablaAplicacion();
}

// =====================
// ACTUALIZAR TABLA DE APLICACIÓN
// =====================
function actualizarTablaAplicacion() {
  const tbody = document.getElementById('facturasAplicarList');
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
               class="monto-aplicar" 
               data-index="${index}"
               value="${f.monto.toFixed(2)}"
               min="0.01"
               max="${f.saldo}"
               step="0.01"
               onchange="actualizarMontoAplicar(${index}, this.value)">
      </td>
      <td>
        <button class="btn-remove" onclick="eliminarFacturaSeleccionada(${index})">X</button>
      </td>
    </tr>
  `).join('');

  calcularTotalAplicar();
}

// =====================
// ACTUALIZAR MONTO A APLICAR
// =====================
function actualizarMontoAplicar(index, monto) {
  if (facturasSeleccionadas[index]) {
    facturasSeleccionadas[index].monto = parseFloat(monto) || 0;
    calcularTotalAplicar();
  }
}

// =====================
// ELIMINAR FACTURA SELECCIONADA
// =====================
function eliminarFacturaSeleccionada(index) {
  const factura = facturasSeleccionadas[index];
  const checkbox = document.querySelector(`.factura-check[data-id="${factura.factura_id}"]`);
  if (checkbox) checkbox.checked = false;
  
  facturasSeleccionadas.splice(index, 1);
  actualizarTablaAplicacion();
}

// =====================
// CALCULAR TOTAL A APLICAR
// =====================
function calcularTotalAplicar() {
  const total = facturasSeleccionadas.reduce((sum, f) => sum + f.monto, 0);
  const totalElement = document.getElementById('total-aplicar');
  if (totalElement) totalElement.textContent = `$${total.toFixed(2)}`;
  return total;
}

// =====================
// AGREGAR ITEM DE PAGO
// =====================
function agregarItemPago() {
  const container = document.getElementById('pago-items-container');
  if (!container) return;
  
  const index = pagoItems.length;
  
  const div = document.createElement('div');
  div.className = 'item-row';
  div.id = `pago-item-${index}`;
  div.innerHTML = `
    <select id="item-tipo-${index}" class="item-input item-tipo" onchange="cambiarTipoItem(${index})">
      <option value="EFECTIVO">Efectivo</option>
      <option value="CHEQUE">Cheque</option>
      <option value="TRANSFERENCIA">Transferencia</option>
    </select>
    <input type="number" id="item-monto-${index}" class="item-input item-monto" placeholder="Monto" step="0.01" min="0" onchange="calcularTotalPago()">
    <div id="item-detalle-${index}" class="item-detalle"></div>
    <button type="button" class="btn-remove" onclick="eliminarItemPago(${index})">X</button>
  `;
  
  container.appendChild(div);
  pagoItems.push({ index, tipo: 'EFECTIVO', monto: 0 });
  cambiarTipoItem(index);
}

// =====================
// CAMBIAR TIPO DE ITEM
// =====================
function cambiarTipoItem(index) {
  const tipo = document.getElementById(`item-tipo-${index}`)?.value;
  const detalleDiv = document.getElementById(`item-detalle-${index}`);
  if (!detalleDiv) return;
  
  let html = '';
  if (tipo === 'CHEQUE') {
    html = `
      <input type="text" class="item-input" id="item-cheque-numero-${index}" placeholder="Nro Cheque">
      <input type="text" class="item-input" id="item-cheque-banco-${index}" placeholder="Banco">
      <input type="date" class="item-input" id="item-cheque-fecha-emision-${index}">
      <input type="date" class="item-input" id="item-cheque-fecha-cobro-${index}">
    `;
  } else if (tipo === 'TRANSFERENCIA') {
    html = `
      <input type="text" class="item-input" id="item-transferencia-origen-${index}" placeholder="Banco Origen">
      <input type="text" class="item-input" id="item-transferencia-destino-${index}" placeholder="Banco Destino">
      <input type="text" class="item-input" id="item-transferencia-operacion-${index}" placeholder="Nro Operacion">
      <input type="date" class="item-input" id="item-transferencia-fecha-${index}">
    `;
  }
  
  detalleDiv.innerHTML = html;
  
  const item = pagoItems.find(i => i.index === index);
  if (item) item.tipo = tipo;
}

// =====================
// ELIMINAR ITEM DE PAGO
// =====================
function eliminarItemPago(index) {
  const item = document.getElementById(`pago-item-${index}`);
  if (item) item.remove();
  pagoItems = pagoItems.filter(item => item.index !== index);
  calcularTotalPago();
}

// =====================
// CALCULAR TOTAL DEL PAGO - CON VALIDACION
// =====================
function calcularTotalPago() {
  let total = 0;
  
  pagoItems.forEach(item => {
    const input = document.getElementById(`item-monto-${item.index}`);
    const monto = parseFloat(input?.value) || 0;
    if (monto < 0) {
      mostrarAlerta('El monto no puede ser negativo', 'error');
      if (input) input.value = 0;
      return;
    }
    total += monto;
  });
  
  const totalElement = document.getElementById('total-pago');
  if (totalElement) {
    totalElement.textContent = `$${total.toFixed(2)}`;
    totalElement.style.color = total === 0 ? '#999' : '#28a745';
  }
  
  if (facturasSeleccionadas.length > 0) {
    const totalSeleccionado = facturasSeleccionadas.reduce((sum, f) => sum + f.monto, 0);
    if (totalSeleccionado > total) {
      mostrarAlerta('El pago es menor a las facturas seleccionadas', 'warning');
    }
  }
  
  return total;
}

// =====================
// GUARDAR PAGO
// =====================
async function guardarPago() {
  const cliente_id = document.getElementById('cliente_id')?.value;
  const fecha_recepcion = document.getElementById('fecha_recepcion')?.value;
  
  if (!cliente_id || !fecha_recepcion) {
    mostrarAlerta('Complete los datos del cliente y fecha', 'error');
    return;
  }

  const items = [];
  for (const item of pagoItems) {
    const monto = parseFloat(document.getElementById(`item-monto-${item.index}`)?.value);
    if (!monto || monto <= 0) continue;
    
    const tipo = document.getElementById(`item-tipo-${item.index}`)?.value;
    const itemData = {
      tipo,
      monto,
      observaciones: ''
    };
    
    if (tipo === 'CHEQUE') {
      itemData.cheque_numero = document.getElementById(`item-cheque-numero-${item.index}`)?.value;
      itemData.cheque_banco = document.getElementById(`item-cheque-banco-${item.index}`)?.value;
      itemData.cheque_fecha_emision = document.getElementById(`item-cheque-fecha-emision-${item.index}`)?.value;
      itemData.cheque_fecha_cobro = document.getElementById(`item-cheque-fecha-cobro-${item.index}`)?.value;
      
      if (!itemData.cheque_numero || !itemData.cheque_banco || !itemData.cheque_fecha_cobro) {
        mostrarAlerta('Complete todos los datos del cheque', 'error');
        return;
      }
    }
    
    if (tipo === 'TRANSFERENCIA') {
      itemData.transferencia_banco_origen = document.getElementById(`item-transferencia-origen-${item.index}`)?.value;
      itemData.transferencia_banco_destino = document.getElementById(`item-transferencia-destino-${item.index}`)?.value;
      itemData.transferencia_numero_operacion = document.getElementById(`item-transferencia-operacion-${item.index}`)?.value;
      itemData.transferencia_fecha = document.getElementById(`item-transferencia-fecha-${item.index}`)?.value || fecha_recepcion;
    }
    
    items.push(itemData);
  }

  if (items.length === 0) {
    mostrarAlerta('Agregue al menos un item de pago', 'error');
    return;
  }

  const data = {
    cliente_id: parseInt(cliente_id),
    fecha_recepcion,
    observaciones: document.getElementById('observaciones_pago')?.value || null,
    items
  };

  try {
    const response = await apiFetch('/api/pagos/pagos', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    pagoId = response.pago.id;
    mostrarAlerta('✅ Pago registrado correctamente', 'success');
    
    const pagoIdSpan = document.getElementById('pago-id');
    const montoPagoSpan = document.getElementById('monto-pago');
    const pagoAplicarSection = document.getElementById('pago-aplicar-section');
    
    if (pagoIdSpan) pagoIdSpan.textContent = pagoId;
    if (montoPagoSpan) montoPagoSpan.textContent = `$${calcularTotalPago().toFixed(2)}`;
    if (pagoAplicarSection) pagoAplicarSection.style.display = 'block';
    
    const container = document.getElementById('pago-items-container');
    if (container) container.innerHTML = '';
    pagoItems = [];
    calcularTotalPago();

  } catch (err) {
    console.error('Error guardando pago:', err);
    mostrarAlerta(err.error || 'Error guardando pago', 'error');
  }
}

// =====================
// APLICAR PAGO
// =====================
async function aplicarPago() {
  if (!pagoId) {
    mostrarAlerta('Primero debe crear un pago', 'error');
    return;
  }

  if (facturasSeleccionadas.length === 0) {
    mostrarAlerta('Seleccione al menos una factura', 'error');
    return;
  }

  const aplicaciones = facturasSeleccionadas.map(f => ({
    factura_id: f.factura_id,
    monto_aplicado: f.monto
  }));

  try {
    const response = await apiFetch(`/api/pagos/pagos/${pagoId}/aplicar`, {
      method: 'POST',
      body: JSON.stringify({ aplicaciones })
    });

    mostrarAlerta('✅ Pago aplicado correctamente', 'success');
    
    const clienteId = document.getElementById('cliente_id')?.value;
    if (clienteId) await cargarFacturasPendientes(clienteId);
    
    facturasSeleccionadas = [];
    actualizarTablaAplicacion();
    
    const reciboSection = document.getElementById('recibo-section');
    if (reciboSection) reciboSection.style.display = 'block';

  } catch (err) {
    console.error('Error aplicando pago:', err);
    mostrarAlerta(err.error || 'Error aplicando pago', 'error');
  }
}

// =====================
// GENERAR RECIBO
// =====================
async function generarRecibo() {
  const numero_recibo = document.getElementById('numero_recibo')?.value;
  const talonario_id = document.getElementById('talonario_id')?.value;
  const fecha_emision = document.getElementById('fecha_emision')?.value;
  const cliente_id = document.getElementById('cliente_id')?.value;
  
  if (!numero_recibo || !fecha_emision || !cliente_id) {
    mostrarAlerta('Complete número, fecha y cliente del recibo', 'error');
    return;
  }

  let talonario_numero = null;
  if (talonario_id) {
    const select = document.getElementById('talonario_id');
    talonario_numero = select.options[select.selectedIndex]?.text;
  }

  const data = {
    numero_recibo,
    talonario_numero,
    cliente_id: parseInt(cliente_id),
    fecha_emision,
    pago_ids: [pagoId],
    observaciones: document.getElementById('observaciones_recibo')?.value || null
  };

  try {
    const response = await apiFetch('/api/pagos/recibos', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    mostrarAlerta('✅ Recibo generado correctamente', 'success');
    
    const reciboSection = document.getElementById('recibo-section');
    const pagoAplicarSection = document.getElementById('pago-aplicar-section');
    
    if (reciboSection) reciboSection.style.display = 'none';
    if (pagoAplicarSection) pagoAplicarSection.style.display = 'none';
    
    const numeroReciboInput = document.getElementById('numero_recibo');
    const observacionesReciboInput = document.getElementById('observaciones_recibo');
    if (numeroReciboInput) numeroReciboInput.value = '';
    if (observacionesReciboInput) observacionesReciboInput.value = '';
    
    cargarPagos();
    cargarRecibos();

  } catch (err) {
    console.error('Error generando recibo:', err);
    mostrarAlerta(err.error || 'Error generando recibo', 'error');
  }
}

// =====================
// CARGAR PAGOS - VERSIÓN CORREGIDA
// =====================
async function cargarPagos() {
  try {
    const cliente_id = document.getElementById('filtroCliente')?.value;
    const desde = document.getElementById('filtroDesde')?.value;
    const hasta = document.getElementById('filtroHasta')?.value;
    const estado = document.getElementById('filtroEstado')?.value;

    let url = '/api/pagos/pagos';
    const params = [];
    
    if (cliente_id) params.push(`cliente_id=${cliente_id}`);
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    if (estado) params.push(`estado=${estado}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const pagos = await apiFetch(url);
    const tbody = document.getElementById('pagosList');
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
      // Verificar que p.items existe antes de mapear
      const itemsHtml = p.items && Array.isArray(p.items) && p.items.length > 0 
        ? p.items.map(i => `<span class="badge badge-${(i.tipo || '').toLowerCase()}">${i.tipo || ''}</span>`).join('')
        : '-';
      
      return `
        <tr>
          <td>#${p.id}</td>
          <td>${p.fecha_recepcion ? new Date(p.fecha_recepcion).toLocaleDateString('es-AR') : '-'}</td>
          <td>${p.cliente_nombre || '-'}</td>
          <td>$${Number(p.monto_total || 0).toFixed(2)}</td>
          <td>${itemsHtml}</td>
          <td><span class="badge badge-${p.estado || 'pendiente'}">${p.estado || 'pendiente'}</span></td>
          <td>
            <button class="btn btn-info btn-sm" onclick="verPago(${p.id})">👁️ Ver</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando pagos:', err);
  }
}

// =====================
// CARGAR RECIBOS
// =====================
async function cargarRecibos() {
  try {
    const cliente_id = document.getElementById('filtroReciboCliente')?.value;
    const desde = document.getElementById('filtroReciboDesde')?.value;
    const hasta = document.getElementById('filtroReciboHasta')?.value;

    let url = '/api/pagos/recibos';
    const params = [];
    
    if (cliente_id) params.push(`cliente_id=${cliente_id}`);
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const recibos = await apiFetch(url);
    const tbody = document.getElementById('recibosList');
    if (!tbody) return;
    
    if (!recibos || recibos.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 40px;">
            No hay recibos generados
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = recibos.map(r => `
      <tr>
        <td><strong>${r.numero_recibo || '-'}</strong></td>
        <td>${r.fecha_emision ? new Date(r.fecha_emision).toLocaleDateString('es-AR') : '-'}</td>
        <td>${r.cliente_nombre || '-'}</td>
        <td>$${Number(r.total_pagado || 0).toFixed(2)}</td>
        <td>${r.numero_talonario || '-'}</td>
        <td>
          <button class="btn btn-info btn-sm" onclick="verRecibo(${r.id})">👁️ Ver</button>
          <button class="btn btn-primary btn-sm" onclick="generarPDF(${r.id})">📄 PDF</button>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    console.error('Error cargando recibos:', err);
  }
}

// =====================
// CARGAR CHEQUES
// =====================
async function cargarCheques() {
  try {
    const cliente_id = document.getElementById('filtroChequeCliente')?.value;
    const estado = document.getElementById('filtroChequeEstado')?.value;
    const desde = document.getElementById('filtroChequeDesde')?.value;
    const hasta = document.getElementById('filtroChequeHasta')?.value;

    let url = '/api/pagos/cheques';
    const params = [];
    
    if (cliente_id) params.push(`cliente_id=${cliente_id}`);
    if (estado) params.push(`estado=${estado}`);
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const cheques = await apiFetch(url);
    const tbody = document.getElementById('chequesList');
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
      const diasRestantes = c.cheque_fecha_cobro ? Math.ceil((new Date(c.cheque_fecha_cobro) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
      let estadoClass = 'badge-pendiente';
      if (c.cheque_estado === 'depositado') estadoClass = 'badge-depositado';
      if (c.cheque_estado === 'acreditado') estadoClass = 'badge-acreditado';
      if (c.cheque_estado === 'rechazado') estadoClass = 'badge-rechazado';

      return `
        <tr>
          <td><strong>${c.cheque_numero || '-'}</strong></td>
          <td>${c.cheque_banco || '-'}</td>
          <td>${c.cliente_nombre || '-'}</td>
          <td>$${Number(c.monto || 0).toFixed(2)}</td>
          <td>${c.cheque_fecha_emision ? new Date(c.cheque_fecha_emision).toLocaleDateString('es-AR') : '-'}</td>
          <td>
            ${c.cheque_fecha_cobro ? new Date(c.cheque_fecha_cobro).toLocaleDateString('es-AR') : '-'}
            ${diasRestantes <= 3 && c.cheque_estado === 'pendiente' ? 
              `<br><span style="color: #dc3545; font-size: 12px;">⚠️ Vence en ${diasRestantes} días</span>` : ''}
          </td>
          <td><span class="badge ${estadoClass}">${c.cheque_estado || 'pendiente'}</span></td>
          <td>
            <button class="btn btn-info btn-sm" onclick="verCheque(${c.id})">👁️ Ver</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando cheques:', err);
  }
}

// =====================
// VERIFICAR ALERTAS DE CHEQUES
// =====================
async function verificarAlertasCheques() {
  try {
    const alertas = await apiFetch('/api/pagos/cheques/alertas?dias=3');
    
    if (alertas.total > 0) {
      const alertaDiv = document.getElementById('alertasCheques');
      const alertaCount = document.getElementById('alertasChequesCount');
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
// VER ALERTAS DE CHEQUES
// =====================
function verAlertasCheques() {
  showTab('cheques-list');
  const filtroEstado = document.getElementById('filtroChequeEstado');
  if (filtroEstado) filtroEstado.value = 'pendiente';
  cargarCheques();
}

// =====================
// VER PAGO
// =====================
async function verPago(id) {
  try {
    const pago = await apiFetch(`/api/pagos/pagos/${id}`);
    
    const detalle = document.getElementById('pagoDetalle');
    if (!detalle) return;
    
    detalle.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h4>Pago #${pago.id}</h4>
        <p><strong>Fecha:</strong> ${pago.fecha_recepcion ? new Date(pago.fecha_recepcion).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Cliente:</strong> ${pago.cliente_nombre || '-'}</p>
        <p><strong>Total:</strong> $${Number(pago.monto_total || 0).toFixed(2)}</p>
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

    const modal = document.getElementById('pagoModal');
    if (modal) modal.style.display = 'block';

  } catch (err) {
    console.error('Error cargando pago:', err);
    mostrarAlerta('Error cargando detalle del pago', 'error');
  }
}

// =====================
// VER RECIBO
// =====================
async function verRecibo(id) {
  try {
    const recibo = await apiFetch(`/api/pagos/recibos/${id}`);
    
    const detalle = document.getElementById('reciboDetalle');
    if (!detalle) return;
    
    detalle.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h4>Recibo N°: ${recibo.numero_recibo || '-'}</h4>
        <p><strong>Fecha:</strong> ${recibo.fecha_emision ? new Date(recibo.fecha_emision).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Cliente:</strong> ${recibo.cliente_nombre || '-'}</p>
        <p><strong>Talonario:</strong> ${recibo.numero_talonario || '-'}</p>
        <p><strong>Total:</strong> $${Number(recibo.total_pagado || 0).toFixed(2)}</p>
      </div>
    `;

    const modal = document.getElementById('reciboModal');
    if (modal) modal.style.display = 'block';

  } catch (err) {
    console.error('Error cargando recibo:', err);
    mostrarAlerta('Error cargando detalle del recibo', 'error');
  }
}

// =====================
// VER CHEQUE
// =====================
async function verCheque(id) {
  try {
    const cheque = await apiFetch(`/api/pagos/cheques/${id}`);
    
    const detalle = document.getElementById('chequeDetalle');
    if (!detalle) return;
    
    detalle.innerHTML = `
      <div style="margin-bottom: 20px;">
        <p><strong>Cheque N°:</strong> ${cheque.cheque_numero || '-'}</p>
        <p><strong>Banco:</strong> ${cheque.cheque_banco || '-'}</p>
        <p><strong>Cliente:</strong> ${cheque.cliente_nombre || '-'}</p>
        <p><strong>Monto:</strong> $${Number(cheque.monto || 0).toFixed(2)}</p>
        <p><strong>Fecha Emisión:</strong> ${cheque.cheque_fecha_emision ? new Date(cheque.cheque_fecha_emision).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Fecha Cobro:</strong> ${cheque.cheque_fecha_cobro ? new Date(cheque.cheque_fecha_cobro).toLocaleDateString('es-AR') : '-'}</p>
        <p><strong>Estado:</strong> <span class="badge badge-${cheque.cheque_estado || 'pendiente'}">${cheque.cheque_estado || 'pendiente'}</span></p>
        ${cheque.cheque_fecha_depositado ? `<p><strong>Fecha Depósito:</strong> ${new Date(cheque.cheque_fecha_depositado).toLocaleDateString('es-AR')}</p>` : ''}
        ${cheque.cheque_gasto_comision ? `<p><strong>Gasto Comisión:</strong> $${Number(cheque.cheque_gasto_comision).toFixed(2)}</p>` : ''}
        ${cheque.cheque_motivo_rechazo ? `<p><strong>Motivo Rechazo:</strong> ${cheque.cheque_motivo_rechazo}</p>` : ''}
      </div>

      ${cheque.cheque_estado === 'pendiente' ? `
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button class="btn btn-info" onclick="depositarCheque(${cheque.id})">🏦 Depositar</button>
          <button class="btn btn-danger" onclick="rechazarCheque(${cheque.id})">❌ Rechazar</button>
        </div>
      ` : ''}

      ${cheque.cheque_estado === 'depositado' ? `
        <div style="margin-top: 20px;">
          <button class="btn btn-success" onclick="acreditarCheque(${cheque.id})">✅ Acreditar</button>
        </div>
      ` : ''}
    `;

    const modal = document.getElementById('chequeModal');
    if (modal) modal.style.display = 'block';

  } catch (err) {
    console.error('Error cargando cheque:', err);
    mostrarAlerta('Error cargando cheque', 'error');
  }
}

// =====================
// DEPOSITAR CHEQUE
// =====================
async function depositarCheque(id) {
  const fecha = prompt('Ingrese fecha de depósito (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
  if (!fecha) return;

  try {
    await apiFetch(`/api/pagos/cheques/${id}/depositar`, {
      method: 'POST',
      body: JSON.stringify({ fecha_depositado: fecha })
    });

    mostrarAlerta('✅ Cheque depositado correctamente', 'success');
    cerrarModal('chequeModal');
    cargarCheques();
    verificarAlertasCheques();

  } catch (err) {
    console.error('Error depositando cheque:', err);
    mostrarAlerta(err.error || 'Error depositando cheque', 'error');
  }
}

// =====================
// RECHAZAR CHEQUE
// =====================
async function rechazarCheque(id) {
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
    await apiFetch(`/api/pagos/cheques/${id}/rechazar`, {
      method: 'POST',
      body: JSON.stringify({
        motivo_rechazo: motivo,
        gasto_comision: parseFloat(comision) || 0,
        nuevo_cheque: nuevoCheque
      })
    });

    mostrarAlerta('✅ Cheque rechazado registrado', 'success');
    cerrarModal('chequeModal');
    cargarCheques();

  } catch (err) {
    console.error('Error rechazando cheque:', err);
    mostrarAlerta(err.error || 'Error rechazando cheque', 'error');
  }
}

// =====================
// ACREDITAR CHEQUE
// =====================
async function acreditarCheque(id) {
  if (!confirm('¿Confirmar acreditación del cheque?')) return;

  try {
    await apiFetch(`/api/pagos/cheques/${id}/acreditar`, {
      method: 'PUT'
    });

    mostrarAlerta('✅ Cheque acreditado correctamente', 'success');
    cerrarModal('chequeModal');
    cargarCheques();

  } catch (err) {
    console.error('Error acreditando cheque:', err);
    mostrarAlerta(err.error || 'Error acreditando cheque', 'error');
  }
}

// =====================
// CERRAR MODAL
// =====================
function cerrarModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

// =====================
// GENERAR PDF
// =====================
async function generarPDF(id) {
  try {
    const response = await apiFetch(`/api/pagos/recibos/${id}/pdf`);
    mostrarAlerta('✅ PDF generado correctamente', 'success');
    // window.open(`/api/pagos/recibos/${id}/pdf/download`, '_blank');
  } catch (err) {
    console.error('Error generando PDF:', err);
    mostrarAlerta('Error generando PDF', 'error');
  }
}

// =====================
// RESET FORMS
// =====================
function resetForms() {
  const itemsContainer = document.getElementById('pago-items-container');
  if (itemsContainer) itemsContainer.innerHTML = '';
  
  const pagoAplicarSection = document.getElementById('pago-aplicar-section');
  if (pagoAplicarSection) pagoAplicarSection.style.display = 'none';
  
  const reciboSection = document.getElementById('recibo-section');
  if (reciboSection) reciboSection.style.display = 'none';
  
  pagoItems = [];
  facturasSeleccionadas = [];
  pagoId = null;
  
  const numeroRecibo = document.getElementById('numero_recibo');
  const observacionesRecibo = document.getElementById('observaciones_recibo');
  
  if (numeroRecibo) numeroRecibo.value = '';
  if (observacionesRecibo) observacionesRecibo.value = '';
}

// =====================
// MOSTRAR TAB
// =====================
function showTab(tabName, event) {
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
  if (tabName === 'pagos-list') {
    cargarPagos();
  }
  if (tabName === 'recibos-list') {
    cargarRecibos();
  }
  if (tabName === 'cheques-list') {
    cargarCheques();
  }
}

// =====================
// MOSTRAR ALERTA
// =====================
function mostrarAlerta(mensaje, tipo) {
  const alertDiv = document.getElementById('globalAlert');
  if (!alertDiv) return;
  
  alertDiv.textContent = mensaje;
  alertDiv.className = `alert alert-${tipo}`;
  alertDiv.style.display = 'block';
  
  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 5000);
}

// =====================
// LOGOUT
// =====================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

// Verificar autenticación
const usuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');

  if (!token || !userStr) {
    window.location.href = 'login.html';
    return null;
  }

  try {
    return JSON.parse(userStr);
  } catch (error) {
    window.location.href = 'login.html';
    return null;
  }
})();

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  localStorage.removeItem('rol');
  localStorage.removeItem('usuario_id');
  window.location.href = 'login.html';
}

// Variables globales
let chartInstance = null;
let dataTable = null;
let proveedoresList = [];

// Cargar proveedores para el filtro
async function cargarProveedores() {
  try {
    const response = await apiRequest('GET', '/api/proveedores');
    if (response.success) {
      proveedoresList = response.data;
      const select = document.getElementById('filterProveedor');
      
      proveedoresList.forEach(proveedor => {
        const option = document.createElement('option');
        option.value = proveedor.id;
        option.textContent = proveedor.nombre;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Error cargando proveedores:', error);
  }
}

// Buscar pagos con filtros
async function buscarPagos() {
  try {
    const params = new URLSearchParams();
    
    const metodo = document.getElementById('filterMetodo').value;
    const proveedor = document.getElementById('filterProveedor').value;
    const desde = document.getElementById('filterDesde').value;
    const hasta = document.getElementById('filterHasta').value;
    const montoMin = document.getElementById('filterMontoMin').value;
    const montoMax = document.getElementById('filterMontoMax').value;
    const comprobante = document.getElementById('filterComprobante').value;
    
    if (metodo) params.append('metodo_pago', metodo);
    if (proveedor) params.append('proveedor_id', proveedor);
    if (desde) params.append('fecha_desde', desde);
    if (hasta) params.append('fecha_hasta', hasta);
    if (montoMin) params.append('monto_min', montoMin);
    if (montoMax) params.append('monto_max', montoMax);
    if (comprobante) params.append('numero_comprobante', comprobante);
    
    const response = await apiRequest('GET', `/api/pagos/busqueda/avanzada?${params.toString()}`);
    
    if (response.success) {
      mostrarResultados(response.data);
      actualizarEstadisticas(response.data);
      actualizarGraficoMetodos(response.data.estadisticas.distribucion_metodos);
    } else {
      mostrarError('Error al buscar pagos');
    }
  } catch (error) {
    console.error('Error en búsqueda:', error);
    mostrarError('Error al realizar la búsqueda');
  }
}

// Mostrar resultados en tabla
function mostrarResultados(data) {
  const tbody = document.querySelector('#pagosTable tbody');
  tbody.innerHTML = '';
  
  if (!data.pagos || data.pagos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4">
          <i class="fas fa-search fa-2x text-muted mb-2"></i>
          <p class="mb-0">No se encontraron pagos con los filtros aplicados</p>
        </td>
      </tr>
    `;
    
    if (dataTable) {
      dataTable.destroy();
      dataTable = null;
    }
    return;
  }
  
  data.pagos.forEach(pago => {
    const row = document.createElement('tr');
    
    const fechaPago = new Date(pago.fecha_pago).toLocaleDateString('es-AR');
    const montoFormateado = parseFloat(pago.monto_total || 0).toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2
    });
    
    const metodoIcon = getMetodoIcon(pago.metodo_pago);
    const estadoBadge = getEstadoBadge(pago.estado);
    
    row.innerHTML = `
      <td>${pago.id}</td>
      <td>${fechaPago}</td>
      <td>${pago.proveedor_nombre || 'N/A'}</td>
      <td><i class="${metodoIcon}"></i> ${pago.metodo_pago}</td>
      <td>${pago.numero_comprobante || 'N/A'}</td>
      <td class="text-end fw-bold">${montoFormateado}</td>
      <td class="text-center">${pago.facturas_pagadas || 0}</td>
      <td>${estadoBadge}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="verDetallePago(${pago.id})">
          <i class="fas fa-eye"></i>
        </button>
        <button class="btn btn-sm btn-outline-info" onclick="verHistorialFacturas(${pago.id})">
          <i class="fas fa-file-invoice"></i>
        </button>
      </td>
    `;
    
    tbody.appendChild(row);
  });
  
  // Inicializar DataTable si no existe
  if (!dataTable) {
    dataTable = $('#pagosTable').DataTable({
      language: {
        url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/es-AR.json'
      },
      pageLength: 25,
      order: [[1, 'desc']]
    });
  } else {
    dataTable.clear().rows.add($('#pagosTable tbody tr')).draw();
  }
}

// Actualizar estadísticas
function actualizarEstadisticas(data) {
  const totalPagos = data.pagos.length;
  const montoTotal = data.pagos.reduce((sum, pago) => sum + parseFloat(pago.monto_total || 0), 0);
  const promedioPago = totalPagos > 0 ? montoTotal / totalPagos : 0;
  const proveedoresUnicos = new Set(data.pagos.map(p => p.proveedor_id)).size;
  
  document.getElementById('totalPagos').textContent = totalPagos;
  document.getElementById('montoTotal').textContent = montoTotal.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  });
  document.getElementById('promedioPago').textContent = promedioPago.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  });
  document.getElementById('proveedoresUnicos').textContent = proveedoresUnicos;
}

// Actualizar gráfico de métodos de pago
function actualizarGraficoMetodos(distribucion) {
  const ctx = document.getElementById('metodosChart').getContext('2d');
  
  // Destruir gráfico anterior si existe
  if (chartInstance) {
    chartInstance.destroy();
  }
  
  // Actualizar lista de métodos
  const metodosList = document.getElementById('metodosList');
  metodosList.innerHTML = '';
  
  if (!distribucion || distribucion.length === 0) {
    metodosList.innerHTML = `
      <div class="alert alert-info">
        <i class="fas fa-info-circle"></i> No hay datos para mostrar
      </div>
    `;
    return;
  }
  
  const labels = distribucion.map(item => item.metodo_pago);
  const data = distribucion.map(item => parseFloat(item.total_monto || 0));
  const colors = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b'];
  
  // Crear gráfico
  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.raw || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = Math.round((value / total) * 100);
              return `${label}: $${value.toLocaleString('es-AR', { minimumFractionDigits: 2 })} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
  
  // Actualizar lista
  distribucion.forEach((item, index) => {
    const monto = parseFloat(item.total_monto || 0);
    const cantidad = parseInt(item.cantidad_por_metodo || 0);
    const porcentaje = data.reduce((a, b) => a + b, 0) > 0 ? 
      Math.round((monto / data.reduce((a, b) => a + b, 0)) * 100) : 0;
    
    const listItem = document.createElement('a');
    listItem.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
    listItem.style.borderLeft = `4px solid ${colors[index % colors.length]}`;
    listItem.innerHTML = `
      <div>
        <i class="${getMetodoIcon(item.metodo_pago)} me-2"></i>
        <strong>${item.metodo_pago}</strong>
      </div>
      <div class="text-end">
        <div class="fw-bold">$${monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
        <small class="text-muted">${cantidad} pagos (${porcentaje}%)</small>
      </div>
    `;
    metodosList.appendChild(listItem);
  });
}

// Ver detalles de un pago
async function verDetallePago(pagoId) {
  try {
    const response = await apiRequest('GET', `/api/pagos/${pagoId}`);
    
    if (response.success) {
      mostrarModalDetalle(response.data);
    } else {
      mostrarError('Error al cargar detalles del pago');
    }
  } catch (error) {
    console.error('Error cargando detalles:', error);
    mostrarError('Error al cargar detalles del pago');
  }
}

// Mostrar modal con detalles del pago
function mostrarModalDetalle(pago) {
  const modalContent = document.getElementById('detallePagoContent');
  
  const fechaPago = new Date(pago.fecha_pago).toLocaleDateString('es-AR');
  const montoTotal = parseFloat(pago.monto_total || 0).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2
  });
  
  let itemsHTML = '';
  if (pago.items && pago.items.length > 0) {
    itemsHTML = `
      <h6 class="mt-4 mb-3"><i class="fas fa-file-invoice-dollar"></i> Facturas Pagadas</h6>
      <div class="table-responsive">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Factura</th>
              <th>Fecha</th>
              <th>Total Factura</th>
              <th>Monto Aplicado</th>
            </tr>
          </thead>
          <tbody>
            ${pago.items.map(item => `
              <tr>
                <td>${item.numero_factura || 'N/A'}</td>
                <td>${item.fecha_factura ? new Date(item.fecha_factura).toLocaleDateString('es-AR') : 'N/A'}</td>
                <td>$${parseFloat(item.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                <td class="fw-bold">$${parseFloat(item.monto_aplicado || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  
  modalContent.innerHTML = `
    <div class="row">
      <div class="col-md-6">
        <div class="mb-3">
          <label class="form-label text-muted">Proveedor</label>
          <p class="fw-bold">${pago.proveedor_nombre || 'N/A'}</p>
        </div>
        <div class="mb-3">
          <label class="form-label text-muted">Fecha de Pago</label>
          <p class="fw-bold">${fechaPago}</p>
        </div>
        <div class="mb-3">
          <label class="form-label text-muted">Método de Pago</label>
          <p class="fw-bold"><i class="${getMetodoIcon(pago.metodo_pago)}"></i> ${pago.metodo_pago}</p>
        </div>
      </div>
      <div class="col-md-6">
        <div class="mb-3">
          <label class="form-label text-muted">N° Comprobante</label>
          <p class="fw-bold">${pago.numero_comprobante || 'N/A'}</p>
        </div>
        <div class="mb-3">
          <label class="form-label text-muted">Monto Total</label>
          <p class="fw-bold fs-4 text-primary">${montoTotal}</p>
        </div>
        <div class="mb-3">
          <label class="form-label text-muted">Estado</label>
          <p>${getEstadoBadge(pago.estado)}</p>
        </div>
      </div>
    </div>
    
    ${pago.observaciones ? `
      <div class="mb-3">
        <label class="form-label text-muted">Observaciones</label>
        <p class="border rounded p-3 bg-light">${pago.observaciones}</p>
      </div>
    ` : ''}
    
    ${itemsHTML}
  `;
  
  const modal = new bootstrap.Modal(document.getElementById('detallePagoModal'));
  modal.show();
}

// Ver historial de facturas de un pago
async function verHistorialFacturas(pagoId) {
  try {
    const response = await apiRequest('GET', `/api/pagos/${pagoId}`);
    
    if (response.success && response.data.items && response.data.items.length > 0) {
      const facturas = response.data.items;
      let historialHTML = `
        <div class="alert alert-info">
          <i class="fas fa-info-circle"></i> Este pago aplicó a ${facturas.length} factura(s)
        </div>
        <div class="list-group">
      `;
      
      facturas.forEach(item => {
        historialHTML += `
          <a href="facturas-compra.html?id=${item.factura_compra_id}" class="list-group-item list-group-item-action">
            <div class="d-flex w-100 justify-content-between">
              <h6 class="mb-1">Factura: ${item.numero_factura || 'N/A'}</h6>
              <small class="text-muted">$${parseFloat(item.monto_aplicado || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</small>
            </div>
            <p class="mb-1">Total factura: $${parseFloat(item.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</p>
            <small class="text-muted">Fecha: ${item.fecha_factura ? new Date(item.fecha_factura).toLocaleDateString('es-AR') : 'N/A'}</small>
          </a>
        `;
      });
      
      historialHTML += '</div>';
      
      mostrarAlerta('Historial de Facturas', historialHTML, 'info');
    } else {
      mostrarAlerta('Historial de Facturas', 'No se encontraron facturas asociadas a este pago.', 'warning');
    }
  } catch (error) {
    console.error('Error cargando historial:', error);
    mostrarError('Error al cargar historial de facturas');
  }
}

// Generar reporte por período
function generarReportePeriodo() {
  // Establecer fechas por defecto (último mes)
  const hoy = new Date();
  const haceUnMes = new Date();
  haceUnMes.setMonth(hoy.getMonth() - 1);
  
  document.getElementById('reporteDesde').value = haceUnMes.toISOString().split('T')[0];
  document.getElementById('reporteHasta').value = hoy.toISOString().split('T')[0];
  
  const modal = new bootstrap.Modal(document.getElementById('reportePeriodoModal'));
  modal.show();
}

// Generar reporte
async function generarReporte() {
  try {
    const desde = document.getElementById('reporteDesde').value;
    const hasta = document.getElementById('reporteHasta').value;
    const agruparPor = document.getElementById('agruparPor').value;
    
    if (!desde || !hasta) {
      mostrarError('Debe seleccionar un rango de fechas');
      return;
    }
    
    const params = new URLSearchParams({
      fecha_desde: desde,
      fecha_hasta: hasta,
      agrupar_por: agruparPor
    });
    
    const response = await apiRequest('GET', `/api/pagos/reporte/periodo?${params.toString()}`);
    
    if (response.success) {
      mostrarReporte(response.data);
    } else {
      mostrarError('Error al generar reporte');
    }
  } catch (error) {
    console.error('Error generando reporte:', error);
    mostrarError('Error al generar reporte');
  }
}

// Mostrar reporte
function mostrarReporte(data) {
  const reporteContent = document.getElementById('reporteContent');
  
  if (!data.reporte || data.reporte.length === 0) {
    reporteContent.innerHTML = `
      <div class="alert alert-warning">
        <i class="fas fa-exclamation-triangle"></i> No hay datos para el período seleccionado
      </div>
    `;
    return;
  }
  
  // Estadísticas generales
  const stats = data.estadisticas;
  const statsHTML = `
    <div class="row mb-4">
      <div class="col-md-3">
        <div class="card bg-light">
          <div class="card-body text-center">
            <h6 class="card-title text-muted">Total Pagos</h6>
            <h3 class="card-text text-primary">${stats.total_pagos}</h3>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card bg-light">
          <div class="card-body text-center">
            <h6 class="card-title text-muted">Monto Total</h6>
            <h3 class="card-text text-success">$${parseFloat(stats.monto_total_periodo || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</h3>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card bg-light">
          <div class="card-body text-center">
            <h6 class="card-title text-muted">Promedio</h6>
            <h3 class="card-text text-warning">$${parseFloat(stats.promedio_general || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</h3>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card bg-light">
          <div class="card-body text-center">
            <h6 class="card-title text-muted">Proveedores</h6>
            <h3 class="card-text text-info">${stats.total_proveedores}</h3>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Tabla de reporte
  let tablaHTML = `
    <div class="table-responsive">
      <table class="table table-striped table-hover">
        <thead class="table-dark">
          <tr>
            <th>Período</th>
            <th>Cantidad Pagos</th>
            <th>Monto Total</th>
            <th>Promedio por Pago</th>
            <th>Proveedores Únicos</th>
            <th>Métodos de Pago</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  data.reporte.forEach(item => {
    tablaHTML += `
      <tr>
        <td><strong>${item.periodo}</strong></td>
        <td class="text-center">${item.cantidad_pagos}</td>
        <td class="text-end fw-bold">$${parseFloat(item.monto_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
        <td class="text-end">$${parseFloat(item.promedio_pago || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
        <td class="text-center">${item.proveedores_unicos}</td>
        <td><small>${item.metodos_pago || 'N/A'}</small></td>
      </tr>
    `;
  });
  
  tablaHTML += `
        </tbody>
      </table>
    </div>
  `;
  
  reporteContent.innerHTML = statsHTML + tablaHTML;
}

// Exportar reporte
function exportarReporte() {
  // Implementación básica de exportación
  const table = document.getElementById('pagosTable');
  if (!table) {
    mostrarError('No hay datos para exportar');
    return;
  }
  
  let csv = [];
  const rows = table.querySelectorAll('tr');
  
  for (let i = 0; i < rows.length; i++) {
    const row = [], cols = rows[i].querySelectorAll('td, th');
    
    for (let j = 0; j < cols.length; j++) {
      row.push(cols[j].innerText);
    }
    
    csv.push(row.join(','));
  }
  
  const csvContent = csv.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `reporte_pagos_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Exportar reporte por período
function exportarReportePeriodo() {
  const reporteContent = document.getElementById('reporteContent');
  const table = reporteContent.querySelector('table');
  
  if (!table) {
    mostrarError('No hay datos para exportar');
    return;
  }
  
  let csv = [];
  const rows = table.querySelectorAll('tr');
  
  for (let i = 0; i < rows.length; i++) {
    const row = [], cols = rows[i].querySelectorAll('td, th');
    
    for (let j = 0; j < cols.length; j++) {
      row.push(cols[j].innerText);
    }
    
    csv.push(row.join(','));
  }
  
  const csvContent = csv.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `reporte_periodo_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Imprimir comprobante
function imprimirComprobante() {
  const modalContent = document.getElementById('detallePagoContent');
  const printWindow = window.open('', '_blank');
  
  printWindow.document.write(`
    <html>
      <head>
        <title>Comprobante de Pago</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .header h1 { color: #333; }
          .info { margin-bottom: 20px; }
          .info table { width: 100%; border-collapse: collapse; }
          .info td { padding: 8px; border-bottom: 1px solid #ddd; }
          .info td:first-child { font-weight: bold; width: 30%; }
          .total { text-align: right; font-size: 18px; font-weight: bold; margin-top: 20px; }
          .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>COMPROBANTE DE PAGO</h1>
          <p>Transformadores ERP</p>
        </div>
        ${modalContent.innerHTML}
        <div class="footer">
          <p>Generado el ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}</p>
        </div>
      </body>
    </html>
  `);
  
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

// Funciones auxiliares
function getMetodoIcon(metodo) {
  switch(metodo) {
    case 'efectivo': return 'fas fa-money-bill-wave';
    case 'cheque': return 'fas fa-money-check';
    case 'transferencia': return 'fas fa-exchange-alt';
    case 'tarjeta': return 'fas fa-credit-card';
    default: return 'fas fa-money-bill';
  }
}

function getEstadoBadge(estado) {
  switch(estado) {
    case 'aplicado': return '<span class="badge bg-success">Aplicado</span>';
    case 'pendiente': return '<span class="badge bg-warning">Pendiente</span>';
    case 'anulado': return '<span class="badge bg-danger">Anulado</span>';
    default: return '<span class="badge bg-secondary">Desconocido</span>';
  }
}

function mostrarError(mensaje) {
  alertify.error(mensaje);
}

function mostrarAlerta(titulo, mensaje, tipo = 'info') {
  alertify.alert(titulo, mensaje);
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  // Verificar permisos
  if (usuario && (usuario.rol === 'admin' || usuario.rol === 'control')) {
    // Cargar proveedores
    cargarProveedores();
    
    // Establecer fechas por defecto (último mes)
    const hoy = new Date();
    const haceUnMes = new Date();
    haceUnMes.setMonth(hoy.getMonth() - 1);
    
    document.getElementById('filterDesde').value = haceUnMes.toISOString().split('T')[0];
    document.getElementById('filterHasta').value = hoy.toISOString().split('T')[0];
    
    // Realizar búsqueda inicial
    buscarPagos();
  } else {
    mostrarError('No tiene permisos para acceder a esta página');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 2000);
  }
});

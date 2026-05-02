const dashboardUsuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');

  if (!token || !userStr) {
    window.location.href = 'login.html';
    return null;
  }

  try {
    const usuario = JSON.parse(userStr);
    
    // Verificar si es empleado intentando acceder al dashboard
    const currentPage = window.location.pathname.split('/').pop();
    if (usuario.rol === 'empleado' && currentPage === 'dashboard.html') {
      // Redirigir empleados a producción
      window.location.href = 'produccion.html';
      return null;
    }
    
    return usuario;
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

function verificarPermisosUsuario() {
  if (!dashboardUsuario) return;

  document.querySelectorAll('[data-roles]').forEach((elemento) => {
    const rolesPermitidos = (elemento.getAttribute('data-roles') || '').split(',');
    if (!rolesPermitidos.includes(dashboardUsuario.rol)) {
      elemento.classList.add('is-hidden');
    }
  });
}

// Función para cargar alertas de pagos pendientes
async function cargarAlertasDashboard() {
  try {
    const response = await apiRequest('GET', '/api/alertas/facturas-pendientes');
    
    if (response.success && response.data && response.data.length > 0) {
      const alertas = response.data;
      const alertasList = document.getElementById('alertasList');
      const alertasCount = document.getElementById('alertasCount');
      
      // Actualizar contador
      alertasCount.textContent = alertas.length;
      alertasCount.classList.add('badge-danger');
      
      // Mostrar las primeras 5 alertas
      const alertasHTML = alertas.slice(0, 5).map(alerta => {
        const estadoClass = getEstadoAlertaClass(alerta.estado_alerta);
        const estadoText = getEstadoAlertaText(alerta.estado_alerta);
        const diasRestantes = alerta.dias_restantes !== null ? alerta.dias_restantes : 'N/A';
        const fechaVencimiento = alerta.fecha_vencimiento ? 
          new Date(alerta.fecha_vencimiento).toLocaleDateString('es-AR') : 'Sin fecha';
        
        return `
          <div class="alert-item ${estadoClass}">
            <div class="alert-item-header">
              <span class="alert-item-title">${alerta.numero_factura || 'Factura'}</span>
              <span class="alert-item-badge">${estadoText}</span>
            </div>
            <div class="alert-item-body">
              <div class="alert-item-proveedor">${alerta.proveedor_nombre || 'Proveedor'}</div>
              <div class="alert-item-details">
                <span>Vence: ${fechaVencimiento}</span>
                <span>Días: ${diasRestantes}</span>
                <span>Saldo: $${parseFloat(alerta.saldo_pendiente || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div class="alert-item-actions">
              <button class="btn btn-sm btn-outline-primary" onclick="window.location.href='pagos-proveedores.html?factura=${alerta.id}'">
                <i class="fas fa-money-bill-wave"></i> Pagar
              </button>
              <button class="btn btn-sm btn-outline-info" onclick="window.location.href='alertas-pagos.html'">
                <i class="fas fa-eye"></i> Ver más
              </button>
            </div>
          </div>
        `;
      }).join('');
      
      alertasList.innerHTML = alertasHTML;
      
      // Si hay más de 5 alertas, agregar enlace para ver todas
      if (alertas.length > 5) {
        alertasList.innerHTML += `
          <div class="alert-item-footer">
            <a href="alertas-pagos.html" class="btn btn-sm btn-link">
              <i class="fas fa-external-link-alt"></i> Ver todas las alertas (${alertas.length})
            </a>
          </div>
        `;
      }
    } else {
      // No hay alertas
      const alertasList = document.getElementById('alertasList');
      const alertasCount = document.getElementById('alertasCount');
      
      alertasCount.textContent = '0';
      alertasCount.classList.remove('badge-danger');
      alertasCount.classList.add('badge-success');
      
      alertasList.innerHTML = `
        <div class="alert-item success">
          <div class="alert-item-body text-center">
            <i class="fas fa-check-circle fa-2x text-success mb-2"></i>
            <p class="mb-0">No hay facturas pendientes de pago</p>
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error cargando alertas:', error);
    const alertasList = document.getElementById('alertasList');
    alertasList.innerHTML = `
      <div class="alert-item warning">
        <div class="alert-item-body text-center">
          <i class="fas fa-exclamation-triangle fa-2x text-warning mb-2"></i>
          <p class="mb-0">Error al cargar alertas</p>
        </div>
      </div>
    `;
  }
}

// Funciones auxiliares para alertas
function getEstadoAlertaClass(estado) {
  switch(estado) {
    case 'vencida': return 'danger';
    case 'por_vencer': return 'warning';
    default: return 'info';
  }
}

function getEstadoAlertaText(estado) {
  switch(estado) {
    case 'vencida': return 'Vencida';
    case 'por_vencer': return 'Por Vencer';
    default: return 'Pendiente';
  }
}

// Función para agregar estilos CSS para las alertas
function agregarEstilosAlertas() {
  const style = document.createElement('style');
  style.textContent = `
    .alert-item {
      border-left: 4px solid #ddd;
      padding: 12px;
      margin-bottom: 10px;
      background: white;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    .alert-item.danger {
      border-left-color: #dc3545;
      background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
    }
    
    .alert-item.warning {
      border-left-color: #ffc107;
      background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
    }
    
    .alert-item.info {
      border-left-color: #0dcaf0;
      background: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%);
    }
    
    .alert-item.success {
      border-left-color: #198754;
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
    }
    
    .alert-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .alert-item-title {
      font-weight: 600;
      font-size: 14px;
    }
    
    .alert-item-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .alert-item.danger .alert-item-badge {
      background-color: #fee2e2;
      color: #dc2626;
    }
    
    .alert-item.warning .alert-item-badge {
      background-color: #fef3c7;
      color: #d97706;
    }
    
    .alert-item.info .alert-item-badge {
      background-color: #cffafe;
      color: #0891b2;
    }
    
    .alert-item-proveedor {
      font-size: 13px;
      color: #666;
      margin-bottom: 6px;
    }
    
    .alert-item-details {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #888;
      margin-bottom: 10px;
    }
    
    .alert-item-actions {
      display: flex;
      gap: 8px;
    }
    
    .alert-item-footer {
      text-align: center;
      padding: 10px;
      border-top: 1px solid #eee;
      margin-top: 10px;
    }
    
    .badge-danger {
      background-color: #dc3545;
      color: white;
    }
    
    .badge-success {
      background-color: #198754;
      color: white;
    }
  `;
  document.head.appendChild(style);
}

document.addEventListener('DOMContentLoaded', () => {
  const currentPage = window.location.pathname.split('/').pop();

  document.querySelectorAll('.navbar-menu button').forEach((btn) => {
    const onClick = btn.getAttribute('onclick') || '';
    const match = onClick.match(/window\.location\.href='([^']+)'/);
    const targetPage = match ? match[1] : '';

    if (targetPage === currentPage) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  verificarPermisosUsuario();
  
  // Agregar estilos para alertas
  agregarEstilosAlertas();
  
  // Cargar alertas si estamos en el dashboard
  if (currentPage === 'dashboard.html') {
    cargarAlertasDashboard();
    
    // Refrescar alertas cada 2 minutos
    setInterval(cargarAlertasDashboard, 2 * 60 * 1000);
  }
});


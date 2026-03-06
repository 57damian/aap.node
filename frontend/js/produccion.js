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

// ============================================
// VERIFICAR PERMISOS PARA REPORTES
// ============================================
function puedeVerReportes() {
  return usuario && (usuario.rol === 'admin' || usuario.rol === 'control');
}



// ============================================
// VARIABLES GLOBALES
// ============================================
let modelos = [];





// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ produccion.js cargado');
  
 

  // Inicializar
  cargarModelos();
  cargarStock();
  cargarHistorial();
  cargarFiltrosReporte();

  // Event listener del formulario
  const form = document.getElementById('produccionForm');
  if (form) {
    form.addEventListener('submit', registrarProduccion);
  }

  // Setear fecha actual por defecto
  const hoy = new Date().toISOString().split('T')[0];
  const fechaInput = document.getElementById('fecha_produccion');
  if (fechaInput) {
    fechaInput.value = hoy;
  }

  // Event listeners para filtros
  const filtroModelo = document.getElementById('filtroModelo');
  if (filtroModelo) {
    filtroModelo.addEventListener('change', cargarHistorial);
  }

  const filtroDesde = document.getElementById('filtroDesde');
  if (filtroDesde) {
    filtroDesde.addEventListener('change', cargarHistorial);
  }

  const filtroHasta = document.getElementById('filtroHasta');
  if (filtroHasta) {
    filtroHasta.addEventListener('change', cargarHistorial);
  }
});

// ============================================
// CARGAR MODELOS
// ============================================
async function cargarModelos() {
  try {
    console.log('Cargando modelos...');
    const response = await apiFetch('/api/ficha-transformador');
    modelos = response;
    
    // Select para registro de producción
    const select = document.getElementById('ficha_id');
    if (select) {
      select.innerHTML = '<option value="">-- Seleccionar Modelo --</option>';
      
      modelos.forEach(modelo => {
        const option = document.createElement('option');
        option.value = modelo.id;
        option.textContent = `${modelo.modelo} (${modelo.voltaje_entrada || '-'}V)`;
        select.appendChild(option);
      });
    }

    // Select para filtro de historial
    const filtroModelo = document.getElementById('filtroModelo');
    if (filtroModelo) {
      filtroModelo.innerHTML = '<option value="">Todos los modelos</option>';
      modelos.forEach(modelo => {
        const option = document.createElement('option');
        option.value = modelo.id;
        option.textContent = modelo.modelo;
        filtroModelo.appendChild(option);
      });
    }

    // Select para filtro de reporte
    const filtroReporteModelo = document.getElementById('filtroReporteModelo');
    if (filtroReporteModelo) {
      filtroReporteModelo.innerHTML = '<option value="">Todos los modelos</option>';
      modelos.forEach(modelo => {
        const option = document.createElement('option');
        option.value = modelo.id;
        option.textContent = modelo.modelo;
        filtroReporteModelo.appendChild(option);
      });
    }

    console.log(`✅ ${modelos.length} modelos cargados`);

  } catch (err) {
    console.error('Error cargando modelos:', err);
    mostrarAlerta('Error cargando modelos', 'error');
  }
}

// ============================================
// REGISTRAR PRODUCCIÓN
// ============================================
async function registrarProduccion(e) {
  e.preventDefault();

  const ficha_id = document.getElementById('ficha_id').value;
  const cantidad = document.getElementById('cantidad').value;
  const fecha_produccion = document.getElementById('fecha_produccion').value;
  const observaciones = document.getElementById('observaciones').value;

  if (!ficha_id) {
    mostrarAlerta('Seleccione un modelo', 'error');
    return;
  }

  if (!cantidad || cantidad <= 0) {
    mostrarAlerta('Ingrese una cantidad válida', 'error');
    return;
  }

  const modelo = modelos.find(m => m.id == ficha_id);

  try {
    const response = await apiFetch('/api/produccion', {
      method: 'POST',
      body: JSON.stringify({
        ficha_id: parseInt(ficha_id),
        cantidad: parseInt(cantidad),
        fecha_produccion: fecha_produccion || undefined,
        observaciones: observaciones || null,
        usuario_id: usuario.id
      })
    });

    mostrarAlerta(response.mensaje || '✅ Producción registrada', 'success');
    
    // Limpiar formulario
    document.getElementById('cantidad').value = '';
    document.getElementById('observaciones').value = '';
    
    // Recargar datos
    await cargarStock();
    await cargarHistorial();
    await cargarReporte();

  } catch (err) {
    console.error('Error registrando producción:', err);
    mostrarAlerta(err.error || 'Error registrando producción', 'error');
  }
}

// ============================================
// CARGAR STOCK ACTUAL
// ============================================
async function cargarStock() {
  try {
    const filtroCliente = document.getElementById('filtroStockCliente')?.value;
    const filtroEstado = document.getElementById('filtroStockEstado')?.value;
    
    let url = '/api/produccion/stock';
    const params = [];
    
    if (filtroCliente === 'genericos') {
      params.push('solo_genericos=true');
    }
    
    if (filtroEstado === 'con_stock') {
      params.push('con_stock=true');
    }
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const stock = await apiFetch(url);
    const container = document.getElementById('stockContainer');
    
    if (!stock || stock.length === 0) {
      container.innerHTML = `
        <div style="grid-column: span 3; text-align: center; padding: 40px; background: #f8f9fa; border-radius: 8px;">
          <div style="font-size: 48px; margin-bottom: 20px;">📦</div>
          <p style="color: #666;">No hay stock disponible</p>
        </div>
      `;
      return;
    }

    container.innerHTML = stock.map(item => {
      let cardClass = 'stock-card';
      if (item.stock_actual === 0) {
        cardClass += ' sin-stock';
      } else if (item.stock_actual < 10) {
        cardClass += ' bajo-stock';
      }

      // Determinar color según estado
      let estadoColor = '';
      let estadoTexto = '';
      if (item.stock_actual === 0) {
        estadoColor = '#dc3545';
        estadoTexto = 'SIN STOCK';
      } else if (item.stock_actual < 10) {
        estadoColor = '#ffc107';
        estadoTexto = 'STOCK BAJO';
      } else {
        estadoColor = '#28a745';
        estadoTexto = 'STOCK OK';
      }

      return `
        <div class="${cardClass}">
          <h3>${item.modelo}</h3>
          <div class="cantidad" style="color: ${estadoColor};">${item.stock_actual}</div>
          <div class="detalle">
            <span>📦 Producido: ${item.producido_total}</span>
            <span>🚚 Entregado: ${item.entregado_total}</span>
          </div>
          <div style="text-align: center; margin-top: 15px; padding: 5px; background: rgba(255,255,255,0.2); border-radius: 4px; font-size: 12px; font-weight: bold;">
            ${estadoTexto}
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando stock:', err);
    mostrarAlerta('Error cargando stock', 'error');
  }
}

// ============================================
// CARGAR HISTORIAL
// ============================================
async function cargarHistorial() {
  try {
    const modelo = document.getElementById('filtroModelo')?.value;
    const desde = document.getElementById('filtroDesde')?.value;
    const hasta = document.getElementById('filtroHasta')?.value;
    
    let url = '/api/produccion';
    const params = [];
    
    if (modelo) params.push(`ficha_id=${modelo}`);
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const historial = await apiFetch(url);
    const tbody = document.getElementById('historialTable');
    
    if (!historial || historial.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 30px;">
            No hay registros de producción
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = historial.map(item => {
      const fecha = new Date(item.fecha_produccion).toLocaleDateString('es-AR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      
      return `
        <tr>
          <td>${fecha}</td>
          <td><strong>${item.modelo}</strong></td>
          <td style="font-weight: bold; color: #28a745;">${item.cantidad} unidades</td>
          <td>${item.registrado_por || 'Sistema'}</td>
          <td>${item.observaciones || '-'}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando historial:', err);
    mostrarAlerta('Error cargando historial', 'error');
  }
}

// ============================================
// CARGAR FILTROS DE REPORTE
// ============================================
function cargarFiltrosReporte() {
  // Solo cargar filtros si el usuario puede ver reportes
  if (!puedeVerReportes()) {
    return;
  }

  // Setear fechas por defecto (últimos 30 días)
  const hoy = new Date();
  const hace30Dias = new Date();
  hace30Dias.setDate(hoy.getDate() - 30);
  
  const desdeInput = document.getElementById('reporteDesde');
  const hastaInput = document.getElementById('reporteHasta');
  
  if (desdeInput) {
    desdeInput.value = hace30Dias.toISOString().split('T')[0];
  }
  
  if (hastaInput) {
    hastaInput.value = hoy.toISOString().split('T')[0];
  }
  
  // Cargar reporte inicial
  cargarReporte();
}

// ============================================
// CARGAR REPORTE
// ============================================
async function cargarReporte() {
  try {
    const desde = document.getElementById('reporteDesde')?.value;
    const hasta = document.getElementById('reporteHasta')?.value;
    const modelo = document.getElementById('filtroReporteModelo')?.value;
    
    let url = '/api/produccion/reporte';
    const params = [];
    
    if (desde) params.push(`desde=${desde}`);
    if (hasta) params.push(`hasta=${hasta}`);
    if (modelo) params.push(`ficha_id=${modelo}`);
    
    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const reporte = await apiFetch(url);
    const tbody = document.getElementById('reporteTable');
    
    if (!reporte || reporte.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 30px;">
            No hay datos para el período seleccionado
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = reporte.map(item => {
      // Determinar color de stock
      let stockColor = '#28a745';
      if (item.stock_actual === 0) {
        stockColor = '#dc3545';
      } else if (item.stock_actual < 10) {
        stockColor = '#ffc107';
      }

      return `
        <tr>
          <td><strong>${item.modelo}</strong></td>
          <td style="color: #28a745; font-weight: bold;">${item.producido_periodo || 0}</td>
          <td style="color: #dc3545;">${item.entregado_periodo || 0}</td>
          <td>${item.producido_total || 0}</td>
          <td>${item.entregado_total || 0}</td>
          <td style="color: ${stockColor}; font-weight: bold;">${item.stock_actual || 0}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Error cargando reporte:', err);
    mostrarAlerta('Error cargando reporte', 'error');
  }
}

// ============================================
// MOSTRAR TAB
// ============================================
function showTab(tabName, event) {
  // BLOQUEO DE SEGURIDAD: Si es empleado y quiere ver reportes, redirigir a stock
  if (tabName === 'reporte' && !puedeVerReportes()) {
    mostrarAlerta('No tienes permiso para ver reportes', 'error');
    // Cambiar al tab de stock automáticamente
    tabName = 'stock';
    // Actualizar el botón activo
    document.querySelectorAll('.tab').forEach(btn => {
      if (btn.textContent.includes('Stock')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Ocultar todos los tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Desactivar todos los botones
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.remove('active');
  });

  // Mostrar el tab seleccionado
  document.getElementById(tabName).classList.add('active');

  // Activar el botón clickeado
  if (event?.target) {
    event.target.classList.add('active');
  }

  // Cargar datos según el tab
  switch(tabName) {
    case 'stock':
      cargarStock();
      break;
    case 'historial':
      cargarHistorial();
      break;
    case 'reporte':
      if (puedeVerReportes()) {
        cargarReporte();
      }
      break;
  }
}

// ============================================
// MOSTRAR ALERTA
// ============================================
function mostrarAlerta(mensaje, tipo) {
  const alertDiv = document.getElementById('alert');
  if (!alertDiv) return;
  
  alertDiv.textContent = mensaje;
  alertDiv.className = `alert alert-${tipo}`;
  alertDiv.style.display = 'block';

  // Auto ocultar después de 5 segundos
  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 5000);
}

// ============================================
// LOGOUT
// ============================================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}
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
// El reporte de producción es del admin. El operario carga lo que produce y
// consulta el stock; el rol 'control' que figuraba acá ya no existe.
function puedeVerReportes() {
  return usuario && usuario.rol === 'admin';
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

  // Pestañas: un solo listener, en vez de un onclick por botón en el HTML.
  document.querySelectorAll('.tab[data-tab]').forEach(boton => {
    boton.addEventListener('click', () => mostrarTab(boton.dataset.tab, boton));
  });

  // Enter en el buscador de materiales aplica el filtro.
  const buscarMp = document.getElementById('buscarMateriaPrima');
  if (buscarMp) {
    buscarMp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); cargarMateriaPrima(); }
    });
  }

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

      // Si se llega acá desde un link "Ir a Producción" de otra pantalla
      // (ej. "Registrar entrega" en oc_detalle.html, cuando un modelo no
      // tiene stock), precargar directamente ese modelo. Se valida que sea
      // un id numérico de un modelo real antes de tocar el <select>.
      const fichaIdUrl = Number.parseInt(new URLSearchParams(window.location.search).get('ficha_id'), 10);
      if (modelos.some(m => m.id === fichaIdUrl)) {
        select.value = String(fichaIdUrl);
        document.getElementById('cantidad')?.focus();
      }
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
      container.innerHTML = `<tr><td colspan="5">${Shell.vacio(
        'Todavía no hay stock',
        'Registrá producción y va a aparecer acá.')}</td></tr>`;
      return;
    }

    container.innerHTML = stock.map(item => {
      const disponible = Number(item.stock_actual) || 0;
      const estado = disponible === 0 ? 'SIN STOCK' : (disponible < 10 ? 'POCO STOCK' : 'DISPONIBLE');

      return `
        <tr>
          <td><strong>${item.modelo}</strong></td>
          <td class="num ${disponible === 0 ? 'neg' : ''}" data-label="Disponible">${disponible}</td>
          <td class="num muted solo-escritorio" data-label="Producido">${item.producido_total || 0}</td>
          <td class="num muted solo-escritorio" data-label="Entregado">${item.entregado_total || 0}</td>
          <td data-label="Estado">${Shell.pill(estado)}</td>
        </tr>`;
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
      tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
        'Sin registros en este período',
        'Probá ampliar las fechas o sacar el filtro de modelo.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = historial.map(item => `
        <tr>
          <td><strong>${Shell.fecha(item.fecha_produccion)}</strong></td>
          <td data-label="Modelo">${item.modelo}</td>
          <td class="num" data-label="Cantidad">${item.cantidad}</td>
          <td class="muted solo-escritorio" data-label="Registró">${item.registrado_por || '—'}</td>
          <td class="muted solo-escritorio" data-label="Observaciones">${item.observaciones || '—'}</td>
        </tr>`).join('');

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
      tbody.innerHTML = `<tr><td colspan="6">${Shell.vacio(
        'Sin movimientos en el período',
        'Elegí otras fechas para ver producción y entregas.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = reporte.map(item => {
      const disponible = Number(item.stock_actual) || 0;
      return `
        <tr>
          <td><strong>${item.modelo}</strong></td>
          <td class="num pos" data-label="Producido">${item.producido_periodo || 0}</td>
          <td class="num" data-label="Entregado">${item.entregado_periodo || 0}</td>
          <td class="num muted solo-escritorio" data-label="Producido total">${item.producido_total || 0}</td>
          <td class="num muted solo-escritorio" data-label="Entregado total">${item.entregado_total || 0}</td>
          <td class="num ${disponible === 0 ? 'neg' : ''}" data-label="Disponible">${disponible}</td>
        </tr>`;
    }).join('');

  } catch (err) {
    console.error('Error cargando reporte:', err);
    mostrarAlerta('Error cargando reporte', 'error');
  }
}


// ============================================
// STOCK DE MATERIA PRIMA (solo cantidades)
// ============================================
// Para saber si alcanza el material antes de producir. El endpoint devuelve
// precios y proveedor solo si quien pregunta es admin: al operario le llegan
// únicamente las cantidades (backend/services/vista-operario.js).
async function cargarMateriaPrima() {
  const tbody = document.getElementById('materiaPrimaContainer');
  if (!tbody) return;

  try {
    const buscar = document.getElementById('buscarMateriaPrima')?.value?.trim();
    const soloFaltantes = document.getElementById('filtroMateriaPrimaBajo')?.checked;

    const url = '/api/stock' + (buscar ? '?search=' + encodeURIComponent(buscar) : '');
    let materiales = await apiFetch(url);

    if (soloFaltantes) {
      materiales = materiales.filter(m =>
        Number(m.stock_actual) <= Number(m.stock_minimo || 0));
    }

    if (!materiales.length) {
      tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
        'No hay materiales que coincidan',
        'Probá con otro nombre o sacá el filtro.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = materiales.map(m => {
      const actual = Number(m.stock_actual) || 0;
      const minimo = Number(m.stock_minimo) || 0;
      const estado = actual === 0 ? 'SIN STOCK' : (actual <= minimo ? 'FALTA' : 'OK');

      return `
        <tr>
          <td><strong>${m.nombre || '—'}</strong>${m.codigo ? ' <span class="muted">' + m.codigo + '</span>' : ''}</td>
          <td class="num ${actual === 0 ? 'neg' : ''}" data-label="Cantidad">${actual.toLocaleString('es-AR')} ${m.unidad_medida || ''}</td>
          <td class="num muted solo-escritorio" data-label="Mínimo">${minimo.toLocaleString('es-AR')}</td>
          <td class="muted solo-escritorio" data-label="Ubicación">${m.ubicacion || '—'}</td>
          <td data-label="Estado">${Shell.pill(estado)}</td>
        </tr>`;
    }).join('');

  } catch (err) {
    Shell.error(err, 'No se pudo cargar el stock de materiales');
    tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
      'No se pudo cargar', 'Probá recargar la página.')}</td></tr>`;
  }
}

// ============================================
// PESTAÑAS
// ============================================
// Mismo patrón que el resto de las pantallas migradas: los botones llevan
// data-tab y el contenido vive en #tab-<nombre>.
function mostrarTab(nombre, boton) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  boton.classList.add('active');
  const contenido = document.getElementById('tab-' + nombre);
  if (contenido) contenido.classList.add('active');

  if (nombre === 'stock') cargarStock();
  if (nombre === 'materiaprima') cargarMateriaPrima();
  if (nombre === 'historial') cargarHistorial();
  if (nombre === 'reporte' && puedeVerReportes()) cargarReporte();
}

// ============================================
// AVISOS
// ============================================
function mostrarAlerta(mensaje, tipo) {
  // Antes escribía en un <div id="alert"> propio de esta pantalla. Ahora usa
  // el mismo toast que el resto del sistema.
  Shell.toast(tipo === 'error' ? 'err' : 'ok', mensaje);
}

// ============================================
// LOGOUT
// ============================================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}
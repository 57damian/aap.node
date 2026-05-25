// =====================
// VERIFICAR AUTENTICACION
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

// ====================================
// VARIABLES GLOBALES
// ====================================
let modelosCache = null; // Cache para evitar multiples cargas

// ====================================
// FUNCIONES DE UTILIDAD
// ====================================
function showLoading(elementId, message = 'Cargando...', colSpan = 4) {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `
      <tr class="loading-row">
        <td colspan="${colSpan}">
          <div class="loading-spinner"></div> ${message}
        </td>
      </tr>
    `;
  }
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function mostrarAlerta(mensaje, tipo = 'success') {
  const alertDiv = document.getElementById('alert');
  if (!alertDiv) return;

  alertDiv.textContent = mensaje;
  alertDiv.className = `alert alert-${tipo}`;
  alertDiv.style.display = 'block';

  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 4000);
}

// ====================================
// FUNCIONES DE GESTION DE DOLAR
// ====================================

// Cargar cotizacion actual
async function cargarDolar() {
  try {
    const data = await apiFetch('/api/precios/parametros/dolar');

    const dolarFormateado = formatCurrency(data.dolar);

    const dolarActualEl = document.getElementById('dolarActual');
    const dolarValorEl = document.getElementById('dolarValor');
    const dolarFechaEl = document.getElementById('dolarFecha');

    if (dolarActualEl) {
      dolarActualEl.innerHTML = `ARS ${dolarFormateado}`;
    }

    if (dolarValorEl) {
      dolarValorEl.innerHTML = dolarFormateado;
    }

    if (dolarFechaEl) {
      const fecha = new Date(data.fecha);
      dolarFechaEl.innerHTML = `
        <i class="far fa-clock"></i>
        Ultima actualizacion: ${fecha.toLocaleDateString('es-AR')} ${fecha.toLocaleTimeString('es-AR')}
      `;
    }
  } catch (err) {
    console.error('Error cargando dolar:', err);
    mostrarAlerta('Error cargando cotizacion del dolar', 'error');

    const dolarActualEl = document.getElementById('dolarActual');
    if (dolarActualEl) {
      dolarActualEl.innerHTML = 'Error al cargar';
    }
  }
}

// Cargar historial de cotizaciones
async function cargarHistorialDolar() {
  const tbody = document.getElementById('historialDolar');
  try {
    showLoading('historialDolar', 'Cargando historial...', 3);

    const historial = await apiFetch('/api/precios/parametros/dolar/historial');

    if (!tbody) return;

    if (!historial || historial.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-state">
            <i class="fas fa-history"></i>
            <p>No hay historial de cotizaciones</p>
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    historial.slice(0, 10).forEach(item => {
      const fecha = formatDate(item.fecha);
      const dolarFormateado = formatCurrency(item.dolar);

      html += `
        <tr>
          <td>
            <i class="far fa-calendar-alt" style="color: #666; margin-right: 8px;"></i>
            ${fecha}
          </td>
          <td>
            <span class="badge badge-success">
              <i class="fas fa-dollar-sign"></i> ARS ${dolarFormateado}
            </span>
          </td>
          <td>
            <span class="badge badge-info">
              <i class="fas fa-user"></i> ${item.usuario || 'Sistema'}
            </span>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (err) {
    console.error('Error cargando historial de dolar:', err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-state">
            <i class="fas fa-exclamation-triangle"></i>
            <p>No se pudo cargar el historial</p>
          </td>
        </tr>
      `;
    }
    mostrarAlerta('Error cargando historial de cotizaciones', 'error');
  }
}

// Actualizar cotizacion del dolar
async function actualizarDolar() {
  const input = document.getElementById('nuevoDolar');
  const nuevoDolar = input?.value;

  if (!nuevoDolar || Number.isNaN(Number(nuevoDolar)) || Number(nuevoDolar) <= 0) {
    mostrarAlerta('Ingrese un valor valido para el dolar', 'error');
    return;
  }

  const valorNumerico = Number(nuevoDolar);

  if (!confirm(`Actualizar cotizacion del dolar a ARS ${valorNumerico.toFixed(2)}?`)) {
    return;
  }

  const btn = document.querySelector('button[onclick="actualizarDolar()"]');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
    btn.disabled = true;
  }

  try {
    const result = await apiFetch('/api/precios/parametros/dolar', {
      method: 'PUT',
      body: JSON.stringify({
        dolar: valorNumerico,
        usuario_id: usuario.id
      })
    });

    mostrarAlerta(result.mensaje || 'Dolar actualizado correctamente', 'success');

    await Promise.all([
      cargarDolar(),
      cargarHistorialDolar()
    ]);

    if (input) input.value = '';
  } catch (err) {
    console.error('Error actualizando dolar:', err);
    mostrarAlerta(err.error || err.message || 'Error actualizando dolar', 'error');
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
}

// ====================================
// FUNCIONES DE PRECIOS
// ====================================

async function cargarPrecios() {
  try {
    showLoading('tablaPrecios', 'Cargando precios...');

    const data = await apiFetch('/api/precios/actuales');
    const tbody = document.getElementById('tablaPrecios');

    if (!tbody) return;

    if (!data || data.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-state">
            <i class="fas fa-tags"></i>
            <p>No hay precios cargados</p>
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    data.forEach(p => {
      const fecha = p.fecha_desde ? new Date(p.fecha_desde).toLocaleDateString('es-AR') : '-';
      const precioUSD = p.precio_usd != null ? formatCurrency(p.precio_usd) : '-';

      html += `
        <tr>
          <td><strong>${p.modelo || 'Sin nombre'}</strong></td>
          <td>
            <span class="badge badge-success">
              <i class="fas fa-dollar-sign"></i> USD ${precioUSD}
            </span>
          </td>
          <td><i class="far fa-calendar-alt"></i> ${fecha}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="actualizarPrecio(${p.ficha_id})">
              <i class="fas fa-edit"></i> Actualizar
            </button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (err) {
    console.error('Error cargando precios:', err);
    mostrarAlerta(err.error || err.message || 'Error cargando precios', 'error');
  }
}

async function cargarModelos() {
  if (modelosCache) return modelosCache;

  const data = await apiFetch('/api/precios/actuales');
  modelosCache = data || [];
  return modelosCache;
}

async function cargarSelectsModelos() {
  try {
    const modelos = await cargarModelos();
    const modeloSelect = document.getElementById('modeloSelect');
    const historialSelect = document.getElementById('historialModeloSelect');

    if (modeloSelect) modeloSelect.innerHTML = '<option value="">-- Seleccionar Modelo --</option>';
    if (historialSelect) historialSelect.innerHTML = '<option value="">-- Seleccionar Modelo --</option>';

    modelos.forEach(m => {
      const label = m.modelo || `Modelo ${m.ficha_id}`;
      if (modeloSelect) {
        const opt = document.createElement('option');
        opt.value = m.ficha_id;
        opt.textContent = label;
        modeloSelect.appendChild(opt);
      }
      if (historialSelect) {
        const opt = document.createElement('option');
        opt.value = m.ficha_id;
        opt.textContent = label;
        historialSelect.appendChild(opt);
      }
    });
  } catch (err) {
    console.error('Error cargando modelos:', err);
    mostrarAlerta('Error cargando modelos', 'error');
  }
}

async function actualizarPrecio(fichaId) {
  const precioStr = prompt('Ingrese nuevo precio USD:');
  if (precioStr === null) return;

  const precio = Number(precioStr);
  if (Number.isNaN(precio) || precio <= 0) {
    mostrarAlerta('Precio invalido', 'error');
    return;
  }

  const observaciones = prompt('Observaciones (opcional):') || null;

  try {
    await apiFetch('/api/precios/modelo', {
      method: 'POST',
      body: JSON.stringify({
        ficha_id: fichaId,
        precio,
        observaciones
      })
    });

    mostrarAlerta('Precio actualizado correctamente', 'success');
    modelosCache = null;
    await Promise.all([cargarPrecios(), cargarSelectsModelos()]);
  } catch (err) {
    console.error('Error actualizando precio:', err);
    mostrarAlerta(err.error || err.message || 'Error actualizando precio', 'error');
  }
}

async function aplicarAumento() {
  const fichaId = document.getElementById('modeloSelect')?.value;
  const porcentajeStr = document.getElementById('porcentaje')?.value;
  const observaciones = document.getElementById('observaciones')?.value || null;

  if (!fichaId) {
    mostrarAlerta('Seleccione un modelo', 'error');
    return;
  }

  const porcentaje = Number(porcentajeStr);
  if (Number.isNaN(porcentaje) || porcentaje <= 0) {
    mostrarAlerta('Ingrese un porcentaje valido', 'error');
    return;
  }

  if (!confirm(`Aplicar aumento del ${porcentaje}% al modelo seleccionado?`)) {
    return;
  }

  try {
    await apiFetch(`/api/precios/aumento/${fichaId}`, {
      method: 'POST',
      body: JSON.stringify({ porcentaje, observaciones })
    });

    mostrarAlerta('Aumento aplicado correctamente', 'success');
    modelosCache = null;

    const porcentajeInput = document.getElementById('porcentaje');
    const obsInput = document.getElementById('observaciones');
    if (porcentajeInput) porcentajeInput.value = '';
    if (obsInput) obsInput.value = '';

    await Promise.all([cargarPrecios(), cargarSelectsModelos()]);
  } catch (err) {
    console.error('Error aplicando aumento:', err);
    mostrarAlerta(err.error || err.message || 'Error aplicando aumento', 'error');
  }
}

async function cargarHistorialPrecios() {
  const fichaId = document.getElementById('historialModeloSelect')?.value;
  const tbody = document.getElementById('tablaHistorialPreciosBody');

  if (!tbody) return;

  if (!fichaId) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="empty-state">
          <i class="fas fa-chart-line"></i>
          <p>Seleccione un modelo para ver su historial</p>
        </td>
      </tr>
    `;
    return;
  }

  try {
    showLoading('tablaHistorialPreciosBody', 'Cargando historial...', 3);

    const data = await apiFetch(`/api/precios/modelo/${fichaId}`);

    if (!data || data.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" class="empty-state">
            <i class="fas fa-history"></i>
            <p>Sin historial para este modelo</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = data.map(item => `
      <tr>
        <td>${formatDate(item.fecha_desde)}</td>
        <td><span class="badge badge-success">USD ${formatCurrency(item.precio_usd)}</span></td>
        <td>${item.observaciones || '-'}</td>
      </tr>
    `).join('');

    const generalBody = document.getElementById('tablaHistorial');
    if (generalBody) {
      generalBody.innerHTML = data.map(item => `
        <tr>
          <td><span class="badge badge-success">USD ${formatCurrency(item.precio_usd)}</span></td>
          <td>${formatDate(item.fecha_desde)}</td>
          <td>${item.observaciones || '-'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error cargando historial de precios:', err);
    mostrarAlerta(err.error || err.message || 'Error cargando historial', 'error');
  }
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await Promise.all([
      cargarDolar(),
      cargarHistorialDolar(),
      cargarPrecios()
    ]);

    await cargarSelectsModelos();
  } catch (err) {
    console.error('Error inicializando pantalla de precios:', err);
    mostrarAlerta('Error inicializando la pantalla', 'error');
  }
});

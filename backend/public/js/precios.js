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
  Shell.toast(tipo === 'error' ? 'err' : 'ok', mensaje);
}

// Cargar cotizacion actual
async function cargarDolar() {
  try {
    const data = await apiFetch('/api/precios/parametros/dolar');

    const dolarFormateado = formatCurrency(data.dolar);

    const dolarActualEl = document.getElementById('dolarActual');
    const dolarValorEl = document.getElementById('dolarValor');
    const dolarFechaEl = document.getElementById('dolarFecha');

    if (dolarActualEl) {
      dolarActualEl.textContent = `$ ${dolarFormateado}`;
    }

    if (dolarValorEl) {
      dolarValorEl.innerHTML = dolarFormateado;
    }

    if (dolarFechaEl) {
      // Antes esto mostraba "Ultima actualizacion: Invalid Date Invalid Date"
      // cuando el parámetro no traía fecha: se construía un Date con undefined
      // y se imprimía dos veces (fecha y hora), sin comprobar nada.
      const fecha = data.fecha ? new Date(data.fecha) : null;
      dolarFechaEl.textContent = (fecha && !isNaN(fecha))
        ? `Actualizada el ${fecha.toLocaleDateString('es-AR')} a las ${fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
        : 'Todavía no se cargó ninguna cotización';
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
      tbody.innerHTML = `<tr><td colspan="3">${Shell.vacio(
        'Todavía no hay cotizaciones guardadas',
        'Cada vez que actualices el dólar, queda registrado acá.')}</td></tr>`;
      return;
    }

    let html = '';
    historial.slice(0, 10).forEach(item => {
      const fecha = formatDate(item.fecha);
      const dolarFormateado = formatCurrency(item.dolar);

      html += `
        <tr>
          <td>${fecha}</td>
          <td class="num" data-label="Valor">$ ${dolarFormateado}</td>
          <td class="muted solo-escritorio" data-label="Cargó">${item.usuario || 'Sistema'}</td>
        </tr>`;
    });

    tbody.innerHTML = html;
  } catch (err) {
    console.error('Error cargando historial de dolar:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="3">${Shell.vacio(
        'No se pudo cargar el historial', 'Probá recargar la página.')}</td></tr>`;
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
    btn.textContent = 'Guardando…';
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
      tbody.innerHTML = `<tr><td colspan="4">${Shell.vacio(
        'Todavía no hay precios cargados',
        'Cargá el precio de un modelo con el botón Cambiar, o aplicá un aumento general.')}</td></tr>`;
      return;
    }

    let html = '';
    data.forEach(p => {
      const precioUSD = p.precio_usd != null ? formatCurrency(p.precio_usd) : '—';

      html += `
        <tr>
          <td><strong>${p.modelo || 'Sin nombre'}</strong></td>
          <td class="num" data-label="Precio">US$ ${precioUSD}</td>
          <td class="muted solo-escritorio" data-label="Desde">${Shell.fecha(p.fecha_desde)}</td>
          <td class="num">
            <button class="b b-ghost b-sm" onclick="actualizarPrecio(${p.ficha_id})">Cambiar</button>
          </td>
        </tr>`;
    });

    tbody.innerHTML = html;
  } catch (err) {
    console.error('Error cargando historial de dolar:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="3">${Shell.vacio(
        'No se pudo cargar el historial', 'Probá recargar la página.')}</td></tr>`;
    }
    mostrarAlerta('Error cargando historial de cotizaciones', 'error');
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

// Abre la ventana para cambiar el precio de un modelo.
async function actualizarPrecio(fichaId) {
  const modelos = await cargarModelos();
  const modelo = (modelos || []).find(m => m.id === fichaId || m.ficha_id === fichaId);

  document.getElementById('precio_ficha_id').value = fichaId;
  document.getElementById('precio_modelo').value = modelo ? (modelo.modelo || '') : '';
  document.getElementById('precio_nuevo').value = '';
  document.getElementById('precio_obs').value = '';
  document.getElementById('precioModal').showModal();
  document.getElementById('precio_nuevo').focus();
}

async function guardarPrecioModelo() {
  const fichaId = Number(document.getElementById('precio_ficha_id').value);
  const precio = Number(document.getElementById('precio_nuevo').value);
  const observaciones = document.getElementById('precio_obs').value.trim() || null;

  if (Number.isNaN(precio) || precio <= 0) {
    mostrarAlerta('Escribí un precio mayor a cero', 'error');
    return;
  }

  try {
    await apiFetch('/api/precios/modelo', {
      method: 'POST',
      body: JSON.stringify({ ficha_id: fichaId, precio, observaciones })
    });

    document.getElementById('precioModal').close();
    mostrarAlerta('Precio actualizado', 'success');
    modelosCache = null;
    await Promise.all([cargarPrecios(), cargarSelectsModelos()]);
  } catch (err) {
    Shell.error(err, 'No se pudo actualizar el precio');
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
    tbody.innerHTML = '<tr><td colspan="3" class="muted">Elegí un modelo para ver su historial.</td></tr>';
    return;
  }

  try {
    showLoading('tablaHistorialPreciosBody', 'Cargando historial...', 3);

    const data = await apiFetch(`/api/precios/modelo/${fichaId}`);

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3">${Shell.vacio(
        'Este modelo no tuvo cambios de precio',
        'Los cambios quedan registrados acá cuando actualizás el precio.')}</td></tr>`;
      return;
    }

    // Antes esto llenaba DOS tablas con exactamente los mismos datos, solo
    // que con las columnas en otro orden ("historial por modelo" e "historial
    // general"). Quedó una.
    tbody.innerHTML = data.map(item => `
      <tr>
        <td>${Shell.fecha(item.fecha_desde)}</td>
        <td class="num" data-label="Precio">US$ ${formatCurrency(item.precio_usd)}</td>
        <td class="muted solo-escritorio" data-label="Motivo">${item.observaciones || '—'}</td>
      </tr>
    `).join('');
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

// ============================================
// PESTAÑAS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-cerrar]').forEach(b => {
    b.addEventListener('click', () => document.getElementById(b.dataset.cerrar)?.close());
  });

  document.querySelectorAll('.tab[data-tab]').forEach(boton => {
    boton.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      boton.classList.add('active');
      document.getElementById('tab-' + boton.dataset.tab)?.classList.add('active');
    });
  });
});

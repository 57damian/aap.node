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
let materialesConsumoCache = []; // stock de materia prima, para la sección "Material consumido"





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
  cargarMaterialesParaConsumo();

  document.getElementById('btnAgregarMaterialProduccion')?.addEventListener('click', agregarFilaMaterialProduccion);
  agregarFilaMaterialProduccion(); // arranca con una fila vacía, mismo patrón que oc.js

  // Cierre de diálogos: mismo patrón data-cerrar que el resto de las pantallas.
  document.querySelectorAll('[data-cerrar]').forEach(b => {
    b.addEventListener('click', () => document.getElementById(b.dataset.cerrar)?.close());
  });
  document.getElementById('btnConfirmarAnularProduccion')?.addEventListener('click', confirmarAnularProduccion);
  document.getElementById('anularProduccionMotivo')?.addEventListener('input', () => { limpiarErrorAnularProduccion(); validarAnularProduccion(); });
  document.getElementById('anularProduccionConfirmar')?.addEventListener('input', () => { limpiarErrorAnularProduccion(); validarAnularProduccion(); });

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

    // Select para filtro de la tab "Consumo de materiales"
    const consumoModelo = document.getElementById('consumoModelo');
    if (consumoModelo) {
      consumoModelo.innerHTML = '<option value="">Todos</option>';
      modelos.forEach(modelo => {
        const option = document.createElement('option');
        option.value = modelo.id;
        option.textContent = modelo.modelo;
        consumoModelo.appendChild(option);
      });
    }

    console.log(`✅ ${modelos.length} modelos cargados`);

  } catch (err) {
    console.error('Error cargando modelos:', err);
    mostrarAlerta('Error cargando modelos', 'error');
  }
}

// ============================================
// MATERIAL CONSUMIDO (30/09/2026)
// ============================================
// Todavía no hay receta por modelo, así que el consumo de materia prima se
// carga a mano junto con la producción. Mismo patrón de filas dinámicas que
// "+ Agregar ítem" en oc.js.
async function cargarMaterialesParaConsumo() {
  try {
    // /api/stock (no /api/materias-primas): ese es soloAdmin y el operario
    // no puede llamarlo. Acá solo hace falta nombre + stock_actual.
    materialesConsumoCache = await apiFetch('/api/stock');
  } catch (err) {
    console.error('Error cargando materiales para consumo:', err);
    materialesConsumoCache = [];
  }

  // Select del filtro de material en la tab "Consumo de materiales" (admin).
  const consumoMaterial = document.getElementById('consumoMaterial');
  if (consumoMaterial) {
    const seleccionPrevia = consumoMaterial.value;
    consumoMaterial.innerHTML = '<option value="">Todos</option>' +
      materialesConsumoCache.map(m => `<option value="${m.articulo_id}">${m.nombre}</option>`).join('');
    consumoMaterial.value = seleccionPrevia;
  }
}

function opcionesMaterialConsumo() {
  return '<option value="">Elegí un material…</option>' +
    materialesConsumoCache.map(m => {
      const stock = Number(m.stock_actual) || 0;
      const etiqueta = m.nombre + (stock === 0 ? ' (sin stock)' : '');
      return `<option value="${m.articulo_id}" data-stock="${stock}" data-unidad="${m.unidad_medida || ''}">${etiqueta}</option>`;
    }).join('');
}

function agregarFilaMaterialProduccion() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="input" data-campo="materia_prima_id">${opcionesMaterialConsumo()}</select></td>
    <td><input class="input" type="number" data-campo="cantidad_usada" min="0" step="any" value="0"></td>
    <td><input class="input" type="number" data-campo="cantidad_desperdiciada" min="0" step="any" value="0"></td>
    <td><input class="input" type="text" data-campo="observaciones" placeholder="Opcional"></td>
    <td>
      <button type="button" class="b b-ghost b-sm" data-vaciar-resto>Vaciar resto</button>
      <button type="button" class="b b-ghost b-sm" data-quitar-material>Quitar</button>
    </td>
  `;

  const campoUsada = tr.querySelector('[data-campo="cantidad_usada"]');
  const campoDesperdiciada = tr.querySelector('[data-campo="cantidad_desperdiciada"]');
  const selectMaterial = tr.querySelector('[data-campo="materia_prima_id"]');

  // "Vaciar resto": el material que quedó físicamente vacío aunque la
  // cuenta (stock conocido - usado) diga que debería sobrar algo.
  tr.querySelector('[data-vaciar-resto]').addEventListener('click', () => {
    const opt = selectMaterial.selectedOptions[0];
    if (!opt || !opt.value) {
      Shell.toast('err', 'Elegí primero el material');
      return;
    }
    const stockConocido = Number(opt.dataset.stock || 0);
    const usada = Number(campoUsada.value || 0);
    campoDesperdiciada.value = Math.max(0, stockConocido - usada);
    tr.dataset.vaciado = '1';
  });

  // Si se toca "Vaciar resto" y después se cambia la cantidad usada, la
  // cuenta queda vieja — se recalcula sola en vez de dejarla desactualizada.
  campoUsada.addEventListener('input', () => {
    if (tr.dataset.vaciado !== '1') return;
    const opt = selectMaterial.selectedOptions[0];
    const stockConocido = Number(opt?.dataset.stock || 0);
    campoDesperdiciada.value = Math.max(0, stockConocido - Number(campoUsada.value || 0));
  });

  selectMaterial.addEventListener('change', () => { tr.dataset.vaciado = ''; });

  tr.querySelector('[data-quitar-material]').addEventListener('click', () => tr.remove());
  document.getElementById('produccion_materialesBody')?.appendChild(tr);
}

function resetMaterialesProduccion() {
  const body = document.getElementById('produccion_materialesBody');
  if (body) body.innerHTML = '';
  agregarFilaMaterialProduccion();
}

function recolectarMaterialesProduccion() {
  const filas = [...(document.getElementById('produccion_materialesBody')?.querySelectorAll('tr') || [])];
  return filas
    .map(fila => ({
      materia_prima_id: fila.querySelector('[data-campo="materia_prima_id"]').value,
      cantidad_usada: fila.querySelector('[data-campo="cantidad_usada"]').value,
      cantidad_desperdiciada: fila.querySelector('[data-campo="cantidad_desperdiciada"]').value,
      observaciones: fila.querySelector('[data-campo="observaciones"]').value || undefined
    }))
    .filter(m => m.materia_prima_id && (Number(m.cantidad_usada) > 0 || Number(m.cantidad_desperdiciada) > 0));
}

// ============================================
// REGISTRAR PRODUCCIÓN
// ============================================
// Sin esta guarda, un doble click en "Registrar producción" mandaba dos POST
// idénticos: no hay UNIQUE en produccion que lo evite, así que se sumaba el
// stock dos veces (hallazgo 27/09/2026, mismo patrón que oc.js).
let produccionEnviando = false;

async function registrarProduccion(e) {
  e.preventDefault();
  if (produccionEnviando) return;

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

  const materiales = recolectarMaterialesProduccion();
  // Mismas reglas que valida el backend (validarMateriales en
  // produccion.routes.js), para no depender solo del rechazo del servidor.
  const idsVistos = new Set();
  for (const m of materiales) {
    if (idsVistos.has(m.materia_prima_id)) {
      mostrarAlerta('Hay un material repetido en "Material consumido": sumá las cantidades en una sola fila', 'error');
      return;
    }
    idsVistos.add(m.materia_prima_id);
    if (Number(m.cantidad_usada) < 0 || Number(m.cantidad_desperdiciada) < 0) {
      mostrarAlerta('Las cantidades de material no pueden ser negativas', 'error');
      return;
    }
  }

  produccionEnviando = true;
  const btn = e.target.querySelector('button[type="submit"]');
  const textoBoton = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }

  try {
    const response = await apiFetch('/api/produccion', {
      method: 'POST',
      body: JSON.stringify({
        ficha_id: parseInt(ficha_id),
        cantidad: parseInt(cantidad),
        fecha_produccion: fecha_produccion || undefined,
        observaciones: observaciones || null,
        usuario_id: usuario.id,
        materiales
      })
    });

    mostrarAlerta(response.mensaje || '✅ Producción registrada', 'success');

    // Limpiar formulario
    document.getElementById('cantidad').value = '';
    document.getElementById('observaciones').value = '';
    resetMaterialesProduccion();

    // Recargar datos (el consumo de materiales movió stock, así que el
    // select de la próxima carga tiene que reflejar los valores nuevos)
    await cargarStock();
    await cargarHistorial();
    await cargarReporte();
    await cargarMaterialesParaConsumo();

  } catch (err) {
    console.error('Error registrando producción:', err);
    mostrarAlerta(err.error || 'Error registrando producción', 'error');
  } finally {
    produccionEnviando = false;
    if (btn) { btn.disabled = false; btn.textContent = textoBoton; }
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
let historialProduccionCache = [];

function paramsHistorialProduccion() {
  const modelo = document.getElementById('filtroModelo')?.value;
  const desde = document.getElementById('filtroDesde')?.value;
  const hasta = document.getElementById('filtroHasta')?.value;

  const params = new URLSearchParams();
  if (modelo) params.append('ficha_id', modelo);
  if (desde) params.append('desde', desde);
  if (hasta) params.append('hasta', hasta);
  return params;
}

async function cargarHistorial() {
  try {
    const params = paramsHistorialProduccion();
    const url = `/api/produccion${params.toString() ? '?' + params : ''}`;

    const historial = await apiFetch(url);
    historialProduccionCache = historial || [];
    const tbody = document.getElementById('historialTable');

    if (!historial || historial.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">${Shell.vacio(
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
          <td data-label="Acciones">
            <button type="button" class="b b-ghost b-sm" onclick="verConsumoProduccion(${item.id})">Ver consumo</button>
            ${usuario.rol === 'admin'
              ? `<button type="button" class="b b-ghost b-sm" onclick="abrirAnularProduccion(${item.id})">Anular</button>`
              : ''}
          </td>
        </tr>`).join('');

  } catch (err) {
    console.error('Error cargando historial:', err);
    mostrarAlerta('Error cargando historial', 'error');
  }
}

// Exportar el historial ya filtrado (mismo patrón que stock.js:exportarMovimientosCSV)
function exportarHistorialProduccionCSV() {
  if (!historialProduccionCache.length) {
    Shell.toast('err', 'No hay datos para exportar');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,';
  const headers = ['Fecha', 'Modelo', 'Cantidad', 'Registró', 'Observaciones'];
  csvContent += headers.join(',') + '\n';

  historialProduccionCache.forEach(item => {
    const fila = [
      item.fecha_produccion || '',
      `"${(item.modelo || '').replace(/"/g, '""')}"`,
      item.cantidad ?? 0,
      `"${(item.registrado_por || '').replace(/"/g, '""')}"`,
      `"${(item.observaciones || '').replace(/"/g, '""')}"`
    ];
    csvContent += fila.join(',') + '\n';
  });

  const desde = document.getElementById('filtroDesde')?.value;
  const hasta = document.getElementById('filtroHasta')?.value;
  const rango = (desde || hasta) ? `${desde || 'inicio'}_a_${hasta || 'hoy'}` : new Date().toISOString().slice(0, 10);

  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `produccion-${rango}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  Shell.toast('ok', 'Reporte exportado');
}

// Previsualizar/descargar el mismo informe en PDF (mismos filtros aplicados)
async function verHistorialProduccionPdf() {
  try {
    const params = paramsHistorialProduccion();
    await verArchivoProtegido(`api/produccion/reporte/pdf${params.toString() ? '?' + params : ''}`);
  } catch (err) {
    Shell.error(err, 'No se pudo abrir el PDF');
  }
}

// ============================================
// VER CONSUMO DE UNA CARGA PUNTUAL (30/09/2026)
// ============================================
async function verConsumoProduccion(id) {
  try {
    const materiales = await apiFetch(`/api/produccion/${id}/materiales`);
    const item = historialProduccionCache.find(h => h.id === id);
    document.getElementById('verConsumoTitulo').textContent = item
      ? `Material consumido — ${item.modelo} (${Shell.fecha(item.fecha_produccion)})`
      : 'Material consumido';

    const body = document.getElementById('verConsumoBody');
    if (!materiales.length) {
      body.innerHTML = `<tr><td colspan="4">${Shell.vacio('Sin material cargado', 'Esta carga no tiene consumo de materia prima registrado.')}</td></tr>`;
    } else {
      body.innerHTML = materiales.map(m => `
        <tr>
          <td>${m.nombre}${m.codigo ? ' <span class="muted">' + m.codigo + '</span>' : ''}</td>
          <td>${m.tipo_movimiento === 'MERMA' ? 'Desperdiciado' : 'Usado'}</td>
          <td class="num">${Math.abs(Number(m.cantidad)).toLocaleString('es-AR')} ${m.unidad_medida || ''}</td>
          <td class="muted solo-escritorio">${m.observaciones || '—'}</td>
        </tr>`).join('');
    }

    document.getElementById('verConsumoModal').showModal();
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el consumo de esta carga');
  }
}

// ============================================
// ANULAR PRODUCCIÓN (30/09/2026)
// Mismo patrón que correcciones.js: preview -> motivo + confirmar número -> POST.
// No hay "editar" una carga: para corregir se anula (revierte el material
// al stock) y se vuelve a cargar bien.
// ============================================
const MOTIVO_ANULAR_PRODUCCION_MIN = 10;
let anularProduccionActual = null;
let anularProduccionEnviando = false;

function limpiarErrorAnularProduccion() {
  const el = document.getElementById('anularProduccionError');
  el.hidden = true;
  el.textContent = '';
}

function validarAnularProduccion() {
  if (!anularProduccionActual) return;
  const motivoOk = document.getElementById('anularProduccionMotivo').value.trim().length >= MOTIVO_ANULAR_PRODUCCION_MIN;
  const numOk = document.getElementById('anularProduccionConfirmar').value.trim() === String(anularProduccionActual.identificador).trim();
  const btn = document.getElementById('btnConfirmarAnularProduccion');
  btn.disabled = anularProduccionEnviando || !(motivoOk && numOk);
  document.getElementById('anularProduccionMotivo').classList.toggle('is-invalid',
    document.getElementById('anularProduccionMotivo').value.length > 0 && !motivoOk);
  document.getElementById('anularProduccionConfirmar').classList.toggle('is-invalid',
    document.getElementById('anularProduccionConfirmar').value.length > 0 && !numOk);
}

async function abrirAnularProduccion(id) {
  try {
    const preview = await apiFetch(`/api/produccion/${id}/anulacion-preview`);
    const { produccion, movimientos } = preview;
    anularProduccionActual = { id, identificador: produccion.identificador };

    document.getElementById('anularProduccionNumeroRef').textContent = produccion.identificador;
    document.getElementById('anularProduccionMotivo').value = '';
    document.getElementById('anularProduccionConfirmar').value = '';
    limpiarErrorAnularProduccion();

    document.getElementById('anularProduccionResumen').innerHTML = `
      <p><strong>${produccion.modelo}</strong> — ${produccion.cantidad} unidades, ${Shell.fecha(produccion.fecha_produccion)}</p>
      ${movimientos.length ? `
        <p class="muted" style="margin-bottom:var(--space-2)">Esto va a volver al stock de materia prima:</p>
        <ul class="consecuencias">
          ${movimientos.map(m => `<li>${m.tipo_movimiento === 'MERMA' ? 'Desperdiciado' : 'Usado'}: ${Math.abs(Number(m.cantidad)).toLocaleString('es-AR')} ${m.unidad || ''} de ${m.material_nombre}</li>`).join('')}
        </ul>` : ''}
    `;
    document.getElementById('anularProduccionSinMateriales').hidden = movimientos.length > 0;

    validarAnularProduccion();
    document.getElementById('anularProduccionModal').showModal();
  } catch (err) {
    Shell.error(err, 'No se pudo preparar la anulación');
  }
}

async function confirmarAnularProduccion() {
  if (!anularProduccionActual || anularProduccionEnviando) return;
  anularProduccionEnviando = true;
  limpiarErrorAnularProduccion();
  const btn = document.getElementById('btnConfirmarAnularProduccion');
  btn.disabled = true;
  btn.textContent = 'Anulando…';

  try {
    const r = await apiFetch(`/api/produccion/${anularProduccionActual.id}/anular`, {
      method: 'POST',
      body: JSON.stringify({
        motivo: document.getElementById('anularProduccionMotivo').value.trim(),
        confirmar_numero: document.getElementById('anularProduccionConfirmar').value.trim()
      })
    });
    document.getElementById('anularProduccionModal').close();
    Shell.toast('ok', 'Producción anulada', r.message || '');
    await cargarHistorial();
    await cargarStock();
    await cargarMaterialesParaConsumo();
  } catch (err) {
    const el = document.getElementById('anularProduccionError');
    el.hidden = false;
    el.textContent = err.error || 'No se pudo anular la producción.';
    btn.textContent = 'Anular producción';
  } finally {
    anularProduccionEnviando = false;
    validarAnularProduccion();
  }
}

// ============================================
// CONSUMO DE MATERIALES (tab, solo admin — 30/09/2026)
// ============================================
let consumoMaterialesCache = [];

function paramsConsumoMateriales() {
  const desde = document.getElementById('consumoDesde')?.value;
  const hasta = document.getElementById('consumoHasta')?.value;
  const ficha_id = document.getElementById('consumoModelo')?.value;
  const materia_prima_id = document.getElementById('consumoMaterial')?.value;

  const params = new URLSearchParams();
  if (desde) params.append('desde', desde);
  if (hasta) params.append('hasta', hasta);
  if (ficha_id) params.append('ficha_id', ficha_id);
  if (materia_prima_id) params.append('materia_prima_id', materia_prima_id);
  return params;
}

async function cargarConsumoMateriales() {
  if (!puedeVerReportes()) return;
  const tbody = document.getElementById('consumoMaterialesTable');
  try {
    const params = paramsConsumoMateriales();
    const url = `/api/produccion/materiales-informe${params.toString() ? '?' + params : ''}`;
    const datos = await apiFetch(url);
    consumoMaterialesCache = datos || [];

    if (!consumoMaterialesCache.length) {
      tbody.innerHTML = `<tr><td colspan="4">${Shell.vacio(
        'Sin consumo en este período',
        'Probá ampliar las fechas o sacar los filtros.')}</td></tr>`;
      return;
    }

    tbody.innerHTML = consumoMaterialesCache.map(m => `
      <tr>
        <td><strong>${m.nombre}</strong>${m.codigo ? ' <span class="muted">' + m.codigo + '</span>' : ''}</td>
        <td class="num" data-label="Usado">${Number(m.total_usado).toLocaleString('es-AR')} ${m.unidad_medida || ''}</td>
        <td class="num" data-label="Desperdiciado">${Number(m.total_desperdiciado).toLocaleString('es-AR')} ${m.unidad_medida || ''}</td>
        <td class="num" data-label="% Merma">${m.porcentaje_merma != null ? m.porcentaje_merma + '%' : '—'}</td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el consumo de materiales');
    tbody.innerHTML = `<tr><td colspan="4">${Shell.vacio('No se pudo cargar', 'Probá recargar la página.')}</td></tr>`;
  }
}

function exportarConsumoMaterialesCSV() {
  if (!consumoMaterialesCache.length) {
    Shell.toast('err', 'No hay datos para exportar');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,';
  const headers = ['Material', 'Código', 'Usado', 'Desperdiciado', 'Unidad', '% Merma'];
  csvContent += headers.join(',') + '\n';

  consumoMaterialesCache.forEach(m => {
    const fila = [
      `"${(m.nombre || '').replace(/"/g, '""')}"`,
      `"${(m.codigo || '').replace(/"/g, '""')}"`,
      m.total_usado ?? 0,
      m.total_desperdiciado ?? 0,
      `"${(m.unidad_medida || '').replace(/"/g, '""')}"`,
      m.porcentaje_merma ?? ''
    ];
    csvContent += fila.join(',') + '\n';
  });

  const desde = document.getElementById('consumoDesde')?.value;
  const hasta = document.getElementById('consumoHasta')?.value;
  const rango = (desde || hasta) ? `${desde || 'inicio'}_a_${hasta || 'hoy'}` : new Date().toISOString().slice(0, 10);

  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `consumo-materiales-${rango}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  Shell.toast('ok', 'Reporte exportado');
}

async function verConsumoMaterialesPdf() {
  try {
    const params = paramsConsumoMateriales();
    await verArchivoProtegido(`api/produccion/materiales-informe/pdf${params.toString() ? '?' + params : ''}`);
  } catch (err) {
    Shell.error(err, 'No se pudo abrir el PDF');
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
  if (nombre === 'consumo' && puedeVerReportes()) cargarConsumoMateriales();
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
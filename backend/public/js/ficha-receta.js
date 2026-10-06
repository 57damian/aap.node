/* =====================================================================
 * Solapa "Receta" del detalle de una ficha técnica (ficha.html).
 *
 * La receta dice qué material se descuenta del stock por cada transformador
 * que se fabrica. Dos partes:
 *   - El alambre de cada devanado: se elige el material al editar la ficha y
 *     el consumo sale del peso en gramos del devanado (acá solo se muestra).
 *   - Otros materiales (carretel, estaño, barniz, cinta, tornillos, bridas,
 *     borneras…): renglones con la cantidad POR transformador y su unidad
 *     (cm de cinta, unidades de tornillos…). Se editan acá.
 * Solo se descuenta lo que está anotado: no hay cálculo automático.
 *
 * Usa de ficha.js: currentFicha, materialesCache, materialesListos, escHtml,
 * opcionesMateriales. Todo lo cargado a mano se escapa con escHtml.
 * ===================================================================== */

let recetaGuardando = false;
let recetaCalculando = false;

const NOMBRE_UNIDAD = { UNI: 'unidades', GR: 'gramos', KG: 'kilos', CM: 'cm', M: 'metros', ROLLO: 'rollos' };

function nombreUnidad(u) { return NOMBRE_UNIDAD[u] || u; }

function numRec(v) {
  return (Number(v) || 0).toLocaleString('es-AR', { maximumFractionDigits: 4 });
}

function materialPorId(id) {
  return materialesCache.find(m => String(m.id) === String(id));
}

/** <option>s de materiales para un renglón (agrupados por categoría). */
function opcionesMaterialesReceta(seleccionadoId) {
  const grupos = new Map();
  materialesCache.forEach(m => {
    const cat = m.categoria_nombre || 'Sin categoría';
    if (!grupos.has(cat)) grupos.set(cat, []);
    grupos.get(cat).push(m);
  });
  let html = '<option value="">Elegí el material…</option>';
  [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).forEach(([cat, lista]) => {
    html += `<optgroup label="${escHtml(cat)}">` + lista.map(m =>
      `<option value="${m.id}" ${String(m.id) === String(seleccionadoId) ? 'selected' : ''}>${escHtml(m.nombre)} (${escHtml(m.unidad_medida)})</option>`
    ).join('') + '</optgroup>';
  });
  return html;
}

function opcionesUnidad(material, seleccionada) {
  const permitidas = material ? material.unidades_permitidas : [];
  if (!permitidas.length) return '<option value="">—</option>';
  return permitidas.map(u =>
    `<option value="${escHtml(u)}" ${u === seleccionada ? 'selected' : ''}>${escHtml(nombreUnidad(u))}</option>`).join('');
}

/** Unidad con la que arranca un renglón nuevo para ese material. */
function unidadInicial(material) {
  const p = material ? material.unidades_permitidas : [];
  // La cinta se anota en cm: si el material los admite, ese es el punto de partida.
  return p.includes('CM') ? 'CM' : (p[0] || '');
}

function filaRecetaHtml(item) {
  const mat = item ? materialPorId(item.materia_prima_id) : null;
  const unidad = item ? item.unidad : '';
  return `
    <tr data-receta-fila>
      <td><select class="input" data-r="materia_prima_id">${opcionesMaterialesReceta(item ? item.materia_prima_id : '')}</select></td>
      <td><input class="input" type="number" step="any" min="0" data-r="cantidad" value="${escHtml(item ? item.cantidad : '')}" style="min-width:90px"></td>
      <td><select class="input" data-r="unidad">${opcionesUnidad(mat, unidad)}</select></td>
      <td><input class="input" type="text" maxlength="200" data-r="observaciones" value="${escHtml(item ? (item.observaciones || '') : '')}" placeholder="Ej: aislación entre capas"></td>
      <td class="num"><button type="button" class="b b-ghost b-sm" data-receta-quitar>Quitar</button></td>
    </tr>`;
}

function mensajeReceta(tipo, texto) {
  const el = document.getElementById('recetaMensaje');
  if (!el) return;
  el.className = 'notice ' + (tipo === 'ok' ? 'notice-ok' : 'notice-err');
  el.textContent = texto || '';
  el.hidden = !texto;
}

function renderReceta(receta) {
  const cont = document.getElementById('recetaContenido');

  const filasDevanados = receta.devanados.map(d => {
    const tienePeso = d.peso_gr > 0;
    let estado;
    if (!tienePeso) estado = '<span class="muted">Sin peso cargado</span>';
    else if (d.material_id) estado = `${escHtml(d.material_nombre)} <span class="muted">(${escHtml(d.material_unidad)})</span>`;
    else estado = '<span class="neg">Sin material elegido: no se descuenta</span>';
    return `
      <tr>
        <td>${escHtml(d.nombre)}</td>
        <td class="muted">${escHtml(d.alambre) || '—'}</td>
        <td>${estado}</td>
        <td class="num">${tienePeso ? numRec(d.peso_gr) + ' gr' : '—'}</td>
      </tr>`;
  }).join('');

  cont.innerHTML = `
    <h4 style="margin:0 0 4px">Alambre de los devanados</h4>
    <p class="muted" style="margin:0 0 8px;font-size:.85rem">
      El material de cada devanado se elige al editar la ficha. Se descuenta el peso en gramos de cada devanado por cada transformador.
    </p>
    <div class="table-wrap"><table class="t">
      <thead><tr><th>Devanado</th><th>Alambre (ficha)</th><th>Material en stock</th><th class="num">Por transformador</th></tr></thead>
      <tbody>${filasDevanados}</tbody>
    </table></div>

    <h4 style="margin:20px 0 4px">Otros materiales por transformador</h4>
    <p class="muted" style="margin:0 0 8px;font-size:.85rem">
      Carretel, estaño, barniz, presspan o cinta, tornillos, bridas, borneras… Cantidad que lleva <strong>un</strong> transformador.
      La cinta se anota en cm (el material tiene que tener cargados los metros por rollo).
    </p>
    <div class="table-wrap"><table class="t" id="recetaTabla">
      <thead><tr><th style="min-width:220px">Material</th><th>Cantidad</th><th>Unidad</th><th>Nota</th><th></th></tr></thead>
      <tbody id="recetaFilas">${receta.items.map(filaRecetaHtml).join('')}</tbody>
    </table></div>
    <p class="muted" id="recetaVacia" style="margin:8px 0" ${receta.items.length ? 'hidden' : ''}>Todavía no hay materiales cargados.</p>
    <div class="notice" id="recetaMensaje" role="alert" hidden style="margin:8px 0"></div>
    <div class="page-head-actions" style="justify-content:flex-start;margin-top:8px">
      <button type="button" class="b b-ghost" id="btnRecetaAgregar">＋ Agregar material</button>
      <button type="button" class="b b-primary" id="btnRecetaGuardar">Guardar receta</button>
    </div>

    <h4 style="margin:24px 0 4px">¿Cuánto material hace falta?</h4>
    <p class="muted" style="margin:0 0 8px;font-size:.85rem">Calcula con la receta guardada y compara con el stock actual.</p>
    <div class="ec-filtros">
      <div class="field">
        <label for="recetaCantidad">Transformadores</label>
        <input class="input" type="number" id="recetaCantidad" min="1" step="1" value="10" style="width:120px">
      </div>
      <button type="button" class="b b-ghost" id="btnRecetaCalcular">Calcular</button>
    </div>
    <div id="recetaNecesidad" style="margin-top:12px"></div>`;
}

async function cargarRecetaTab() {
  if (!currentFicha) return;
  const cont = document.getElementById('recetaContenido');
  cont.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    await materialesListos;
    const receta = await apiFetch(`/api/ficha-transformador/${currentFicha.id}/receta`);
    renderReceta(receta);
  } catch (err) {
    console.error('Error cargando receta:', err);
    cont.innerHTML = `<div class="notice notice-err">${escHtml(err.error || err.message || 'No se pudo cargar la receta')}</div>`;
  }
}

function leerFilasReceta() {
  return Array.from(document.querySelectorAll('#recetaFilas [data-receta-fila]')).map(tr => {
    const v = (campo) => tr.querySelector(`[data-r="${campo}"]`).value;
    return {
      materia_prima_id: v('materia_prima_id'), cantidad: v('cantidad'),
      unidad: v('unidad'), observaciones: v('observaciones').trim()
    };
  }).filter(f => f.materia_prima_id || f.cantidad !== '');   // un renglón totalmente vacío se ignora
}

async function guardarReceta() {
  if (recetaGuardando || !currentFicha) return;
  mensajeReceta('', '');
  const items = leerFilasReceta();
  recetaGuardando = true;
  const btn = document.getElementById('btnRecetaGuardar');
  if (btn) btn.disabled = true;
  try {
    await apiFetch(`/api/ficha-transformador/${currentFicha.id}/receta`, {
      method: 'PUT', body: JSON.stringify({ items })
    });
    await cargarRecetaTab();
    mensajeReceta('ok', 'Receta guardada.');
  } catch (err) {
    mensajeReceta('err', err.error || err.message || 'No se pudo guardar la receta');
  } finally {
    recetaGuardando = false;
    const b = document.getElementById('btnRecetaGuardar');
    if (b) b.disabled = false;
  }
}

async function calcularNecesidadReceta() {
  if (recetaCalculando || !currentFicha) return;
  const cont = document.getElementById('recetaNecesidad');
  const n = Number(document.getElementById('recetaCantidad').value);
  if (!Number.isInteger(n) || n <= 0) {
    cont.innerHTML = '<div class="notice notice-err">Escribí un número entero de transformadores.</div>';
    return;
  }
  recetaCalculando = true;
  try {
    const r = await apiFetch(`/api/ficha-transformador/${currentFicha.id}/receta/necesidad?cantidad=${n}`);
    let html = '';
    r.errores.forEach(e => { html += `<div class="notice notice-err" style="margin-bottom:6px">${escHtml(e)}</div>`; });
    r.avisos.forEach(a => { html += `<div class="notice notice-warn" style="margin-bottom:6px">${escHtml(a)}</div>`; });
    if (!r.tiene_receta) {
      html += '<p class="muted">Esta ficha no tiene receta: producir no descuenta materia prima.</p>';
    } else {
      html += `<div class="table-wrap"><table class="t">
        <thead><tr><th>Material</th><th class="num">Por transformador</th><th class="num">Para ${numRec(n)}</th><th class="num">En stock</th><th class="num">Falta</th></tr></thead>
        <tbody>${r.lineas.map(l => `
          <tr>
            <td>${escHtml(l.nombre)}</td>
            <td class="num">${numRec(l.por_unidad)} ${escHtml(l.unidad)}</td>
            <td class="num">${numRec(l.necesaria)} ${escHtml(l.unidad)}</td>
            <td class="num">${numRec(l.stock_actual)} ${escHtml(l.unidad)}</td>
            <td class="num ${l.faltante > 0 ? 'neg' : 'muted'}">${l.faltante > 0 ? numRec(l.faltante) + ' ' + escHtml(l.unidad) : '—'}</td>
          </tr>`).join('')}
        </tbody></table></div>`;
      html += r.faltantes.length
        ? `<p class="neg" style="margin:8px 0 0">No alcanza el stock de ${r.faltantes.length} material${r.faltantes.length === 1 ? '' : 'es'}.</p>`
        : '<p class="muted" style="margin:8px 0 0">El stock alcanza para todo.</p>';
    }
    cont.innerHTML = html;
  } catch (err) {
    cont.innerHTML = `<div class="notice notice-err">${escHtml(err.error || err.message || 'No se pudo calcular')}</div>`;
  } finally {
    recetaCalculando = false;
  }
}

// Delegación (el shell vuelve a armar el body).
document.addEventListener('click', (e) => {
  if (e.target.closest('#btnRecetaAgregar')) {
    document.getElementById('recetaFilas').insertAdjacentHTML('beforeend', filaRecetaHtml(null));
    document.getElementById('recetaVacia').hidden = true;
    return;
  }
  const quitar = e.target.closest('[data-receta-quitar]');
  if (quitar) {
    quitar.closest('[data-receta-fila]').remove();
    document.getElementById('recetaVacia').hidden = document.querySelectorAll('#recetaFilas [data-receta-fila]').length > 0;
    return;
  }
  if (e.target.closest('#btnRecetaGuardar')) { guardarReceta(); return; }
  if (e.target.closest('#btnRecetaCalcular')) { calcularNecesidadReceta(); }
});

// Al cambiar de material, la lista de unidades se rearma según lo que admite ese material.
document.addEventListener('change', (e) => {
  if (!e.target.matches('#recetaFilas [data-r="materia_prima_id"]')) return;
  const tr = e.target.closest('[data-receta-fila]');
  const mat = materialPorId(e.target.value);
  const selUnidad = tr.querySelector('[data-r="unidad"]');
  selUnidad.innerHTML = opcionesUnidad(mat, unidadInicial(mat));
});

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
function opcionesMaterialesReceta(seleccionadoId, vacio = 'Elegí el material…') {
  const grupos = new Map();
  materialesCache.forEach(m => {
    const cat = m.categoria_nombre || 'Sin categoría';
    if (!grupos.has(cat)) grupos.set(cat, []);
    grupos.get(cat).push(m);
  });
  let html = `<option value="">${escHtml(vacio)}</option>`;
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
    const vacia = document.getElementById('recetaVacia');
    if (vacia) vacia.hidden = document.querySelectorAll('#recetaFilas [data-receta-fila]').length > 0;
    return;
  }
  if (e.target.closest('#btnRecetaGuardar')) { guardarReceta(); return; }
  if (e.target.closest('#btnRecetaCalcular')) { calcularNecesidadReceta(); return; }

  // Receta dentro del formulario de la ficha.
  if (e.target.closest('#btnFormRecetaAgregar')) {
    document.getElementById('formRecetaFilas').insertAdjacentHTML('beforeend', filaRecetaFormHtml(null, null));
    return;
  }
  const quitarForm = e.target.closest('[data-form-receta-quitar]');
  if (quitarForm) { quitarForm.closest('[data-receta-fila]').remove(); return; }
  if (e.target.closest('#btnGuardarConAvisos')) {
    avisosRecetaConfirmados = true;
    document.getElementById('avisosRecetaModal').close();
    document.getElementById('fichaForm').requestSubmit();
  }
});

// Al cambiar de material, la lista de unidades se rearma según lo que admite ese material
// (vale para la solapa Receta y para la receta del formulario de la ficha).
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-receta-fila] [data-r="materia_prima_id"]')) return;
  const tr = e.target.closest('[data-receta-fila]');
  const mat = materialPorId(e.target.value);
  const selUnidad = tr.querySelector('[data-r="unidad"]');
  selUnidad.innerHTML = opcionesUnidad(mat, unidadInicial(mat));
  if (tr.dataset.recetaFija) sugerirCantidadFija(tr, mat);
});

/* =====================================================================
 * Receta dentro del formulario de la ficha (alta y edición).
 *
 * Se guarda junto con la ficha: el formulario manda `receta_items` (JSON) y el
 * servidor lo graba en la misma transacción (solo admin).
 *
 * Carretel y laminación tienen una fila fija cada una. Son renglones comunes de
 * ficha_receta_items; se reconocen al volver a abrir la ficha porque su nota es
 * exactamente "Carretel" / "Laminación" (sin migración). El alambre no se carga
 * acá: sale del material y del peso de cada devanado.
 * ===================================================================== */
const FIJAS_RECETA = [
  { tag: 'Carretel', campoTexto: 'tipo_carretel', campoPeso: null },
  { tag: 'Laminación', campoTexto: 'laminacion', campoPeso: 'peso_laminacion_kg' }
];

let recetaFormCargada = true;          // false mientras se edita y no se pudo leer la receta guardada
let recetaFormListo = Promise.resolve();
let avisosRecetaConfirmados = false;   // "Guardar igual" en el diálogo de avisos

function normTag(t) {
  return String(t || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function valorCampo(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function filaRecetaFormHtml(item, fija) {
  let mat = item ? materialPorId(item.materia_prima_id) : null;
  let opcionesMat = opcionesMaterialesReceta(item ? item.materia_prima_id : '', fija ? 'Sin material (no descuenta stock)' : 'Elegí el material…');
  if (item && !mat) {
    // El material ya no figura entre los activos: se conserva el renglón para que se vea y se pueda cambiar.
    opcionesMat += `<option value="${escHtml(item.materia_prima_id)}" selected>${escHtml(item.material_nombre || 'Material')} (no disponible)</option>`;
    mat = { unidades_permitidas: [item.unidad] };
  }
  const unidad = item ? item.unidad : '';
  const concepto = fija ? `<strong>${escHtml(fija.tag)}</strong>` : '<span class="muted">Otro material</span>';
  const nota = fija
    ? '<span class="muted">—</span>'
    : `<input class="input" type="text" maxlength="200" data-r="observaciones" value="${escHtml(item ? (item.observaciones || '') : '')}" placeholder="Ej: aislación entre capas">`;
  const accion = fija ? '' : '<button type="button" class="b b-ghost b-sm" data-form-receta-quitar>Quitar</button>';
  return `
    <tr data-receta-fila ${fija ? `data-receta-fija="${escHtml(fija.tag)}"` : ''}>
      <td>${concepto}</td>
      <td><select class="input" data-r="materia_prima_id">${opcionesMat}</select></td>
      <td><input class="input" type="number" step="any" min="0" data-r="cantidad" value="${escHtml(item ? item.cantidad : '')}" style="min-width:90px"></td>
      <td><select class="input" data-r="unidad">${opcionesUnidad(mat, unidad)}</select></td>
      <td>${nota}</td>
      <td class="num">${accion}</td>
    </tr>`;
}

/** Arma la tabla del formulario con los renglones dados (los de carretel y laminación van a su fila fija). */
function renderRecetaForm(items) {
  const fijas = document.getElementById('formRecetaFijas');
  const filas = document.getElementById('formRecetaFilas');
  if (!fijas || !filas) return;
  const resto = (items || []).slice();
  fijas.innerHTML = FIJAS_RECETA.map(f => {
    const i = resto.findIndex(it => normTag(it.observaciones) === normTag(f.tag));
    return filaRecetaFormHtml(i >= 0 ? resto.splice(i, 1)[0] : null, f);
  }).join('');
  filas.innerHTML = resto.map(it => filaRecetaFormHtml(it, null)).join('');
  mostrarErrorRecetaForm('');
}

function mostrarErrorRecetaForm(texto) {
  const el = document.getElementById('formRecetaError');
  if (!el) return;
  el.textContent = texto || '';
  el.hidden = !texto;
}

/** Formulario de receta vacío (ficha nueva o "Limpiar formulario"). */
function resetRecetaForm() {
  recetaFormCargada = true;
  recetaFormListo = Promise.resolve();
  renderRecetaForm([]);
}

/**
 * Al editar: trae la receta guardada. Si no se puede leer, el formulario NO manda
 * `receta_items` al guardar (se conserva la que está guardada, no se borra).
 */
function cargarRecetaForm(fichaId) {
  recetaFormCargada = false;
  recetaFormListo = (async () => {
    try {
      await materialesListos;
      const r = await apiFetch(`/api/ficha-transformador/${fichaId}/receta`);
      if (currentId !== fichaId) return;   // mientras tanto se cambió de ficha
      renderRecetaForm(r.items);
      recetaFormCargada = true;
    } catch (err) {
      console.error('Error cargando la receta de la ficha:', err);
      mostrarErrorRecetaForm('No se pudo cargar la receta guardada. Si guardás ahora, la receta no se modifica; podés editarla desde «Ver» → Receta.');
    }
  })();
  return recetaFormListo;
}

/** Cantidad y unidad que se proponen al elegir el material de una fila fija. */
function sugerirCantidadFija(tr, mat) {
  const f = FIJAS_RECETA.find(x => x.tag === tr.dataset.recetaFija);
  const cant = tr.querySelector('[data-r="cantidad"]');
  if (!f || !mat || !cant || cant.value !== '') return;
  // La laminación ya tiene su peso en gramos en la ficha: ese es el consumo.
  const peso = f.campoPeso ? Number(valorCampo(f.campoPeso)) : 0;
  if (peso > 0 && mat.unidades_permitidas.includes('GR')) {
    cant.value = peso;
    tr.querySelector('[data-r="unidad"]').value = 'GR';
  }
}

/** Lee la tabla del formulario: { items, errores }. Una fila totalmente vacía se ignora. */
function leerRecetaForm() {
  const items = [];
  const errores = [];
  let otro = 0;
  document.querySelectorAll('#formRecetaFijas [data-receta-fila], #formRecetaFilas [data-receta-fila]').forEach(tr => {
    const v = (campo) => { const el = tr.querySelector(`[data-r="${campo}"]`); return el ? String(el.value).trim() : ''; };
    const fija = tr.dataset.recetaFija || '';
    if (!fija) otro++;
    const cual = fija || `Otro material ${otro}`;
    const material = v('materia_prima_id');
    const cantidad = v('cantidad');
    if (!material && cantidad === '') return;
    if (!material) errores.push(`${cual}: elegí el material.`);
    else if (!(Number(cantidad) > 0)) errores.push(`${cual}: cargá la cantidad que lleva un transformador (mayor a cero).`);
    else if (!v('unidad')) errores.push(`${cual}: elegí la unidad.`);
    else items.push({ materia_prima_id: material, cantidad, unidad: v('unidad'), observaciones: fija || v('observaciones') });
  });
  return { items, errores };
}

/** Los devanados del formulario (primario, secundario y los adicionales). */
function devanadosDelFormulario() {
  const lista = [
    { nombre: 'primario', alambre: valorCampo('alambre_primario'), diametro: valorCampo('diametro_primario_mm'), peso: valorCampo('peso_primario_kg'), material: valorCampo('material_primario_id') },
    { nombre: 'secundario', alambre: valorCampo('alambre_secundario'), diametro: valorCampo('diametro_secundario_mm'), peso: valorCampo('peso_secundario_kg'), material: valorCampo('material_secundario_id') }
  ];
  document.querySelectorAll('#devanadosExtra .devanado-extra').forEach((panel, i) => {
    const g = (c) => { const el = panel.querySelector(`[data-campo="${c}"]`); return el ? el.value.trim() : ''; };
    lista.push({ nombre: NOMBRES_DEVANADO[i] || `${i + 3}°`, alambre: g('alambre'), diametro: g('diametro_mm'), peso: g('peso_kg'), material: g('material_id') });
  });
  return lista;
}

/** Cosas de la ficha que no van a descontar stock aunque parezca que sí. Lista de textos (vacía = todo bien). */
function avisosReceta(items) {
  const avisos = [];
  devanadosDelFormulario().forEach(d => {
    if (!(d.alambre || d.diametro || d.material || Number(d.peso) > 0)) return;   // devanado sin datos
    if (!d.material) avisos.push(`Devanado ${d.nombre}: no elegiste el «Material de alambre en stock», así que no se descuenta alambre.`);
    else if (!(Number(d.peso) > 0)) avisos.push(`Devanado ${d.nombre}: tiene material pero falta el peso en gramos, así que no se descuenta alambre.`);
  });
  FIJAS_RECETA.forEach(f => {
    const texto = valorCampo(f.campoTexto);
    if (texto && !items.some(it => normTag(it.observaciones) === normTag(f.tag))) {
      avisos.push(`${f.tag}: escribiste «${texto}» pero no elegiste el material en stock en la receta, así que no se descuenta.`);
    }
  });
  return avisos;
}

/** Cuántos materiales va a descontar la ficha al producir (alambres con material y peso + renglones de receta). */
function resumenReceta(items) {
  const alambres = devanadosDelFormulario().filter(d => d.material && Number(d.peso) > 0).length;
  const n = alambres + items.length;
  return n > 0
    ? `Receta: ${n} material${n === 1 ? '' : 'es'} que se descuenta${n === 1 ? '' : 'n'} al producir.`
    : 'Sin receta: producir este modelo no descuenta materia prima.';
}

function mostrarAvisosReceta(avisos) {
  document.getElementById('avisosRecetaLista').innerHTML = avisos.map(a => `<li style="margin-bottom:4px">${escHtml(a)}</li>`).join('');
  document.getElementById('avisosRecetaModal').showModal();
}

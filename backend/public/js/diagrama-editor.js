/* =====================================================================
 * Solapa "Diagrama de salidas" del detalle de una ficha (ficha.html).
 *
 * Dibujo libre de cómo salen las conexiones del transformador:
 *   - Pines numerados, marcados como primario / secundario / otro (color distinto).
 *   - Cables con color y texto ("Rojo — 12 V", "Largo 30 cm").
 *   - Borneras con sus posiciones numeradas.
 *   - Textos sueltos y, opcionalmente, una foto o boceto de fondo (del carretel
 *     o del transformador) para dibujar encima.
 *
 * Se guarda como JSON en ficha_diagramas (API: routes/diagrama.routes.js, que
 * lo valida) y se dibuja igual en el PDF de la ficha (services/pdf-ficha.js).
 * Cualquier cambio de formato se hace en los tres lugares.
 *
 * Usa de ficha.js: currentFicha, escHtml, confirmarFicha, prepararFoto. Todo
 * texto cargado a mano se escapa con escHtml al dibujarlo.
 * ===================================================================== */

(function () {
  const COLORES_CABLE = [
    { n: 'Rojo', h: '#dc2626' }, { n: 'Negro', h: '#111827' }, { n: 'Azul', h: '#2563eb' },
    { n: 'Verde', h: '#16a34a' }, { n: 'Amarillo', h: '#eab308' }, { n: 'Blanco', h: '#ffffff' },
    { n: 'Marrón', h: '#92400e' }, { n: 'Naranja', h: '#f97316' }, { n: 'Gris', h: '#6b7280' },
    { n: 'Violeta', h: '#7c3aed' }, { n: 'Celeste', h: '#06b6d4' }, { n: 'Rosa', h: '#ec4899' }
  ];
  const COLOR_PIN = { PRIMARIO: '#dc2626', SECUNDARIO: '#2563eb', OTRO: '#6b7280' };
  const NOMBRE_FUNCION = { PRIMARIO: 'Primario', SECUNDARIO: 'Secundario', OTRO: 'Otro' };
  const ANCHO_CELDA = 28;
  const ALTO_BORNERA = 34;
  const MAX_HISTORIAL = 50;
  const MAX_ELEMENTOS = 300;

  const dg = {
    fichaId: null, datos: null, tieneFondo: false, fondoUrl: null,
    editando: false, herramienta: 'seleccionar', seleccion: null, historial: [],
    cable: null,            // puntos del cable que se está dibujando
    mouse: null,            // última posición del puntero (vista previa del cable)
    arrastre: null, funcionPin: 'PRIMARIO', colorCable: '#dc2626', posiciones: 4,
    sucio: false, guardando: false, contador: 0
  };

  const $ = (id) => document.getElementById(id);
  const copia = (o) => JSON.parse(JSON.stringify(o));
  const nuevoId = () => 'e' + Date.now().toString(36) + (++dg.contador);

  /* ---------- carga ---------- */

  async function urlProtegida(ruta) {
    const r = await fetch(API_URL + '/' + String(ruta).replace(/^\/+/, ''), {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return URL.createObjectURL(await r.blob());
  }

  async function cargarFondo(ruta) {
    if (dg.fondoUrl) { URL.revokeObjectURL(dg.fondoUrl); dg.fondoUrl = null; }
    if (!ruta) return;
    try { dg.fondoUrl = await urlProtegida(ruta); } catch (e) { console.warn('No se pudo cargar el fondo del diagrama:', e.message); }
  }

  window.cargarDiagramaTab = async function () {
    if (!currentFicha) return;
    const cont = $('diagramaContenido');
    cont.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      const r = await apiFetch(`/api/ficha-transformador/${currentFicha.id}/diagrama`);
      dg.fichaId = currentFicha.id;
      dg.datos = r.datos;
      dg.tieneFondo = r.tiene_fondo;
      await cargarFondo(r.ruta_fondo);
      dg.editando = false; dg.herramienta = 'seleccionar'; dg.seleccion = null;
      dg.historial = []; dg.cable = null; dg.sucio = false;
      armarContenedor();
    } catch (err) {
      console.error('Error cargando diagrama:', err);
      cont.innerHTML = `<div class="notice notice-err">${escHtml(err.error || err.message || 'No se pudo cargar el diagrama')}</div>`;
    }
  };

  /* ---------- estructura de la solapa ---------- */

  function armarContenedor() {
    $('diagramaContenido').innerHTML = `
      <p class="muted" style="margin:0 0 8px;font-size:.85rem">
        Dibujá dónde van las entradas y salidas: pines del carretel (primario y secundario con distinto color),
        cables de colores en los transformadores grandes y borneras. Podés poner una foto o boceto de fondo.
      </p>
      <div id="dgBarra"></div>
      <div id="dgMensaje" class="notice" role="alert" hidden style="margin:8px 0"></div>
      <div id="dgLienzo" style="margin-top:8px"></div>
      <div id="dgProps" style="margin-top:8px"></div>
      <div id="dgLeyenda" style="margin-top:12px"></div>`;
    renderTodo();
  }

  function renderTodo() {
    renderBarra();
    redibujar();
    renderProps();
    renderLeyenda();
  }

  function mensaje(tipo, texto) {
    const el = $('dgMensaje');
    if (!el) return;
    el.className = 'notice ' + (tipo === 'ok' ? 'notice-ok' : 'notice-err');
    el.textContent = texto || '';
    el.hidden = !texto;
  }

  /* ---------- barra de herramientas ---------- */

  function botonHerr(id, texto) {
    return `<button type="button" class="b b-sm ${dg.herramienta === id ? 'b-primary' : 'b-ghost'}" data-dg-herr="${id}">${texto}</button>`;
  }

  function renderBarra() {
    const barra = $('dgBarra');
    if (!barra) return;
    if (!dg.editando) {
      barra.innerHTML = `<div class="page-head-actions" style="justify-content:flex-start;margin:0">
        <button type="button" class="b b-primary" data-dg-accion="editar">${dg.datos.elementos.length ? 'Editar diagrama' : 'Dibujar diagrama'}</button></div>`;
      return;
    }
    let opciones = '';
    if (dg.herramienta === 'pin') {
      opciones = `<label class="muted" style="font-size:.85rem">Es del
        <select class="input" data-dg-opcion="funcionPin" style="width:auto;display:inline-block">
          ${Object.keys(NOMBRE_FUNCION).map(f => `<option value="${f}" ${dg.funcionPin === f ? 'selected' : ''}>${NOMBRE_FUNCION[f]}</option>`).join('')}
        </select></label>`;
    } else if (dg.herramienta === 'cable') {
      opciones = `<span class="muted" style="font-size:.85rem">Color:</span> ` + COLORES_CABLE.map(c =>
        `<button type="button" title="${c.n}" data-dg-color="${c.h}" style="width:22px;height:22px;border-radius:50%;background:${c.h};border:${dg.colorCable === c.h ? '3px solid #f59e0b' : '1px solid #334155'};padding:0;cursor:pointer"></button>`).join('') +
        (dg.cable ? ` <button type="button" class="b b-sm b-primary" data-dg-accion="terminar-cable">Terminar cable</button>` : '');
    } else if (dg.herramienta === 'bornera') {
      opciones = `<label class="muted" style="font-size:.85rem">Posiciones
        <input class="input" type="number" min="1" max="24" value="${dg.posiciones}" data-dg-opcion="posiciones" style="width:70px;display:inline-block"></label>`;
    }
    barra.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        ${botonHerr('seleccionar', 'Mover / seleccionar')}
        ${botonHerr('pin', 'Pin')}
        ${botonHerr('cable', 'Cable')}
        ${botonHerr('bornera', 'Bornera')}
        ${botonHerr('texto', 'Texto')}
        <span style="flex:1"></span>
        <button type="button" class="b b-ghost b-sm" data-dg-accion="deshacer" ${dg.historial.length ? '' : 'disabled'}>Deshacer</button>
        <button type="button" class="b b-ghost b-sm" data-dg-accion="eliminar" ${dg.seleccion ? '' : 'disabled'}>Eliminar elemento</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;min-height:30px">${opciones}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px">
        <button type="button" class="b b-ghost b-sm" data-dg-accion="fondo">${dg.tieneFondo ? 'Cambiar imagen de fondo' : 'Poner imagen de fondo'}</button>
        ${dg.tieneFondo ? '<button type="button" class="b b-ghost b-sm" data-dg-accion="quitar-fondo">Quitar fondo</button>' : ''}
        <input type="file" id="dgFondoInput" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
        <span style="flex:1"></span>
        ${dg.sucio ? '<span class="muted" style="font-size:.85rem">Cambios sin guardar</span>' : ''}
        <button type="button" class="b b-ghost" data-dg-accion="cancelar">Cancelar</button>
        <button type="button" class="b b-primary" data-dg-accion="guardar">Guardar diagrama</button>
      </div>`;
  }

  /* ---------- dibujo SVG ---------- */

  function caja(e) {
    if (e.tipo === 'pin') return { x: e.x - 17, y: e.y - 17, w: 34, h: e.etiqueta ? 52 : 34 };
    if (e.tipo === 'bornera') return { x: e.x - 4, y: e.y - (e.etiqueta ? 20 : 4), w: ANCHO_CELDA * e.posiciones + 8, h: ALTO_BORNERA + (e.etiqueta ? 24 : 8) };
    if (e.tipo === 'texto') return { x: e.x - 4, y: e.y - 4, w: e.texto.length * (e.tam || 14) * 0.6 + 8, h: (e.tam || 14) + 8 };
    return null;
  }

  function svgElemento(e) {
    const sel = dg.editando && dg.seleccion === e.id;
    const capa = (interior) => `<g data-id="${e.id}" ${dg.editando ? 'style="cursor:move"' : ''}>${interior}</g>`;
    const halo = 'paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round"';
    let s = '';

    if (e.tipo === 'cable') {
      const pts = e.puntos.map(p => p.join(',')).join(' ');
      const medio = e.puntos[Math.floor(e.puntos.length / 2)];
      s += `<polyline points="${pts}" fill="none" stroke="transparent" stroke-width="16" pointer-events="stroke"/>`;
      if (sel) s += `<polyline points="${pts}" fill="none" stroke="#f59e0b" stroke-opacity=".4" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`;
      s += `<polyline points="${pts}" fill="none" stroke="#1e293b" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
      s += `<polyline points="${pts}" fill="none" stroke="${e.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (e.etiqueta) s += `<text x="${medio[0] + 8}" y="${medio[1] - 8}" font-size="13" fill="#0f172a" ${halo}>${escHtml(e.etiqueta)}</text>`;
      return capa(s);
    }
    if (e.tipo === 'bornera') {
      const ancho = ANCHO_CELDA * e.posiciones;
      s += `<rect x="${e.x}" y="${e.y}" width="${ancho}" height="${ALTO_BORNERA}" fill="#e2e8f0" stroke="#334155" stroke-width="1.5"/>`;
      for (let i = 0; i < e.posiciones; i++) {
        const cx = e.x + i * ANCHO_CELDA;
        if (i) s += `<line x1="${cx}" y1="${e.y}" x2="${cx}" y2="${e.y + ALTO_BORNERA}" stroke="#334155"/>`;
        s += `<text x="${cx + ANCHO_CELDA / 2}" y="${e.y + ALTO_BORNERA / 2}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="700" fill="#0f172a">${i + 1}</text>`;
      }
      if (e.etiqueta) s += `<text x="${e.x}" y="${e.y - 6}" font-size="13" fill="#0f172a" ${halo}>${escHtml(e.etiqueta)}</text>`;
    } else if (e.tipo === 'pin') {
      s += `<circle cx="${e.x}" cy="${e.y}" r="12" fill="${COLOR_PIN[e.funcion] || COLOR_PIN.OTRO}" stroke="#fff" stroke-width="1.5"/>`;
      s += `<text x="${e.x}" y="${e.y}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="700" fill="#fff">${escHtml(e.numero)}</text>`;
      if (e.etiqueta) s += `<text x="${e.x}" y="${e.y + 28}" text-anchor="middle" font-size="12" fill="#0f172a" ${halo}>${escHtml(e.etiqueta)}</text>`;
    } else if (e.tipo === 'texto') {
      s += `<text x="${e.x}" y="${e.y}" font-size="${e.tam || 14}" dominant-baseline="hanging" fill="#0f172a">${escHtml(e.texto)}</text>`;
    }
    if (sel) {
      const c = caja(e);
      s += `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>`;
    }
    // Un pin o texto chico es difícil de agarrar: se agrega una zona de clic más grande.
    if (dg.editando && (e.tipo === 'pin' || e.tipo === 'texto')) {
      const c = caja(e);
      s = `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="transparent"/>` + s;
    }
    return capa(s);
  }

  function redibujar() {
    const lienzo = $('dgLienzo');
    if (!lienzo) return;
    const { ancho, alto, elementos } = dg.datos;
    let s = `<svg id="dgSvg" viewBox="0 0 ${ancho} ${alto}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;border:1px solid #cbd5e1;border-radius:8px;background:#fff;${dg.editando ? 'touch-action:none;cursor:' + (dg.herramienta === 'seleccionar' ? 'default' : 'crosshair') : ''}">`;
    if (dg.fondoUrl) s += `<image href="${dg.fondoUrl}" x="0" y="0" width="${ancho}" height="${alto}" preserveAspectRatio="xMidYMid meet" opacity=".9"/>`;
    s += elementos.map(svgElemento).join('');

    if (dg.editando && dg.seleccion) {
      const e = elementos.find(x => x.id === dg.seleccion);
      if (e && e.tipo === 'cable') {
        s += e.puntos.map((p, i) =>
          `<circle data-punto="${i}" cx="${p[0]}" cy="${p[1]}" r="7" fill="#fff" stroke="#f59e0b" stroke-width="2.5" style="cursor:grab"/>`).join('');
      }
    }
    if (dg.cable && dg.cable.length) {
      const pts = dg.cable.concat(dg.mouse ? [dg.mouse] : []).map(p => p.join(',')).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="#1e293b" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
      s += `<polyline points="${pts}" fill="none" stroke="${dg.colorCable}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
      s += dg.cable.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#f59e0b" pointer-events="none"/>`).join('');
    }
    if (!elementos.length && !dg.fondoUrl && !dg.editando) {
      s += `<text x="${ancho / 2}" y="${alto / 2}" text-anchor="middle" fill="#94a3b8" font-size="18">Todavía no hay diagrama</text>`;
    }
    lienzo.innerHTML = s + '</svg>';
  }

  /* ---------- propiedades del elemento seleccionado ---------- */

  function elementoSel() {
    return dg.datos.elementos.find(e => e.id === dg.seleccion) || null;
  }

  function campo(etiqueta, prop, valor, extra) {
    return `<div class="field"><label>${etiqueta}</label>
      <input class="input" data-dg-prop="${prop}" value="${escHtml(valor)}" ${extra || ''}></div>`;
  }

  function renderProps() {
    const cont = $('dgProps');
    if (!cont) return;
    const e = dg.editando ? elementoSel() : null;
    if (!e) { cont.innerHTML = ''; return; }
    let html = '';
    if (e.tipo === 'pin') {
      html = campo('Número del pin', 'numero', e.numero, 'maxlength="6"') +
        `<div class="field"><label>Es del</label><select class="input" data-dg-prop="funcion">
          ${Object.keys(NOMBRE_FUNCION).map(f => `<option value="${f}" ${e.funcion === f ? 'selected' : ''}>${NOMBRE_FUNCION[f]}</option>`).join('')}
        </select></div>` + campo('Texto junto al pin (opcional)', 'etiqueta', e.etiqueta, 'maxlength="40" placeholder="Ej: Entrada 220 V"');
    } else if (e.tipo === 'cable') {
      html = `<div class="field"><label>Color del cable</label><select class="input" data-dg-prop="color">
          ${COLORES_CABLE.map(c => `<option value="${c.h}" ${e.color === c.h ? 'selected' : ''}>${c.n}</option>`).join('')}
        </select></div>` + campo('Texto del cable (opcional)', 'etiqueta', e.etiqueta, 'maxlength="40" placeholder="Ej: Rojo — 12 V, largo 30 cm"') +
        '<p class="muted" style="font-size:.85rem;margin:0;align-self:end">Arrastrá los círculos para mover los puntos del cable.</p>';
    } else if (e.tipo === 'bornera') {
      html = campo('Nombre (opcional)', 'etiqueta', e.etiqueta, 'maxlength="40" placeholder="Ej: Bornera de salida"') +
        campo('Posiciones', 'posiciones', e.posiciones, 'type="number" min="1" max="24"');
    } else if (e.tipo === 'texto') {
      html = campo('Texto', 'texto', e.texto, 'maxlength="80"') + campo('Tamaño', 'tam', e.tam || 14, 'type="number" min="8" max="48"');
    }
    cont.innerHTML = `<div class="panel" style="margin:0"><div class="panel-body"><div class="form-grid">${html}</div></div></div>`;
  }

  function renderLeyenda() {
    const cont = $('dgLeyenda');
    if (!cont) return;
    const el = dg.datos.elementos;
    const filas = [];
    ['PRIMARIO', 'SECUNDARIO', 'OTRO'].forEach(f => {
      const pines = el.filter(e => e.tipo === 'pin' && e.funcion === f).map(e => e.numero);
      if (pines.length) {
        filas.push(`<li><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${COLOR_PIN[f]};vertical-align:middle"></span>
          <strong>${NOMBRE_FUNCION[f]}</strong>: pin${pines.length > 1 ? 'es' : ''} ${pines.map(escHtml).join(', ')}</li>`);
      }
    });
    el.filter(e => e.tipo === 'cable').forEach(e => {
      const nombre = (COLORES_CABLE.find(c => c.h === e.color) || { n: e.color }).n;
      filas.push(`<li><span style="display:inline-block;width:26px;height:6px;border-radius:3px;background:${e.color};border:1px solid #334155;vertical-align:middle"></span>
        Cable ${escHtml(nombre.toLowerCase())}${e.etiqueta ? ': ' + escHtml(e.etiqueta) : ''}</li>`);
    });
    cont.innerHTML = filas.length ? `<ul style="list-style:none;padding:0;margin:0;font-size:.9rem;display:grid;gap:4px">${filas.join('')}</ul>` : '';
  }

  /* ---------- cambios y deshacer ---------- */

  function empujarHistorial() {
    dg.historial.push(JSON.stringify(dg.datos));
    if (dg.historial.length > MAX_HISTORIAL) dg.historial.shift();
  }

  function marcarCambio() {
    dg.sucio = true;
  }

  function deshacer() {
    if (!dg.historial.length) return;
    dg.datos = JSON.parse(dg.historial.pop());
    if (!elementoSel()) dg.seleccion = null;
    dg.sucio = true;
    renderTodo();
  }

  function agregar(e) {
    if (dg.datos.elementos.length >= MAX_ELEMENTOS) {
      mensaje('err', `El diagrama admite hasta ${MAX_ELEMENTOS} elementos.`);
      return;
    }
    empujarHistorial();
    dg.datos.elementos.push(e);
    dg.seleccion = e.id;
    marcarCambio();
    renderTodo();
  }

  function eliminarSeleccion() {
    if (!dg.seleccion) return;
    empujarHistorial();
    dg.datos.elementos = dg.datos.elementos.filter(e => e.id !== dg.seleccion);
    dg.seleccion = null;
    marcarCambio();
    renderTodo();
  }

  function siguienteNumeroPin() {
    const nums = dg.datos.elementos.filter(e => e.tipo === 'pin').map(e => parseInt(e.numero, 10)).filter(n => Number.isFinite(n));
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  }

  function terminarCable() {
    const pts = dg.cable || [];
    // Un doble clic agrega el último punto dos veces: se descartan los repetidos seguidos.
    const limpios = pts.filter((p, i) => !i || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    dg.cable = null;
    dg.mouse = null;
    if (limpios.length < 2) { renderTodo(); return; }
    agregar({ id: nuevoId(), tipo: 'cable', puntos: limpios, color: dg.colorCable, etiqueta: '' });
  }

  /* ---------- puntero ---------- */

  function puntoSvg(ev) {
    const svg = $('dgSvg');
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = Math.min(dg.datos.ancho, Math.max(0, Math.round(p.x * 10) / 10));
    const y = Math.min(dg.datos.alto, Math.max(0, Math.round(p.y * 10) / 10));
    return [x, y];
  }

  function alPresionar(ev) {
    if (!dg.editando || !ev.target.closest('#dgSvg')) return;
    const [x, y] = puntoSvg(ev);

    if (dg.herramienta === 'pin') {
      agregar({ id: nuevoId(), tipo: 'pin', x, y, numero: siguienteNumeroPin(), funcion: dg.funcionPin, etiqueta: '' });
      return;
    }
    if (dg.herramienta === 'bornera') {
      agregar({ id: nuevoId(), tipo: 'bornera', x, y, posiciones: dg.posiciones, etiqueta: '' });
      return;
    }
    if (dg.herramienta === 'texto') {
      agregar({ id: nuevoId(), tipo: 'texto', x, y, texto: 'Texto', tam: 14 });
      return;
    }
    if (dg.herramienta === 'cable') {
      dg.cable = (dg.cable || []).concat([[x, y]]);
      renderBarra();
      redibujar();
      return;
    }

    // Seleccionar / mover
    const asa = ev.target.closest('[data-punto]');
    const el = ev.target.closest('[data-id]');
    if (asa && dg.seleccion) {
      const e = elementoSel();
      dg.arrastre = { tipo: 'punto', indice: Number(asa.dataset.punto), original: copia(e), inicio: [x, y], movido: false, snapshot: JSON.stringify(dg.datos) };
      ev.target.setPointerCapture?.(ev.pointerId);
      return;
    }
    if (el) {
      const e = dg.datos.elementos.find(z => z.id === el.dataset.id);
      if (!e) return;
      const cambioSel = dg.seleccion !== e.id;
      dg.seleccion = e.id;
      dg.arrastre = { tipo: 'elemento', original: copia(e), inicio: [x, y], movido: false, snapshot: JSON.stringify(dg.datos) };
      if (cambioSel) { renderBarra(); renderProps(); redibujar(); }
      return;
    }
    if (dg.seleccion) { dg.seleccion = null; renderTodo(); }
  }

  function alMover(ev) {
    if (!dg.editando || !$('dgSvg')) return;
    if (dg.herramienta === 'cable' && dg.cable) {
      dg.mouse = puntoSvg(ev);
      redibujar();
      return;
    }
    const a = dg.arrastre;
    if (!a) return;
    const [x, y] = puntoSvg(ev);
    let dx = x - a.inicio[0], dy = y - a.inicio[1];
    if (!a.movido && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    a.movido = true;
    const e = elementoSel();
    if (!e) return;
    const { ancho, alto } = dg.datos;

    if (a.tipo === 'punto') {
      e.puntos[a.indice] = [Math.min(ancho, Math.max(0, a.original.puntos[a.indice][0] + dx)), Math.min(alto, Math.max(0, a.original.puntos[a.indice][1] + dy))];
    } else if (e.tipo === 'cable') {
      const xs = a.original.puntos.map(p => p[0]), ys = a.original.puntos.map(p => p[1]);
      dx = Math.min(ancho - Math.max(...xs), Math.max(-Math.min(...xs), dx));
      dy = Math.min(alto - Math.max(...ys), Math.max(-Math.min(...ys), dy));
      e.puntos = a.original.puntos.map(p => [Math.round((p[0] + dx) * 10) / 10, Math.round((p[1] + dy) * 10) / 10]);
    } else {
      e.x = Math.min(ancho, Math.max(0, Math.round((a.original.x + dx) * 10) / 10));
      e.y = Math.min(alto, Math.max(0, Math.round((a.original.y + dy) * 10) / 10));
    }
    redibujar();
  }

  function alSoltar() {
    const a = dg.arrastre;
    dg.arrastre = null;
    if (!a) return;
    if (a.movido) {
      dg.historial.push(a.snapshot);
      if (dg.historial.length > MAX_HISTORIAL) dg.historial.shift();
      marcarCambio();
      renderBarra();
    }
    renderProps();
  }

  /* ---------- acciones ---------- */

  async function guardar() {
    if (dg.guardando) return;
    mensaje('', '');
    dg.guardando = true;
    const btn = document.querySelector('[data-dg-accion="guardar"]');
    if (btn) btn.disabled = true;
    try {
      if (dg.cable) terminarCable();
      const r = await apiFetch(`/api/ficha-transformador/${dg.fichaId}/diagrama`, {
        method: 'PUT', body: JSON.stringify({ datos: dg.datos })
      });
      dg.datos = r.datos;
      dg.editando = false; dg.sucio = false; dg.seleccion = null; dg.historial = []; dg.herramienta = 'seleccionar';
      renderTodo();
      mensaje('ok', 'Diagrama guardado.');
    } catch (err) {
      mensaje('err', err.error || err.message || 'No se pudo guardar el diagrama');
      const b = document.querySelector('[data-dg-accion="guardar"]');
      if (b) b.disabled = false;
    } finally {
      dg.guardando = false;
    }
  }

  async function cancelar() {
    if (dg.sucio && !await confirmarFicha('Descartar cambios', 'Hay cambios sin guardar en el diagrama. ¿Descartarlos?', 'Descartar')) return;
    await window.cargarDiagramaTab();
  }

  async function subirFondo(archivo) {
    mensaje('', '');
    try {
      const listo = await prepararFoto(archivo);
      const fd = new FormData();
      fd.append('fondo', listo);
      const r = await apiFetch(`/api/ficha-transformador/${dg.fichaId}/diagrama/fondo`, { method: 'PUT', body: fd });
      dg.tieneFondo = true;
      await cargarFondo(r.ruta_fondo);
      renderTodo();
    } catch (err) {
      mensaje('err', err.error || err.message || 'No se pudo subir la imagen de fondo');
    }
  }

  async function quitarFondo() {
    if (!await confirmarFicha('Quitar imagen de fondo', '¿Quitar la imagen de fondo? Los pines y cables dibujados se mantienen.', 'Quitar')) return;
    try {
      await apiFetch(`/api/ficha-transformador/${dg.fichaId}/diagrama/fondo`, { method: 'DELETE' });
      dg.tieneFondo = false;
      await cargarFondo(null);
      renderTodo();
    } catch (err) {
      mensaje('err', err.error || err.message || 'No se pudo quitar la imagen de fondo');
    }
  }

  /* ---------- eventos (delegados: el shell vuelve a armar el body) ---------- */

  document.addEventListener('pointerdown', (ev) => { if (ev.target.closest('#dgLienzo')) alPresionar(ev); });
  document.addEventListener('pointermove', (ev) => { if (dg.editando) alMover(ev); });
  document.addEventListener('pointerup', alSoltar);
  document.addEventListener('pointercancel', alSoltar);
  document.addEventListener('dblclick', (ev) => {
    if (dg.editando && dg.herramienta === 'cable' && dg.cable && ev.target.closest('#dgLienzo')) terminarCable();
  });

  document.addEventListener('click', async (ev) => {
    const herr = ev.target.closest('[data-dg-herr]');
    if (herr) {
      if (dg.cable) terminarCable();
      dg.herramienta = herr.dataset.dgHerr;
      renderBarra(); redibujar();
      return;
    }
    const color = ev.target.closest('[data-dg-color]');
    if (color) { dg.colorCable = color.dataset.dgColor; renderBarra(); return; }

    const accion = ev.target.closest('[data-dg-accion]');
    if (!accion) return;
    switch (accion.dataset.dgAccion) {
      case 'editar': dg.editando = true; mensaje('', ''); renderTodo(); break;
      case 'deshacer': deshacer(); break;
      case 'eliminar': eliminarSeleccion(); break;
      case 'terminar-cable': terminarCable(); break;
      case 'guardar': guardar(); break;
      case 'cancelar': cancelar(); break;
      case 'fondo': $('dgFondoInput').click(); break;
      case 'quitar-fondo': quitarFondo(); break;
    }
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'dgFondoInput' && t.files[0]) { const f = t.files[0]; t.value = ''; subirFondo(f); return; }
    if (t.dataset && t.dataset.dgOpcion === 'funcionPin') dg.funcionPin = t.value;
    if (t.dataset && t.dataset.dgOpcion === 'posiciones') {
      const n = parseInt(t.value, 10);
      dg.posiciones = Number.isInteger(n) ? Math.min(24, Math.max(1, n)) : 4;
    }
  });

  // Propiedades del elemento seleccionado: se actualiza el dibujo en cada tecla.
  function alEditarProp(ev) {
    const t = ev.target;
    if (!t.dataset || !t.dataset.dgProp) return;
    const e = elementoSel();
    if (!e) return;
    const prop = t.dataset.dgProp;
    if (ev.type === 'input' && t.tagName === 'SELECT') return;   // los select se aplican en 'change'
    if (!dg.propEditada) { empujarHistorial(); dg.propEditada = true; }
    if (prop === 'posiciones') {
      const n = parseInt(t.value, 10);
      if (!Number.isInteger(n) || n < 1 || n > 24) return;
      e.posiciones = n;
    } else if (prop === 'tam') {
      const n = parseInt(t.value, 10);
      if (!Number.isFinite(n)) return;
      e.tam = Math.min(48, Math.max(8, n));
    } else {
      e[prop] = t.value;
    }
    marcarCambio();
    redibujar();
    renderLeyenda();
  }
  document.addEventListener('input', alEditarProp);
  document.addEventListener('change', alEditarProp);
  // Una "edición" para el historial = una tanda de teclas seguidas en el mismo campo.
  document.addEventListener('focusout', () => { dg.propEditada = false; });

  document.addEventListener('keydown', (ev) => {
    const abierto = dg.editando && $('dgSvg') && !$('dtab-diagrama').hidden && $('detailModal').open;
    if (!abierto) return;
    const enCampo = /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName);
    if (ev.key === 'Escape' && dg.cable) { dg.cable = null; dg.mouse = null; renderBarra(); redibujar(); ev.preventDefault(); return; }
    if (ev.key === 'Enter' && dg.cable && !enCampo) { terminarCable(); ev.preventDefault(); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && dg.seleccion && !enCampo) { eliminarSeleccion(); ev.preventDefault(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !enCampo) { deshacer(); ev.preventDefault(); }
  });
})();

// Materiales para un pedido (20/11/2026).
// Arma una lista de modelos × cantidad (a mano o cargando lo pendiente de un
// cliente), la manda a POST /api/produccion/materiales-pedido y muestra qué
// material hace falta, cuánto hay y cuánto falta. Es solo una consulta.

(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 4 });

  /** Cantidad con su unidad; los gramos se muestran también en kg cuando son muchos. */
  function cant(n, unidad) {
    const u = String(unidad || '').toUpperCase();
    if (u === 'GR' && Math.abs(n) >= 1000) return `${num(n / 1000)} kg <span class="muted">(${num(n)} gr)</span>`;
    return `${num(n)} ${esc(unidad)}`;
  }
  function cantTexto(n, unidad) {
    const u = String(unidad || '').toUpperCase();
    if (u === 'GR' && Math.abs(n) >= 1000) return `${num(n / 1000)} kg`;
    return `${num(n)} ${unidad}`;
  }

  let modelos = [];
  let ultimoResultado = null;
  let ultimoItems = null;
  let calculando = false;

  const filas = document.getElementById('mp_filas');
  const errorBox = document.getElementById('mp_error');

  function mostrarError(msg) {
    errorBox.textContent = msg || '';
    errorBox.hidden = !msg;
  }

  function agregarFila(fichaId, cantidad) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select class="input mp-modelo">
        <option value="">Elegí un modelo…</option>
        ${modelos.map(m => `<option value="${Number(m.id)}">${esc(m.modelo)}</option>`).join('')}
      </select></td>
      <td><input class="input mp-cantidad" type="number" min="1" step="1" placeholder="Ej: 100"></td>
      <td><button type="button" class="b b-ghost" title="Quitar">Quitar</button></td>`;
    if (fichaId) tr.querySelector('.mp-modelo').value = String(fichaId);
    if (cantidad) tr.querySelector('.mp-cantidad').value = cantidad;
    tr.querySelector('button').addEventListener('click', () => { tr.remove(); if (!filas.children.length) agregarFila(); });
    filas.appendChild(tr);
  }

  function leerFilas() {
    const items = [];
    for (const tr of filas.children) {
      const ficha_id = Number(tr.querySelector('.mp-modelo').value);
      const cantidad = parseInt(tr.querySelector('.mp-cantidad').value, 10);
      if (!ficha_id && !cantidad) continue;           // fila vacía
      if (!ficha_id) throw new Error('Hay una cantidad sin modelo elegido');
      if (!(cantidad > 0)) throw new Error('Cada modelo necesita una cantidad entera mayor a cero');
      items.push({ ficha_id, cantidad });
    }
    return items;
  }

  async function cargarDatos() {
    try {
      modelos = await apiFetch('/api/ficha-transformador');
      agregarFila();
    } catch (e) {
      mostrarError((e && e.error) || 'No se pudieron cargar los modelos');
    }
    try {
      const clientes = await apiFetch('/api/clientes');
      const sel = document.getElementById('mp_cliente');
      clientes.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.nombre;
        sel.appendChild(o);
      });
    } catch (_) { /* el selector de cliente es opcional */ }
  }

  async function cargarPendientes() {
    mostrarError('');
    const clienteId = document.getElementById('mp_cliente').value;
    if (!clienteId) return mostrarError('Elegí un cliente para cargar lo que tiene pendiente de entrega');
    try {
      const r = await apiFetch(`/api/ordenes-compra/pendientes?cliente_id=${encodeURIComponent(clienteId)}`);
      const cli = r[0];
      if (!cli || !cli.modelos.length) return mostrarError('Ese cliente no tiene nada pendiente de entrega');
      filas.innerHTML = '';
      cli.modelos.forEach(m => agregarFila(m.ficha_id, m.pendiente));
      Shell.toast('ok', 'Pendientes cargados', `${cli.modelos.length} modelo(s) de ${cli.cliente}. Podés ajustar las cantidades.`);
    } catch (e) {
      mostrarError((e && e.error) || (e && e.message) || 'No se pudieron cargar los pendientes');
    }
  }

  async function calcular() {
    if (calculando) return;
    mostrarError('');
    let items;
    try {
      items = leerFilas();
      if (!items.length) throw new Error('Agregá al menos un modelo con su cantidad');
    } catch (e) { return mostrarError(e.message); }

    calculando = true;
    const btn = document.getElementById('btnCalcular');
    btn.disabled = true;
    try {
      ultimoResultado = await apiFetch('/api/produccion/materiales-pedido', { method: 'POST', body: JSON.stringify({ items }) });
      ultimoItems = items;
      mostrar(ultimoResultado);
    } catch (e) {
      mostrarError((e && e.error) || (e && e.message) || 'No se pudo calcular');
    } finally {
      calculando = false;
      btn.disabled = false;
    }
  }

  function mostrar(r) {
    document.getElementById('mp_resultado').hidden = false;

    // Datos que faltan cargar, por modelo
    const avisos = [];
    r.modelos.forEach(m => {
      m.errores.forEach(e => avisos.push({ tipo: 'err', modelo: m.modelo, texto: e }));
      m.faltan_datos.forEach(t => avisos.push({ tipo: 'warn', modelo: m.modelo, texto: t }));
    });
    document.getElementById('mp_panelAvisos').hidden = !avisos.length;
    document.getElementById('mp_avisos').innerHTML = avisos.map(a =>
      `<div class="notice ${a.tipo === 'err' ? 'notice-err' : 'notice-warn'}" style="margin-bottom:6px"><strong>${esc(a.modelo)}:</strong> ${esc(a.texto)}</div>`).join('');

    // Materiales
    document.getElementById('mp_resumen').textContent =
      `${r.unidades_total} transformador(es) en ${r.modelos.length} modelo(s). ` +
      (r.materiales.length
        ? (r.faltantes ? `Falta stock de ${r.faltantes} de ${r.materiales.length} material(es).` : 'El stock alcanza para todo.')
        : 'Ningún modelo tiene materiales vinculados todavía.');

    let categoria = Symbol();
    const cuerpo = [];
    r.materiales.forEach(m => {
      if (m.categoria !== categoria) {
        categoria = m.categoria;
        cuerpo.push(`<tr><td colspan="5" class="muted"><strong>${esc(categoria || 'Sin categoría')}</strong></td></tr>`);
      }
      const falta = m.faltante > 0;
      const comprar = falta
        ? `<strong class="neg">${cant(m.a_comprar, m.unidad)}</strong>` + (m.a_comprar !== m.faltante ? `<br><small class="muted">faltan ${num(m.faltante)}, se compran enteros</small>` : '')
        : '<span class="pos">Alcanza</span>';
      const detalle = m.por_modelo.map(p =>
        `<li>${esc(p.modelo)} × ${num(p.cantidad)}: ${cant(p.necesaria, m.unidad)} <span class="muted">(${esc(p.origenes.join(', '))})</span></li>`).join('');
      cuerpo.push(`<tr>
        <td data-label="Material">${esc(m.nombre)}</td>
        <td class="num" data-label="Necesario">${cant(m.necesaria, m.unidad)}</td>
        <td class="num" data-label="En stock">${cant(m.stock_actual, m.unidad)}</td>
        <td class="num" data-label="Falta">${comprar}</td>
        <td data-label="De dónde sale"><details><summary>${m.por_modelo.length} modelo(s)</summary><ul style="margin:4px 0 0;padding-left:18px">${detalle}</ul></details></td>
      </tr>`);
    });
    document.getElementById('mp_materiales').innerHTML = cuerpo.length
      ? cuerpo.join('')
      : '<tr><td colspan="5" class="muted">Sin materiales para mostrar.</td></tr>';

    // Sin vincular
    document.getElementById('mp_panelSinVincular').hidden = !r.sin_vincular.length;
    document.getElementById('mp_sinVincular').innerHTML = r.sin_vincular.map(s =>
      `<tr><td data-label="Concepto">${esc(s.concepto)}</td><td class="num" data-label="Necesario">${cant(s.cantidad, s.unidad)}</td><td data-label="Modelos">${esc(s.modelos.join(', '))}</td></tr>`).join('');

    // Etiquetas
    document.getElementById('mp_panelEtiquetas').hidden = !r.etiquetas.length;
    document.getElementById('mp_etiquetas').innerHTML = r.etiquetas.map(e =>
      `<tr><td data-label="Modelo">${esc(e.modelo)}</td><td class="num" data-label="Cantidad">${num(e.cantidad)}</td>
       <td data-label="Etiquetas">${e.archivos.map(a => esc(a.nombre)).join(', ')} <span class="muted">(${e.archivos.length} por transformador)</span></td></tr>`).join('');

    document.getElementById('mp_resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function descargarCsv() {
    if (!ultimoResultado) return;
    const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lineas = [['Categoría', 'Material', 'Necesario', 'Unidad', 'En stock', 'Falta', 'A comprar']];
    ultimoResultado.materiales.forEach(m => lineas.push([m.categoria || '', m.nombre, m.necesaria, m.unidad, m.stock_actual, m.faltante, m.a_comprar]));
    if (ultimoResultado.sin_vincular.length) {
      lineas.push([]);
      lineas.push(['Sin material del catálogo', 'Concepto', 'Necesario', 'Unidad', '', '', '']);
      ultimoResultado.sin_vincular.forEach(s => lineas.push(['', s.concepto, s.cantidad, s.unidad, '', '', '']));
    }
    const csv = '﻿' + lineas.map(l => l.map(celda).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'materiales-para-pedido.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // PDF: es un POST (la lista viaja en el cuerpo), así que no sirve verArchivoProtegido (GET).
  // La pestaña se abre antes del fetch para que el navegador no la bloquee como popup.
  // Se usa la lista con la que se calculó, para que el PDF coincida con lo que se ve.
  let generandoPdf = false;
  async function verPdf() {
    if (generandoPdf || !ultimoItems) return;
    generandoPdf = true;
    const btn = document.getElementById('btnPdf');
    btn.disabled = true;
    const ventana = window.open('', '_blank');
    try {
      const r = await fetch(`${API_URL}/api/produccion/materiales-pedido/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
        body: JSON.stringify({ items: ultimoItems })
      });
      if (!r.ok) {
        let msg = 'No se pudo generar el PDF';
        try { msg = (await r.json()).error || msg; } catch (_) { /* no era JSON */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await r.blob());
      if (ventana && !ventana.closed) ventana.location.href = url;
      else if (!window.open(url, '_blank')) throw new Error('El navegador bloqueó la ventana del PDF. Habilitá las ventanas emergentes para este sitio.');
    } catch (e) {
      if (ventana && !ventana.closed) ventana.close();
      mostrarError(e.message || 'No se pudo generar el PDF');
    } finally {
      generandoPdf = false;
      btn.disabled = false;
    }
  }

  document.getElementById('btnPdf').addEventListener('click', verPdf);
  document.getElementById('btnAgregarModelo').addEventListener('click', () => agregarFila());
  document.getElementById('btnCargarPendientes').addEventListener('click', cargarPendientes);
  document.getElementById('btnCalcular').addEventListener('click', calcular);
  document.getElementById('btnCsv').addEventListener('click', descargarCsv);
  document.getElementById('btnImprimir').addEventListener('click', () => window.print());

  cargarDatos();
})();

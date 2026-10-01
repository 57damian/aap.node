/* =====================================================================
 * facturar-wizard.js — Wizard "Facturar remitos" (4 pasos), compartido
 * Antes vivía dentro de oc_detalle.js/html. Se sacó a un módulo para usarlo
 * también desde la ficha del cliente (cliente.html) sin duplicar lógica.
 *
 *   FacturarWizard.abrir({ ocId, onListo })
 *
 * Una factura agrupa uno o varios remitos de la MISMA OC, de cualquier
 * fecha; un renglón por modelo. El precio puede haber cambiado desde la
 * entrega: se edita la cotización del dólar y el precio USD de cada modelo;
 * el precio en pesos se calcula solo, pero también se puede escribir a mano.
 * Pasos: 1 Remitos → 2 Precios → 3 Datos de la factura → 4 Revisar y
 * confirmar (solo lectura; ahí vive el botón que genera la factura —
 * operación fiscal: se deshace anulándola desde Correcciones).
 *
 * El <dialog> se inyecta en el body la primera vez que se abre. Requiere
 * Shell y apiFetch.
 * ===================================================================== */
(function (global) {
  'use strict';

  const TOTAL_PASOS = 4;
  const NOMBRES_PASO = { 1: 'Remitos', 2: 'Precios', 3: 'Datos', 4: 'Revisar' };

  const $ = (id) => document.getElementById(id);

  // Lo que devolvió /pendiente-facturar: remitos con items sin facturar,
  // precios de lista, dólar e IVA vigentes.
  let pendiente = null;
  let ocId = null;
  let onListo = null;
  // Renglones de la factura, uno por modelo: { ficha_id, modelo, cantidad,
  // preciosEntrega (Map usd -> Set de remito), usd, pesos, pesosManual }.
  // Se conservan los valores editados al marcar/desmarcar remitos.
  let renglones = new Map();
  let pasoActual = 1;
  let enviando = false;
  let montado = false;

  const HTML = `
  <dialog id="facturarModal" class="panel" style="width:min(920px, calc(100% - 32px))">
    <div class="panel-head">
      <div class="wizard-head">
        <h2 id="facturarTitulo">Facturar remitos</h2>
        <ol class="wizard-steps" id="facturarPasos" aria-label="Pasos para facturar">
          <li class="wizard-step" data-paso="1"><span class="wizard-step-n">1</span>Remitos</li>
          <li class="wizard-step" data-paso="2"><span class="wizard-step-n">2</span>Precios</li>
          <li class="wizard-step" data-paso="3"><span class="wizard-step-n">3</span>Datos</li>
          <li class="wizard-step" data-paso="4"><span class="wizard-step-n">4</span>Revisar</li>
        </ol>
        <p class="muted" id="facturarPasoTitulo">Paso 1 de 4 — Remitos</p>
      </div>
    </div>
    <div class="panel-body">

      <div class="wizard-panel" data-paso="1">
        <div class="table-wrap">
          <table class="t">
            <thead><tr><th>Incluir</th><th>Remito</th><th>Fecha</th><th>Ítems</th></tr></thead>
            <tbody id="facturarRemitos"></tbody>
          </table>
        </div>
        <div class="notice notice-err" id="facturarPaso1Error" hidden>Marcá al menos un remito para continuar.</div>
      </div>

      <div class="wizard-panel" data-paso="2" hidden>
        <p class="muted" id="facturarRemitosResumen"></p>
        <div class="form-grid">
          <div class="field">
            <label for="facturar_cotizacion">Cotización del dólar (ARS por USD)</label>
            <input class="input" type="number" id="facturar_cotizacion" step="0.01" min="0.01">
            <small class="muted" id="facturarDolarActual"></small>
          </div>
        </div>
        <div class="notice notice-err" id="facturarPaso2Error" hidden>Ingresá la cotización del dólar para calcular los precios.</div>
        <div class="table-wrap" style="margin-top:8px">
          <table class="t">
            <thead>
              <tr>
                <th>Modelo</th><th class="num">Cantidad</th><th class="num">Precio USD</th>
                <th class="num">Precio ARS s/IVA</th><th class="num">Subtotal</th>
              </tr>
            </thead>
            <tbody id="facturarRenglones"></tbody>
          </table>
        </div>
        <small class="muted">El precio en pesos se calcula como USD × cotización. Si lo escribís a mano, ese renglón deja de recalcularse.</small>
        <div class="totales-inline" style="margin-top:16px">
          <div><span>Subtotal sin IVA</span><strong id="facturarSubtotal">$0.00</strong></div>
          <div><span id="facturarIvaLabel">IVA</span><strong id="facturarIva">$0.00</strong></div>
          <div><span>Total</span><strong id="facturarTotal">$0.00</strong></div>
        </div>
      </div>

      <div class="wizard-panel" data-paso="3" hidden>
        <div class="form-grid">
          <div class="field">
            <label for="facturar_numero">Número de factura</label>
            <input class="input" type="text" id="facturar_numero" placeholder="Ej: 0001-00001234" required>
          </div>
          <div class="field">
            <label for="facturar_tipo">Tipo</label>
            <select class="input" id="facturar_tipo" required>
              <option value="">Elegí…</option>
              <option value="A">Factura A</option>
              <option value="B">Factura B</option>
              <option value="C">Factura C</option>
            </select>
          </div>
          <div class="field">
            <label for="facturar_fecha">Fecha</label>
            <input class="input" type="date" id="facturar_fecha" required>
          </div>
          <div class="field">
            <label for="facturar_dias_credito">Días de crédito</label>
            <input class="input" type="number" id="facturar_dias_credito" value="0" min="0">
          </div>
        </div>
      </div>

      <div class="wizard-panel" data-paso="4" hidden>
        <p class="muted" id="facturarRevisionRemitos"></p>
        <div class="table-wrap">
          <table class="t">
            <thead>
              <tr><th>Modelo</th><th class="num">Cantidad</th><th class="num">Precio USD</th><th class="num">Precio ARS s/IVA</th><th class="num">Subtotal</th></tr>
            </thead>
            <tbody id="facturarRevisionRenglones"></tbody>
          </table>
        </div>
        <dl class="wizard-revision-datos" id="facturarRevisionDatos"></dl>
        <div class="totales-inline" style="margin-top:8px">
          <div><span>Subtotal sin IVA</span><strong id="facturarRevisionSubtotal">$0.00</strong></div>
          <div><span id="facturarRevisionIvaLabel">IVA</span><strong id="facturarRevisionIva">$0.00</strong></div>
          <div><span>Total</span><strong id="facturarRevisionTotal">$0.00</strong></div>
        </div>
        <div class="notice notice-info" style="margin-top:12px">Revisá los datos antes de confirmar. Una vez generada, la factura se puede anular desde Correcciones si hace falta.</div>
      </div>

      <div class="page-head-actions">
        <button type="button" class="b b-ghost" id="btnFacturarCancelar">Cancelar</button>
        <button type="button" class="b b-ghost" id="btnFacturarAtras" hidden>Atrás</button>
        <button type="button" class="b b-primary" id="btnFacturarSiguiente">Siguiente</button>
      </div>
    </div>
  </dialog>`;

  /* ---------------------- utilidades ---------------------- */

  function remitosSeleccionados() {
    const ids = [...document.querySelectorAll('.facturar-remito:checked')]
      .map((c) => Number(c.dataset.ventaId));
    return (pendiente?.remitos || []).filter((r) => ids.includes(r.venta_id));
  }

  function textoRemitosSeleccionados() {
    const remitos = remitosSeleccionados();
    return remitos.length
      ? remitos.map((r) => r.remito_numero || `venta #${r.venta_id}`).join(' · ')
      : '—';
  }

  function cotizacion() {
    return Number($('facturar_cotizacion').value) || 0;
  }

  function redondear2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function totales() {
    const iva = Number(pendiente?.iva) || 0;
    let subtotal = 0;
    let ivaTotal = 0;
    renglones.forEach((r) => {
      const sub = redondear2(r.cantidad * redondear2(r.pesos));
      subtotal += sub;
      ivaTotal += redondear2(sub * iva);
    });
    return { subtotal, ivaTotal, total: subtotal + ivaTotal };
  }

  /* ---------------------- apertura ---------------------- */

  async function abrir(opciones) {
    montar();
    ocId = opciones.ocId;
    onListo = opciones.onListo || null;

    try {
      pendiente = await apiFetch(`/api/reportes-oc/orden-compra/${ocId}/pendiente-facturar`);
    } catch (err) {
      Shell.error(err, 'No se pudo cargar lo pendiente de facturar');
      return;
    }

    const remitos = pendiente.remitos || [];
    if (!remitos.length) {
      Shell.toast('warn', 'No hay remitos pendientes de facturar en esta orden.');
      return;
    }

    renglones = new Map();
    $('facturarTitulo').textContent = `Facturar remitos · OC ${pendiente.numero_oc || ''}`.trim();

    $('facturarRemitos').innerHTML = remitos.map((r) => `
      <tr>
        <td data-label="Incluir">
          <label class="check">
            <input type="checkbox" class="facturar-remito" data-venta-id="${r.venta_id}" checked><span></span>
          </label>
        </td>
        <td><strong>${r.remito_numero || `venta #${r.venta_id}`}</strong></td>
        <td data-label="Fecha">${Shell.fecha(r.remito_fecha)}</td>
        <td data-label="Ítems">${r.items.map((i) => `${i.cantidad} x ${i.modelo}`).join('<br>')}</td>
      </tr>
    `).join('');

    const dolar = Number(pendiente.dolar_actual) || 0;
    $('facturar_cotizacion').value = dolar ? dolar.toFixed(2) : '';
    $('facturarDolarActual').textContent = dolar
      ? `Cotización cargada hoy en el sistema: ARS ${dolar.toFixed(2)}`
      : 'No hay cotización cargada en Precios';
    const ivaTexto = `IVA ${Math.round((pendiente.iva || 0) * 100)}%`;
    $('facturarIvaLabel').textContent = ivaTexto;
    $('facturarRevisionIvaLabel').textContent = ivaTexto;
    $('facturar_fecha').value = new Date().toISOString().split('T')[0];

    pasoActual = 1;
    irAPaso(1);
    $('facturarModal').showModal();
  }

  /* ---------------------- renglones y totales ---------------------- */

  // Arma un renglón por modelo sumando las cantidades de los remitos
  // marcados. Si el renglón ya existía, conserva los precios editados.
  function armarRenglones() {
    const anteriores = renglones;
    renglones = new Map();
    const cot = cotizacion();

    $('facturarRemitosResumen').textContent = `Remitos incluidos: ${textoRemitosSeleccionados()}`;

    remitosSeleccionados().forEach((remito) => {
      const remitoNombre = remito.remito_numero || `venta #${remito.venta_id}`;
      remito.items.forEach((item) => {
        const key = String(item.ficha_id);
        let renglon = renglones.get(key);
        if (!renglon) {
          const previo = anteriores.get(key);
          const precioLista = pendiente.precios_lista?.[item.ficha_id];
          const usd = previo
            ? previo.usd
            : Number(precioLista ?? item.precio_unitario_usd) || 0;
          renglon = {
            ficha_id: item.ficha_id,
            modelo: item.modelo,
            cantidad: 0,
            preciosEntrega: new Map(),
            usd,
            pesos: previo ? previo.pesos : redondear2(usd * cot),
            pesosManual: previo ? previo.pesosManual : false
          };
          renglones.set(key, renglon);
        }
        renglon.cantidad += Number(item.cantidad);
        const precioEntrega = Number(item.precio_unitario_usd) || 0;
        if (!renglon.preciosEntrega.has(precioEntrega)) renglon.preciosEntrega.set(precioEntrega, new Set());
        renglon.preciosEntrega.get(precioEntrega).add(remitoNombre);
      });
    });

    const tbody = $('facturarRenglones');
    if (!renglones.size) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">Marcá al menos un remito.</td></tr>';
      actualizarTotales();
      return;
    }

    tbody.innerHTML = [...renglones.values()].map((r) => {
      const preciosEntrega = [...r.preciosEntrega.entries()];
      // Si el mismo modelo se entregó a distinto precio en distintos remitos,
      // avisar en vez de mostrar en silencio el último que se procesó.
      const entregaInfo = preciosEntrega.length > 1
        ? `<span class="pill pill-warn" title="${preciosEntrega
            .map(([usd, nombres]) => `US$ ${usd.toFixed(2)} en ${[...nombres].join(', ')}`).join(' — ')}">Precios de entrega distintos</span>`
        : `<span class="muted">Entregado a US$ ${(preciosEntrega[0]?.[0] ?? 0).toFixed(2)}</span>`;
      return `
      <tr>
        <td><strong>${r.modelo}</strong><br>${entregaInfo}</td>
        <td class="num" data-label="Cantidad">${r.cantidad}</td>
        <td class="num" data-label="Precio USD">
          <input class="input facturar-usd" type="number" step="0.01" min="0" data-ficha-id="${r.ficha_id}"
            value="${r.usd.toFixed(2)}" style="max-width:120px">
        </td>
        <td class="num" data-label="Precio ARS s/IVA">
          <input class="input facturar-pesos" type="number" step="0.01" min="0.01" data-ficha-id="${r.ficha_id}"
            value="${r.pesos.toFixed(2)}" style="max-width:150px">
          <span class="pill pill-info" data-manual-ficha="${r.ficha_id}"
            title="Precio fijado a mano: no sigue la cotización"${r.pesosManual ? '' : ' hidden'}>Manual</span>
        </td>
        <td class="num" data-label="Subtotal" data-subtotal-ficha="${r.ficha_id}">${Shell.money(r.cantidad * r.pesos)}</td>
      </tr>`;
    }).join('');

    actualizarTotales();
  }

  function recalcularPesos() {
    const cot = cotizacion();
    renglones.forEach((r) => {
      if (r.pesosManual) return;
      r.pesos = redondear2(r.usd * cot);
      const input = document.querySelector(`.facturar-pesos[data-ficha-id="${r.ficha_id}"]`);
      if (input) input.value = r.pesos.toFixed(2);
    });
    actualizarTotales();
  }

  function actualizarTotales() {
    renglones.forEach((r) => {
      const celda = document.querySelector(`[data-subtotal-ficha="${r.ficha_id}"]`);
      if (celda) celda.textContent = Shell.money(redondear2(r.cantidad * redondear2(r.pesos)));
    });
    const t = totales();
    $('facturarSubtotal').textContent = Shell.money(t.subtotal);
    $('facturarIva').textContent = Shell.money(t.ivaTotal);
    $('facturarTotal').textContent = Shell.money(t.total);
  }

  /* ---------------------- navegación entre pasos ---------------------- */

  function pasoValido(n) {
    if (n === 1) return remitosSeleccionados().length > 0;
    if (n === 2) {
      if (!(cotizacion() > 0)) return false;
      if (!renglones.size) return false;
      return [...renglones.values()].every((r) => r.pesos > 0);
    }
    if (n === 3) {
      const numero = $('facturar_numero').value.trim();
      const tipo = $('facturar_tipo').value;
      const fecha = $('facturar_fecha').value;
      const dias = Number($('facturar_dias_credito').value);
      return !!numero && !!tipo && !!fecha && Number.isFinite(dias) && dias >= 0;
    }
    return true;
  }

  function actualizarBotonesNav() {
    $('btnFacturarAtras').hidden = pasoActual === 1;
    const siguiente = $('btnFacturarSiguiente');
    siguiente.textContent = pasoActual === TOTAL_PASOS ? 'Generar factura' : 'Siguiente';
    siguiente.disabled = enviando || !pasoValido(pasoActual);

    $('facturarPaso1Error').hidden = !(pasoActual === 1 && remitosSeleccionados().length === 0);

    const paso2Error = $('facturarPaso2Error');
    if (pasoActual !== 2) {
      paso2Error.hidden = true;
    } else if (!(cotizacion() > 0)) {
      paso2Error.hidden = false;
      paso2Error.textContent = 'Ingresá la cotización del dólar para calcular los precios.';
    } else {
      const sinPrecio = [...renglones.values()].find((r) => !(r.pesos > 0));
      paso2Error.hidden = !sinPrecio;
      if (sinPrecio) paso2Error.textContent = `Falta el precio de ${sinPrecio.modelo}.`;
    }
  }

  function pintarRevision() {
    $('facturarRevisionRemitos').textContent = `Remitos incluidos: ${textoRemitosSeleccionados()}`;

    $('facturarRevisionRenglones').innerHTML = [...renglones.values()].map((r) => `
      <tr>
        <td>${r.modelo}</td>
        <td class="num">${r.cantidad}</td>
        <td class="num">US$ ${r.usd.toFixed(2)}</td>
        <td class="num">${Shell.money(r.pesos)}</td>
        <td class="num">${Shell.money(r.cantidad * r.pesos)}</td>
      </tr>
    `).join('');

    const tipo = $('facturar_tipo').value;
    $('facturarRevisionDatos').innerHTML = `
      <div><dt>Número</dt><dd>${$('facturar_numero').value.trim()}</dd></div>
      <div><dt>Tipo</dt><dd>${tipo ? `Factura ${tipo}` : '—'}</dd></div>
      <div><dt>Fecha</dt><dd>${Shell.fecha($('facturar_fecha').value)}</dd></div>
      <div><dt>Días de crédito</dt><dd>${$('facturar_dias_credito').value || '0'}</dd></div>
    `;

    const t = totales();
    $('facturarRevisionSubtotal').textContent = Shell.money(t.subtotal);
    $('facturarRevisionIva').textContent = Shell.money(t.ivaTotal);
    $('facturarRevisionTotal').textContent = Shell.money(t.total);
  }

  function irAPaso(n, { moverFoco = false } = {}) {
    if (n < 1 || n > TOTAL_PASOS) return;
    if (n > pasoActual && !pasoValido(pasoActual)) return;

    if (n === 2) armarRenglones();
    if (n === 4) pintarRevision();

    document.querySelectorAll('#facturarModal .wizard-panel').forEach((p) => {
      p.hidden = Number(p.dataset.paso) !== n;
    });
    document.querySelectorAll('#facturarPasos .wizard-step').forEach((li) => {
      const i = Number(li.dataset.paso);
      li.classList.toggle('activo', i === n);
      li.classList.toggle('completado', i < n);
    });

    pasoActual = n;
    $('facturarPasoTitulo').textContent = `Paso ${n} de ${TOTAL_PASOS} — ${NOMBRES_PASO[n]}`;
    actualizarBotonesNav();

    if (moverFoco) {
      document.querySelector(`#facturarModal .wizard-panel[data-paso="${n}"] input:not([type=checkbox]), #facturarModal .wizard-panel[data-paso="${n}"] select`)
        ?.focus();
    }
  }

  function resetear() {
    enviando = false;
    renglones = new Map();
    $('facturar_numero').value = '';
    $('facturar_tipo').value = '';
    $('facturar_fecha').value = '';
    $('facturar_dias_credito').value = '0';
    $('facturar_cotizacion').value = '';
    document.querySelectorAll('#facturarModal .is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    pasoActual = 1;
    irAPaso(1);
  }

  /* ---------------------- confirmar ---------------------- */

  async function confirmar() {
    if (enviando) return;
    // El botón "Generar factura" solo se habilita en el paso 4 con los tres
    // pasos anteriores válidos, pero se revalida por las dudas.
    if (!pasoValido(1) || !pasoValido(2) || !pasoValido(3)) return;

    const remitos = remitosSeleccionados();
    const precios = [...renglones.values()].map((r) => ({
      ficha_id: r.ficha_id,
      precio_unitario_usd: r.usd,
      precio_unitario_pesos: redondear2(r.pesos)
    }));

    enviando = true;
    const btn = $('btnFacturarSiguiente');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generando factura…';

    try {
      const factura = await apiFetch('/api/facturas', {
        method: 'POST',
        body: JSON.stringify({
          venta_ids: remitos.map((r) => r.venta_id),
          numero_factura: $('facturar_numero').value.trim(),
          tipo_factura: $('facturar_tipo').value,
          fecha: $('facturar_fecha').value,
          dias_credito: Number.parseInt($('facturar_dias_credito').value, 10) || 0,
          tipo_cambio: cotizacion() || null,
          precios
        })
      });

      Shell.toast('ok', `Factura ${factura.numero_factura} generada por ${remitos.length} remito(s)`);
      $('facturarModal').close();
      if (onListo) await onListo(factura);
    } catch (err) {
      console.error('Error generando factura:', err);
      Shell.error(err, 'No se pudo generar la factura');
      btn.textContent = textoOriginal;
      btn.disabled = false;
    } finally {
      enviando = false;
    }
  }

  /* ---------------------- montaje (una sola vez) ---------------------- */

  function montar() {
    if (montado) return;
    montado = true;
    document.body.insertAdjacentHTML('beforeend', HTML);

    $('facturarModal').addEventListener('close', resetear);
    $('btnFacturarCancelar').addEventListener('click', () => $('facturarModal').close());
    $('btnFacturarSiguiente').addEventListener('click', () => {
      if (pasoActual < TOTAL_PASOS) irAPaso(pasoActual + 1, { moverFoco: true });
      else confirmar();
    });
    $('btnFacturarAtras').addEventListener('click', () => irAPaso(pasoActual - 1, { moverFoco: true }));
    document.querySelectorAll('#facturarPasos .wizard-step').forEach((li) => {
      li.addEventListener('click', () => {
        if (li.classList.contains('completado')) irAPaso(Number(li.dataset.paso));
      });
    });

    $('facturarRemitos').addEventListener('change', (e) => {
      if (e.target.classList.contains('facturar-remito')) actualizarBotonesNav();
    });
    $('facturar_cotizacion').addEventListener('input', () => {
      recalcularPesos();
      actualizarBotonesNav();
    });
    $('facturarRenglones').addEventListener('input', (e) => {
      const renglon = renglones.get(String(e.target.dataset.fichaId));
      if (!renglon) return;
      const badge = document.querySelector(`[data-manual-ficha="${renglon.ficha_id}"]`);
      if (e.target.classList.contains('facturar-usd')) {
        renglon.usd = Number(e.target.value) || 0;
        // Cambiar el USD vuelve a calcular el precio en pesos del renglón.
        renglon.pesosManual = false;
        badge?.setAttribute('hidden', '');
        recalcularPesos();
      } else if (e.target.classList.contains('facturar-pesos')) {
        renglon.pesos = Number(e.target.value) || 0;
        renglon.pesosManual = true;
        badge?.removeAttribute('hidden');
        actualizarTotales();
      }
      actualizarBotonesNav();
    });

    // Datos de la factura (paso 3): marca el campo en rojo recién cuando se
    // pierde el foco con un valor inválido, y habilita/deshabilita
    // "Siguiente" en cada cambio.
    [
      ['facturar_numero', () => $('facturar_numero').value.trim().length > 0],
      ['facturar_tipo', () => !!$('facturar_tipo').value],
      ['facturar_fecha', () => !!$('facturar_fecha').value]
    ].forEach(([id, esValido]) => {
      const el = $(id);
      el.addEventListener('blur', () => el.classList.toggle('is-invalid', !esValido()));
      el.addEventListener('input', () => {
        if (esValido()) el.classList.remove('is-invalid');
        actualizarBotonesNav();
      });
      el.addEventListener('change', () => {
        el.classList.toggle('is-invalid', !esValido());
        actualizarBotonesNav();
      });
    });
    $('facturar_dias_credito').addEventListener('input', actualizarBotonesNav);
  }

  global.FacturarWizard = { abrir };
})(window);

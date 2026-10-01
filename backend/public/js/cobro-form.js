/* =====================================================================
 * cobro-form.js — Formulario "Registrar cobro", compartido
 * Antes era una solapa de cobros.html. Ahora es un diálogo que se abre
 * desde la ficha del cliente (cliente.html) o desde Cobros:
 *
 *   CobroForm.abrir({ clienteId, onListo })   // clienteId opcional
 *
 * Pasos en una sola ventana: 1 de quién es el cobro → 2 con qué nos pagan
 * (efectivo, transferencia, cheque, retención) → 3 a qué facturas se
 * imputa. Lo que no se imputa queda a cuenta del cliente. Los cheques no
 * cancelan la factura hasta que se acrediten (quedan "en gestión").
 *
 * El <dialog> se inyecta en el body la primera vez. Requiere Shell y apiFetch.
 * ===================================================================== */
(function (global) {
  'use strict';

  const API = '/api/cobros';
  const $ = (id) => document.getElementById(id);
  const num = (v) => Number(v) || 0;

  const estado = {
    clientes: null,      // lista de clientes (se pide una sola vez)
    formas: [],          // ids de las formas de cobro cargadas
    seqForma: 0,
    facturas: [],        // facturas pendientes del cliente elegido
    imputaciones: {},    // { factura_id: monto }
    clienteFijo: false,
    onListo: null,
    guardando: false,
    avisoACuentaVisto: false
  };
  let montado = false;

  const HTML = `
  <dialog id="cobroModal" class="panel" style="width:min(980px, calc(100% - 32px))">
    <div class="panel-head"><h2>Registrar cobro</h2></div>
    <div class="panel-body">

      <div class="panel-head" style="padding:0 0 var(--space-3);border:none">1 · De quién es el cobro</div>
      <div class="filters" style="background:none;border:none;padding:0">
        <div class="field grow">
          <label for="cobroCliente">Cliente *</label>
          <select class="select" id="cobroCliente"><option value="">-- Seleccionar --</option></select>
        </div>
        <div class="field">
          <label for="cobroFecha">Fecha de recepción *</label>
          <input class="input" type="date" id="cobroFecha">
        </div>
        <div class="field grow">
          <label for="cobroObs">Observaciones</label>
          <input class="input" type="text" id="cobroObs" placeholder="Ej: entregado en planta">
        </div>
      </div>
      <div id="cobroResumenCliente"></div>

      <div class="panel-head" style="padding:var(--space-4) 0 var(--space-3);border:none">
        2 · Con qué nos pagan
        <div class="page-head-actions">
          <button type="button" class="b b-ghost b-sm" id="btnAgregarForma">+ Agregar forma de cobro</button>
        </div>
      </div>
      <div id="formasCobro"></div>
      <div class="empty" id="avisoCheques" hidden style="padding:var(--space-4);text-align:left">
        Los cheques no cancelan la factura hasta que se acrediten. Hasta entonces la factura
        queda marcada <strong>en gestión de cobro</strong>.
      </div>

      <div class="panel-head" style="padding:var(--space-4) 0 var(--space-3);border:none">
        3 · A qué facturas se imputa <button type="button" class="ayuda" data-ayuda="imputar">?</button>
        <div class="page-head-actions">
          <button type="button" class="b b-ghost b-sm" id="btnImputarAuto">Imputar a las más viejas</button>
          <button type="button" class="b b-ghost b-sm" id="btnLimpiarImputacion">Limpiar</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="t">
          <thead>
            <tr>
              <th style="width:40px"></th><th>Factura</th><th>Vencimiento</th>
              <th class="num">Total</th><th class="num">Saldo</th><th class="num">En gestión</th>
              <th>Estado</th><th class="num" style="width:160px">A imputar</th>
            </tr>
          </thead>
          <tbody id="tablaFacturasCobro">
            <tr><td colspan="8">Elegí un cliente para ver sus facturas pendientes</td></tr>
          </tbody>
        </table>
      </div>

      <div class="totales-inline" style="margin-top:var(--space-4)">
        <div><span>Total del cobro</span><strong id="totCobro">$0</strong></div>
        <div><span>Imputado a facturas</span><strong id="totImputado">$0</strong></div>
        <div><span>Queda a cuenta <button type="button" class="ayuda" data-ayuda="a_cuenta">?</button></span><strong id="totACuenta">$0</strong></div>
      </div>
      <div class="notice notice-warn" id="avisoACuenta" hidden style="margin-top:var(--space-3)">
        El cliente tiene facturas pendientes y no imputaste nada: el cobro va a quedar <strong>a cuenta</strong>.
        Si es lo que querés, tocá <strong>Registrar cobro</strong> otra vez para confirmar.
      </div>

      <div class="page-head-actions" style="margin-top:var(--space-4)">
        <button type="button" class="b b-ghost" id="btnCancelarCobro">Cancelar</button>
        <button type="button" class="b b-primary" id="btnGuardarCobro">Registrar cobro</button>
      </div>
    </div>
  </dialog>`;

  function textoAtraso(dias) {
    if (dias === null || dias === undefined) return '—';
    const d = Number(dias);
    if (d > 0) return `<span class="neg">${d} d</span>`;
    if (d === 0) return '<span class="neg">vence hoy</span>';
    return `<span class="muted">en ${Math.abs(d)} d</span>`;
  }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------------- apertura ---------------------- */

  async function abrir(opciones = {}) {
    montar();
    estado.onListo = opciones.onListo || null;
    estado.clienteFijo = !!opciones.clienteId;

    if (!estado.clientes) {
      try {
        estado.clientes = await apiFetch('/api/clientes');
      } catch (err) {
        Shell.error(err, 'No se pudieron cargar los clientes');
        return;
      }
    }
    $('cobroCliente').innerHTML = '<option value="">-- Seleccionar --</option>' +
      estado.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');

    reset();
    if (opciones.clienteId) {
      $('cobroCliente').value = String(opciones.clienteId);
      $('cobroCliente').disabled = true;
      await alCambiarCliente();
    } else {
      $('cobroCliente').disabled = false;
    }
    agregarForma();
    $('cobroModal').showModal();
  }

  function reset() {
    estado.formas = [];
    estado.imputaciones = {};
    estado.facturas = [];
    estado.guardando = false;
    estado.avisoACuentaVisto = false;
    $('formasCobro').innerHTML = '';
    $('cobroCliente').value = '';
    $('cobroObs').value = '';
    $('cobroFecha').value = new Date().toISOString().slice(0, 10);
    $('cobroResumenCliente').innerHTML = '';
    $('avisoCheques').hidden = true;
    $('avisoACuenta').hidden = true;
    pintarFacturas();
  }

  /* ---------------------- cliente y facturas ---------------------- */

  async function alCambiarCliente() {
    const clienteId = $('cobroCliente').value;
    estado.imputaciones = {};

    if (!clienteId) {
      estado.facturas = [];
      $('cobroResumenCliente').innerHTML = '';
      pintarFacturas();
      return;
    }

    try {
      const [facturas, ficha] = await Promise.all([
        apiFetch(`${API}/clientes/${clienteId}/facturas-pendientes`),
        apiFetch(`${API}/clientes/${clienteId}`)
      ]);
      estado.facturas = facturas;

      const t = ficha.totales;
      $('cobroResumenCliente').innerHTML = `
        <div class="notice ${num(t.vencido) > 0 ? 'notice-warn' : 'notice-info'}" style="margin-top:var(--space-4)">
          Tiene <strong>${Shell.money(t.saldo)}</strong> por cobrar en ${facturas.length} factura(s).
          ${num(t.vencido) > 0 ? `De eso, <strong>${Shell.money(t.vencido)}</strong> está vencido (hasta ${t.dias_atraso_max} días).` : 'Nada vencido todavía.'}
          ${num(t.en_gestion) > 0 ? ` Hay <strong>${Shell.money(t.en_gestion)}</strong> en cheques sin acreditar.` : ''}
          ${num(t.saldo_a_favor) > 0 ? ` Tiene <strong>${Shell.money(t.saldo_a_favor)}</strong> a favor sin imputar.` : ''}
          ${num(t.exceso_cobrado) > 0 ? ` Además hay <strong>${Shell.money(t.exceso_cobrado)}</strong> cobrado de más en facturas ya saldadas.` : ''}
        </div>`;

      pintarFacturas();
    } catch (err) {
      Shell.error(err, 'No se pudieron cargar las facturas del cliente');
    }
  }

  function pintarFacturas() {
    const tbody = $('tablaFacturasCobro');

    if (!estado.facturas.length) {
      tbody.innerHTML = `<tr><td colspan="8">${
        $('cobroCliente').value ? 'Este cliente no tiene facturas pendientes. El cobro va a quedar a cuenta.'
                                : 'Elegí un cliente para ver sus facturas pendientes'}</td></tr>`;
      recalcularTotales();
      return;
    }

    tbody.innerHTML = estado.facturas.map((f) => {
      const disponible = num(f.saldo) - num(f.en_gestion);
      const imputado = estado.imputaciones[f.id] || 0;
      return `
      <tr>
        <td><input type="checkbox" data-cf-toggle="${f.id}" ${imputado ? 'checked' : ''} ${disponible <= 0 ? 'disabled' : ''}></td>
        <td data-label="Factura"><strong>${esc(f.numero_factura)}</strong> <span class="muted">${esc(f.tipo_factura || '')}</span></td>
        <td data-label="Vencimiento">${Shell.fecha(f.fecha_vencimiento)} ${textoAtraso(f.dias_atraso)}</td>
        <td class="num" data-label="Total">${Shell.money(f.total)}</td>
        <td class="num" data-label="Saldo"><strong>${Shell.money(f.saldo)}</strong></td>
        <td class="num muted" data-label="En gestión">${num(f.en_gestion) ? Shell.money(f.en_gestion) : '—'}</td>
        <td data-label="Estado">${Shell.pill(f.estado)}</td>
        <td class="num" data-label="A imputar">
          <input class="input" type="number" step="0.01" min="0" max="${disponible}"
                 style="width:150px; text-align:right" data-cf-imputar="${f.id}"
                 value="${imputado ? imputado.toFixed(2) : ''}" ${disponible <= 0 ? 'disabled' : ''}>
        </td>
      </tr>`;
    }).join('');

    recalcularTotales();
  }

  function alternarFactura(facturaId, marcado) {
    const f = estado.facturas.find((x) => x.id === facturaId);
    if (!f) return;
    if (marcado) {
      const disponible = num(f.saldo) - num(f.en_gestion);
      const restante = totalCobro() - totalImputado();
      estado.imputaciones[facturaId] = Math.max(0, Math.min(disponible, restante > 0 ? restante : disponible));
    } else {
      delete estado.imputaciones[facturaId];
    }
    pintarFacturas();
  }

  function cambiarImputacion(facturaId, valor) {
    const v = parseFloat(valor);
    if (!v || v <= 0) delete estado.imputaciones[facturaId];
    else estado.imputaciones[facturaId] = v;
    recalcularTotales();
  }

  /* Reparte el total del cobro sobre las facturas más viejas primero. */
  function imputarAutomatico() {
    const total = totalCobro();
    if (total <= 0) { Shell.toast('warn', 'Cargá primero las formas de cobro y sus importes.'); return; }

    estado.imputaciones = {};
    let restante = Math.round(total * 100);

    for (const f of estado.facturas) {
      if (restante <= 0) break;
      const disponible = Math.round((num(f.saldo) - num(f.en_gestion)) * 100);
      if (disponible <= 0) continue;
      const usar = Math.min(restante, disponible);
      estado.imputaciones[f.id] = usar / 100;
      restante -= usar;
    }

    pintarFacturas();
    if (restante > 0) {
      Shell.toast('ok', `Quedan ${Shell.money(restante / 100)} sin imputar: se van a registrar a cuenta del cliente.`);
    }
  }

  /* ---------------------- formas de cobro ---------------------- */

  function agregarForma() {
    const i = estado.seqForma++;
    estado.formas.push(i);

    const div = document.createElement('div');
    div.className = 'forma';
    div.id = `forma-${i}`;
    div.innerHTML = `
      <select class="select" id="f-tipo-${i}" data-cf-tipo="${i}">
        <option value="EFECTIVO">Efectivo</option>
        <option value="TRANSFERENCIA">Transferencia</option>
        <option value="CHEQUE">Cheque</option>
        <option value="RETENCION">Retención</option>
      </select>
      <input class="input" type="number" id="f-monto-${i}" step="0.01" min="0" placeholder="Importe" data-cf-monto>
      <div class="detalle" id="f-detalle-${i}"></div>
      <button type="button" class="forma-quitar" data-cf-quitar="${i}">×</button>`;

    $('formasCobro').appendChild(div);
    pintarDetalleForma(i);
  }

  function hayCheque() {
    return estado.formas.some((j) => $(`f-tipo-${j}`) && $(`f-tipo-${j}`).value === 'CHEQUE');
  }

  function pintarDetalleForma(i) {
    const tipo = $(`f-tipo-${i}`).value;
    const cont = $(`f-detalle-${i}`);

    if (tipo === 'CHEQUE') {
      cont.innerHTML = `
        <label class="campo"><span>N° de cheque *</span><input class="input" type="text" id="f-ch-num-${i}"></label>
        <label class="campo"><span>Banco *</span><input class="input" type="text" id="f-ch-banco-${i}"></label>
        <label class="campo"><span>Emisión</span><input class="input" type="date" id="f-ch-emision-${i}"></label>
        <label class="campo"><span>Fecha de cobro *</span><input class="input" type="date" id="f-ch-cobro-${i}"></label>`;
    } else if (tipo === 'TRANSFERENCIA') {
      cont.innerHTML = `
        <label class="campo"><span>Banco origen</span><input class="input" type="text" id="f-tr-origen-${i}"></label>
        <label class="campo"><span>Banco destino</span><input class="input" type="text" id="f-tr-destino-${i}"></label>
        <label class="campo"><span>N° de operación</span><input class="input" type="text" id="f-tr-op-${i}"></label>
        <label class="campo"><span>Fecha</span><input class="input" type="date" id="f-tr-fecha-${i}"></label>`;
    } else if (tipo === 'RETENCION') {
      cont.innerHTML = `
        <label class="campo"><span>Impuesto *</span>
          <select class="select" id="f-re-tipo-${i}">
            <option value="IIBB">Ingresos Brutos</option>
            <option value="GANANCIAS">Ganancias</option>
            <option value="IVA">IVA</option>
            <option value="SUSS">SUSS</option>
          </select>
        </label>
        <label class="campo"><span>N° de certificado</span><input class="input" type="text" id="f-re-cert-${i}"></label>`;
    } else {
      cont.innerHTML = '<span class="muted" style="align-self:center">Sin datos adicionales</span>';
    }

    $('avisoCheques').hidden = !hayCheque();
  }

  function quitarForma(i) {
    estado.formas = estado.formas.filter((x) => x !== i);
    $(`forma-${i}`).remove();
    recalcularTotales();
    $('avisoCheques').hidden = !hayCheque();
  }

  function totalCobro() {
    return estado.formas.reduce((acc, i) => acc + (parseFloat($(`f-monto-${i}`)?.value) || 0), 0);
  }

  function totalImputado() {
    return Object.values(estado.imputaciones).reduce((a, b) => a + num(b), 0);
  }

  function recalcularTotales() {
    const total = totalCobro();
    const imputado = totalImputado();
    const aCuenta = total - imputado;

    $('totCobro').textContent = Shell.money(total);
    $('totImputado').textContent = Shell.money(imputado);

    if (aCuenta < -0.005) {
      $('totACuenta').textContent = Shell.money(aCuenta) + ' (imputás más de lo que cobrás)';
      $('totACuenta').className = 'neg';
    } else {
      $('totACuenta').textContent = Shell.money(Math.max(aCuenta, 0));
      $('totACuenta').className = aCuenta > 0.005 ? 'pos' : '';
    }

    // Si cambió algo, la confirmación "a cuenta" ya no vale.
    estado.avisoACuentaVisto = false;
    $('avisoACuenta').hidden = true;
  }

  function leerFormas() {
    const items = [];
    for (const i of estado.formas) {
      const tipo = $(`f-tipo-${i}`).value;
      const monto = parseFloat($(`f-monto-${i}`).value);
      if (!monto || monto <= 0) throw new Error('Hay una forma de cobro sin monto.');

      const item = { tipo, monto };

      if (tipo === 'CHEQUE') {
        item.cheque_numero = $(`f-ch-num-${i}`).value.trim();
        item.cheque_banco = $(`f-ch-banco-${i}`).value.trim();
        item.cheque_fecha_emision = $(`f-ch-emision-${i}`).value || null;
        item.cheque_fecha_cobro = $(`f-ch-cobro-${i}`).value || null;
        if (!item.cheque_numero || !item.cheque_banco || !item.cheque_fecha_cobro) {
          throw new Error('Un cheque necesita número, banco y fecha de cobro.');
        }
      }
      if (tipo === 'TRANSFERENCIA') {
        item.transferencia_banco_origen = $(`f-tr-origen-${i}`).value.trim() || null;
        item.transferencia_banco_destino = $(`f-tr-destino-${i}`).value.trim() || null;
        item.transferencia_numero_operacion = $(`f-tr-op-${i}`).value.trim() || null;
        item.transferencia_fecha = $(`f-tr-fecha-${i}`).value || null;
      }
      if (tipo === 'RETENCION') {
        item.retencion_tipo = $(`f-re-tipo-${i}`).value;
        item.retencion_certificado = $(`f-re-cert-${i}`).value.trim() || null;
      }

      items.push(item);
    }
    return items;
  }

  /* ---------------------- guardar ---------------------- */

  async function guardar() {
    if (estado.guardando) return;
    const boton = $('btnGuardarCobro');

    try {
      const cliente_id = $('cobroCliente').value;
      const fecha_recepcion = $('cobroFecha').value;
      if (!cliente_id) throw new Error('Elegí el cliente.');
      if (!fecha_recepcion) throw new Error('Indicá la fecha de recepción.');

      const items = leerFormas();
      if (!items.length) throw new Error('Agregá al menos una forma de cobro.');

      const aplicaciones = Object.entries(estado.imputaciones)
        .filter(([, m]) => num(m) > 0)
        .map(([factura_id, monto]) => ({ factura_id: Number(factura_id), monto: num(monto) }));

      const total = totalCobro();
      const imputado = totalImputado();
      if (imputado - total > 0.005) throw new Error('Estás imputando más de lo que cobrás.');

      // Cobro sin imputar con facturas pendientes: se pide un segundo toque
      // (un aviso dentro de la ventana, no un confirm() nativo).
      if (total - imputado > 0.005 && estado.facturas.length && aplicaciones.length === 0
          && !estado.avisoACuentaVisto) {
        estado.avisoACuentaVisto = true;
        $('avisoACuenta').hidden = false;
        return;
      }

      estado.guardando = true;
      boton.disabled = true;
      boton.textContent = 'Guardando...';

      const r = await apiFetch(API, {
        method: 'POST',
        body: JSON.stringify({
          cliente_id: Number(cliente_id),
          fecha_recepcion,
          observaciones: $('cobroObs').value.trim() || null,
          items,
          aplicaciones
        })
      });

      Shell.toast('ok', `${r.message}. Cobro #${r.pago_id} por ${Shell.money(r.monto_total)}.`);
      $('cobroModal').close();
      if (estado.onListo) await estado.onListo(r);
    } catch (err) {
      Shell.error(err, 'No se pudo registrar el cobro');
    } finally {
      estado.guardando = false;
      boton.disabled = false;
      boton.textContent = 'Registrar cobro';
    }
  }

  /* ---------------------- montaje (una sola vez) ---------------------- */

  function montar() {
    if (montado) return;
    montado = true;
    document.body.insertAdjacentHTML('beforeend', HTML);

    const modal = $('cobroModal');
    $('cobroCliente').addEventListener('change', alCambiarCliente);
    $('btnAgregarForma').addEventListener('click', agregarForma);
    $('btnImputarAuto').addEventListener('click', imputarAutomatico);
    $('btnLimpiarImputacion').addEventListener('click', () => { estado.imputaciones = {}; pintarFacturas(); });
    $('btnGuardarCobro').addEventListener('click', guardar);
    $('btnCancelarCobro').addEventListener('click', () => modal.close());

    modal.addEventListener('change', (e) => {
      const tipo = e.target.closest('[data-cf-tipo]');
      if (tipo) return pintarDetalleForma(Number(tipo.dataset.cfTipo));
      const toggle = e.target.closest('[data-cf-toggle]');
      if (toggle) alternarFactura(Number(toggle.dataset.cfToggle), toggle.checked);
    });
    modal.addEventListener('input', (e) => {
      if (e.target.closest('[data-cf-monto]')) return recalcularTotales();
      const imp = e.target.closest('[data-cf-imputar]');
      if (imp) cambiarImputacion(Number(imp.dataset.cfImputar), imp.value);
    });
    modal.addEventListener('click', (e) => {
      const quitar = e.target.closest('[data-cf-quitar]');
      if (quitar) quitarForma(Number(quitar.dataset.cfQuitar));
    });
  }

  global.CobroForm = { abrir };
})(window);

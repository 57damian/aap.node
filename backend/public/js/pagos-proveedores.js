/* =====================================================================
 * PAGOS A PROVEEDORES — pantalla de seguimiento y carga
 * ---------------------------------------------------------------------
 * Migrada al shell (F1.3 del plan de rediseño). Espejo de cobros.js:
 * misma lógica de negocio, mismo shell, mismos helpers (Shell.money,
 * Shell.fecha, Shell.pill, Shell.error) en vez de los propios de esta
 * pantalla.
 * ===================================================================== */

const API = '/api/pagos-proveedores';

const estado = {
  proveedores: [],
  facturas: [],        // facturas pendientes del proveedor elegido
  formas: [],          // formas de pago cargadas en el formulario
  endosables: [],      // cheques de clientes disponibles para endosar
  secuencia: 0
};

/* ---------------------------------------------------------------------
 * Utilidades
 * ------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const num = (v) => parseFloat(v) || 0;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ---------------------------------------------------------------------
 * Arranque
 * ------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  $('pagoFecha').value = new Date().toISOString().slice(0, 10);

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => mostrarTab(btn.dataset.tab, btn));
  });
  document.querySelectorAll('[data-tab-ir]').forEach(b => b.addEventListener('click', () =>
    document.querySelector(`.tab[data-tab="${b.dataset.tabIr}"]`).click()));

  $('buscarProveedor').addEventListener('input', debounce(cargarDeuda, 300));
  $('soloVencido').addEventListener('change', cargarDeuda);
  $('ordenDeuda').addEventListener('change', cargarDeuda);
  $('btnActualizarDeuda').addEventListener('click', cargarTodo);
  $('pagoProveedor').addEventListener('change', alCambiarProveedor);
  $('btnAgregarForma').addEventListener('click', agregarForma);
  $('btnImputarAuto').addEventListener('click', imputarAutomatico);
  $('btnLimpiarImputacion').addEventListener('click', limpiarImputacion);
  $('btnGuardarPago').addEventListener('click', guardarPago);
  $('btnCancelarPago').addEventListener('click', resetFormularioPago);
  $('btnFiltrarCheques').addEventListener('click', cargarCheques);
  $('btnFiltrarHistorial').addEventListener('click', cargarHistorial);
  $('btnCerrarDrawer').addEventListener('click', cerrarDrawer);
  $('drawerBg').addEventListener('click', cerrarDrawer);

  await cargarProveedores();
  await cargarTodo();
});

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function mostrarTab(nombre, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  const destino = $('tab-' + nombre);
  if (destino) destino.classList.add('active');
  if (btn) btn.classList.add('active');

  if (nombre === 'cheques') cargarCheques();
  if (nombre === 'historial') cargarHistorial();
  if (nombre === 'pagar' && !estado.formas.length) agregarForma();
}

async function cargarTodo() {
  await Promise.all([cargarResumen(), cargarDeuda()]);
}

/* ---------------------------------------------------------------------
 * Tarjetas y antigüedad de la deuda
 * ------------------------------------------------------------------- */
async function cargarResumen() {
  try {
    const r = await apiFetch(`${API}/resumen`);
    const d = r.deuda, c = r.cheques_a_debitar;

    $('kpis').innerHTML = `
      <div class="kpi is-danger">
        <div class="kpi-k">Deuda total</div>
        <div class="kpi-v">${Shell.money(d.deuda_total)}</div>
        <div class="kpi-sub">${d.facturas_con_saldo} factura(s) · ${d.proveedores_con_deuda} proveedor(es)</div>
      </div>
      <div class="kpi is-warning">
        <div class="kpi-k">Vencido</div>
        <div class="kpi-v">${Shell.money(d.vencido)}</div>
        <div class="kpi-sub">Ya pasó la fecha de pago</div>
      </div>
      <div class="kpi is-info">
        <div class="kpi-k">Cheques a debitar <button type="button" class="ayuda" data-ayuda="en_valores">?</button></div>
        <div class="kpi-v">${Shell.money(c.total)}</div>
        <div class="kpi-sub">${c.cantidad} entregado(s) · ${Shell.money(c.total_7_dias)} en 7 días${
          num(c.pasados_sin_debitar) > 0 ? ` · <span class="neg">${c.pasados_sin_debitar} con fecha pasada</span>` : ''}</div>
      </div>
      <div class="kpi is-success">
        <div class="kpi-k">A favor nuestro</div>
        <div class="kpi-v">${Shell.money(num(r.saldo_a_favor) + num(d.exceso_pagado))}</div>
        <div class="kpi-sub">${Shell.money(r.saldo_a_favor)} sin imputar${
          num(d.exceso_pagado) > 0 ? ` · ${Shell.money(d.exceso_pagado)} pagado de más` : ''}</div>
      </div>`;

    $('aging').innerHTML = `
      <div class="b0"><div class="t">Por vencer</div><div class="v">${Shell.money(d.por_vencer)}</div></div>
      <div class="b1"><div class="t">1 a 30 días</div><div class="v">${Shell.money(d.atraso_1_30)}</div></div>
      <div class="b2"><div class="t">31 a 60 días</div><div class="v">${Shell.money(d.atraso_31_60)}</div></div>
      <div class="b3"><div class="t">61 a 90 días</div><div class="v">${Shell.money(d.atraso_61_90)}</div></div>
      <div class="b4"><div class="t">Más de 90 días</div><div class="v">${Shell.money(d.atraso_90_mas)}</div></div>`;
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el resumen de pagos a proveedores');
  }
}

/* ---------------------------------------------------------------------
 * Tabla de deuda por proveedor
 * ------------------------------------------------------------------- */
async function cargarDeuda() {
  const tbody = $('tablaDeuda');
  try {
    const qs = new URLSearchParams();
    if ($('buscarProveedor').value.trim()) qs.set('buscar', $('buscarProveedor').value.trim());
    if ($('soloVencido').checked) qs.set('solo_vencido', 'true');
    qs.set('orden', $('ordenDeuda').value);

    const filas = await apiFetch(`${API}/deuda?${qs}`);

    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="8">' + Shell.vacio(
        'No hay deuda con proveedores',
        'Va a aparecer acá en cuanto cargues una factura de compra.',
        { txt: 'Ver facturas de compra', url: 'facturas-compra.html' }
      ) + '</td></tr>';
      return;
    }

    tbody.innerHTML = filas.map(p => `
      <tr class="clickable" onclick="verProveedor(${p.proveedor_id})">
        <td>
          <strong>${esc(p.proveedor_nombre)}</strong>
          <div class="muted" style="font-size:12px">${esc(p.cuit || 'sin CUIT')}</div>
        </td>
        <td class="num" data-label="Facturas">${p.facturas_pendientes}</td>
        <td class="num" data-label="Saldo"><strong>${Shell.money(p.saldo)}</strong></td>
        <td class="num ${num(p.vencido) > 0 ? 'neg' : 'muted'}" data-label="Vencido">${Shell.money(p.vencido)}</td>
        <td class="num muted" data-label="Por vencer">${Shell.money(p.por_vencer)}</td>
        <td class="num ${num(p.en_valores) > 0 ? '' : 'muted'}" data-label="En valores">${Shell.money(p.en_valores)}</td>
        <td class="num" data-label="Atraso">${p.dias_atraso_max > 0 ? `<span class="neg">${p.dias_atraso_max} d</span>` : '<span class="muted">—</span>'}</td>
        <td class="num ${num(p.saldo_a_favor) + num(p.exceso_pagado) > 0 ? 'pos' : 'muted'}" data-label="A favor">
          ${Shell.money(num(p.saldo_a_favor) + num(p.exceso_pagado))}</td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudo cargar la deuda con proveedores');
    tbody.innerHTML = '<tr><td colspan="8">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

/* ---------------------------------------------------------------------
 * Ficha del proveedor (panel lateral)
 * ------------------------------------------------------------------- */
async function verProveedor(id) {
  abrirDrawer('Cargando...', '', '');
  try {
    const [ficha, cc] = await Promise.all([
      apiFetch(`${API}/proveedores/${id}?solo_pendientes=false`),
      apiFetch(`${API}/proveedores/${id}/cuenta-corriente`)
    ]);
    const t = ficha.totales;

    const avisoExceso = num(t.exceso_pagado) > 0 ? `
      <div class="notice notice-warn">
        Hay ${Shell.money(t.exceso_pagado)} imputados de más sobre facturas ya canceladas.
        Conviene deshacer esa imputación desde el pago correspondiente y dejar la plata a cuenta.
      </div>` : '';

    const avisoValores = num(t.en_valores) > 0 ? `
      <div class="notice notice-info">
        ${Shell.money(t.en_valores)} de lo que figura pagado está cubierto con cheques que todavía
        no se debitaron.
      </div>` : '';

    abrirDrawer(ficha.proveedor.nombre,
      `${esc(ficha.proveedor.cuit || 'sin CUIT')} · ${ficha.proveedor.dias_credito || 0} días de crédito`,
      `
      ${avisoExceso}${avisoValores}
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-k">Saldo</div><div class="kpi-v">${Shell.money(t.saldo)}</div></div>
        <div class="kpi is-warning"><div class="kpi-k">Vencido</div><div class="kpi-v">${Shell.money(t.vencido)}</div></div>
        <div class="kpi is-info"><div class="kpi-k">En valores</div><div class="kpi-v">${Shell.money(t.en_valores)}</div></div>
        <div class="kpi is-success"><div class="kpi-k">A favor</div><div class="kpi-v">${Shell.money(t.saldo_a_favor)}</div></div>
      </div>

      <div class="panel">
        <div class="panel-head">Facturas</div>
        <div class="panel-body flush"><div class="table-wrap">
          <table class="t">
            <thead><tr><th>Factura</th><th>Emisión</th><th>Vencimiento</th>
              <th class="num">Total</th><th class="num">Pagado</th><th class="num">Saldo</th><th>Estado</th></tr></thead>
            <tbody>${ficha.facturas.length ? ficha.facturas.map(f => `
              <tr>
                <td><strong>${esc(f.numero_factura)}</strong></td>
                <td data-label="Emisión">${Shell.fecha(f.fecha)}</td>
                <td data-label="Vencimiento">${Shell.fecha(f.fecha_vencimiento)}${f.dias_atraso > 0 ? ` <span class="neg">(${f.dias_atraso} d)</span>` : ''}</td>
                <td class="num" data-label="Total">${Shell.money(f.total)}</td>
                <td class="num" data-label="Pagado">${Shell.money(f.pagado)}</td>
                <td class="num" data-label="Saldo"><strong>${Shell.money(f.saldo)}</strong></td>
                <td data-label="Estado">${Shell.pill(f.estado)}</td>
              </tr>`).join('') : `<tr><td colspan="7">${Shell.vacio('Sin facturas', '')}</td></tr>`}</tbody>
          </table>
        </div></div>
      </div>

      ${ficha.cheques_a_debitar.length ? `
      <div class="panel">
        <div class="panel-head">Cheques entregados sin debitar</div>
        <div class="panel-body flush"><div class="table-wrap">
          <table class="t">
            <thead><tr><th>Cheque</th><th>Banco</th><th class="num">Monto</th><th>Se debita</th></tr></thead>
            <tbody>${ficha.cheques_a_debitar.map(c => `
              <tr>
                <td><strong>${esc(c.cheque_numero || 's/n')}</strong> ${c.tipo === 'CHEQUE_ENDOSADO' ? Shell.pill('ENTREGADO') : ''}</td>
                <td data-label="Banco">${esc(c.cheque_banco || '—')}</td>
                <td class="num" data-label="Monto">${Shell.money(c.monto)}</td>
                <td data-label="Se debita">${Shell.fecha(c.cheque_fecha_cobro)}${c.dias_para_debito < 0 ? ' <span class="neg">(pasado)</span>' : ''}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div></div>
      </div>` : ''}

      <div class="panel">
        <div class="panel-head">Cuenta corriente <button type="button" class="ayuda" data-ayuda="cuenta_corriente">?</button></div>
        <div class="panel-body flush"><div class="table-wrap">
          <table class="t">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th>Comprobante</th><th>Detalle</th>
              <th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th></tr></thead>
            <tbody>${cc.movimientos.length ? cc.movimientos.map(m => `
              <tr>
                <td>${Shell.fecha(m.fecha)}</td>
                <td data-label="Movimiento">${Shell.pill(m.tipo)}</td>
                <td data-label="Comprobante">${esc(m.comprobante)}</td>
                <td class="muted" data-label="Detalle">${esc(m.detalle || '')}</td>
                <td class="num" data-label="Debe">${num(m.debe) ? Shell.money(m.debe) : '—'}</td>
                <td class="num" data-label="Haber">${num(m.haber) ? Shell.money(m.haber) : '—'}</td>
                <td class="num" data-label="Saldo"><strong>${Shell.money(m.saldo_acumulado)}</strong></td>
              </tr>`).join('') : `<tr><td colspan="7">${Shell.vacio('Sin movimientos', '')}</td></tr>`}</tbody>
          </table>
        </div></div>
      </div>`);
  } catch (err) {
    abrirDrawer('Error', '', `<div class="notice notice-err">No se pudo cargar la ficha de este proveedor.</div>`);
    Shell.error(err, 'No se pudo cargar la ficha del proveedor');
  }
}

function abrirDrawer(titulo, meta, cuerpo) {
  $('drawerTitulo').textContent = titulo;
  $('drawerMeta').textContent = meta;
  $('drawerCuerpo').innerHTML = cuerpo;
  $('drawer').classList.add('open');
  $('drawerBg').classList.add('open');
}

function cerrarDrawer() {
  $('drawer').classList.remove('open');
  $('drawerBg').classList.remove('open');
}

/* ---------------------------------------------------------------------
 * Formulario de pago
 * ------------------------------------------------------------------- */
async function cargarProveedores() {
  try {
    estado.proveedores = await apiFetch('/api/proveedores');
    const opciones = estado.proveedores
      .map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    $('pagoProveedor').innerHTML = '<option value="">-- Seleccionar --</option>' + opciones;
    $('filtroChequeProveedor').innerHTML = '<option value="">Todos los proveedores</option>' + opciones;
    $('filtroHistProveedor').innerHTML = '<option value="">Todos los proveedores</option>' + opciones;
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los proveedores');
  }
}

async function alCambiarProveedor() {
  const id = $('pagoProveedor').value;
  estado.facturas = [];
  if (!id) {
    $('pagoResumenProveedor').innerHTML = '';
    dibujarFacturasPago();
    return;
  }
  try {
    const [ficha, facturas] = await Promise.all([
      apiFetch(`${API}/proveedores/${id}`),
      apiFetch(`${API}/proveedores/${id}/facturas-pendientes`)
    ]);
    estado.facturas = facturas.map(f => ({ ...f, imputar: 0 }));

    const t = ficha.totales;
    $('pagoResumenProveedor').innerHTML = `
      <div class="notice ${num(t.vencido) > 0 ? 'notice-warn' : 'notice-info'}" style="margin-top:var(--space-4)">
        Le debemos <strong>${Shell.money(t.saldo)}</strong>.
        ${num(t.vencido) > 0 ? `De eso, <strong>${Shell.money(t.vencido)}</strong> está vencido.` : 'Nada vencido todavía.'}
        ${num(t.en_valores) > 0 ? ` Hay <strong>${Shell.money(t.en_valores)}</strong> en cheques entregados sin debitar.` : ''}
        ${num(t.saldo_a_favor) > 0 ? ` Tenemos <strong>${Shell.money(t.saldo_a_favor)}</strong> a favor sin imputar.` : ''}
      </div>`;
    dibujarFacturasPago();
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar las facturas del proveedor');
  }
}

const TIPOS = [
  ['EFECTIVO', 'Efectivo'],
  ['TRANSFERENCIA', 'Transferencia'],
  ['CHEQUE', 'Cheque propio'],
  ['CHEQUE_ENDOSADO', 'Cheque de cliente endosado'],
  ['RETENCION', 'Retención practicada']
];

function agregarForma() {
  const id = ++estado.secuencia;
  estado.formas.push({ id, tipo: 'EFECTIVO' });

  const div = document.createElement('div');
  div.className = 'forma';
  div.id = `forma-${id}`;
  div.innerHTML = `
    <div class="campo">
      <span>Forma de pago</span>
      <select class="select" onchange="cambiarTipoForma(${id}, this.value)">
        ${TIPOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
      </select>
    </div>
    <div class="campo">
      <span>Monto</span>
      <input class="input" type="number" step="0.01" min="0" id="monto-${id}" oninput="recalcular()">
    </div>
    <div class="detalle" id="detalle-${id}"></div>
    <button type="button" class="forma-quitar" onclick="quitarForma(${id})" title="Quitar">×</button>`;

  $('formasPago').appendChild(div);
  cambiarTipoForma(id, 'EFECTIVO');
}

function quitarForma(id) {
  estado.formas = estado.formas.filter(f => f.id !== id);
  const el = $(`forma-${id}`);
  if (el) el.remove();
  recalcular();
}

async function cambiarTipoForma(id, tipo) {
  const forma = estado.formas.find(f => f.id === id);
  if (forma) forma.tipo = tipo;

  const det = $(`detalle-${id}`);
  const montoInput = $(`monto-${id}`);

  if (tipo === 'CHEQUE') {
    montoInput.disabled = false;
    det.innerHTML = `
      <div class="campo"><span>N° cheque *</span><input class="input" type="text" id="chq-num-${id}"></div>
      <div class="campo"><span>Banco *</span><input class="input" type="text" id="chq-banco-${id}"></div>
      <div class="campo"><span>Emisión</span><input class="input" type="date" id="chq-emi-${id}"></div>
      <div class="campo"><span>Se debita *</span><input class="input" type="date" id="chq-cobro-${id}"></div>`;
  } else if (tipo === 'CHEQUE_ENDOSADO') {
    montoInput.disabled = true;
    montoInput.value = '';
    if (!estado.endosables.length) {
      try { estado.endosables = await apiFetch(`${API}/cheques-endosables`); } catch { estado.endosables = []; }
    }
    det.innerHTML = estado.endosables.length ? `
      <div class="campo" style="grid-column:1/-1">
        <span>Cheque de cliente a endosar * <button type="button" class="ayuda" data-ayuda="endosar">?</button></span>
        <select class="select" id="endoso-${id}" onchange="recalcular()">
          <option value="">-- Elegir cheque en cartera --</option>
          ${estado.endosables.map(c => `<option value="${c.id}" data-monto="${c.monto}">
            ${esc(c.cheque_numero || 's/n')} · ${esc(c.cheque_banco || '')} · ${Shell.money(c.monto)} ·
            se cobra ${Shell.fecha(c.cheque_fecha_cobro)} · de ${esc(c.cliente_nombre)}</option>`).join('')}
        </select>
      </div>` : `<div class="muted" style="grid-column:1/-1">No hay cheques de clientes en cartera para endosar.</div>`;
  } else if (tipo === 'TRANSFERENCIA') {
    montoInput.disabled = false;
    det.innerHTML = `
      <div class="campo"><span>Banco origen</span><input class="input" type="text" id="tr-org-${id}"></div>
      <div class="campo"><span>Banco destino</span><input class="input" type="text" id="tr-dst-${id}"></div>
      <div class="campo"><span>N° operación</span><input class="input" type="text" id="tr-op-${id}"></div>
      <div class="campo"><span>Fecha</span><input class="input" type="date" id="tr-fecha-${id}"></div>`;
  } else if (tipo === 'RETENCION') {
    montoInput.disabled = false;
    det.innerHTML = `
      <div class="campo"><span>Impuesto *</span>
        <select class="select" id="ret-tipo-${id}">
          <option value="IIBB">IIBB</option>
          <option value="GANANCIAS">Ganancias</option>
          <option value="IVA">IVA</option>
          <option value="SUSS">SUSS</option>
        </select></div>
      <div class="campo"><span>N° certificado</span><input class="input" type="text" id="ret-cert-${id}"></div>`;
  } else {
    montoInput.disabled = false;
    det.innerHTML = '<span class="muted" style="align-self:center">Sin datos adicionales</span>';
  }

  $('avisoCheques').hidden =
    !estado.formas.some(f => f.tipo === 'CHEQUE' || f.tipo === 'CHEQUE_ENDOSADO');
  recalcular();
}

function montoDeForma(f) {
  if (f.tipo === 'CHEQUE_ENDOSADO') {
    const sel = $(`endoso-${f.id}`);
    if (!sel || !sel.value) return 0;
    return num(sel.selectedOptions[0].dataset.monto);
  }
  return num($(`monto-${f.id}`)?.value);
}

function dibujarFacturasPago() {
  const tbody = $('tablaFacturasPago');
  if (!estado.facturas.length) {
    tbody.innerHTML = `<tr><td colspan="7">${
      $('pagoProveedor').value ? 'Este proveedor no tiene facturas pendientes. El pago va a quedar a cuenta.'
                               : 'Elegí un proveedor para ver sus facturas pendientes'}</td></tr>`;
    recalcular();
    return;
  }

  tbody.innerHTML = estado.facturas.map((f, i) => `
    <tr>
      <td><input type="checkbox" id="chk-${i}" ${f.imputar > 0 ? 'checked' : ''} onchange="marcarFactura(${i}, this.checked)"></td>
      <td data-label="Factura"><strong>${esc(f.numero_factura)}</strong></td>
      <td data-label="Vencimiento">${Shell.fecha(f.fecha_vencimiento)}${f.dias_atraso > 0 ? ` <span class="neg">(${f.dias_atraso} d)</span>` : ''}</td>
      <td class="num" data-label="Total">${Shell.money(f.total)}</td>
      <td class="num" data-label="Saldo"><strong>${Shell.money(f.saldo)}</strong></td>
      <td data-label="Estado">${Shell.pill(f.estado)}</td>
      <td class="num" data-label="A imputar">
        <input class="input" type="number" step="0.01" min="0" max="${f.saldo}" id="imp-${i}"
               style="width:150px; text-align:right"
               value="${f.imputar ? num(f.imputar).toFixed(2) : ''}" oninput="cambiarImputacion(${i}, this.value)">
      </td>
    </tr>`).join('');
  recalcular();
}

function marcarFactura(i, marcado) {
  const f = estado.facturas[i];
  f.imputar = marcado ? num(f.saldo) : 0;
  const input = $(`imp-${i}`);
  if (input) input.value = f.imputar ? f.imputar.toFixed(2) : '';
  recalcular();
}

function cambiarImputacion(i, valor) {
  const f = estado.facturas[i];
  let v = num(valor);
  if (v > num(f.saldo)) { v = num(f.saldo); $(`imp-${i}`).value = v.toFixed(2); }
  f.imputar = v;
  const chk = $(`chk-${i}`);
  if (chk) chk.checked = v > 0;
  recalcular();
}

function imputarAutomatico() {
  if (!estado.facturas.length) { Shell.toast('warn', 'Elegí un proveedor primero.'); return; }
  let disponible = estado.formas.reduce((a, f) => a + montoDeForma(f), 0);
  if (disponible <= 0) { Shell.toast('warn', 'Cargá primero el monto del pago.'); return; }

  // Las facturas ya vienen ordenadas por vencimiento más viejo primero.
  for (const f of estado.facturas) {
    const usar = Math.min(disponible, num(f.saldo));
    f.imputar = usar > 0 ? Math.round(usar * 100) / 100 : 0;
    disponible -= usar;
  }
  dibujarFacturasPago();
}

function limpiarImputacion() {
  estado.facturas.forEach(f => { f.imputar = 0; });
  dibujarFacturasPago();
}

function recalcular() {
  const total = estado.formas.reduce((a, f) => a + montoDeForma(f), 0);
  const imputado = estado.facturas.reduce((a, f) => a + num(f.imputar), 0);
  const aCuenta = Math.round((total - imputado) * 100) / 100;

  $('totPago').textContent = Shell.money(total);
  $('totImputado').textContent = Shell.money(imputado);
  $('totACuenta').textContent = Shell.money(aCuenta);
  $('totACuenta').className = aCuenta < 0 ? 'neg' : (aCuenta > 0 ? 'pos' : '');
}

async function guardarPago() {
  const proveedor_id = $('pagoProveedor').value;
  const fecha_pago = $('pagoFecha').value;

  if (!proveedor_id) return Shell.toast('warn', 'Elegí el proveedor.');
  if (!fecha_pago) return Shell.toast('warn', 'Falta la fecha del pago.');
  if (!estado.formas.length) return Shell.toast('warn', 'Agregá al menos una forma de pago.');

  const items = [];
  for (const f of estado.formas) {
    const item = { tipo: f.tipo };

    if (f.tipo === 'CHEQUE_ENDOSADO') {
      const sel = $(`endoso-${f.id}`);
      if (!sel || !sel.value) return Shell.toast('warn', 'Elegí qué cheque de cliente se endosa.');
      item.pago_item_origen_id = parseInt(sel.value, 10);
    } else {
      item.monto = num($(`monto-${f.id}`).value);
      if (item.monto <= 0) return Shell.toast('warn', 'Cada forma de pago necesita un monto mayor a cero.');
    }

    if (f.tipo === 'CHEQUE') {
      item.cheque_numero = $(`chq-num-${f.id}`).value.trim();
      item.cheque_banco = $(`chq-banco-${f.id}`).value.trim();
      item.cheque_fecha_emision = $(`chq-emi-${f.id}`).value || null;
      item.cheque_fecha_cobro = $(`chq-cobro-${f.id}`).value || null;
      if (!item.cheque_numero || !item.cheque_banco || !item.cheque_fecha_cobro) {
        return Shell.toast('warn', 'Un cheque propio necesita número, banco y fecha de débito.');
      }
    }

    if (f.tipo === 'TRANSFERENCIA') {
      item.transferencia_banco_origen = $(`tr-org-${f.id}`).value.trim() || null;
      item.transferencia_banco_destino = $(`tr-dst-${f.id}`).value.trim() || null;
      item.transferencia_numero_operacion = $(`tr-op-${f.id}`).value.trim() || null;
      item.transferencia_fecha = $(`tr-fecha-${f.id}`).value || null;
    }

    if (f.tipo === 'RETENCION') {
      item.retencion_tipo = $(`ret-tipo-${f.id}`).value;
      item.retencion_certificado = $(`ret-cert-${f.id}`).value.trim() || null;
    }

    items.push(item);
  }

  const aplicaciones = estado.facturas
    .filter(f => num(f.imputar) > 0)
    .map(f => ({ factura_compra_id: f.id, monto: num(f.imputar) }));

  const btn = $('btnGuardarPago');
  btn.disabled = true;
  try {
    const r = await apiFetch(API, {
      method: 'POST',
      body: JSON.stringify({
        proveedor_id: parseInt(proveedor_id, 10),
        fecha_pago,
        referencia: $('pagoReferencia').value.trim() || null,
        observaciones: $('pagoObs').value.trim() || null,
        items,
        aplicaciones
      })
    });
    Shell.toast('ok', r.message || 'Pago registrado.');
    resetFormularioPago();
    estado.endosables = [];
    await cargarTodo();
  } catch (err) {
    Shell.error(err, 'No se pudo registrar el pago');
  } finally {
    btn.disabled = false;
  }
}

function resetFormularioPago() {
  estado.formas = [];
  estado.facturas = [];
  $('formasPago').innerHTML = '';
  $('pagoResumenProveedor').innerHTML = '';
  $('pagoReferencia').value = '';
  $('pagoObs').value = '';
  $('pagoProveedor').value = '';
  $('avisoCheques').hidden = true;
  dibujarFacturasPago();
  agregarForma();
}

/* ---------------------------------------------------------------------
 * Cheques entregados
 * ------------------------------------------------------------------- */
async function cargarCheques() {
  const tbody = $('tablaCheques');
  try {
    const qs = new URLSearchParams();
    if ($('filtroChequeEstado').value) qs.set('estado', $('filtroChequeEstado').value);
    if ($('filtroChequeTipo').value) qs.set('tipo', $('filtroChequeTipo').value);
    if ($('filtroChequeProveedor').value) qs.set('proveedor_id', $('filtroChequeProveedor').value);

    const cheques = await apiFetch(`${API}/cheques?${qs}`);

    if (!cheques.length) {
      tbody.innerHTML = '<tr><td colspan="9">' + Shell.vacio('No hay cheques con ese filtro', '') + '</td></tr>';
      return;
    }

    tbody.innerHTML = cheques.map(c => {
      const propio = c.tipo === 'CHEQUE';
      const acciones = (c.estado === 'ENTREGADO' && propio)
        ? `<button class="b b-ghost b-sm" onclick="accionCheque(${c.id},'debitar')">Debitar</button>
           <button class="b b-danger b-sm" onclick="accionCheque(${c.id},'rechazar')">Rechazar</button>`
        : (propio && c.estado !== 'ANULADO'
            ? `<button class="b b-ghost b-sm" onclick="accionCheque(${c.id},'anular')">Anular</button>`
            : '<span class="muted">—</span>');

      return `
        <tr>
          <td><strong>${esc(c.cheque_numero || 's/n')}</strong></td>
          <td data-label="Banco">${esc(c.cheque_banco || '—')}</td>
          <td data-label="Proveedor">${esc(c.proveedor_nombre)}</td>
          <td class="muted" data-label="Origen">${propio ? 'propio' : `endosado de ${esc(c.cliente_origen || 'cliente')}`}</td>
          <td class="num" data-label="Monto"><strong>${Shell.money(c.monto)}</strong></td>
          <td data-label="Se debita">${Shell.fecha(c.cheque_fecha_cobro)}${
            c.estado === 'ENTREGADO' && c.dias_para_debito < 0 ? ' <span class="neg">(pasado)</span>' : ''}</td>
          <td class="muted" data-label="Imputado a">${c.facturas || 'sin imputar'}</td>
          <td data-label="Estado">${Shell.pill(c.estado)}</td>
          <td data-label="Acciones">${acciones}</td>
        </tr>`;
    }).join('');
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los cheques');
    tbody.innerHTML = '<tr><td colspan="9">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

async function accionCheque(id, accion) {
  const body = {};
  if (accion === 'rechazar') {
    const motivo = prompt('Motivo del rechazo:', 'Sin fondos');
    if (motivo === null) return;
    body.motivo = motivo;
  }
  if (accion === 'anular') {
    if (!confirm('¿Anular este cheque? La deuda que cancelaba vuelve a quedar abierta.')) return;
  }
  if (accion === 'debitar') {
    const f = prompt('Fecha del débito (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (f === null) return;
    body.fecha = f;
  }

  try {
    await apiFetch(`${API}/cheques/${id}/${accion}`, { method: 'POST', body: JSON.stringify(body) });
    Shell.toast('ok', 'Cheque actualizado.');
    await Promise.all([cargarCheques(), cargarResumen(), cargarDeuda()]);
  } catch (err) {
    Shell.error(err, 'No se pudo actualizar el cheque');
  }
}

/* ---------------------------------------------------------------------
 * Historial de pagos
 * ------------------------------------------------------------------- */
async function cargarHistorial() {
  const tbody = $('tablaHistorial');
  try {
    const qs = new URLSearchParams();
    if ($('filtroHistProveedor').value) qs.set('proveedor_id', $('filtroHistProveedor').value);
    if ($('filtroHistDesde').value) qs.set('desde', $('filtroHistDesde').value);
    if ($('filtroHistHasta').value) qs.set('hasta', $('filtroHistHasta').value);
    if ($('filtroHistEstado').value) qs.set('estado', $('filtroHistEstado').value);

    const pagos = await apiFetch(`${API}?${qs}`);

    if (!pagos.length) {
      tbody.innerHTML = '<tr><td colspan="10">' + Shell.vacio('No hay pagos registrados', '') + '</td></tr>';
      return;
    }

    tbody.innerHTML = pagos.map(p => `
      <tr>
        <td>#${p.id}</td>
        <td data-label="Fecha">${Shell.fecha(p.fecha)}</td>
        <td data-label="Proveedor">${esc(p.proveedor_nombre || '—')}</td>
        <td class="muted" data-label="Formas">${esc((p.formas || '').replace(/_/g, ' '))}</td>
        <td data-label="Referencia">${esc(p.referencia || '—')}</td>
        <td class="num" data-label="Monto"><strong>${Shell.money(p.monto)}</strong></td>
        <td class="num" data-label="Imputado">${Shell.money(p.imputado)}</td>
        <td class="num ${num(p.disponible) > 0 ? 'pos' : 'muted'}" data-label="Sin imputar">${Shell.money(p.disponible)}</td>
        <td data-label="Estado">${Shell.pill(p.estado)}${p.tiene_rechazo ? ' ' + Shell.pill('RECHAZADO') : ''}</td>
        <td data-label="Acciones">
          <button class="b b-ghost b-sm" onclick="verPago(${p.id})">Ver</button>
          ${!p.anulado ? `<button class="b b-danger b-sm" onclick="anularPago(${p.id})">Anular</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el historial de pagos');
    tbody.innerHTML = '<tr><td colspan="10">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

async function verPago(id) {
  abrirDrawer('Cargando...', '', '');
  try {
    const p = await apiFetch(`${API}/${id}`);

    const detalleItem = (i) => {
      if (i.tipo === 'CHEQUE') return `N° ${esc(i.cheque_numero || '')} · ${esc(i.cheque_banco || '')} · se debita ${Shell.fecha(i.cheque_fecha_cobro)}`;
      if (i.tipo === 'CHEQUE_ENDOSADO') return `N° ${esc(i.origen_cheque_numero || '')} · ${esc(i.origen_cheque_banco || '')} · de ${esc(i.cliente_origen || 'cliente')} (cheque ${esc(i.origen_estado || '')})`;
      if (i.tipo === 'TRANSFERENCIA') return `Op. ${esc(i.transferencia_numero_operacion || 's/n')} · ${esc(i.transferencia_banco_destino || '')}`;
      if (i.tipo === 'RETENCION') return `${esc(i.retencion_tipo || '')} · cert. ${esc(i.retencion_certificado || 's/n')}`;
      return '';
    };

    abrirDrawer(`Pago #${p.id}`,
      `${esc(p.proveedor_nombre || '')} · ${Shell.fecha(p.fecha)} · ${Shell.money(p.monto)}${p.anulado ? ' · ANULADO' : ''}`,
      `
      ${p.anulado ? `<div class="notice notice-warn">Pago anulado: ${esc(p.motivo_anulacion || 'sin motivo')}</div>` : ''}
      <div class="panel">
        <div class="panel-head">Formas de pago</div>
        <div class="panel-body flush"><div class="table-wrap">
          <table class="t">
            <thead><tr><th>Tipo</th><th>Detalle</th><th class="num">Monto</th><th class="num">Imputado</th><th>Estado</th></tr></thead>
            <tbody>${p.items.map(i => `
              <tr>
                <td><strong>${esc(i.tipo.replace(/_/g, ' '))}</strong></td>
                <td class="muted" data-label="Detalle">${detalleItem(i)}</td>
                <td class="num" data-label="Monto">${Shell.money(i.monto)}</td>
                <td class="num" data-label="Imputado">${Shell.money(i.imputado)}</td>
                <td data-label="Estado">${Shell.pill(i.estado_efectivo)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div></div>
      </div>

      <div class="panel">
        <div class="panel-head">Imputaciones <button type="button" class="ayuda" data-ayuda="imputar">?</button></div>
        <div class="panel-body flush"><div class="table-wrap">
          <table class="t">
            <thead><tr><th>Factura</th><th>Emisión</th><th>Forma</th><th class="num">Monto</th><th></th></tr></thead>
            <tbody>${p.imputaciones.length ? p.imputaciones.map(a => `
              <tr>
                <td><strong>${esc(a.numero_factura)}</strong></td>
                <td data-label="Emisión">${Shell.fecha(a.fecha_emision)}</td>
                <td class="muted" data-label="Forma">${esc(a.forma_pago.replace(/_/g, ' '))}${a.cheque_numero ? ' ' + esc(a.cheque_numero) : ''}</td>
                <td class="num" data-label="Monto">${Shell.money(a.monto_aplicado)}</td>
                <td data-label="">${p.anulado ? '' : `<button class="b b-ghost b-sm" onclick="deshacerImputacion(${a.id}, ${p.id})">Deshacer</button>`}</td>
              </tr>`).join('') : `<tr><td colspan="5">${Shell.vacio('Pago a cuenta, sin imputar', '')}</td></tr>`}</tbody>
          </table>
        </div></div>
      </div>`);
  } catch (err) {
    abrirDrawer('Error', '', `<div class="notice notice-err">No se pudo cargar este pago.</div>`);
    Shell.error(err, 'No se pudo cargar el pago');
  }
}

async function deshacerImputacion(imputacionId, pagoId) {
  if (!confirm('¿Deshacer esta imputación? La factura vuelve a quedar con saldo.')) return;
  try {
    await apiFetch(`${API}/imputaciones/${imputacionId}`, { method: 'DELETE' });
    Shell.toast('ok', 'Imputación deshecha.');
    await Promise.all([verPago(pagoId), cargarResumen(), cargarDeuda(), cargarHistorial()]);
  } catch (err) {
    Shell.error(err, 'No se pudo deshacer la imputación');
  }
}

async function anularPago(id) {
  const motivo = prompt('Motivo de la anulación:');
  if (motivo === null) return;
  try {
    const r = await apiFetch(`${API}/${id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) });
    Shell.toast('ok', r.message + (r.cheques_devueltos_a_cartera
      ? ` ${r.cheques_devueltos_a_cartera} cheque(s) de cliente volvieron a cartera.` : ''));
    estado.endosables = [];
    await Promise.all([cargarHistorial(), cargarResumen(), cargarDeuda()]);
  } catch (err) {
    Shell.error(err, 'No se pudo anular el pago');
  }
}

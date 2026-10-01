/* =====================================================================
 * Pantalla de Cobros y deuda de clientes
 * Migrada al shell (F1.2 del plan de rediseño). Misma lógica de negocio
 * que antes; lo que cambia es de dónde sale el marcado (Shell.money,
 * Shell.fecha, Shell.pill, Shell.vacio) y que los errores pasan por
 * Shell.error() en vez de mostrar el texto técnico crudo.
 * ===================================================================== */

const API = '/api/cobros';

const estado = {
  clientes: [],
  deuda: [],
  formas: [],          // formas de cobro cargadas en el formulario
  facturas: [],        // facturas pendientes del cliente elegido
  imputaciones: {},    // { factura_id: monto }
  seqForma: 0,
  historial: []        // último resultado de cargarHistorial(), para exportar
};

/* ---------------------- utilidades ---------------------- */

const $ = (id) => document.getElementById(id);
const num = (v) => Number(v) || 0;

function textoAtraso(dias) {
  if (dias === null || dias === undefined) return '—';
  const d = Number(dias);
  if (d > 0) return `<span class="neg">${d} d</span>`;
  if (d === 0) return '<span class="neg">vence hoy</span>';
  return `<span class="muted">en ${Math.abs(d)} d</span>`;
}

function porcentaje(parte, total) {
  const t = num(total);
  if (!t) return '0%';
  return Math.round((num(parte) / t) * 100) + '%';
}

/* ---------------------- arranque ---------------------- */

document.addEventListener('DOMContentLoaded', async () => {
  $('cobroFecha').value = new Date().toISOString().slice(0, 10);

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => mostrarTab(t.dataset.tab, t));
  });
  document.querySelectorAll('[data-tab-ir]').forEach(b => b.addEventListener('click', () =>
    document.querySelector(`.tab[data-tab="${b.dataset.tabIr}"]`).click()));

  $('buscarCliente').addEventListener('input', debounce(cargarDeuda, 350));
  $('soloVencido').addEventListener('change', cargarDeuda);
  $('ordenDeuda').addEventListener('change', cargarDeuda);
  $('btnActualizarDeuda').addEventListener('click', cargarTodo);
  $('cobroCliente').addEventListener('change', onCambiaClienteCobro);
  $('btnAgregarForma').addEventListener('click', agregarForma);
  $('btnImputarAuto').addEventListener('click', imputarAutomatico);
  $('btnLimpiarImputacion').addEventListener('click', limpiarImputacion);
  $('btnGuardarCobro').addEventListener('click', guardarCobro);
  $('btnCancelarCobro').addEventListener('click', resetFormularioCobro);
  $('btnFiltrarCheques').addEventListener('click', cargarCheques);
  $('btnFiltrarHistorial').addEventListener('click', cargarHistorial);
  $('btnExportarHistorialCSV').addEventListener('click', exportarHistorialCSV);
  $('btnVerHistorialPdf').addEventListener('click', verHistorialPdf);
  $('btnCerrarDrawer').addEventListener('click', cerrarDrawer);
  $('drawerBg').addEventListener('click', cerrarDrawer);
  $('drawerCuerpo').addEventListener('click', clicEnDrawer);
  $('drawerCuerpo').addEventListener('change', (e) => {
    if (e.target.matches('#ecDesde, #ecHasta, #ecSoloPend')) cargarEstadoCuenta();
  });

  await cargarClientes();
  await cargarTodo();
});

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function mostrarTab(nombre, boton) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  boton.classList.add('active');
  $('tab-' + nombre).classList.add('active');
  if (nombre === 'cheques') cargarCheques();
  if (nombre === 'historial') cargarHistorial();
}

async function cargarTodo() {
  await Promise.all([cargarResumen(), cargarDeuda()]);
}

/* ---------------------- clientes ---------------------- */

async function cargarClientes() {
  try {
    estado.clientes = await apiFetch('/api/clientes');
    const opciones = estado.clientes
      .map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    ['cobroCliente', 'filtroChequeCliente', 'filtroHistCliente'].forEach(id => {
      const sel = $(id);
      const primera = sel.options[0].outerHTML;
      sel.innerHTML = primera + opciones;
    });
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los clientes');
  }
}

/* ---------------------- panel de situación ---------------------- */

async function cargarResumen() {
  try {
    const r = await apiFetch(`${API}/resumen`);
    const d = r.deuda, ch = r.cheques_en_cartera;

    $('kpis').innerHTML = `
      <div class="kpi is-danger">
        <div class="kpi-k">Deuda total</div>
        <div class="kpi-v">${Shell.money(d.deuda_total)}</div>
        <div class="kpi-sub">${d.facturas_con_saldo} facturas · ${d.clientes_con_deuda} clientes</div>
      </div>
      <div class="kpi is-warning">
        <div class="kpi-k">Vencido <button type="button" class="ayuda" data-ayuda="vencido">?</button></div>
        <div class="kpi-v">${Shell.money(d.vencido)}</div>
        <div class="kpi-sub">${porcentaje(d.vencido, d.deuda_total)} de la deuda</div>
      </div>
      <div class="kpi is-info">
        <div class="kpi-k">En gestión <button type="button" class="ayuda" data-ayuda="en_gestion">?</button></div>
        <div class="kpi-v">${Shell.money(d.en_gestion)}</div>
        <div class="kpi-sub">${ch.cantidad} cheques · ${ch.vencen_7_dias} se cobran en 7 días</div>
      </div>
      <div class="kpi is-success">
        <div class="kpi-k">A favor <button type="button" class="ayuda" data-ayuda="a_favor">?</button></div>
        <div class="kpi-v">${Shell.money(num(r.saldo_a_favor) + num(d.exceso_cobrado))}</div>
        <div class="kpi-sub">${Shell.money(r.saldo_a_favor)} sin imputar${
          num(d.exceso_cobrado) > 0 ? ` · ${Shell.money(d.exceso_cobrado)} cobrado de más` : ''}</div>
      </div>`;

    $('aging').innerHTML = `
      <div class="b0"><div class="t">Por vencer</div><div class="v">${Shell.money(d.por_vencer)}</div></div>
      <div class="b1"><div class="t">1 a 30 días</div><div class="v">${Shell.money(d.atraso_1_30)}</div></div>
      <div class="b2"><div class="t">31 a 60 días</div><div class="v">${Shell.money(d.atraso_31_60)}</div></div>
      <div class="b3"><div class="t">61 a 90 días</div><div class="v">${Shell.money(d.atraso_61_90)}</div></div>
      <div class="b4"><div class="t">Más de 90 días</div><div class="v">${Shell.money(d.atraso_90_mas)}</div></div>`;

    if (num(ch.vencidos_sin_depositar) > 0) {
      Shell.toast('warn', `Hay ${ch.vencidos_sin_depositar} cheque(s) con fecha de cobro pasada sin depositar.`);
    }
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el resumen de cobros');
  }
}

/* ---------------------- quién nos debe ---------------------- */

async function cargarDeuda() {
  const params = new URLSearchParams({ orden: $('ordenDeuda').value });
  if ($('buscarCliente').value.trim()) params.set('buscar', $('buscarCliente').value.trim());
  if ($('soloVencido').checked) params.set('solo_vencido', 'true');

  const tbody = $('tablaDeuda');
  try {
    estado.deuda = await apiFetch(`${API}/deuda?${params}`);

    if (!estado.deuda.length) {
      tbody.innerHTML = '<tr><td colspan="8">' + Shell.vacio(
        'No hay clientes con saldo pendiente',
        'Van a aparecer acá en cuanto emitas una factura de venta.',
        { txt: 'Ver ventas', url: 'ventas.html' }
      ) + '</td></tr>';
      return;
    }

    tbody.innerHTML = estado.deuda.map(c => `
      <tr class="clickable" onclick="verCliente(${c.cliente_id})">
        <td>
          <strong>${c.cliente_nombre}</strong>
          <div class="muted" style="font-size:12px">${c.cuit || 'sin CUIT'}${c.dias_max_pago ? ' · plazo ' + c.dias_max_pago + ' d' : ''}</div>
        </td>
        <td class="num" data-label="Facturas">${c.facturas_pendientes}</td>
        <td class="num" data-label="Saldo"><strong>${Shell.money(c.saldo)}</strong></td>
        <td class="num ${num(c.vencido) > 0 ? 'neg' : 'muted'}" data-label="Vencido">${Shell.money(c.vencido)}</td>
        <td class="num muted" data-label="Por vencer">${Shell.money(c.por_vencer)}</td>
        <td class="num" data-label="En gestión">${num(c.en_gestion) > 0 ? Shell.money(c.en_gestion) : '<span class="muted">—</span>'}</td>
        <td class="num" data-label="Atraso">${textoAtraso(c.dias_atraso_max)}</td>
        <td class="num ${num(c.saldo_a_favor) + num(c.exceso_cobrado) > 0 ? 'pos' : 'muted'}" data-label="A favor">
          ${num(c.saldo_a_favor) + num(c.exceso_cobrado) > 0
              ? Shell.money(num(c.saldo_a_favor) + num(c.exceso_cobrado)) : '—'}
          ${num(c.exceso_cobrado) > 0
              ? `<div class="muted" style="font-size:11px">incluye ${Shell.money(c.exceso_cobrado)} cobrado de más</div>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudo cargar la deuda de clientes');
    tbody.innerHTML = '<tr><td colspan="8">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

/* ---------------------- ficha del cliente (panel lateral) ---------------------- */
/* Dos solapas: "Estado de cuenta" (una línea por factura, con los pagos
 * aplicados al expandir) y "Cuenta corriente" (movimientos cronológicos).
 * Nunca dos tablas de facturas a la vez. */

const ec = {
  clienteId: null,
  datos: null,
  abiertas: new Set()   // ids de factura con los pagos desplegados
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function verCliente(clienteId) {
  abrirDrawer();
  $('drawerTitulo').textContent = 'Cargando...';
  $('drawerMeta').innerHTML = '';
  $('drawerCuerpo').innerHTML = '';
  ec.clienteId = clienteId;
  ec.abiertas = new Set();

  try {
    const [ficha, cc] = await Promise.all([
      apiFetch(`${API}/clientes/${clienteId}?solo_pendientes=false`),
      apiFetch(`${API}/clientes/${clienteId}/cuenta-corriente`)
    ]);

    const t = ficha.totales;
    $('drawerTitulo').textContent = ficha.cliente.nombre;
    $('drawerMeta').textContent = [
      ficha.cliente.cuit, ficha.cliente.telefono, ficha.cliente.correo,
      ficha.cliente.dias_max_pago ? `plazo ${ficha.cliente.dias_max_pago} días` : null
    ].filter(Boolean).join(' · ');

    $('drawerCuerpo').innerHTML = `
      <div class="dtabs-bar">
        <div class="tabs" role="tablist">
          <button type="button" class="dtab active" data-dtab="estado">Estado de cuenta</button>
          <button type="button" class="dtab" data-dtab="cc">Cuenta corriente</button>
        </div>
        <button class="b b-primary b-sm" onclick="cobrarA(${clienteId})">Registrar un cobro</button>
      </div>

      <div class="dscroll">
        <div class="dpane active" id="dpane-estado">
          <div class="ec-filtros">
            <label class="field"><span>Facturas desde</span><input type="date" id="ecDesde"></label>
            <label class="field"><span>Hasta</span><input type="date" id="ecHasta"></label>
            <label class="ec-check"><input type="checkbox" id="ecSoloPend"> Solo pendientes de cobro</label>
            <div class="ec-acciones">
              <button type="button" class="b b-ghost b-sm" id="ecLimpiar">Limpiar</button>
              <button type="button" class="b b-ghost b-sm" id="ecCsv">CSV</button>
              <button type="button" class="b b-primary b-sm" id="ecPdf">PDF</button>
              <label class="ec-check" title="Si lo destildás, el PDF trae solo las facturas, sin los pagos de cada una">
                <input type="checkbox" id="ecDetalle" checked> con detalle de pagos</label>
            </div>
          </div>
          <div id="ecResultado"><div class="muted" style="padding:16px">Cargando…</div></div>
        </div>

        <div class="dpane" id="dpane-cc">
          <div class="kpi-row">
            <div class="kpi"><div class="kpi-k">Saldo</div><div class="kpi-v">${Shell.money(t.saldo)}</div></div>
            <div class="kpi is-warning"><div class="kpi-k">Vencido</div><div class="kpi-v">${Shell.money(t.vencido)}</div>
              <div class="kpi-sub">${t.dias_atraso_max > 0 ? 'hasta ' + t.dias_atraso_max + ' días' : 'al día'}</div></div>
            <div class="kpi is-info"><div class="kpi-k">En gestión</div><div class="kpi-v">${Shell.money(t.en_gestion)}</div>
              <div class="kpi-sub">${ficha.cheques_en_cartera.length} cheque(s)</div></div>
            <div class="kpi is-success"><div class="kpi-k">A favor</div>
              <div class="kpi-v">${Shell.money(num(t.saldo_a_favor) + num(t.exceso_cobrado))}</div>
              ${num(t.exceso_cobrado) > 0
                ? `<div class="kpi-sub">${Shell.money(t.exceso_cobrado)} cobrado de más</div>` : ''}</div>
          </div>

          ${ficha.cheques_en_cartera.length ? `
          <div class="panel">
            <div class="panel-head">Cheques de este cliente todavía no acreditados <button type="button" class="ayuda" data-ayuda="en_cartera">?</button></div>
            <div class="panel-body flush">
              <div class="table-wrap">
                <table class="t">
                  <thead><tr><th>Cheque</th><th>Banco</th><th class="num">Monto</th><th>Se cobra</th><th>Estado</th></tr></thead>
                  <tbody>${ficha.cheques_en_cartera.map(c => `
                    <tr>
                      <td><strong>${esc(c.cheque_numero)}</strong>${c.endosado ? ' ' + Shell.pill('EN_GESTION') : ''}</td>
                      <td data-label="Banco">${esc(c.cheque_banco) || '—'}</td>
                      <td class="num" data-label="Monto">${Shell.money(c.monto)}</td>
                      <td data-label="Se cobra">${Shell.fecha(c.cheque_fecha_cobro)} ${textoAtraso(c.dias_para_cobro === null ? null : -c.dias_para_cobro)}</td>
                      <td data-label="Estado">${Shell.pill(c.estado)}</td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>` : ''}

          <div class="panel">
            <div class="panel-head">Cuenta corriente <button type="button" class="ayuda" data-ayuda="cuenta_corriente">?</button></div>
            <div class="panel-body flush">
              <div class="table-wrap">
                <table class="t">
                  <thead><tr>
                    <th>Fecha</th><th>Movimiento</th><th>Comprobante</th>
                    <th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th>
                  </tr></thead>
                  <tbody>${cc.movimientos.map(m => {
                    const informativo = num(m.debe) === 0 && num(m.haber) === 0;
                    return `
                    <tr${informativo ? ' class="muted"' : ''}>
                      <td>${Shell.fecha(m.fecha)}</td>
                      <td data-label="Movimiento">${esc(m.tipo.replace(/_/g, ' '))}${m.detalle ? `<div class="muted" style="font-size:11px">${esc(m.detalle)}</div>` : ''}</td>
                      <td data-label="Comprobante">${esc(m.comprobante)}</td>
                      <td class="num" data-label="Debe">${num(m.debe) ? Shell.money(m.debe) : (informativo ? `<span class="muted">(${Shell.money(m.monto)})</span>` : '—')}</td>
                      <td class="num" data-label="Haber">${num(m.haber) ? Shell.money(m.haber) : '—'}</td>
                      <td class="num" data-label="Saldo"><strong>${Shell.money(m.saldo_acumulado)}</strong></td>
                    </tr>`; }).join('') || `<tr><td colspan="6">${Shell.vacio('Sin movimientos', '')}</td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="panel-body" style="padding-top:0">
              <div class="muted" style="font-size:12px">
                Las filas grises son informativas: un cheque no mueve el saldo hasta que se acredita.
              </div>
            </div>
          </div>
        </div>
      </div>`;

    await cargarEstadoCuenta();
  } catch (err) {
    $('drawerTitulo').textContent = 'Error';
    Shell.error(err, 'No se pudo cargar la ficha del cliente');
    $('drawerCuerpo').innerHTML = `<div class="notice notice-err">No se pudo cargar la ficha de este cliente.</div>`;
  }
}

function paramsEstadoCuenta() {
  const p = new URLSearchParams();
  if ($('ecDesde').value) p.set('desde', $('ecDesde').value);
  if ($('ecHasta').value) p.set('hasta', $('ecHasta').value);
  if ($('ecSoloPend').checked) p.set('solo_pendientes', 'true');
  return p;
}

async function cargarEstadoCuenta() {
  const clienteId = ec.clienteId;
  ec.abiertas = new Set();   // al cambiar el filtro las filas abiertas ya no son las mismas
  try {
    const datos = await apiFetch(`${API}/clientes/${clienteId}/estado-cuenta?${paramsEstadoCuenta()}`);
    if (clienteId !== ec.clienteId) return;   // el usuario abrió otro cliente mientras tanto
    ec.datos = datos;
    pintarEstadoCuenta();
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el estado de cuenta');
    $('ecResultado').innerHTML = '<div class="notice notice-err">No se pudo cargar el estado de cuenta.</div>';
  }
}

function pintarEstadoCuenta() {
  const { resumen: r, facturas, a_cuenta } = ec.datos;
  const hayExceso = facturas.some(f => f.estado === 'SOBRE_COBRADA');

  $('ecResultado').innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-k">Facturado</div><div class="kpi-v">${Shell.money(r.facturado)}</div></div>
      <div class="kpi is-success"><div class="kpi-k">Cobrado</div><div class="kpi-v">${Shell.money(r.cobrado)}</div>
        ${num(r.en_gestion) > 0 ? `<div class="kpi-sub">+${Shell.money(r.en_gestion)} en gestión</div>` : ''}</div>
      <div class="kpi"><div class="kpi-k">Por cobrar</div><div class="kpi-v">${Shell.money(r.por_cobrar)}</div></div>
      <div class="kpi ${num(r.vencido) > 0 ? 'is-warning' : ''}"><div class="kpi-k">Vencido</div><div class="kpi-v">${Shell.money(r.vencido)}</div></div>
    </div>

    ${hayExceso ? `
    <div class="notice notice-warn">
      Hay factura(s) cobradas de más: se imputó más plata de la que facturaban. Revisá las marcadas
      <strong>cobrada de más</strong> y deshacé la imputación sobrante desde el cobro correspondiente.
    </div>` : ''}

    <div class="panel">
      <div class="panel-body flush">
        <div class="table-wrap">
          <table class="t ec-tabla">
            <thead><tr>
              <th>Factura</th><th>Fecha</th><th>Vence</th>
              <th class="num">Total</th><th class="num">Cobrado</th><th class="num">Saldo</th>
              <th>Estado</th><th>Pagos</th>
            </tr></thead>
            <tbody id="ecCuerpo"></tbody>
            ${facturas.length ? `
            <tfoot><tr class="ec-total">
              <td colspan="3">Totales</td>
              <td class="num">${Shell.money(r.facturado)}</td>
              <td class="num">${Shell.money(r.cobrado)}</td>
              <td class="num">${Shell.money(r.por_cobrar)}</td>
              <td colspan="2"></td>
            </tr></tfoot>` : ''}
          </table>
        </div>
      </div>
    </div>

    ${num(a_cuenta) > 0 ? `<div class="muted" style="font-size:13px">Cobros a cuenta sin imputar a ninguna factura: <strong>${Shell.money(a_cuenta)}</strong></div>` : ''}
    <div class="muted" style="font-size:12px">
      Ordenado por urgencia: primero lo vencido. Tocá "pagos" para ver qué cobro se aplicó a cada factura y por cuánto.
    </div>`;

  pintarFilasEstadoCuenta();
}

function pintarFilasEstadoCuenta() {
  const { facturas } = ec.datos;
  const cuerpo = $('ecCuerpo');
  if (!facturas.length) {
    cuerpo.innerHTML = `<tr><td colspan="8">${Shell.vacio('Sin facturas', 'No hay facturas para este filtro.')}</td></tr>`;
    return;
  }

  cuerpo.innerHTML = facturas.map(f => {
    const nPagos = f.pagos.length;
    const nHijos = nPagos + f.notas_credito_detalle.length;
    const abierta = ec.abiertas.has(f.id);
    const gestion = num(f.en_gestion) > 0.005
      ? `<div class="ec-gestion">+${Shell.money(f.en_gestion)} en gestión</div>` : '';

    let html = `
      <tr class="ec-fila${abierta ? ' abierta' : ''}">
        <td><a href="#" class="ec-link" data-pdf="api/facturas/${f.id}/pdf" title="Ver el PDF de la factura"><strong>${esc(f.numero_factura)}</strong></a>
            <span class="muted">${esc(f.tipo_factura || '')}</span></td>
        <td data-label="Fecha">${Shell.fecha(f.fecha)}</td>
        <td data-label="Vence">${Shell.fecha(f.fecha_vencimiento)} ${num(f.saldo) > 0.005 ? textoAtraso(f.dias_atraso) : ''}</td>
        <td class="num" data-label="Total">${Shell.money(f.total)}</td>
        <td class="num" data-label="Cobrado">${Shell.money(f.cobrado)}${gestion}</td>
        <td class="num" data-label="Saldo"><strong>${Shell.money(f.saldo)}</strong></td>
        <td data-label="Estado">${Shell.pill(f.estado)}</td>
        <td data-label="Pagos">${nHijos
          ? `<button type="button" class="ec-toggle" data-ec-toggle="${f.id}" aria-expanded="${abierta}">
               <span class="ec-flecha">${abierta ? '▼' : '▶'}</span> ${nPagos ? nPagos + (nPagos === 1 ? ' pago' : ' pagos') : 'NC'}${nPagos && nHijos > nPagos ? ' + NC' : ''}</button>`
          : '<span class="muted">—</span>'}</td>
      </tr>`;

    if (abierta) {
      f.pagos.forEach(p => {
        const forma = [p.numero_recibo ? 'Recibo ' + esc(p.numero_recibo) : null, esc(p.formas)].filter(Boolean).join(' · ');
        html += `
      <tr class="ec-hijo">
        <td><a href="#" class="ec-link" data-pdf="api/cobros/${p.pago_id}/pdf" title="Ver el recibo del cobro">Cobro #${p.pago_id}</a></td>
        <td data-label="Fecha">${Shell.fecha(p.fecha_recepcion)}</td>
        <td colspan="2" class="muted">${forma}</td>
        <td class="num" data-label="Aplicado">${Shell.money(p.monto_aplicado)}</td>
        <td></td>
        <td data-label="Estado">${Shell.pill(p.estado_forma)}</td>
        <td></td>
      </tr>`;
      });
      f.notas_credito_detalle.forEach(n => {
        html += `
      <tr class="ec-hijo">
        <td>NC ${esc(n.numero_nota)}</td>
        <td data-label="Fecha">${Shell.fecha(n.fecha)}</td>
        <td class="muted">Nota de crédito</td>
        <td class="num" data-label="Monto">−${Shell.money(n.total)}</td>
        <td colspan="4"></td>
      </tr>`;
      });
    }
    return html;
  }).join('');
}

function exportarEstadoCuentaCSV() {
  if (!ec.datos || !ec.datos.facturas.length) {
    Shell.toast('err', 'No hay datos para exportar');
    return;
  }
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = [['Factura', 'Fecha', 'Vence', 'Total', 'Cobrado', 'En gestión', 'Saldo', 'Estado',
    'Cobro', 'Fecha cobro', 'Monto aplicado', 'Forma de pago']];

  ec.datos.facturas.forEach(f => {
    const base = [q(f.numero_factura), f.fecha, f.fecha_vencimiento, f.total, f.cobrado, f.en_gestion, f.saldo, f.estado];
    if (!f.pagos.length) filas.push([...base, '', '', '', '']);
    f.pagos.forEach(p => filas.push([...base, `#${p.pago_id}`, p.fecha_recepcion, p.monto_aplicado,
      q([p.formas, p.estado_forma].filter(Boolean).join(' · '))]));
  });

  const csv = 'data:text/csv;charset=utf-8,' + filas.map(f => f.join(',')).join('\n');
  const link = document.createElement('a');
  link.href = encodeURI(csv);
  link.download = `estado-cuenta-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  Shell.toast('ok', 'Estado de cuenta exportado');
}

async function verEstadoCuentaPdf() {
  try {
    const p = paramsEstadoCuenta();
    if (!$('ecDetalle').checked) p.set('detalle', 'false');
    await verArchivoProtegido(`api/cobros/clientes/${ec.clienteId}/estado-cuenta/pdf?${p}`);
  } catch (err) {
    Shell.error(err, 'No se pudo abrir el PDF');
  }
}

// Un solo manejador para todo lo que se pinta dentro del panel lateral.
function clicEnDrawer(e) {
  const tab = e.target.closest('[data-dtab]');
  if (tab) {
    document.querySelectorAll('#drawerCuerpo .dtab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('#drawerCuerpo .dpane').forEach(p =>
      p.classList.toggle('active', p.id === 'dpane-' + tab.dataset.dtab));
    return;
  }
  const toggle = e.target.closest('[data-ec-toggle]');
  if (toggle) {
    const id = Number(toggle.dataset.ecToggle);
    if (ec.abiertas.has(id)) ec.abiertas.delete(id); else ec.abiertas.add(id);
    pintarFilasEstadoCuenta();
    return;
  }
  const pdf = e.target.closest('[data-pdf]');
  if (pdf) {
    e.preventDefault();
    verArchivoProtegido(pdf.dataset.pdf).catch(err => Shell.error(err, 'No se pudo abrir el PDF'));
    return;
  }
  if (e.target.closest('#ecCsv')) return exportarEstadoCuentaCSV();
  if (e.target.closest('#ecPdf')) return verEstadoCuentaPdf();
  if (e.target.closest('#ecLimpiar')) {
    $('ecDesde').value = ''; $('ecHasta').value = ''; $('ecSoloPend').checked = false;
    cargarEstadoCuenta();
  }
}


function chipEstadoFactura(e) {
  return Shell.pill(e);
}

function abrirDrawer() {
  $('drawer').classList.add('open');
  $('drawerBg').classList.add('open');
}
function cerrarDrawer() {
  $('drawer').classList.remove('open');
  $('drawerBg').classList.remove('open');
}

function cobrarA(clienteId) {
  cerrarDrawer();
  const boton = document.querySelector('.tab[data-tab="cobrar"]');
  mostrarTab('cobrar', boton);
  $('cobroCliente').value = clienteId;
  onCambiaClienteCobro();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------- registrar cobro ---------------------- */

async function onCambiaClienteCobro() {
  const clienteId = $('cobroCliente').value;
  estado.imputaciones = {};

  if (!clienteId) {
    estado.facturas = [];
    $('cobroResumenCliente').innerHTML = '';
    pintarFacturasCobro();
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
        Debe <strong>${Shell.money(t.saldo)}</strong> en ${facturas.length} factura(s).
        ${num(t.vencido) > 0 ? `De eso, <strong>${Shell.money(t.vencido)}</strong> está vencido (hasta ${t.dias_atraso_max} días).` : 'Nada vencido todavía.'}
        ${num(t.en_gestion) > 0 ? ` Hay <strong>${Shell.money(t.en_gestion)}</strong> en cheques sin acreditar.` : ''}
        ${num(t.saldo_a_favor) > 0 ? ` Tiene <strong>${Shell.money(t.saldo_a_favor)}</strong> a favor sin imputar.` : ''}
        ${num(t.exceso_cobrado) > 0 ? ` Además hay <strong>${Shell.money(t.exceso_cobrado)}</strong> cobrado de más en facturas ya saldadas.` : ''}
      </div>`;

    pintarFacturasCobro();
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar las facturas del cliente');
  }
}

function pintarFacturasCobro() {
  const tbody = $('tablaFacturasCobro');

  if (!estado.facturas.length) {
    tbody.innerHTML = `<tr><td colspan="8">${
      $('cobroCliente').value ? 'Este cliente no tiene facturas pendientes. El cobro va a quedar a cuenta.'
                              : 'Elegí un cliente para ver sus facturas pendientes'}</td></tr>`;
    recalcularTotales();
    return;
  }

  tbody.innerHTML = estado.facturas.map(f => {
    const disponible = num(f.saldo) - num(f.en_gestion);
    const imputado = estado.imputaciones[f.id] || 0;
    return `
    <tr>
      <td><input type="checkbox" ${imputado ? 'checked' : ''} ${disponible <= 0 ? 'disabled' : ''}
                 onchange="toggleFactura(${f.id}, this.checked)"></td>
      <td data-label="Factura"><strong>${f.numero_factura}</strong> <span class="muted">${f.tipo_factura || ''}</span></td>
      <td data-label="Vencimiento">${Shell.fecha(f.fecha_vencimiento)} ${textoAtraso(f.dias_atraso)}</td>
      <td class="num" data-label="Total">${Shell.money(f.total)}</td>
      <td class="num" data-label="Saldo"><strong>${Shell.money(f.saldo)}</strong></td>
      <td class="num muted" data-label="En gestión">${num(f.en_gestion) ? Shell.money(f.en_gestion) : '—'}</td>
      <td data-label="Estado">${chipEstadoFactura(f.estado)}</td>
      <td class="num" data-label="A imputar">
        <input class="input" type="number" step="0.01" min="0" max="${disponible}"
               style="width:150px; text-align:right"
               value="${imputado ? imputado.toFixed(2) : ''}"
               ${disponible <= 0 ? 'disabled' : ''}
               oninput="cambiarImputacion(${f.id}, this.value)">
      </td>
    </tr>`;
  }).join('');

  recalcularTotales();
}

function toggleFactura(facturaId, marcado) {
  const f = estado.facturas.find(x => x.id === facturaId);
  if (!f) return;
  if (marcado) {
    const disponible = num(f.saldo) - num(f.en_gestion);
    const restante = totalCobro() - totalImputado();
    estado.imputaciones[facturaId] = Math.max(0, Math.min(disponible, restante > 0 ? restante : disponible));
  } else {
    delete estado.imputaciones[facturaId];
  }
  pintarFacturasCobro();
}

function cambiarImputacion(facturaId, valor) {
  const v = parseFloat(valor);
  if (!v || v <= 0) delete estado.imputaciones[facturaId];
  else estado.imputaciones[facturaId] = v;
  recalcularTotales();
}

function limpiarImputacion() {
  estado.imputaciones = {};
  pintarFacturasCobro();
}

/* Reparte el total del cobro sobre las facturas más viejas primero. */
function imputarAutomatico() {
  const total = totalCobro();
  if (total <= 0) { Shell.toast('warn', 'Cargá primero las formas de cobro y sus montos.'); return; }

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

  pintarFacturasCobro();
  if (restante > 0) {
    Shell.toast('ok', `Quedan ${Shell.money(restante / 100)} sin imputar: se van a registrar a cuenta del cliente.`);
  }
}

/* ---- formas de cobro ---- */

function agregarForma() {
  const i = estado.seqForma++;
  estado.formas.push(i);

  const div = document.createElement('div');
  div.className = 'forma';
  div.id = `forma-${i}`;
  div.innerHTML = `
    <select class="select" id="f-tipo-${i}" onchange="pintarDetalleForma(${i})">
      <option value="EFECTIVO">Efectivo</option>
      <option value="TRANSFERENCIA">Transferencia</option>
      <option value="CHEQUE">Cheque</option>
      <option value="RETENCION">Retención</option>
    </select>
    <input class="input" type="number" id="f-monto-${i}" step="0.01" min="0" placeholder="Monto" oninput="recalcularTotales()">
    <div class="detalle" id="f-detalle-${i}"></div>
    <button type="button" class="forma-quitar" onclick="quitarForma(${i})">×</button>`;

  $('formasCobro').appendChild(div);
  pintarDetalleForma(i);
}

function pintarDetalleForma(i) {
  const tipo = $(`f-tipo-${i}`).value;
  const cont = $(`f-detalle-${i}`);

  if (tipo === 'CHEQUE') {
    cont.innerHTML = `
      <label class="campo"><span>N° de cheque *</span><input class="input" type="text" id="f-ch-num-${i}"></label>
      <label class="campo"><span>Banco *</span><input class="input" type="text" id="f-ch-banco-${i}"></label>
      <label class="campo"><span>Emisión</span><input class="input" type="date" id="f-ch-emision-${i}"></label>
      <label class="campo"><span>Se cobra el *</span><input class="input" type="date" id="f-ch-cobro-${i}"></label>`;
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

  $('avisoCheques').hidden =
    !estado.formas.some(j => $(`f-tipo-${j}`) && $(`f-tipo-${j}`).value === 'CHEQUE');
}

function quitarForma(i) {
  estado.formas = estado.formas.filter(x => x !== i);
  $(`forma-${i}`).remove();
  recalcularTotales();
  $('avisoCheques').hidden =
    !estado.formas.some(j => $(`f-tipo-${j}`) && $(`f-tipo-${j}`).value === 'CHEQUE');
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

async function guardarCobro() {
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

    if (total - imputado > 0.005 && estado.facturas.length && aplicaciones.length === 0) {
      const seguir = confirm(
        `El cliente tiene facturas pendientes y no imputaste nada.\n` +
        `El cobro de ${Shell.money(total)} va a quedar a cuenta. ¿Seguimos?`);
      if (!seguir) return;
    }

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
    resetFormularioCobro();
    await cargarTodo();
  } catch (err) {
    Shell.error(err, 'No se pudo registrar el cobro');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Registrar cobro';
  }
}

function resetFormularioCobro() {
  estado.formas = [];
  estado.imputaciones = {};
  estado.facturas = [];
  $('formasCobro').innerHTML = '';
  $('cobroCliente').value = '';
  $('cobroObs').value = '';
  $('cobroFecha').value = new Date().toISOString().slice(0, 10);
  $('cobroResumenCliente').innerHTML = '';
  $('avisoCheques').hidden = true;
  pintarFacturasCobro();
}

/* ---------------------- cheques ---------------------- */

async function cargarCheques() {
  const params = new URLSearchParams();
  if ($('filtroChequeEstado').value) params.set('estado', $('filtroChequeEstado').value);
  if ($('filtroChequeCliente').value) params.set('cliente_id', $('filtroChequeCliente').value);

  const tbody = $('tablaCheques');
  try {
    const cheques = await apiFetch(`${API}/cheques?${params}`);

    if (!cheques.length) {
      tbody.innerHTML = '<tr><td colspan="8">' + Shell.vacio(
        'No hay cheques con ese filtro',
        'Los cheques aparecen acá cuando registrás un cobro con forma de pago "cheque".'
      ) + '</td></tr>';
      return;
    }

    tbody.innerHTML = cheques.map(c => `
      <tr>
        <td><strong>${c.cheque_numero || 's/n'}</strong>${c.endosado ? `<div class="muted" style="font-size:11px">endosado a ${c.endosado_a || '—'}</div>` : ''}</td>
        <td data-label="Banco">${c.cheque_banco || '—'}</td>
        <td data-label="Cliente">${c.cliente_nombre}</td>
        <td class="num" data-label="Monto"><strong>${Shell.money(c.monto)}</strong></td>
        <td data-label="Se cobra">${Shell.fecha(c.cheque_fecha_cobro)}<div class="muted" style="font-size:11px">${textoVencimientoCheque(c)}</div></td>
        <td class="muted" data-label="Imputado a">${c.facturas || 'sin imputar'}</td>
        <td data-label="Estado">${Shell.pill(c.estado)}</td>
        <td data-label="Acciones">${accionesCheque(c)}</td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los cheques');
    tbody.innerHTML = '<tr><td colspan="8">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

function textoVencimientoCheque(c) {
  if (c.estado === 'ACREDITADO' || c.estado === 'RECHAZADO') return '';
  const d = Number(c.dias_para_cobro);
  if (isNaN(d)) return '';
  if (d < 0) return `vencido hace ${Math.abs(d)} días`;
  if (d === 0) return 'se cobra hoy';
  return `faltan ${d} días`;
}

function accionesCheque(c) {
  const b = [];
  if (c.estado === 'EN_CARTERA') {
    b.push(`<button class="b b-ghost b-sm" onclick="accionCheque(${c.id},'depositar')">Depositar</button>`);
    b.push(`<button class="b b-ghost b-sm" onclick="accionCheque(${c.id},'acreditar')">Acreditar</button>`);
  }
  if (c.estado === 'DEPOSITADO') {
    b.push(`<button class="b b-ghost b-sm" onclick="accionCheque(${c.id},'acreditar')">Acreditar</button>`);
  }
  if (['EN_CARTERA', 'DEPOSITADO', 'ACREDITADO'].includes(c.estado)) {
    b.push(`<button class="b b-danger b-sm" onclick="accionCheque(${c.id},'rechazar')">Rechazar</button>`);
  }
  return b.join(' ') || '<span class="muted">—</span>';
}

async function accionCheque(id, accion) {
  const cuerpo = {};

  if (accion === 'rechazar') {
    const motivo = prompt('Motivo del rechazo:', 'Sin fondos');
    if (motivo === null) return;
    cuerpo.motivo = motivo;
    const gasto = prompt('Gastos o comisión que nos cobró el banco (0 si no hubo):', '0');
    if (gasto === null) return;
    cuerpo.gasto_comision = parseFloat(gasto) || 0;
    if (!confirm('Al rechazar el cheque, la deuda que cancelaba vuelve a quedar abierta. ¿Confirmás?')) return;
  }

  try {
    const r = await apiFetch(`${API}/cheques/${id}/${accion}`, {
      method: 'POST', body: JSON.stringify(cuerpo)
    });
    Shell.toast('ok', `Cheque ${r.estado.toLowerCase().replace('_', ' ')}.`);
    await Promise.all([cargarCheques(), cargarTodo()]);
  } catch (err) {
    Shell.error(err, 'No se pudo actualizar el cheque');
  }
}

/* ---------------------- historial de cobros ---------------------- */

function paramsHistorial() {
  const params = new URLSearchParams();
  if ($('filtroHistCliente').value) params.set('cliente_id', $('filtroHistCliente').value);
  if ($('filtroHistDesde').value) params.set('desde', $('filtroHistDesde').value);
  if ($('filtroHistHasta').value) params.set('hasta', $('filtroHistHasta').value);
  if ($('filtroHistEstado').value) params.set('estado', $('filtroHistEstado').value);
  return params;
}

async function cargarHistorial() {
  const params = paramsHistorial();

  const tbody = $('tablaHistorial');
  try {
    const cobros = await apiFetch(`${API}?${params}`);
    estado.historial = cobros || [];

    if (!cobros.length) {
      tbody.innerHTML = '<tr><td colspan="10">' + Shell.vacio('No hay cobros con ese filtro', '') + '</td></tr>';
      return;
    }

    tbody.innerHTML = cobros.map(p => `
      <tr>
        <td>${p.id}</td>
        <td data-label="Fecha">${Shell.fecha(p.fecha_recepcion)}</td>
        <td data-label="Cliente">${p.cliente_nombre || '—'}</td>
        <td class="muted" data-label="Formas">${(p.formas || '').replace(/_/g, ' ').toLowerCase()}</td>
        <td class="num" data-label="Monto"><strong>${Shell.money(p.monto_total)}</strong></td>
        <td class="num" data-label="Imputado">${Shell.money(p.imputado)}</td>
        <td class="num ${num(p.disponible) > 0 ? 'pos' : 'muted'}" data-label="Sin imputar">${Shell.money(p.disponible)}</td>
        <td data-label="Recibo">${p.numero_recibo || '<span class="muted">—</span>'}</td>
        <td data-label="Estado">${Shell.pill(p.estado)}
            ${p.tiene_rechazo ? Shell.pill('RECHAZADO') : ''}</td>
        <td data-label="Acciones">
          <button class="b b-ghost b-sm" onclick="verCobroPdf(${p.id})">PDF</button>
          ${num(p.disponible) > 0 && !p.anulado ? `<button class="b b-ghost b-sm" onclick="imputarPendiente(${p.id})">Imputar</button>` : ''}
          ${!p.anulado && !p.recibo_id ? `<button class="b b-danger b-sm" onclick="anularCobro(${p.id})">Anular</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudo cargar el historial de cobros');
    tbody.innerHTML = '<tr><td colspan="10">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

// Exportar el historial ya filtrado (mismo patrón que stock.js:exportarMovimientosCSV)
function exportarHistorialCSV() {
  if (!estado.historial.length) {
    Shell.toast('err', 'No hay datos para exportar');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,';
  const headers = ['Fecha', 'Cliente', 'Formas', 'Monto', 'Imputado', 'Sin imputar', 'Recibo', 'Estado'];
  csvContent += headers.join(',') + '\n';

  estado.historial.forEach(p => {
    const fila = [
      p.fecha_recepcion || '',
      `"${(p.cliente_nombre || '').replace(/"/g, '""')}"`,
      `"${(p.formas || '').replace(/_/g, ' ').toLowerCase().replace(/"/g, '""')}"`,
      p.monto_total ?? 0,
      p.imputado ?? 0,
      p.disponible ?? 0,
      p.numero_recibo || '',
      p.estado || ''
    ];
    csvContent += fila.join(',') + '\n';
  });

  const desde = $('filtroHistDesde').value;
  const hasta = $('filtroHistHasta').value;
  const rango = (desde || hasta) ? `${desde || 'inicio'}_a_${hasta || 'hoy'}` : new Date().toISOString().slice(0, 10);

  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `cobros-${rango}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  Shell.toast('ok', 'Reporte exportado');
}

// Previsualizar/descargar el informe (mismos filtros aplicados) en PDF
async function verHistorialPdf() {
  try {
    const params = paramsHistorial();
    await verArchivoProtegido(`api/cobros/reporte/pdf?${params}`);
  } catch (err) {
    Shell.error(err, 'No se pudo abrir el PDF');
  }
}

async function verCobroPdf(pagoId) {
  try {
    await verArchivoProtegido(`api/cobros/${pagoId}/pdf`);
  } catch (err) {
    Shell.error(err, 'No se pudo abrir el PDF');
  }
}

async function imputarPendiente(pagoId) {
  if (!confirm('Se va a imputar lo que queda del cobro a las facturas más viejas del cliente. ¿Seguimos?')) return;
  try {
    const r = await apiFetch(`${API}/${pagoId}/imputar`, { method: 'POST', body: JSON.stringify({}) });
    Shell.toast('ok', r.message);
    await Promise.all([cargarHistorial(), cargarTodo()]);
  } catch (err) {
    Shell.error(err, 'No se pudo imputar el cobro');
  }
}

async function anularCobro(pagoId) {
  const motivo = prompt('¿Por qué se anula este cobro?');
  if (motivo === null) return;
  try {
    const r = await apiFetch(`${API}/${pagoId}/anular`, {
      method: 'POST', body: JSON.stringify({ motivo })
    });
    Shell.toast('ok', r.message);
    await Promise.all([cargarHistorial(), cargarTodo()]);
  } catch (err) {
    Shell.error(err, 'No se pudo anular el cobro');
  }
}

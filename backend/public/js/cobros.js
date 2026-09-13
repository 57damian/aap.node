/* =====================================================================
 * Pantalla de Cobros y deuda de clientes
 * Reemplaza a js/pagos.js, que llamaba a /api/pagos/... — un prefijo que
 * nunca estuvo montado en index.js, así que la pantalla anterior devolvía
 * 404 en todas sus operaciones.
 * ===================================================================== */

const API = '/api/cobros';

const estado = {
  clientes: [],
  deuda: [],
  formas: [],          // formas de cobro cargadas en el formulario
  facturas: [],        // facturas pendientes del cliente elegido
  imputaciones: {},    // { factura_id: monto }
  seqForma: 0
};

/* ---------------------- utilidades ---------------------- */

const fmtMoneda = new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', minimumFractionDigits: 2
});
const $ = (id) => document.getElementById(id);
const plata = (v) => fmtMoneda.format(Number(v) || 0);
const num = (v) => Number(v) || 0;

function fecha(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function chip(texto, clase) {
  return `<span class="chip chip-${clase}">${texto}</span>`;
}

function textoAtraso(dias) {
  if (dias === null || dias === undefined) return '—';
  const d = Number(dias);
  if (d > 0) return `<span class="rojo fuerte">${d} d</span>`;
  if (d === 0) return '<span class="rojo">vence hoy</span>';
  return `<span class="gris">en ${Math.abs(d)} d</span>`;
}

function aviso(mensaje, tipo = 'ok') {
  const caja = $('flash');
  caja.className = `aviso aviso-${tipo}`;
  caja.innerHTML = mensaje;
  caja.style.display = 'block';
  clearTimeout(aviso._t);
  aviso._t = setTimeout(() => { caja.style.display = 'none'; }, 6000);
}

function errorDe(err) {
  if (!err) return 'Error desconocido';
  if (typeof err === 'string') return err;
  return err.error || err.message || 'Error desconocido';
}

function cerrarSesion() {
  localStorage.clear();
  location.href = 'login.html';
}

/* ---------------------- arranque ---------------------- */

document.addEventListener('DOMContentLoaded', async () => {
  $('cobroFecha').value = hoy();

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => mostrarTab(t.dataset.tab, t));
  });

  $('buscarCliente').addEventListener('input', debounce(cargarDeuda, 350));
  $('soloVencido').addEventListener('change', cargarDeuda);
  $('ordenDeuda').addEventListener('change', cargarDeuda);
  $('cobroCliente').addEventListener('change', onCambiaClienteCobro);

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
    aviso('No se pudieron cargar los clientes: ' + errorDe(err), 'err');
  }
}

/* ---------------------- panel de situación ---------------------- */

async function cargarResumen() {
  try {
    const r = await apiFetch(`${API}/resumen`);
    const d = r.deuda, ch = r.cheques_en_cartera;

    $('kpis').innerHTML = `
      <div class="kpi total">
        <div class="kpi-label">Deuda total</div>
        <div class="kpi-value">${plata(d.deuda_total)}</div>
        <div class="kpi-sub">${d.facturas_con_saldo} facturas · ${d.clientes_con_deuda} clientes</div>
      </div>
      <div class="kpi vencido">
        <div class="kpi-label">Vencido</div>
        <div class="kpi-value">${plata(d.vencido)}</div>
        <div class="kpi-sub">${porcentaje(d.vencido, d.deuda_total)} de la deuda</div>
      </div>
      <div class="kpi porvencer">
        <div class="kpi-label">Por vencer</div>
        <div class="kpi-value">${plata(d.por_vencer)}</div>
        <div class="kpi-sub">todavía en plazo</div>
      </div>
      <div class="kpi gestion">
        <div class="kpi-label">En gestión (cheques)</div>
        <div class="kpi-value">${plata(d.en_gestion)}</div>
        <div class="kpi-sub">${ch.cantidad} cheques · ${ch.vencen_7_dias} se cobran en 7 días</div>
      </div>
      <div class="kpi afavor">
        <div class="kpi-label">Saldo a favor</div>
        <div class="kpi-value">${plata(num(r.saldo_a_favor) + num(d.exceso_cobrado))}</div>
        <div class="kpi-sub">${plata(r.saldo_a_favor)} sin imputar${
          num(d.exceso_cobrado) > 0 ? ` · ${plata(d.exceso_cobrado)} cobrado de más` : ''}</div>
      </div>`;

    $('aging').innerHTML = `
      <div class="b0"><div class="t">Por vencer</div><div class="v">${plata(d.por_vencer)}</div></div>
      <div class="b1"><div class="t">1 a 30 días</div><div class="v">${plata(d.atraso_1_30)}</div></div>
      <div class="b2"><div class="t">31 a 60 días</div><div class="v">${plata(d.atraso_31_60)}</div></div>
      <div class="b3"><div class="t">61 a 90 días</div><div class="v">${plata(d.atraso_61_90)}</div></div>
      <div class="b4"><div class="t">Más de 90 días</div><div class="v">${plata(d.atraso_90_mas)}</div></div>`;

    if (num(ch.vencidos_sin_depositar) > 0) {
      aviso(`Hay ${ch.vencidos_sin_depositar} cheque(s) con fecha de cobro pasada sin depositar.`, 'warn');
    }
  } catch (err) {
    aviso('No se pudo cargar el resumen: ' + errorDe(err), 'err');
  }
}

function porcentaje(parte, total) {
  const t = num(total);
  if (!t) return '0%';
  return Math.round((num(parte) / t) * 100) + '%';
}

/* ---------------------- quién nos debe ---------------------- */

async function cargarDeuda() {
  const params = new URLSearchParams({ orden: $('ordenDeuda').value });
  if ($('buscarCliente').value.trim()) params.set('buscar', $('buscarCliente').value.trim());
  if ($('soloVencido').checked) params.set('solo_vencido', 'true');

  try {
    estado.deuda = await apiFetch(`${API}/deuda?${params}`);
    const tbody = $('tablaDeuda');

    if (!estado.deuda.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="vacio">No hay clientes con saldo pendiente.</td></tr>';
      return;
    }

    tbody.innerHTML = estado.deuda.map(c => `
      <tr class="clickable" onclick="verCliente(${c.cliente_id})">
        <td>
          <div class="fuerte">${c.cliente_nombre}</div>
          <div class="gris" style="font-size:.78rem">${c.cuit || 'sin CUIT'}${c.dias_max_pago ? ' · plazo ' + c.dias_max_pago + ' d' : ''}</div>
        </td>
        <td class="num">${c.facturas_pendientes}</td>
        <td class="num fuerte">${plata(c.saldo)}</td>
        <td class="num ${num(c.vencido) > 0 ? 'rojo fuerte' : 'gris'}">${plata(c.vencido)}</td>
        <td class="num gris">${plata(c.por_vencer)}</td>
        <td class="num">${num(c.en_gestion) > 0 ? plata(c.en_gestion) : '<span class="gris">—</span>'}</td>
        <td class="num">${textoAtraso(c.dias_atraso_max)}</td>
        <td class="num ${num(c.saldo_a_favor) + num(c.exceso_cobrado) > 0 ? 'verde' : 'gris'}">
          ${num(c.saldo_a_favor) + num(c.exceso_cobrado) > 0
              ? plata(num(c.saldo_a_favor) + num(c.exceso_cobrado)) : '—'}
          ${num(c.exceso_cobrado) > 0
              ? `<div class="gris" style="font-size:.72rem">incluye ${plata(c.exceso_cobrado)} cobrado de más</div>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    $('tablaDeuda').innerHTML = `<tr><td colspan="8" class="vacio rojo">${errorDe(err)}</td></tr>`;
  }
}

/* ---------------------- ficha del cliente (panel lateral) ---------------------- */

async function verCliente(clienteId) {
  abrirDrawer();
  $('drawerTitulo').textContent = 'Cargando...';
  $('drawerCuerpo').innerHTML = '';

  try {
    const [ficha, cc] = await Promise.all([
      apiFetch(`${API}/clientes/${clienteId}?solo_pendientes=false`),
      apiFetch(`${API}/clientes/${clienteId}/cuenta-corriente`)
    ]);

    const t = ficha.totales;
    $('drawerTitulo').textContent = ficha.cliente.nombre;
    $('drawerMeta').innerHTML = [
      ficha.cliente.cuit, ficha.cliente.telefono, ficha.cliente.correo,
      ficha.cliente.dias_max_pago ? `plazo ${ficha.cliente.dias_max_pago} días` : null
    ].filter(Boolean).join(' · ');

    $('drawerCuerpo').innerHTML = `
      <div class="kpis">
        <div class="kpi total"><div class="kpi-label">Saldo</div><div class="kpi-value">${plata(t.saldo)}</div></div>
        <div class="kpi vencido"><div class="kpi-label">Vencido</div><div class="kpi-value">${plata(t.vencido)}</div>
          <div class="kpi-sub">${t.dias_atraso_max > 0 ? 'hasta ' + t.dias_atraso_max + ' días' : 'al día'}</div></div>
        <div class="kpi gestion"><div class="kpi-label">En gestión</div><div class="kpi-value">${plata(t.en_gestion)}</div>
          <div class="kpi-sub">${ficha.cheques_en_cartera.length} cheque(s)</div></div>
        <div class="kpi afavor"><div class="kpi-label">A favor</div>
          <div class="kpi-value">${plata(num(t.saldo_a_favor) + num(t.exceso_cobrado))}</div>
          ${num(t.exceso_cobrado) > 0
            ? `<div class="kpi-sub">${plata(t.exceso_cobrado)} cobrado de más</div>` : ''}</div>
      </div>

      ${ficha.facturas.some(f => f.estado === 'SOBRE_COBRADA') ? `
      <div class="aviso aviso-warn">
        Hay factura(s) con saldo negativo: se imputó más plata de la que facturaban.
        Ese exceso se cuenta como saldo a favor del cliente. Revisá las marcadas
        <strong>cobrada de más</strong> y deshacé la imputación sobrante desde el cobro correspondiente.
      </div>` : ''}

      <div style="margin-bottom:var(--space-5)">
        <button class="btn btn-primary btn-sm" onclick="cobrarA(${clienteId})">Registrar un cobro de este cliente</button>
      </div>

      <div class="panel">
        <div class="panel-title">Facturas</div>
        <table class="data">
          <thead><tr>
            <th>Factura</th><th>Fecha</th><th>Vence</th>
            <th class="num">Total</th><th class="num">Cobrado</th><th class="num">Saldo</th><th>Estado</th>
          </tr></thead>
          <tbody>${ficha.facturas.map(f => `
            <tr>
              <td class="fuerte">${f.numero_factura} <span class="gris">${f.tipo_factura || ''}</span></td>
              <td>${fecha(f.fecha)}</td>
              <td>${fecha(f.fecha_vencimiento)} ${num(f.saldo) > 0 ? textoAtraso(f.dias_atraso) : ''}</td>
              <td class="num">${plata(f.total)}</td>
              <td class="num">${plata(f.cobrado)}${num(f.en_gestion) > 0 ? `<div class="gris" style="font-size:.75rem">+${plata(f.en_gestion)} en gestión</div>` : ''}</td>
              <td class="num fuerte">${plata(f.saldo)}</td>
              <td>${chipEstadoFactura(f.estado)}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin facturas</td></tr>'}
          </tbody>
        </table>
      </div>

      ${ficha.cheques_en_cartera.length ? `
      <div class="panel">
        <div class="panel-title">Cheques de este cliente todavía no acreditados</div>
        <table class="data">
          <thead><tr><th>Cheque</th><th>Banco</th><th class="num">Monto</th><th>Se cobra</th><th>Estado</th></tr></thead>
          <tbody>${ficha.cheques_en_cartera.map(c => `
            <tr>
              <td>${c.cheque_numero}${c.endosado ? ' <span class="chip chip-gestion">endosado</span>' : ''}</td>
              <td>${c.cheque_banco || '—'}</td>
              <td class="num">${plata(c.monto)}</td>
              <td>${fecha(c.cheque_fecha_cobro)} ${textoAtraso(c.dias_para_cobro === null ? null : -c.dias_para_cobro)}</td>
              <td>${chip(c.estado.replace('_', ' '), c.estado.toLowerCase())}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <div class="panel">
        <div class="panel-title">Cuenta corriente</div>
        <table class="data">
          <thead><tr>
            <th>Fecha</th><th>Movimiento</th><th>Comprobante</th>
            <th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th>
          </tr></thead>
          <tbody>${cc.movimientos.map(m => {
            const informativo = num(m.debe) === 0 && num(m.haber) === 0;
            return `
            <tr${informativo ? ' class="gris"' : ''}>
              <td>${fecha(m.fecha)}</td>
              <td>${m.tipo.replace(/_/g, ' ')}${m.detalle ? `<div class="gris" style="font-size:.75rem">${m.detalle}</div>` : ''}</td>
              <td>${m.comprobante}</td>
              <td class="num">${num(m.debe) ? plata(m.debe) : (informativo ? `<span class="gris">(${plata(m.monto)})</span>` : '—')}</td>
              <td class="num">${num(m.haber) ? plata(m.haber) : '—'}</td>
              <td class="num fuerte">${plata(m.saldo_acumulado)}</td>
            </tr>`; }).join('') || '<tr><td colspan="6" class="vacio">Sin movimientos</td></tr>'}
          </tbody>
        </table>
        <div class="gris" style="font-size:.78rem;margin-top:var(--space-3)">
          Las filas en gris son informativas: un cheque no mueve el saldo hasta que se acredita.
        </div>
      </div>`;
  } catch (err) {
    $('drawerTitulo').textContent = 'Error';
    $('drawerCuerpo').innerHTML = `<div class="aviso aviso-err">${errorDe(err)}</div>`;
  }
}

function chipEstadoFactura(e) {
  const mapa = {
    SOBRE_COBRADA: ['Cobrada de más', 'sobre_cobrada'],
    COBRADA: ['Cobrada', 'cobrada'],
    EN_GESTION: ['En gestión', 'gestion'],
    VENCIDA: ['Vencida', 'vencida'],
    PARCIAL: ['Parcial', 'parcial'],
    PENDIENTE: ['Pendiente', 'pendiente']
  };
  const [txt, cls] = mapa[e] || [e, 'pendiente'];
  return chip(txt, cls);
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
      <div class="aviso ${num(t.vencido) > 0 ? 'aviso-warn' : 'aviso-info'}" style="margin-top:var(--space-4)">
        Debe <strong>${plata(t.saldo)}</strong> en ${facturas.length} factura(s).
        ${num(t.vencido) > 0 ? `De eso, <strong>${plata(t.vencido)}</strong> está vencido (hasta ${t.dias_atraso_max} días).` : 'Nada vencido todavía.'}
        ${num(t.en_gestion) > 0 ? ` Hay <strong>${plata(t.en_gestion)}</strong> en cheques sin acreditar.` : ''}
        ${num(t.saldo_a_favor) > 0 ? ` Tiene <strong>${plata(t.saldo_a_favor)}</strong> a favor sin imputar.` : ''}
        ${num(t.exceso_cobrado) > 0 ? ` Además hay <strong>${plata(t.exceso_cobrado)}</strong> cobrado de más en facturas ya saldadas.` : ''}
      </div>`;

    pintarFacturasCobro();
  } catch (err) {
    aviso('No se pudieron cargar las facturas: ' + errorDe(err), 'err');
  }
}

function pintarFacturasCobro() {
  const tbody = $('tablaFacturasCobro');

  if (!estado.facturas.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="vacio">${
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
      <td class="fuerte">${f.numero_factura} <span class="gris">${f.tipo_factura || ''}</span></td>
      <td>${fecha(f.fecha_vencimiento)} ${textoAtraso(f.dias_atraso)}</td>
      <td class="num">${plata(f.total)}</td>
      <td class="num fuerte">${plata(f.saldo)}</td>
      <td class="num gris">${num(f.en_gestion) ? plata(f.en_gestion) : '—'}</td>
      <td>${chipEstadoFactura(f.estado)}</td>
      <td class="num">
        <input type="number" step="0.01" min="0" max="${disponible}"
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
  if (total <= 0) { aviso('Cargá primero las formas de cobro y sus montos.', 'warn'); return; }

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
    aviso(`Quedan ${plata(restante / 100)} sin imputar: se van a registrar a cuenta del cliente.`, 'info');
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
    <select id="f-tipo-${i}" onchange="pintarDetalleForma(${i})">
      <option value="EFECTIVO">Efectivo</option>
      <option value="TRANSFERENCIA">Transferencia</option>
      <option value="CHEQUE">Cheque</option>
      <option value="RETENCION">Retención</option>
    </select>
    <input type="number" id="f-monto-${i}" step="0.01" min="0" placeholder="Monto" oninput="recalcularTotales()">
    <div class="detalle" id="f-detalle-${i}"></div>
    <button type="button" class="btn-x" onclick="quitarForma(${i})">×</button>`;

  $('formasCobro').appendChild(div);
  pintarDetalleForma(i);
}

function pintarDetalleForma(i) {
  const tipo = $(`f-tipo-${i}`).value;
  const cont = $(`f-detalle-${i}`);

  if (tipo === 'CHEQUE') {
    cont.innerHTML = `
      <label class="campo"><span>N° de cheque *</span><input type="text" id="f-ch-num-${i}"></label>
      <label class="campo"><span>Banco *</span><input type="text" id="f-ch-banco-${i}"></label>
      <label class="campo"><span>Emisión</span><input type="date" id="f-ch-emision-${i}"></label>
      <label class="campo"><span>Se cobra el *</span><input type="date" id="f-ch-cobro-${i}"></label>`;
  } else if (tipo === 'TRANSFERENCIA') {
    cont.innerHTML = `
      <label class="campo"><span>Banco origen</span><input type="text" id="f-tr-origen-${i}"></label>
      <label class="campo"><span>Banco destino</span><input type="text" id="f-tr-destino-${i}"></label>
      <label class="campo"><span>N° de operación</span><input type="text" id="f-tr-op-${i}"></label>
      <label class="campo"><span>Fecha</span><input type="date" id="f-tr-fecha-${i}"></label>`;
  } else if (tipo === 'RETENCION') {
    cont.innerHTML = `
      <label class="campo"><span>Impuesto *</span>
        <select id="f-re-tipo-${i}">
          <option value="IIBB">Ingresos Brutos</option>
          <option value="GANANCIAS">Ganancias</option>
          <option value="IVA">IVA</option>
          <option value="SUSS">SUSS</option>
        </select>
      </label>
      <label class="campo"><span>N° de certificado</span><input type="text" id="f-re-cert-${i}"></label>`;
  } else {
    cont.innerHTML = '<span class="gris" style="align-self:center">Sin datos adicionales</span>';
  }

  $('avisoCheques').style.display =
    estado.formas.some(j => $(`f-tipo-${j}`) && $(`f-tipo-${j}`).value === 'CHEQUE') ? 'block' : 'none';
}

function quitarForma(i) {
  estado.formas = estado.formas.filter(x => x !== i);
  $(`forma-${i}`).remove();
  recalcularTotales();
  $('avisoCheques').style.display =
    estado.formas.some(j => $(`f-tipo-${j}`) && $(`f-tipo-${j}`).value === 'CHEQUE') ? 'block' : 'none';
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

  $('totCobro').textContent = plata(total);
  $('totImputado').textContent = plata(imputado);
  $('totACuenta').textContent = plata(Math.max(aCuenta, 0));
  $('totACuenta').className = aCuenta < -0.005 ? 'rojo' : (aCuenta > 0.005 ? 'verde' : '');

  if (aCuenta < -0.005) {
    $('totACuenta').textContent = plata(aCuenta) + ' (imputás más de lo que cobrás)';
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
        `El cobro de ${plata(total)} va a quedar a cuenta. ¿Seguimos?`);
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

    aviso(`${r.message}. Cobro #${r.pago_id} por ${plata(r.monto_total)}.`, 'ok');
    resetFormularioCobro();
    await cargarTodo();
  } catch (err) {
    aviso(errorDe(err), 'err');
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
  $('cobroFecha').value = hoy();
  $('cobroResumenCliente').innerHTML = '';
  $('avisoCheques').style.display = 'none';
  pintarFacturasCobro();
}

/* ---------------------- cheques ---------------------- */

async function cargarCheques() {
  const params = new URLSearchParams();
  if ($('filtroChequeEstado').value) params.set('estado', $('filtroChequeEstado').value);
  if ($('filtroChequeCliente').value) params.set('cliente_id', $('filtroChequeCliente').value);

  try {
    const cheques = await apiFetch(`${API}/cheques?${params}`);
    const tbody = $('tablaCheques');

    if (!cheques.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="vacio">No hay cheques con ese filtro.</td></tr>';
      return;
    }

    tbody.innerHTML = cheques.map(c => `
      <tr>
        <td class="fuerte">${c.cheque_numero || 's/n'}${c.endosado ? `<div class="gris" style="font-size:.75rem">endosado a ${c.endosado_a || '—'}</div>` : ''}</td>
        <td>${c.cheque_banco || '—'}</td>
        <td>${c.cliente_nombre}</td>
        <td class="num fuerte">${plata(c.monto)}</td>
        <td>${fecha(c.cheque_fecha_cobro)}<div class="gris" style="font-size:.75rem">${textoVencimientoCheque(c)}</div></td>
        <td class="gris">${c.facturas || 'sin imputar'}</td>
        <td>${chip(c.estado.replace('_', ' '), c.estado.toLowerCase())}</td>
        <td>${accionesCheque(c)}</td>
      </tr>`).join('');
  } catch (err) {
    $('tablaCheques').innerHTML = `<tr><td colspan="8" class="vacio rojo">${errorDe(err)}</td></tr>`;
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
    b.push(`<button class="btn btn-info btn-sm" onclick="accionCheque(${c.id},'depositar')">Depositar</button>`);
    b.push(`<button class="btn btn-success btn-sm" onclick="accionCheque(${c.id},'acreditar')">Acreditar</button>`);
  }
  if (c.estado === 'DEPOSITADO') {
    b.push(`<button class="btn btn-success btn-sm" onclick="accionCheque(${c.id},'acreditar')">Acreditar</button>`);
  }
  if (['EN_CARTERA', 'DEPOSITADO', 'ACREDITADO'].includes(c.estado)) {
    b.push(`<button class="btn btn-danger btn-sm" onclick="accionCheque(${c.id},'rechazar')">Rechazar</button>`);
  }
  return b.join(' ') || '<span class="gris">—</span>';
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
    aviso(`Cheque ${r.estado.toLowerCase().replace('_', ' ')}.`, 'ok');
    await Promise.all([cargarCheques(), cargarTodo()]);
  } catch (err) {
    aviso(errorDe(err), 'err');
  }
}

/* ---------------------- historial de cobros ---------------------- */

async function cargarHistorial() {
  const params = new URLSearchParams();
  if ($('filtroHistCliente').value) params.set('cliente_id', $('filtroHistCliente').value);
  if ($('filtroHistDesde').value) params.set('desde', $('filtroHistDesde').value);
  if ($('filtroHistHasta').value) params.set('hasta', $('filtroHistHasta').value);
  if ($('filtroHistEstado').value) params.set('estado', $('filtroHistEstado').value);

  try {
    const cobros = await apiFetch(`${API}?${params}`);
    const tbody = $('tablaHistorial');

    if (!cobros.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="vacio">No hay cobros con ese filtro.</td></tr>';
      return;
    }

    tbody.innerHTML = cobros.map(p => `
      <tr>
        <td>${p.id}</td>
        <td>${fecha(p.fecha_recepcion)}</td>
        <td>${p.cliente_nombre || '—'}</td>
        <td class="gris">${(p.formas || '').replace(/_/g, ' ').toLowerCase()}</td>
        <td class="num fuerte">${plata(p.monto_total)}</td>
        <td class="num">${plata(p.imputado)}</td>
        <td class="num ${num(p.disponible) > 0 ? 'verde' : 'gris'}">${plata(p.disponible)}</td>
        <td>${p.numero_recibo || '<span class="gris">—</span>'}</td>
        <td>${chip(p.estado.replace('_', ' '), p.estado.toLowerCase())}
            ${p.tiene_rechazo ? chip('cheque rechazado', 'rechazado') : ''}</td>
        <td>
          ${num(p.disponible) > 0 && !p.anulado ? `<button class="btn btn-success btn-sm" onclick="imputarPendiente(${p.id})">Imputar</button>` : ''}
          ${!p.anulado && !p.recibo_id ? `<button class="btn btn-danger btn-sm" onclick="anularCobro(${p.id})">Anular</button>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    $('tablaHistorial').innerHTML = `<tr><td colspan="10" class="vacio rojo">${errorDe(err)}</td></tr>`;
  }
}

async function imputarPendiente(pagoId) {
  if (!confirm('Se va a imputar lo que queda del cobro a las facturas más viejas del cliente. ¿Seguimos?')) return;
  try {
    const r = await apiFetch(`${API}/${pagoId}/imputar`, { method: 'POST', body: JSON.stringify({}) });
    aviso(r.message, 'ok');
    await Promise.all([cargarHistorial(), cargarTodo()]);
  } catch (err) {
    aviso(errorDe(err), 'err');
  }
}

async function anularCobro(pagoId) {
  const motivo = prompt('¿Por qué se anula este cobro?');
  if (motivo === null) return;
  try {
    const r = await apiFetch(`${API}/${pagoId}/anular`, {
      method: 'POST', body: JSON.stringify({ motivo })
    });
    aviso(r.message, 'ok');
    await Promise.all([cargarHistorial(), cargarTodo()]);
  } catch (err) {
    aviso(errorDe(err), 'err');
  }
}

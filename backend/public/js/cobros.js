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
  seleccionadas: new Set(), // facturas tildadas (pueden tener 0 imputado si todavía no hay importes)
  imputacionManual: false,  // true cuando se edita un "A imputar" a mano: deja de seguir el total del cobro
  seqForma: 0,
  historial: [],       // último resultado de cargarHistorial(), para exportar
  // Cuentas por cobrar navegables
  vista: 'cliente',         // 'cliente' | 'factura'
  facturasPend: [],         // facturas con saldo de todos los clientes (con su origen)
  filtroKpi: null,          // clave de FILTROS_KPI o null
  clientesAbiertos: new Set(),
  facturasAbiertas: new Set(),
  detalles: new Map()       // factura_id → detalle completo (cobros, NC, origen), se pide al desplegar
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

  // La búsqueda filtra sobre lo ya cargado, en cada tecla (sin ir al servidor).
  $('buscarCliente').addEventListener('input', pintarPorCobrar);
  $('soloVencido').addEventListener('change', cargarDeuda);
  $('ordenDeuda').addEventListener('change', cargarDeuda);
  $('tab-deuda').addEventListener('click', clicEnPorCobrar);
  // Los filtros de Cheques e Historial se aplican al cambiarlos (el botón "Filtrar" sigue sirviendo).
  ['filtroChequeEstado', 'filtroChequeCliente'].forEach(id => $(id).addEventListener('change', cargarCheques));
  ['filtroHistCliente', 'filtroHistDesde', 'filtroHistHasta', 'filtroHistEstado']
    .forEach(id => $(id).addEventListener('change', cargarHistorial));
  $('tab-cheques').addEventListener('click', clicEnPdf);
  $('tab-historial').addEventListener('click', clicEnPdf);
  $('kpis').addEventListener('click', clicEnFiltroKpi);
  $('aging').addEventListener('click', clicEnFiltroKpi);
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
  $('btnConfirmarCancelar').addEventListener('click', () => $('confirmarModal').close());
  $('drawerCuerpo').addEventListener('change', (e) => {
    if (e.target.matches('#ecDesde, #ecHasta, #ecSoloPend')) cargarEstadoCuenta();
    // El orden se aplica sobre lo ya cargado: no hace falta ir al servidor.
    if (e.target.matches('#ecOrden') && ec.datos) {
      ec.orden = ORDENES_EC[e.target.value] ? e.target.value : 'urgencia';
      pintarEstadoCuenta();
    }
  });

  await cargarClientes();
  await cargarTodo();
  abrirDesdeLink();
});

/* Links desde otras pantallas: cobros.html?factura=ID abre esa factura en la
 * vista "Por factura"; cobros.html?cliente=ID abre el cliente en "Por cliente". */
async function abrirDesdeLink() {
  const p = new URLSearchParams(location.search);
  const facturaId = Number(p.get('factura'));
  const clienteId = Number(p.get('cliente'));

  if (facturaId) {
    const f = estado.facturasPend.find(x => x.id === facturaId);
    if (!f) {
      // Sin saldo (ya cobrada): se muestra su estado de cuenta en el panel lateral.
      try {
        const d = await apiFetch(`${API}/facturas/${facturaId}`);
        return verCliente(d.cliente_id);
      } catch (err) {
        return Shell.error(err, 'No se encontró la factura');
      }
    }
    estado.vista = 'factura';
    estado.clientesAbiertos.add(f.cliente_id);
    pintarPorCobrar();
    await alternarFactura(facturaId);
    const fila = document.querySelector(`[data-fx-toggle="${facturaId}"]`);
    if (fila) fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (clienteId) {
    estado.vista = 'cliente';
    estado.clientesAbiertos.add(clienteId);
    pintarPorCobrar();
    const fila = document.querySelector(`[data-cli-toggle="${clienteId}"]`);
    if (fila) fila.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

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
  estado.detalles.clear();   // un cobro nuevo o deshecho cambia el detalle de las facturas
  await Promise.all([cargarResumen(), cargarDeuda()]);
}

/* ---------------------- clientes ---------------------- */

async function cargarClientes() {
  try {
    estado.clientes = await apiFetch('/api/clientes');
    const opciones = estado.clientes
      .map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
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

    // Total, Vencido y En gestión son botones: un toque filtra la lista de facturas.
    $('kpis').innerHTML = `
      <button type="button" class="kpi is-danger" data-filtro="todas" title="Ver todas las facturas por cobrar">
        <div class="kpi-k">Total por cobrar</div>
        <div class="kpi-v">${Shell.money(d.deuda_total)}</div>
        <div class="kpi-sub">${d.facturas_con_saldo} facturas · ${d.clientes_con_deuda} clientes</div>
      </button>
      <button type="button" class="kpi is-warning" data-filtro="vencido" title="Ver solo las facturas vencidas">
        <div class="kpi-k">Vencido <span class="ayuda" data-ayuda="vencido" role="button" tabindex="0">?</span></div>
        <div class="kpi-v">${Shell.money(d.vencido)}</div>
        <div class="kpi-sub">${porcentaje(d.vencido, d.deuda_total)} del total por cobrar</div>
      </button>
      <button type="button" class="kpi is-info" data-filtro="en_gestion" title="Ver solo las facturas con cheques sin acreditar">
        <div class="kpi-k">En gestión <span class="ayuda" data-ayuda="en_gestion" role="button" tabindex="0">?</span></div>
        <div class="kpi-v">${Shell.money(d.en_gestion)}</div>
        <div class="kpi-sub">${ch.cantidad} cheques · ${ch.vencen_7_dias} se cobran en 7 días</div>
      </button>
      <div class="kpi is-success">
        <div class="kpi-k">A favor <button type="button" class="ayuda" data-ayuda="a_favor">?</button></div>
        <div class="kpi-v">${Shell.money(num(r.saldo_a_favor) + num(d.exceso_cobrado))}</div>
        <div class="kpi-sub">${Shell.money(r.saldo_a_favor)} sin imputar${
          num(d.exceso_cobrado) > 0 ? ` · ${Shell.money(d.exceso_cobrado)} cobrado de más` : ''}</div>
      </div>`;

    $('aging').innerHTML = `
      <button type="button" class="b0" data-filtro="por_vencer" title="Ver las facturas que todavía no vencieron"><div class="t">Por vencer</div><div class="v">${Shell.money(d.por_vencer)}</div></button>
      <button type="button" class="b1" data-filtro="a1_30" title="Ver las facturas vencidas hace 1 a 30 días"><div class="t">1 a 30 días</div><div class="v">${Shell.money(d.atraso_1_30)}</div></button>
      <button type="button" class="b2" data-filtro="a31_60" title="Ver las facturas vencidas hace 31 a 60 días"><div class="t">31 a 60 días</div><div class="v">${Shell.money(d.atraso_31_60)}</div></button>
      <button type="button" class="b3" data-filtro="a61_90" title="Ver las facturas vencidas hace 61 a 90 días"><div class="t">61 a 90 días</div><div class="v">${Shell.money(d.atraso_61_90)}</div></button>
      <button type="button" class="b4" data-filtro="a90" title="Ver las facturas vencidas hace más de 90 días"><div class="t">Más de 90 días</div><div class="v">${Shell.money(d.atraso_90_mas)}</div></button>`;
    marcarFiltroActivo();

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
  if ($('soloVencido').checked) params.set('solo_vencido', 'true');

  try {
    // Clientes (con sus totales) y facturas con saldo (con su origen) juntos:
    // el buscador y los filtros trabajan sobre lo cargado, sin volver al servidor.
    const [deuda, facturas] = await Promise.all([
      apiFetch(`${API}/deuda?${params}`),
      apiFetch(`${API}/facturas`)
    ]);
    estado.deuda = deuda;
    estado.facturasPend = facturas;
    pintarPorCobrar();
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar las cuentas por cobrar');
    $('tablaDeuda').innerHTML = '<tr><td colspan="8">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
    $('tablaPorFactura').innerHTML = '<tr><td colspan="9">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

/* ---------------------- cuentas por cobrar navegables ---------------------- */
/* Cadena que se abre de a un nivel, sin cambiar de pantalla:
 *   cliente → factura → (origen: OC y remitos) y (cobros imputados).
 * Se puede mirar por cliente o por factura; los KPIs y los tramos de
 * antigüedad filtran la lista de facturas. */

// Filtros que dispara un KPI o un tramo de antigüedad (mismas definiciones que /resumen).
const FILTROS_KPI = {
  vencido:    { texto: 'Vencido',               test: f => num(f.dias_atraso) > 0 },
  en_gestion: { texto: 'En gestión',            test: f => num(f.en_gestion) > 0.005 },
  por_vencer: { texto: 'Por vencer',            test: f => num(f.dias_atraso) <= 0 },
  a1_30:      { texto: 'Vencido hace 1 a 30 días',  test: f => num(f.dias_atraso) >= 1 && num(f.dias_atraso) <= 30 },
  a31_60:     { texto: 'Vencido hace 31 a 60 días', test: f => num(f.dias_atraso) >= 31 && num(f.dias_atraso) <= 60 },
  a61_90:     { texto: 'Vencido hace 61 a 90 días', test: f => num(f.dias_atraso) >= 61 && num(f.dias_atraso) <= 90 },
  a90:        { texto: 'Vencido hace más de 90 días', test: f => num(f.dias_atraso) > 90 }
};

// Para comparar sin mayúsculas ni tildes.
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function textoDeFactura(f) {
  const o = f.origen || {};
  return norm([f.cliente_nombre, f.cliente_cuit, f.numero_factura, o.numero_oc,
    (o.remitos || []).map(r => r.numero_remito).join(' ')].join(' '));
}

function clicEnFiltroKpi(e) {
  if (e.target.closest('.ayuda')) return;   // el "?" de ayuda no filtra
  const b = e.target.closest('[data-filtro]');
  if (!b) return;
  const clave = b.dataset.filtro;
  // "Total por cobrar" quita el filtro; tocar de nuevo el activo también.
  estado.filtroKpi = (clave === 'todas' || clave === estado.filtroKpi) ? null : clave;
  if (estado.filtroKpi) estado.vista = 'factura';   // los filtros son de facturas
  estado.facturasAbiertas = new Set();
  pintarPorCobrar();
  if (estado.filtroKpi) $('tab-deuda').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function marcarFiltroActivo() {
  document.querySelectorAll('#kpis [data-filtro], #aging [data-filtro]').forEach(b =>
    b.classList.toggle('is-activo', b.dataset.filtro === estado.filtroKpi));
}

/* Facturas que pasan el filtro del KPI (sin el buscador). */
function facturasDelFiltro() {
  const t = estado.filtroKpi && FILTROS_KPI[estado.filtroKpi].test;
  return t ? estado.facturasPend.filter(t) : estado.facturasPend;
}

function pintarPorCobrar() {
  const q = norm($('buscarCliente').value.trim());
  const delFiltro = facturasDelFiltro();

  // Estado de los controles
  document.querySelectorAll('.vista-toggle [data-vista]').forEach(b =>
    b.classList.toggle('active', b.dataset.vista === estado.vista));
  $('vistaCliente').hidden = estado.vista !== 'cliente';
  $('vistaFactura').hidden = estado.vista !== 'factura';
  $('campoOrdenDeuda').hidden = estado.vista !== 'cliente';
  marcarFiltroActivo();

  // Facturas visibles: pasan el filtro y el buscador
  const visibles = q ? delFiltro.filter(f => textoDeFactura(f).includes(q)) : delFiltro;

  const chip = $('filtroActivo');
  if (estado.filtroKpi) {
    chip.hidden = false;
    chip.innerHTML = `Mostrando solo: <strong>${esc(FILTROS_KPI[estado.filtroKpi].texto)}</strong>
      (${delFiltro.length} ${delFiltro.length === 1 ? 'factura' : 'facturas'})
      <button type="button" class="b b-ghost b-sm" data-quitar-filtro>Quitar filtro</button>`;
  } else {
    chip.hidden = true;
    chip.innerHTML = '';
  }

  if (estado.vista === 'cliente') pintarVistaCliente(q, delFiltro);
  else pintarVistaFactura(visibles);
}

/* Facturas con saldo agrupadas por cliente. */
function facturasPorCliente(facturas) {
  const m = new Map();
  facturas.forEach(f => {
    if (!m.has(f.cliente_id)) m.set(f.cliente_id, []);
    m.get(f.cliente_id).push(f);
  });
  return m;
}

function pintarVistaCliente(q, delFiltro) {
  const tbody = $('tablaDeuda');
  const porCliente = facturasPorCliente(delFiltro);

  let clientes = estado.deuda;
  // Con un filtro de KPI, solo los clientes que tienen facturas de ese tipo.
  if (estado.filtroKpi) clientes = clientes.filter(c => porCliente.has(c.cliente_id));
  if (q) {
    clientes = clientes.filter(c =>
      norm(`${c.cliente_nombre} ${c.cuit || ''}`).includes(q) ||
      (porCliente.get(c.cliente_id) || []).some(f => textoDeFactura(f).includes(q)));
  }

  if (!clientes.length) {
    tbody.innerHTML = '<tr><td colspan="8">' + (q || estado.filtroKpi
      ? Shell.vacio('Sin resultados', 'Ningún cliente coincide con la búsqueda o el filtro.')
      : Shell.vacio('No hay clientes con saldo por cobrar',
          'Van a aparecer acá en cuanto emitas una factura de venta.',
          { txt: 'Ver entregas y remitos', url: 'ventas.html' })) + '</td></tr>';
    return;
  }

  tbody.innerHTML = clientes.map(c => {
    const abierto = estado.clientesAbiertos.has(c.cliente_id);
    const aFavor = num(c.saldo_a_favor) + num(c.exceso_cobrado);
    let html = `
      <tr class="clickable${abierto ? ' abierta' : ''}" data-cli-toggle="${c.cliente_id}" aria-expanded="${abierto}">
        <td>
          <span class="fx-chevron">${abierto ? '▼' : '▶'}</span><strong>${esc(c.cliente_nombre)}</strong>
          <div class="muted" style="font-size:12px; padding-left:12px">${esc(c.cuit) || 'sin CUIT'}${c.dias_max_pago ? ' · plazo ' + c.dias_max_pago + ' d' : ''}</div>
        </td>
        <td class="num" data-label="Facturas">${c.facturas_pendientes}</td>
        <td class="num" data-label="Saldo"><strong>${Shell.money(c.saldo)}</strong></td>
        <td class="num ${num(c.vencido) > 0 ? 'neg' : 'muted'}" data-label="Vencido">${Shell.money(c.vencido)}</td>
        <td class="num muted" data-label="Por vencer">${Shell.money(c.por_vencer)}</td>
        <td class="num" data-label="En gestión">${num(c.en_gestion) > 0 ? Shell.money(c.en_gestion) : '<span class="muted">—</span>'}</td>
        <td class="num" data-label="Atraso">${textoAtraso(c.dias_atraso_max)}</td>
        <td class="num ${aFavor > 0 ? 'pos' : 'muted'}" data-label="A favor">
          ${aFavor > 0 ? Shell.money(aFavor) : '—'}
          ${num(c.exceso_cobrado) > 0
              ? `<div class="muted" style="font-size:11px">incluye ${Shell.money(c.exceso_cobrado)} cobrado de más</div>` : ''}
        </td>
      </tr>`;

    if (abierto) {
      const facturas = porCliente.get(c.cliente_id) || [];
      html += `
      <tr class="fx-cliente"><td colspan="8">
        <div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; margin-bottom:8px">
          <button type="button" class="b b-ghost b-sm" data-ver-ficha="${c.cliente_id}">Estado de cuenta completo</button>
          <button type="button" class="b b-primary b-sm" data-cobrar-cliente="${c.cliente_id}">Registrar cobro</button>
        </div>
        ${facturas.length ? `
        <div class="table-wrap"><table class="t">
          <thead><tr>
            <th>Factura</th><th>Vencimiento</th><th class="num">Total</th><th class="num">Cobrado</th>
            <th class="num">Saldo</th><th>Estado</th><th>OC / Remitos</th><th></th>
          </tr></thead>
          <tbody>${filasFacturas(facturas, false)}</tbody>
        </table></div>`
        : '<div class="muted">Sin facturas pendientes de cobro' +
          (aFavor > 0 ? ' · tiene plata a favor para imputar' : '') + '.</div>'}
      </td></tr>`;
    }
    return html;
  }).join('');
}

function pintarVistaFactura(facturas) {
  const tbody = $('tablaPorFactura');
  const pie = $('piePorFactura');

  if (!facturas.length) {
    tbody.innerHTML = '<tr><td colspan="9">' + (estado.filtroKpi || $('buscarCliente').value.trim()
      ? Shell.vacio('Sin resultados', 'Ninguna factura coincide con la búsqueda o el filtro.')
      : Shell.vacio('No hay facturas por cobrar', 'Van a aparecer acá en cuanto emitas una factura de venta.',
          { txt: 'Ver entregas y remitos', url: 'ventas.html' })) + '</td></tr>';
    pie.innerHTML = '';
    return;
  }

  tbody.innerHTML = filasFacturas(facturas, true);

  const suma = (campo) => facturas.reduce((s, f) => s + num(f[campo]), 0);
  pie.innerHTML = `
    <tr class="ec-total">
      <td colspan="3">${facturas.length} ${facturas.length === 1 ? 'factura' : 'facturas'}</td>
      <td class="num">${Shell.money(suma('total'))}</td>
      <td class="num">${Shell.money(suma('cobrado'))}</td>
      <td class="num">${Shell.money(suma('saldo'))}</td>
      <td colspan="3"></td>
    </tr>`;
}

/* Las OC que cubre una factura (puede ser más de una), como links a cada OC. */
function linksOc(o, { corto = false } = {}) {
  const ordenes = (o.ordenes && o.ordenes.length) ? o.ordenes
    : (o.orden_compra_id ? [{ id: o.orden_compra_id, numero_oc: o.numero_oc }] : []);
  const visibles = corto ? ordenes.slice(0, 2) : ordenes;
  const links = visibles.map(oc =>
    `<a href="oc_detalle.html?id=${oc.id}&tab=facturas" class="ec-link" title="Abrir la orden de compra">OC ${esc(oc.numero_oc)}</a>`);
  if (corto && ordenes.length > 2) links.push(`+${ordenes.length - 2}`);
  return links.join(', ');
}

/* OC y remitos de una factura, en una línea (para la fila). */
function origenCorto(f) {
  const o = f.origen || {};
  const partes = [];
  const ocs = linksOc(o, { corto: true });
  if (ocs) partes.push(ocs);
  const rem = o.remitos || [];
  if (rem.length) {
    partes.push(esc(rem.slice(0, 2).map(r => r.numero_remito).join(', ')) +
      (rem.length > 2 ? ` +${rem.length - 2}` : ''));
  }
  return partes.length ? partes.join(' · ') : '<span class="muted">—</span>';
}

/* Filas de facturas (una por factura + el detalle si está desplegada).
 * `conCliente`: la vista por factura muestra el cliente; dentro de un cliente no. */
function filasFacturas(facturas, conCliente) {
  const cols = conCliente ? 9 : 8;
  return facturas.map(f => {
    const abierta = estado.facturasAbiertas.has(f.id);
    const gestion = num(f.en_gestion) > 0.005
      ? `<div class="ec-gestion">+${Shell.money(f.en_gestion)} en gestión</div>` : '';
    let html = `
      <tr class="fx-fila clickable${abierta ? ' abierta' : ''}" data-fx-toggle="${f.id}" aria-expanded="${abierta}">
        ${conCliente ? `<td data-label="Cliente"><strong>${esc(f.cliente_nombre)}</strong></td>` : ''}
        <td data-label="Factura"><span class="fx-chevron">${abierta ? '▼' : '▶'}</span><a href="#" class="ec-link" data-pdf="api/facturas/${f.id}/pdf" title="Ver el PDF de la factura"><strong>${esc(f.numero_factura)}</strong></a>
          <span class="muted">${esc(f.tipo_factura || '')}</span>
          <div class="muted" style="font-size:12px; padding-left:12px">${Shell.fecha(f.fecha)}</div></td>
        <td data-label="Vencimiento">${Shell.fecha(f.fecha_vencimiento)} ${textoAtraso(f.dias_atraso)}</td>
        <td class="num" data-label="Total">${Shell.money(f.total)}</td>
        <td class="num" data-label="Cobrado">${Shell.money(f.cobrado)}${gestion}</td>
        <td class="num" data-label="Saldo"><strong>${Shell.money(f.saldo)}</strong></td>
        <td data-label="Estado">${Shell.pill(f.estado)}</td>
        <td data-label="OC / Remitos">${origenCorto(f)}</td>
        <td><button type="button" class="b b-primary b-sm" data-cobrar-fact="${f.id}" data-cliente="${f.cliente_id}"
                    title="Registrar un cobro de esta factura">Cobrar</button></td>
      </tr>`;
    if (abierta) {
      const d = estado.detalles.get(f.id);
      html += `<tr class="fx-detalle"><td colspan="${cols}">${
        d ? detalleFacturaHtml(d) : '<span class="muted">Cargando…</span>'}</td></tr>`;
    }
    return html;
  }).join('');
}

/* Origen de una factura: OC → remitos → modelos facturados. Lo usan
 * la lista de Por cobrar y el estado de cuenta del cliente. */
function origenHtml(f) {
  const o = f.origen || {};
  const rem = o.remitos || [];
  const ocs = linksOc(o);
  if (!ocs && !rem.length) {
    return '<div class="fx-bloque"><div class="fx-titulo">Origen</div><span class="muted">Factura cargada manualmente, sin OC ni remitos asociados.</span></div>';
  }
  const oc = ocs || '<span class="muted">sin OC</span>';
  const remitos = rem.length
    ? rem.map(r => `<a href="#" class="ec-link" data-pdf="api/ventas/${r.id}/pdf" title="Ver el PDF del remito">Remito ${esc(r.numero_remito)}</a>` +
        (r.fecha ? ` <span class="muted">(${Shell.fecha(r.fecha)})</span>` : '')).join(', ')
    : '<span class="muted">sin remitos</span>';
  const items = (o.items || []).map(i => `${esc(i.modelo)} × ${Number(i.cantidad).toLocaleString('es-AR')}`).join(' · ');
  return `
    <div class="fx-bloque">
      <div class="fx-titulo">Origen</div>
      <div class="fx-cadena">${oc} <span class="sep">›</span> ${remitos} <span class="sep">›</span> <strong>Factura ${esc(f.numero_factura)}</strong></div>
      ${items ? `<div class="fx-items">Facturado: ${items}</div>` : ''}
    </div>`;
}

/* Detalle desplegado de una factura: origen y cobros imputados. */
function detalleFacturaHtml(d) {
  const pagos = (d.pagos || []).map(p => {
    const forma = [p.numero_recibo ? 'Recibo ' + esc(p.numero_recibo) : null, esc(p.formas)].filter(Boolean).join(' · ');
    return `
      <div class="fx-pago">
        <a href="#" class="ec-link" data-pdf="api/cobros/${p.pago_id}/pdf" title="Ver el recibo del cobro">Cobro #${p.pago_id}</a>
        <span class="muted">${Shell.fecha(p.fecha_recepcion)}</span>
        <span class="muted">${forma}</span>
        ${Shell.pill(p.estado_forma)}
        <span class="num">${Shell.money(p.monto_aplicado)}</span>
        <button type="button" class="b b-ghost b-sm" data-desimputar="${p.pago_id}" data-factura="${d.id}"
                title="Sacar este cobro de la factura (queda a favor del cliente)">Deshacer</button>
      </div>`;
  }).join('');
  const ncs = (d.notas_credito_detalle || []).map(n => `
      <div class="fx-pago">
        <span>NC ${esc(n.numero_nota)}</span>
        <span class="muted">${Shell.fecha(n.fecha)}</span>
        <span class="muted">Nota de crédito</span>
        <span class="num">−${Shell.money(n.total)}</span>
      </div>`).join('');

  return `
    ${origenHtml(d)}
    <div class="fx-bloque">
      <div class="fx-titulo">Cobros imputados</div>
      ${pagos || ncs ? pagos + ncs : '<span class="muted">Todavía no se le imputó ningún cobro.</span>'}
    </div>`;
}

/* Un solo manejador para todo lo que se pinta en la solapa Por cobrar. */
async function clicEnPorCobrar(e) {
  const vista = e.target.closest('[data-vista]');
  if (vista) {
    estado.vista = vista.dataset.vista;
    return pintarPorCobrar();
  }
  if (e.target.closest('[data-quitar-filtro]')) {
    estado.filtroKpi = null;
    return pintarPorCobrar();
  }

  // Links y botones primero: no deben desplegar la fila que los contiene.
  const pdf = e.target.closest('[data-pdf]');
  if (pdf) {
    e.preventDefault();
    verArchivoProtegido(pdf.dataset.pdf).catch(err => Shell.error(err, 'No se pudo abrir el PDF'));
    return;
  }
  if (e.target.closest('a[href]')) return;   // links normales (OC): navegan
  const cobrarFact = e.target.closest('[data-cobrar-fact]');
  if (cobrarFact) return cobrarA(Number(cobrarFact.dataset.cliente), Number(cobrarFact.dataset.cobrarFact));
  const cobrarCli = e.target.closest('[data-cobrar-cliente]');
  if (cobrarCli) return cobrarA(Number(cobrarCli.dataset.cobrarCliente));
  const ficha = e.target.closest('[data-ver-ficha]');
  if (ficha) return verCliente(Number(ficha.dataset.verFicha));
  const desimputar = e.target.closest('[data-desimputar]');
  if (desimputar) {
    return desimputarCobro(Number(desimputar.dataset.desimputar), Number(desimputar.dataset.factura));
  }

  const fx = e.target.closest('[data-fx-toggle]');
  if (fx) return alternarFactura(Number(fx.dataset.fxToggle));
  const cli = e.target.closest('[data-cli-toggle]');
  if (cli) {
    const id = Number(cli.dataset.cliToggle);
    if (estado.clientesAbiertos.has(id)) estado.clientesAbiertos.delete(id);
    else estado.clientesAbiertos.add(id);
    pintarPorCobrar();
  }
}

/* Despliega o pliega una factura; el detalle (cobros) se pide la primera vez. */
async function alternarFactura(id) {
  if (estado.facturasAbiertas.has(id)) {
    estado.facturasAbiertas.delete(id);
    return pintarPorCobrar();
  }
  estado.facturasAbiertas.add(id);
  pintarPorCobrar();
  if (estado.detalles.has(id)) return;
  try {
    estado.detalles.set(id, await apiFetch(`${API}/facturas/${id}`));
  } catch (err) {
    estado.facturasAbiertas.delete(id);
    Shell.error(err, 'No se pudo cargar el detalle de la factura');
  }
  pintarPorCobrar();
}

/* ---------------------- ficha del cliente (panel lateral) ---------------------- */
/* Dos solapas: "Estado de cuenta" (una línea por factura, con los pagos
 * aplicados al expandir) y "Cuenta corriente" (movimientos cronológicos).
 * Nunca dos tablas de facturas a la vez. */

const ec = {
  clienteId: null,
  datos: null,
  orden: 'urgencia',    // cómo se ordenan las facturas en pantalla (ver ORDENES_EC)
  abiertas: new Set()   // ids de factura con los pagos desplegados
};

/* Órdenes del estado de cuenta. Se ordena en el navegador sobre lo ya cargado:
 * el servidor siempre manda "por urgencia". El desempate es el id (orden de alta). */
const ORDENES_EC = {
  urgencia:      { texto: 'Urgencia (lo vencido primero)', nota: 'por urgencia: primero lo vencido' },
  fecha_desc:    { texto: 'Últimas facturas primero', nota: 'de la más nueva a la más vieja (por fecha de factura)',
                   cmp: (a, b) => fechaMs(b.fecha) - fechaMs(a.fecha) || b.id - a.id },
  fecha_asc:     { texto: 'Facturas más viejas primero', nota: 'de la más vieja a la más nueva (por fecha de factura)',
                   cmp: (a, b) => fechaMs(a.fecha) - fechaMs(b.fecha) || a.id - b.id },
  cargadas_desc: { texto: 'Últimas cargadas en el sistema', nota: 'de la última factura cargada en el sistema a la primera',
                   cmp: (a, b) => b.id - a.id },
  saldo_desc:    { texto: 'Mayor saldo primero', nota: 'por saldo, de mayor a menor',
                   cmp: (a, b) => num(b.saldo) - num(a.saldo) || a.id - b.id },
  vence_asc:     { texto: 'Vencimiento más antiguo primero', nota: 'por vencimiento, del más antiguo al más lejano',
                   cmp: (a, b) => fechaMs(a.fecha_vencimiento) - fechaMs(b.fecha_vencimiento) || a.id - b.id }
};

function fechaMs(v) {
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/* Facturas del estado de cuenta en el orden elegido (sin tocar ec.datos). */
function facturasOrdenadasEC() {
  const facturas = ec.datos.facturas;
  const cmp = ORDENES_EC[ec.orden]?.cmp;
  return cmp ? [...facturas].sort(cmp) : facturas;
}

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
            <label class="field"><span>Ordenar por</span>
              <select class="select" id="ecOrden">${Object.entries(ORDENES_EC).map(([k, o]) =>
                `<option value="${k}"${k === ec.orden ? ' selected' : ''}>${o.texto}</option>`).join('')}</select></label>
            <label class="ec-check"><input type="checkbox" id="ecSoloPend"> Solo pendientes de cobro</label>
            <div class="ec-acciones">
              <button type="button" class="b b-ghost b-sm" id="ecLimpiar">Limpiar</button>
              <button type="button" class="b b-ghost b-sm" id="ecCsv">Exportar CSV</button>
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
                  <thead><tr><th>Cheque</th><th>Banco</th><th class="num">Importe</th><th>Fecha de cobro</th><th>Estado</th></tr></thead>
                  <tbody>${ficha.cheques_en_cartera.map(c => `
                    <tr>
                      <td><strong>${esc(c.cheque_numero)}</strong>${c.endosado ? ' ' + Shell.pill('EN_GESTION') : ''}</td>
                      <td data-label="Banco">${esc(c.cheque_banco) || '—'}</td>
                      <td class="num" data-label="Importe">${Shell.money(c.monto)}</td>
                      <td data-label="Fecha de cobro">${Shell.fecha(c.cheque_fecha_cobro)} ${textoAtraso(c.dias_para_cobro === null ? null : -c.dias_para_cobro)}</td>
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
              <th>Factura</th><th>Fecha</th><th>Vencimiento</th>
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

    ${num(a_cuenta) > 0 ? `<div class="muted" style="font-size:13px">Cobros a favor del cliente, sin imputar a ninguna factura: <strong>${Shell.money(a_cuenta)}</strong></div>` : ''}
    <div class="muted" style="font-size:12px">
      Ordenado ${ORDENES_EC[ec.orden].nota}. Desplegá una factura para ver su origen (OC y remitos) y los cobros imputados.
    </div>`;

  pintarFilasEstadoCuenta();
}

function pintarFilasEstadoCuenta() {
  const facturas = facturasOrdenadasEC();
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
        <td data-label="Vencimiento">${Shell.fecha(f.fecha_vencimiento)} ${num(f.saldo) > 0.005 ? textoAtraso(f.dias_atraso) : ''}</td>
        <td class="num" data-label="Total">${Shell.money(f.total)}</td>
        <td class="num" data-label="Cobrado">${Shell.money(f.cobrado)}${gestion}</td>
        <td class="num" data-label="Saldo"><strong>${Shell.money(f.saldo)}</strong></td>
        <td data-label="Estado">${Shell.pill(f.estado)}</td>
        <td data-label="Pagos"><button type="button" class="ec-toggle" data-ec-toggle="${f.id}" aria-expanded="${abierta}">
               <span class="ec-flecha">${abierta ? '▼' : '▶'}</span> ${nPagos ? nPagos + (nPagos === 1 ? ' pago' : ' pagos') : (nHijos ? 'NC' : 'Origen')}${nPagos && nHijos > nPagos ? ' + NC' : ''}</button></td>
      </tr>`;

    if (abierta) {
      // Origen de la factura (OC y remitos), antes de los cobros.
      html += `<tr class="ec-hijo"><td colspan="8">${origenHtml(f)}</td></tr>`;
      f.pagos.forEach(p => {
        const forma = [p.numero_recibo ? 'Recibo ' + esc(p.numero_recibo) : null, esc(p.formas)].filter(Boolean).join(' · ');
        html += `
      <tr class="ec-hijo">
        <td><a href="#" class="ec-link" data-pdf="api/cobros/${p.pago_id}/pdf" title="Ver el recibo del cobro">Cobro #${p.pago_id}</a></td>
        <td data-label="Fecha">${Shell.fecha(p.fecha_recepcion)}</td>
        <td colspan="2" class="muted">${forma}</td>
        <td class="num" data-label="Imputado">${Shell.money(p.monto_aplicado)}</td>
        <td></td>
        <td data-label="Estado">${Shell.pill(p.estado_forma)}</td>
        <td><button type="button" class="b b-ghost b-sm" data-desimputar="${p.pago_id}" data-factura="${f.id}"
                    title="Sacar este cobro de la factura (queda a favor del cliente)">Deshacer</button></td>
      </tr>`;
      });
      f.notas_credito_detalle.forEach(n => {
        html += `
      <tr class="ec-hijo">
        <td>NC ${esc(n.numero_nota)}</td>
        <td data-label="Fecha">${Shell.fecha(n.fecha)}</td>
        <td class="muted">Nota de crédito</td>
        <td class="num" data-label="Importe">−${Shell.money(n.total)}</td>
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
  const filas = [['Factura', 'Fecha', 'Vencimiento', 'Total', 'Cobrado', 'En gestión', 'Saldo', 'Estado',
    'Cobro', 'Fecha de cobro', 'Importe imputado', 'Forma de pago']];

  facturasOrdenadasEC().forEach(f => {
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
  const desimputar = e.target.closest('[data-desimputar]');
  if (desimputar) {
    return desimputarCobro(Number(desimputar.dataset.desimputar), Number(desimputar.dataset.factura));
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


/* Confirmación en <dialog> (confirm() queda bloqueado en algunos navegadores). */
function confirmarCobro(titulo, mensajeHtml) {
  return new Promise((resolve) => {
    $('confirmarTitulo').textContent = titulo;
    $('confirmarMsg').innerHTML = mensajeHtml;
    const modal = $('confirmarModal');
    const btn = $('btnConfirmarConfirmar');

    function limpiar() {
      btn.removeEventListener('click', onConfirmar);
      modal.removeEventListener('close', onCerrar);
    }
    function onConfirmar() { limpiar(); modal.close(); resolve(true); }
    function onCerrar() { limpiar(); resolve(false); }

    btn.addEventListener('click', onConfirmar);
    modal.addEventListener('close', onCerrar);
    modal.showModal();
  });
}

/* Diálogo que pide datos (motivo, gastos…) y los valida antes de cerrar.
 * Reemplaza a prompt(), que queda bloqueado en algunos navegadores.
 * campos: [{ id, label, tipo: 'texto'|'numero', valor, requerido, min }].
 * Devuelve { [id]: valor } o null si se cancela. */
function pedirDatos({ titulo, mensajeHtml, campos = [], textoBoton = 'Confirmar' }) {
  return new Promise((resolve) => {
    const modal = $('accionModal');
    const form = $('accionForm');
    $('accionTitulo').textContent = titulo;
    $('accionMsg').innerHTML = mensajeHtml || '';
    $('accionError').hidden = true;
    $('btnAccionConfirmar').textContent = textoBoton;
    $('accionCampos').innerHTML = campos.map(c => `
      <div class="field" style="margin-top:var(--space-3)">
        <label for="accion_${c.id}">${esc(c.label)}</label>
        ${c.tipo === 'numero'
          ? `<input class="input" type="number" id="accion_${c.id}" step="0.01" min="${c.min ?? 0}" value="${esc(c.valor ?? '')}">`
          : `<textarea class="input" id="accion_${c.id}" rows="2">${esc(c.valor ?? '')}</textarea>`}
      </div>`).join('');

    let resultado = null;
    function limpiar() {
      form.removeEventListener('submit', onEnviar);
      $('btnAccionCancelar').removeEventListener('click', onCancelar);
      modal.removeEventListener('close', onCerrar);
    }
    function onEnviar(e) {
      e.preventDefault();
      const valores = {};
      for (const c of campos) {
        const bruto = $('accion_' + c.id).value.trim();
        if (c.requerido && !bruto) return mostrarError(`Completá: ${c.label}.`);
        if (c.tipo === 'numero') {
          const n = bruto === '' ? 0 : Number(bruto.replace(',', '.'));
          if (!Number.isFinite(n) || n < (c.min ?? 0)) return mostrarError(`${c.label}: ingresá un número válido.`);
          valores[c.id] = n;
        } else {
          if (c.minLargo && bruto.length < c.minLargo) return mostrarError(`${c.label}: escribí al menos ${c.minLargo} caracteres.`);
          valores[c.id] = bruto;
        }
      }
      resultado = valores;
      modal.close();
    }
    function mostrarError(msg) {
      $('accionError').textContent = msg;
      $('accionError').hidden = false;
    }
    function onCancelar() { modal.close(); }
    function onCerrar() { limpiar(); resolve(resultado); }

    form.addEventListener('submit', onEnviar);
    $('btnAccionCancelar').addEventListener('click', onCancelar);
    modal.addEventListener('close', onCerrar);
    modal.showModal();
    const primero = $('accionCampos').querySelector('input, textarea');
    if (primero) primero.focus();
  });
}

let desimputando = false;

async function desimputarCobro(pagoId, facturaId) {
  if (desimputando) return;
  // La factura puede estar en el estado de cuenta del panel lateral o
  // desplegada en la lista de Por cobrar.
  const factura = (ec.datos && ec.datos.facturas.find(f => f.id === facturaId)) ||
    estado.detalles.get(facturaId);
  const pago = factura && factura.pagos.find(p => p.pago_id === pagoId);
  const ok = await confirmarCobro('Deshacer imputación',
    `¿Sacar el <strong>Cobro #${pagoId}</strong>${pago ? ` (${Shell.money(pago.monto_aplicado)})` : ''} de la factura ` +
    `<strong>${esc(factura ? factura.numero_factura : '')}</strong>?<br>` +
    'La factura vuelve a tener saldo y el cobro queda a favor del cliente, para imputarlo a otra factura.');
  if (!ok) return;

  desimputando = true;
  try {
    const r = await apiFetch(`${API}/${pagoId}/desimputar`, {
      method: 'POST', body: JSON.stringify({ factura_id: facturaId })
    });
    Shell.toast('ok', r.message);
    // El panel lateral solo se recarga si está abierto.
    const drawerAbierto = $('drawer').classList.contains('open') && $('ecResultado');
    await Promise.all([drawerAbierto ? cargarEstadoCuenta() : null, cargarTodo()]);
  } catch (err) {
    Shell.error(err, 'No se pudo deshacer la imputación');
  } finally {
    desimputando = false;
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

/* Abre "Registrar cobro" con el cliente elegido y, si viene, la factura ya
 * tildada para imputarle el cobro. */
async function cobrarA(clienteId, facturaId) {
  cerrarDrawer();
  const boton = document.querySelector('.tab[data-tab="cobrar"]');
  mostrarTab('cobrar', boton);
  $('cobroCliente').value = clienteId;
  await onCambiaClienteCobro();
  if (facturaId && estado.facturas.some(f => f.id === facturaId)) toggleFactura(facturaId, true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------- registrar cobro ---------------------- */

async function onCambiaClienteCobro() {
  const clienteId = $('cobroCliente').value;
  estado.imputaciones = {};
  estado.seleccionadas = new Set();
  estado.imputacionManual = false;

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
        Tiene <strong>${Shell.money(t.saldo)}</strong> por cobrar en ${facturas.length} factura(s).
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
      $('cobroCliente').value ? 'Este cliente no tiene facturas pendientes. El cobro va a quedar a favor del cliente.'
                              : 'Elegí un cliente para ver sus facturas pendientes'}</td></tr>`;
    recalcularTotales();
    return;
  }

  tbody.innerHTML = estado.facturas.map(f => {
    const disponible = num(f.saldo) - num(f.en_gestion);
    const imputado = estado.imputaciones[f.id] || 0;
    return `
    <tr>
      <td><input type="checkbox" ${estado.seleccionadas.has(f.id) ? 'checked' : ''} ${disponible <= 0 ? 'disabled' : ''}
                 onchange="toggleFactura(${f.id}, this.checked)"></td>
      <td data-label="Factura"><strong>${esc(f.numero_factura)}</strong> <span class="muted">${esc(f.tipo_factura || '')}</span></td>
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
  // Tildar o destildar vuelve a hacer que lo imputado siga el total del cobro.
  estado.imputacionManual = false;
  if (marcado) {
    estado.seleccionadas.add(facturaId);
    // Sin importes cargados todavía no hay total que repartir: se precarga el
    // saldo disponible y se ajusta apenas se escribe un importe.
    const disponible = num(f.saldo) - num(f.en_gestion);
    estado.imputaciones[facturaId] = Math.max(0, disponible);
  } else {
    estado.seleccionadas.delete(facturaId);
    delete estado.imputaciones[facturaId];
  }
  sincronizarImputaciones();
  pintarFacturasCobro();
}

/* Reparte el total del cobro entre las facturas tildadas, en el orden en que
   se listan (más viejas primero), cada una hasta su saldo disponible. Lo que
   sobra queda a favor del cliente. No hace nada si se editó un importe a mano
   o si todavía no hay importes de cobro cargados. */
function sincronizarImputaciones() {
  const total = totalCobro();
  if (estado.imputacionManual || total <= 0) return;

  estado.imputaciones = {};
  let restante = Math.round(total * 100);
  for (const f of estado.facturas) {
    if (!estado.seleccionadas.has(f.id)) continue;
    const disponible = Math.max(0, Math.round((num(f.saldo) - num(f.en_gestion)) * 100));
    const usar = Math.min(restante, disponible);
    if (usar > 0) estado.imputaciones[f.id] = usar / 100;
    restante -= usar;
  }
}

/* Cambió un importe de cobro (o se quitó una forma): la imputación lo sigue. */
function onCambiaImporteCobro() {
  sincronizarImputaciones();
  pintarFacturasCobro();
}

function cambiarImputacion(facturaId, valor) {
  estado.imputacionManual = true;
  const v = parseFloat(valor);
  if (!v || v <= 0) delete estado.imputaciones[facturaId];
  else estado.imputaciones[facturaId] = v;
  recalcularTotales();
}

function limpiarImputacion() {
  estado.imputaciones = {};
  estado.seleccionadas = new Set();
  estado.imputacionManual = false;
  pintarFacturasCobro();
}

/* Reparte el total del cobro sobre las facturas más viejas primero. */
function imputarAutomatico() {
  const total = totalCobro();
  if (total <= 0) { Shell.toast('warn', 'Cargá primero las formas de cobro y sus importes.'); return; }

  estado.imputaciones = {};
  estado.seleccionadas = new Set();
  estado.imputacionManual = false;
  let restante = Math.round(total * 100);

  for (const f of estado.facturas) {
    if (restante <= 0) break;
    const disponible = Math.round((num(f.saldo) - num(f.en_gestion)) * 100);
    if (disponible <= 0) continue;
    const usar = Math.min(restante, disponible);
    estado.imputaciones[f.id] = usar / 100;
    estado.seleccionadas.add(f.id);
    restante -= usar;
  }

  pintarFacturasCobro();
  if (restante > 0) {
    Shell.toast('ok', `Quedan ${Shell.money(restante / 100)} sin imputar: quedan a favor del cliente.`);
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
    <input class="input" type="number" id="f-monto-${i}" step="0.01" min="0" placeholder="Importe" oninput="onCambiaImporteCobro()">
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

  $('avisoCheques').hidden =
    !estado.formas.some(j => $(`f-tipo-${j}`) && $(`f-tipo-${j}`).value === 'CHEQUE');
}

function quitarForma(i) {
  estado.formas = estado.formas.filter(x => x !== i);
  $(`forma-${i}`).remove();
  onCambiaImporteCobro();
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
    if (!monto || monto <= 0) throw new Error('Hay una forma de cobro sin importe.');

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

let guardandoCobro = false;

async function guardarCobro() {
  if (guardandoCobro) return;   // doble clic: no registrar el cobro dos veces
  const boton = $('btnGuardarCobro');
  guardandoCobro = true;
  boton.disabled = true;

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
      const seguir = await confirmarCobro('Cobro sin imputar',
        `El cliente tiene facturas pendientes y no imputaste nada.<br>` +
        `El cobro de <strong>${Shell.money(total)}</strong> va a quedar a favor del cliente, sin asignar a ninguna factura. ¿Seguimos?`);
      if (!seguir) return;
    }

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
    guardandoCobro = false;
    boton.disabled = false;
    boton.textContent = 'Registrar cobro';
  }
}

function resetFormularioCobro() {
  estado.formas = [];
  estado.imputaciones = {};
  estado.seleccionadas = new Set();
  estado.imputacionManual = false;
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
        <td><strong>${esc(c.cheque_numero) || 's/n'}</strong>${c.endosado ? `<div class="muted" style="font-size:11px">endosado a ${esc(c.endosado_a) || '—'}</div>` : ''}</td>
        <td data-label="Banco">${esc(c.cheque_banco) || '—'}</td>
        <td data-label="Cliente">${esc(c.cliente_nombre)}</td>
        <td class="num" data-label="Importe"><strong>${Shell.money(c.monto)}</strong></td>
        <td data-label="Fecha de cobro">${Shell.fecha(c.cheque_fecha_cobro)}<div class="muted" style="font-size:11px">${textoVencimientoCheque(c)}</div></td>
        <td class="muted" data-label="Imputado a">${linksFacturas(c.facturas_detalle) || 'sin imputar'}</td>
        <td data-label="Estado">${Shell.pill(c.estado)}</td>
        <td data-label="Acciones">${accionesCheque(c)}</td>
      </tr>`).join('');
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los cheques');
    tbody.innerHTML = '<tr><td colspan="8">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

/* Números de factura como links al PDF (para "Imputado a"). */
function linksFacturas(lista) {
  if (!Array.isArray(lista) || !lista.length) return '';
  return lista.map(f =>
    `<a href="#" class="ec-link" data-pdf="api/facturas/${f.id}/pdf" title="Ver el PDF de la factura">${esc(f.numero)}</a>`).join(', ');
}

/* Abre el PDF de cualquier link con data-pdf de las solapas Cheques e Historial. */
function clicEnPdf(e) {
  const pdf = e.target.closest('[data-pdf]');
  if (!pdf) return;
  e.preventDefault();
  verArchivoProtegido(pdf.dataset.pdf).catch(err => Shell.error(err, 'No se pudo abrir el PDF'));
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

let accionChequeEnCurso = false;

async function accionCheque(id, accion) {
  if (accionChequeEnCurso) return;
  const cuerpo = {};

  if (accion === 'rechazar') {
    const datos = await pedirDatos({
      titulo: 'Rechazar cheque',
      mensajeHtml: 'Al rechazar el cheque, el saldo que cancelaba vuelve a quedar abierto.',
      campos: [
        { id: 'motivo', label: 'Motivo del rechazo', tipo: 'texto', valor: 'Sin fondos', requerido: true },
        { id: 'gasto', label: 'Gastos o comisión que nos cobró el banco (0 si no hubo)', tipo: 'numero', valor: '0', min: 0 }
      ],
      textoBoton: 'Rechazar cheque'
    });
    if (!datos) return;
    cuerpo.motivo = datos.motivo;
    cuerpo.gasto_comision = datos.gasto;
  }

  accionChequeEnCurso = true;
  try {
    const r = await apiFetch(`${API}/cheques/${id}/${accion}`, {
      method: 'POST', body: JSON.stringify(cuerpo)
    });
    Shell.toast('ok', `Cheque ${r.estado.toLowerCase().replace('_', ' ')}.`);
    await Promise.all([cargarCheques(), cargarTodo()]);
  } catch (err) {
    Shell.error(err, 'No se pudo actualizar el cheque');
  } finally {
    accionChequeEnCurso = false;
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
        <td data-label="Cliente">${esc(p.cliente_nombre) || '—'}</td>
        <td class="muted" data-label="Formas">${esc((p.formas || '').replace(/_/g, ' ').toLowerCase())}</td>
        <td class="num" data-label="Importe"><strong>${Shell.money(p.monto_total)}</strong></td>
        <td class="num" data-label="Imputado">${Shell.money(p.imputado)}
          ${p.facturas_detalle && p.facturas_detalle.length
            ? `<div class="muted" style="font-size:11px">a ${linksFacturas(p.facturas_detalle)}</div>` : ''}</td>
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
  const headers = ['Fecha', 'Cliente', 'Formas', 'Importe', 'Imputado', 'Sin imputar', 'Recibo', 'Estado'];
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

let cobroEnCurso = false;   // imputar / anular: una sola acción a la vez

async function imputarPendiente(pagoId) {
  if (cobroEnCurso) return;
  const ok = await confirmarCobro('Imputar lo que queda del cobro',
    `Se va a imputar lo que queda del <strong>Cobro #${pagoId}</strong> a las facturas más viejas del cliente. ¿Seguimos?`);
  if (!ok) return;
  cobroEnCurso = true;
  try {
    const r = await apiFetch(`${API}/${pagoId}/imputar`, { method: 'POST', body: JSON.stringify({}) });
    Shell.toast('ok', r.message);
    await Promise.all([cargarHistorial(), cargarTodo()]);
  } catch (err) {
    Shell.error(err, 'No se pudo imputar el cobro');
  } finally {
    cobroEnCurso = false;
  }
}

async function anularCobro(pagoId) {
  if (cobroEnCurso) return;
  const datos = await pedirDatos({
    titulo: `Anular el Cobro #${pagoId}`,
    mensajeHtml: 'El cobro deja de contar y las facturas a las que estaba imputado vuelven a tener saldo.',
    campos: [{ id: 'motivo', label: 'Motivo (queda registrado)', tipo: 'texto', requerido: true, minLargo: 10 }],
    textoBoton: 'Anular cobro'
  });
  if (!datos) return;
  cobroEnCurso = true;
  try {
    const r = await apiFetch(`${API}/${pagoId}/anular`, {
      method: 'POST', body: JSON.stringify({ motivo: datos.motivo })
    });
    Shell.toast('ok', r.message);
    await Promise.all([cargarHistorial(), cargarTodo()]);
  } catch (err) {
    Shell.error(err, 'No se pudo anular el cobro');
  } finally {
    cobroEnCurso = false;
  }
}

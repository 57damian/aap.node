// Correcciones — anular facturas de venta, remitos y órdenes de compra.
// Backend:
//   facturas  GET /api/facturas · GET|POST /api/facturas/:id/anulacion-preview|anular
//   remitos   GET /api/ventas   · GET|POST /api/ventas/:id/anulacion-preview|anular
//   OC        GET /api/ordenes-compra · GET|POST /api/ordenes-compra/:id/anulacion-preview|anular
//   historial GET /api/facturas/anulaciones
(function () {
  'use strict';

  var MOTIVO_MIN = 10;
  var $ = function (id) { return document.getElementById(id); };
  var actual = null;   // { tipo, id, identificador, bloqueos } del diálogo abierto
  var enviando = false;
  var remitos = [], ordenes = [];   // se filtran en el navegador

  // Cada tipo sabe dónde está su API y cómo se llama en pantalla.
  var TIPOS = {
    factura: { base: '/api/facturas', boton: 'Anular factura', confirmar: 'el número de la factura' },
    remito:  { base: '/api/ventas', boton: 'Anular remito', confirmar: 'el número del remito' },
    oc:      { base: '/api/ordenes-compra', boton: 'Anular OC', confirmar: 'el número de la OC' }
  };

  // Todo lo que viene de la base (números, nombres, motivos) se escapa antes de
  // armar HTML: lo cargó una persona y Shell.toast/innerHTML no escapan solos.
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function cuando(v) {
    var d = new Date(v);
    return isNaN(d) ? '—' : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function errorTexto(err, porDefecto) {
    return (err && (err.error || err.message)) || porDefecto;
  }
  function contiene(fila, texto) {
    return fila.join(' ').toLowerCase().indexOf(texto.toLowerCase()) !== -1;
  }

  /* ------------------------------------------------------------------ */
  /* Pestañas                                                            */
  /* ------------------------------------------------------------------ */
  document.querySelectorAll('.tabs .tab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tabs .tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      document.querySelectorAll('.tab-content').forEach(function (c) {
        c.classList.toggle('active', c.id === 'tab-' + b.dataset.tab);
      });
      if (b.dataset.tab === 'historial') cargarHistorial();
      if (b.dataset.tab === 'remitos') cargarRemitos();
      if (b.dataset.tab === 'ordenes') cargarOrdenes();
    });
  });

  /* ------------------------------------------------------------------ */
  /* Listado de facturas                                                 */
  /* ------------------------------------------------------------------ */
  async function cargarFacturas() {
    var tbody = $('facturasGrid');
    var p = new URLSearchParams();
    if ($('filtroNumero').value.trim()) p.set('q', $('filtroNumero').value.trim());
    if ($('filtroEstado').value) p.set('estado', $('filtroEstado').value);
    try {
      var filas = await apiFetch('/api/facturas' + (p.toString() ? '?' + p : ''));
      if (!filas.length) {
        tbody.innerHTML = '<tr><td colspan="7">' + Shell.vacio(
          'No hay facturas', 'Probá con otro número o quitá el filtro de estado.') + '</td></tr>';
        return;
      }
      tbody.innerHTML = filas.map(function (f) {
        var anulada = f.estado === 'ANULADA';
        return '<tr>' +
          '<td data-label="Fecha">' + Shell.fecha(f.fecha) + '</td>' +
          '<td data-label="Factura"><strong class="' + (anulada ? 'tachado' : '') + '">' +
            esc(f.tipo_factura || '') + ' ' + esc(f.numero_factura) + '</strong>' +
            (f.remitos ? '<br><span class="muted">Remitos: ' + esc(f.remitos) + '</span>' : '') + '</td>' +
          '<td data-label="Cliente">' + esc(f.cliente_nombre) + '</td>' +
          '<td class="num" data-label="Total">' + Shell.money(f.total) + '</td>' +
          '<td class="num solo-escritorio" data-label="Cobrado">' + Shell.money(f.cobrado) + '</td>' +
          '<td data-label="Estado">' + Shell.pill(f.estado) +
            (anulada && f.motivo_anulacion ? '<br><span class="muted">' + esc(f.motivo_anulacion) + '</span>' : '') + '</td>' +
          '<td>' + (anulada ? '' :
            '<button type="button" class="b b-danger b-sm" data-anular="factura:' + f.id + '">Anular…</button>') + '</td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No se pudo cargar el listado.</td></tr>';
      Shell.error(err, 'cargando las facturas');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Listado de remitos (los anulados no aparecen: están en el historial) */
  /* ------------------------------------------------------------------ */
  function pintarRemitos() {
    var tbody = $('remitosGrid');
    var t = $('filtroRemitos').value.trim();
    var filas = remitos.filter(function (r) {
      return !t || contiene([r.remito_numero, r.cliente, r.numero_oc], t);
    });
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="7">' + Shell.vacio(
        'No hay remitos', t ? 'Probá con otra búsqueda.' : 'Todavía no se registró ninguna entrega.') + '</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map(function (r) {
      return '<tr>' +
        '<td data-label="Fecha">' + Shell.fecha(r.remito_fecha || r.fecha) + '</td>' +
        '<td data-label="Remito"><strong>' + esc(r.remito_numero || ('venta #' + r.id)) + '</strong></td>' +
        '<td data-label="Cliente">' + esc(r.cliente) + '</td>' +
        '<td class="solo-escritorio" data-label="OC">' + esc(r.numero_oc || '—') + '</td>' +
        '<td class="num" data-label="Unidades">' + esc(r.unidades) + '</td>' +
        '<td data-label="Facturado">' + (r.numero_factura ? esc(r.numero_factura) : Shell.pill('PENDIENTE')) + '</td>' +
        '<td><button type="button" class="b b-danger b-sm" data-anular="remito:' + r.id + '">Anular…</button></td>' +
        '</tr>';
    }).join('');
  }
  async function cargarRemitos() {
    try { remitos = await apiFetch('/api/ventas'); pintarRemitos(); }
    catch (err) {
      $('remitosGrid').innerHTML = '<tr><td colspan="7" class="muted">No se pudo cargar el listado.</td></tr>';
      Shell.error(err, 'cargando los remitos');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Listado de órdenes de compra                                        */
  /* ------------------------------------------------------------------ */
  function pintarOrdenes() {
    var tbody = $('ordenesGrid');
    var t = $('filtroOrdenes').value.trim();
    var filas = ordenes.filter(function (o) { return !t || contiene([o.numero_oc, o.cliente], t); });
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="5">' + Shell.vacio(
        'No hay órdenes de compra', t ? 'Probá con otra búsqueda.' : 'Todavía no se cargó ninguna.') + '</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map(function (o) {
      var anulada = o.estado === 'anulada';
      return '<tr>' +
        '<td data-label="Fecha">' + Shell.fecha(o.fecha_oc) + '</td>' +
        '<td data-label="OC"><strong class="' + (anulada ? 'tachado' : '') + '">' + esc(o.numero_oc) + '</strong></td>' +
        '<td data-label="Cliente">' + esc(o.cliente) + '</td>' +
        '<td data-label="Estado">' + Shell.pill(o.estado || 'abierta') + '</td>' +
        '<td>' + (anulada ? '' :
          '<button type="button" class="b b-danger b-sm" data-anular="oc:' + o.id + '">Anular…</button>') + '</td>' +
        '</tr>';
    }).join('');
  }
  async function cargarOrdenes() {
    try { ordenes = await apiFetch('/api/ordenes-compra'); pintarOrdenes(); }
    catch (err) {
      $('ordenesGrid').innerHTML = '<tr><td colspan="5" class="muted">No se pudo cargar el listado.</td></tr>';
      Shell.error(err, 'cargando las órdenes de compra');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Historial                                                           */
  /* ------------------------------------------------------------------ */
  var ETIQUETA = { FACTURA_VENTA: 'Factura', REMITO: 'Remito', ORDEN_COMPRA: 'OC' };

  async function cargarHistorial() {
    var tbody = $('historialGrid');
    try {
      var filas = await apiFetch('/api/facturas/anulaciones');
      if (!filas.length) {
        tbody.innerHTML = '<tr><td colspan="5">' + Shell.vacio(
          'Todavía no se anuló nada', 'Cada anulación va a quedar registrada acá.') + '</td></tr>';
        return;
      }
      tbody.innerHTML = filas.map(function (a) {
        var partes = [];
        if (a.entidad === 'FACTURA_VENTA') {
          var acc = Array.isArray(a.acciones) ? a.acciones : [];
          var aCuenta = acc.filter(function (x) { return x.accion === 'A_CUENTA'; }).length;
          var anulados = acc.filter(function (x) { return x.accion === 'ANULAR_COBRO'; }).length;
          partes.push((Array.isArray(a.remitos) ? a.remitos.length : 0) + ' remito(s) liberado(s)');
          if (aCuenta) partes.push(aCuenta + ' cobro(s) a cuenta');
          if (anulados) partes.push(anulados + ' cobro(s) anulado(s)');
        } else if (a.entidad === 'REMITO') {
          var unidades = (Array.isArray(a.items) ? a.items : []).reduce(function (s, i) { return s + Number(i.cantidad || 0); }, 0);
          partes.push(unidades + ' unidad(es) devuelta(s) al stock');
        } else if (a.entidad === 'ORDEN_COMPRA') {
          partes.push((Array.isArray(a.items) ? a.items.length : 0) + ' modelo(s) en la orden');
        }
        return '<tr>' +
          '<td data-label="Cuándo">' + cuando(a.creado_en) + '</td>' +
          '<td data-label="Qué"><strong>' + esc(ETIQUETA[a.entidad] || a.entidad) + ' ' + esc(a.numero) + '</strong></td>' +
          '<td data-label="Motivo">' + esc(a.motivo) + '</td>' +
          '<td data-label="Quién">' + esc(a.usuario_nombre) + '</td>' +
          '<td class="solo-escritorio muted" data-label="Detalle">' + esc(partes.join(' · ')) + '</td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No se pudo cargar el historial.</td></tr>';
      Shell.error(err, 'cargando el historial');
    }
  }

  function recargarTodo() {
    return Promise.all([cargarFacturas(), cargarRemitos(), cargarOrdenes(), cargarHistorial()]);
  }

  $('btnBuscar').addEventListener('click', cargarFacturas);
  $('btnLimpiar').addEventListener('click', function () {
    $('filtroNumero').value = ''; $('filtroEstado').value = ''; cargarFacturas();
  });
  $('filtroNumero').addEventListener('keydown', function (e) { if (e.key === 'Enter') cargarFacturas(); });
  $('filtroRemitos').addEventListener('input', pintarRemitos);
  $('filtroOrdenes').addEventListener('input', pintarOrdenes);
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-anular]');
    if (!b) return;
    var partes = b.dataset.anular.split(':');
    abrirAnular(partes[0], partes[1]);
  });

  /* ------------------------------------------------------------------ */
  /* Diálogo de anulación                                                */
  /* ------------------------------------------------------------------ */
  function descForma(f) {
    if (f.tipo === 'CHEQUE') {
      return 'Cheque ' + esc([f.cheque_banco, f.cheque_numero].filter(Boolean).join(' ')) +
        ' (' + esc(String(f.estado || '').replace(/_/g, ' ').toLowerCase()) + ')';
    }
    if (f.tipo === 'RETENCION') return 'Retención ' + esc(f.retencion_tipo || '');
    if (f.tipo === 'TRANSFERENCIA') return 'Transferencia';
    return 'Efectivo';
  }
  function lista(items, fmt) { return items.map(fmt).join(', '); }

  // Cada tipo arma lo que muestra el diálogo a partir de la vista previa del servidor.
  var VISTAS = {
    factura: function (p) {
      var f = p.factura;
      var li = ['La factura queda <strong>ANULADA</strong> y deja de sumar en la deuda del cliente.'];
      li.push(p.remitos.length
        ? 'Estos remitos vuelven a quedar <strong>pendientes de facturar</strong>: ' +
          lista(p.remitos, function (r) { return esc(r.remito_numero || ('venta #' + r.venta_id)) + ' (' + r.unidades + ' u.)'; }) + '.'
        : 'No tiene remitos asociados.');
      li.push('El stock de transformadores <strong>no cambia</strong> (se mueve con el remito, no con la factura).');
      li.push('El número <strong>' + esc(f.numero_factura) + '</strong> puede volver a usarse para cargar la factura corregida.');
      return {
        titulo: 'Anular factura ' + f.numero_factura,
        identificador: f.numero_factura,
        resumen: '<strong>' + esc(f.tipo_factura || '') + ' ' + esc(f.numero_factura) + '</strong> · ' + esc(f.cliente_nombre) +
          '<br><span class="muted">' + Shell.fecha(f.fecha) + ' · Total ' + Shell.money(f.total) + ' (con IVA)</span>',
        consecuencias: li,
        cobros: p.cobros
      };
    },
    remito: function (p) {
      var v = p.venta;
      var unidades = p.items.reduce(function (s, i) { return s + Number(i.cantidad); }, 0);
      var li = ['El remito queda <strong>ANULADO</strong>.'];
      li.push(p.items.length
        ? 'Vuelven al stock <strong>' + unidades + ' unidad(es)</strong>: ' +
          lista(p.items, function (i) { return esc(i.modelo || ('ficha ' + i.ficha_id)) + ' × ' + i.cantidad; }) + '.'
        : 'No tiene ítems: no cambia el stock.');
      if (v.numero_oc) li.push('En la OC <strong>' + esc(v.numero_oc) + '</strong> esas unidades vuelven a figurar como pendientes de entregar.');
      li.push('Se guarda una copia de los ítems en el historial de anulaciones.');
      return {
        titulo: 'Anular remito ' + v.identificador,
        identificador: v.identificador,
        resumen: '<strong>Remito ' + esc(v.identificador) + '</strong> · ' + esc(v.cliente_nombre) +
          '<br><span class="muted">' + Shell.fecha(v.remito_fecha || v.fecha) + (v.numero_oc ? ' · OC ' + esc(v.numero_oc) : '') + '</span>',
        consecuencias: li,
        cobros: null
      };
    },
    oc: function (p) {
      var o = p.oc;
      var li = ['La orden queda <strong>ANULADA</strong>: no admite más ítems ni entregas.'];
      li.push(p.items.length
        ? 'Modelos que tenía: ' + lista(p.items, function (i) { return esc(i.modelo || ('ficha ' + i.ficha_id)) + ' × ' + i.cantidad_pedida; }) + '.'
        : 'No tenía ítems cargados.');
      li.push('Se guarda una copia de sus ítems en el historial de anulaciones.');
      return {
        titulo: 'Anular OC ' + o.identificador,
        identificador: o.identificador,
        resumen: '<strong>OC ' + esc(o.identificador) + '</strong> · ' + esc(o.cliente_nombre) +
          '<br><span class="muted">' + Shell.fecha(o.fecha_oc) + '</span>',
        consecuencias: li,
        cobros: null
      };
    }
  };

  function limpiarError() { $('anularError').hidden = true; $('anularError').textContent = ''; }
  function mostrarError(msg) { $('anularError').textContent = msg; $('anularError').hidden = false; }

  // Se vuelve a dejar todo en blanco cada vez que se abre: el <dialog> persiste.
  function resetDialogo() {
    actual = null; enviando = false;
    $('anularMotivo').value = ''; $('anularConfirmar').value = '';
    $('anularMotivo').classList.remove('is-invalid'); $('anularConfirmar').classList.remove('is-invalid');
    $('anularResumen').innerHTML = ''; $('anularConsecuencias').innerHTML = '';
    $('anularCobros').innerHTML = ''; $('anularCobrosBloque').hidden = true;
    $('anularBloqueos').innerHTML = ''; $('anularBloqueos').hidden = true;
    $('anularFormBloque').hidden = false;
    $('btnConfirmarAnular').disabled = true; $('btnConfirmarAnular').textContent = 'Anular';
    limpiarError();
  }

  async function abrirAnular(tipo, id) {
    if (!TIPOS[tipo]) return;
    resetDialogo();
    try {
      var p = await apiFetch(TIPOS[tipo].base + '/' + encodeURIComponent(id) + '/anulacion-preview');
      var v = VISTAS[tipo](p);
      actual = { tipo: tipo, id: id, identificador: v.identificador, bloqueos: p.bloqueos };

      $('anularTitulo').textContent = v.titulo;
      $('anularNumeroRef').textContent = v.identificador;
      $('anularNumeroTipo').textContent = TIPOS[tipo].confirmar;
      $('btnConfirmarAnular').textContent = TIPOS[tipo].boton;
      $('anularResumen').innerHTML = v.resumen;
      $('anularConsecuencias').innerHTML = v.consecuencias.map(function (x) { return '<li>' + x + '</li>'; }).join('');

      if (v.cobros && v.cobros.length) {
        $('anularCobrosBloque').hidden = false;
        $('anularCobros').innerHTML = v.cobros.map(function (c) {
          var otras = c.tambien_imputado_en.length
            ? '<br><span class="muted">También imputado en: ' + c.tambien_imputado_en.map(function (o) { return esc(o.numero_factura); }).join(', ') +
              ' (si anulás el cobro, esas imputaciones también se sueltan)</span>' : '';
          return '<div class="cobro-linea">' +
            '<div>Cobro del ' + Shell.fecha(c.fecha_recepcion) + ': ' + c.formas.map(descForma).join(' + ') +
              '<br><span class="muted">Imputado a esta factura: ' + Shell.money(c.monto_imputado_a_esta_factura) + '</span>' + otras + '</div>' +
            '<select class="select" data-pago="' + c.pago_id + '" aria-label="Qué hacer con este cobro">' +
              '<option value="A_CUENTA">Dejar a cuenta (queda anotado de qué factura viene)</option>' +
              '<option value="ANULAR_COBRO"' + (c.puede_anularse ? '' : ' disabled') + '>' +
                (c.puede_anularse ? 'Anular este cobro' : 'Anular este cobro — no se puede: ' + esc(c.motivo_no_anulable)) + '</option>' +
            '</select></div>';
        }).join('');
      }

      if (p.bloqueos.length) {
        $('anularBloqueos').hidden = false;
        $('anularBloqueos').innerHTML = p.bloqueos.map(function (b) {
          return '<div class="notice notice-err">' + esc(b) + '</div>';
        }).join('');
        $('anularFormBloque').hidden = true;
      }
      validar();
      $('anularModal').showModal();
    } catch (err) {
      Shell.error(err, 'preparando la anulación');
    }
  }

  function validar() {
    if (!actual) return;
    var motivoOk = $('anularMotivo').value.trim().length >= MOTIVO_MIN;
    var numOk = $('anularConfirmar').value.trim() === String(actual.identificador).trim();
    var sinBloqueos = actual.bloqueos.length === 0;
    $('btnConfirmarAnular').disabled = enviando || !(motivoOk && numOk && sinBloqueos);
    // Solo se marca en rojo lo que la persona ya empezó a escribir mal.
    $('anularMotivo').classList.toggle('is-invalid', $('anularMotivo').value.length > 0 && !motivoOk);
    $('anularConfirmar').classList.toggle('is-invalid', $('anularConfirmar').value.length > 0 && !numOk);
  }
  $('anularMotivo').addEventListener('input', function () { limpiarError(); validar(); });
  $('anularConfirmar').addEventListener('input', function () { limpiarError(); validar(); });

  $('btnConfirmarAnular').addEventListener('click', async function () {
    if (!actual || enviando) return;
    enviando = true; limpiarError();
    var btn = $('btnConfirmarAnular');
    var textoBoton = TIPOS[actual.tipo].boton;
    btn.disabled = true; btn.textContent = 'Anulando…';
    var cuerpo = { motivo: $('anularMotivo').value.trim(), confirmar_numero: $('anularConfirmar').value.trim() };
    if (actual.tipo === 'factura') {
      cuerpo.acciones_cobros = Array.prototype.map.call($('anularCobros').querySelectorAll('select[data-pago]'), function (s) {
        return { pago_id: parseInt(s.dataset.pago, 10), accion: s.value };
      });
    }
    try {
      var r = await apiFetch(TIPOS[actual.tipo].base + '/' + encodeURIComponent(actual.id) + '/anular', {
        method: 'POST', body: JSON.stringify(cuerpo)
      });
      $('anularModal').close();
      Shell.toast('ok', 'Anulado', esc(r.message || ''));
      await recargarTodo();
    } catch (err) {
      // Error dentro del diálogo: un modal puede tapar el toast del shell.
      mostrarError(errorTexto(err, 'No se pudo anular.'));
      btn.textContent = textoBoton;
    } finally {
      enviando = false;
      validar();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Inicio                                                              */
  /* ------------------------------------------------------------------ */
  cargarFacturas().then(function () {
    // Enlace desde oc_detalle: correcciones.html?factura=ID abre el diálogo directo.
    var id = new URLSearchParams(location.search).get('factura');
    if (id && /^\d+$/.test(id)) abrirAnular('factura', id);
  });
})();

// Correcciones — anular facturas de venta.
// Backend: GET /api/facturas, GET /api/facturas/:id/anulacion-preview,
// POST /api/facturas/:id/anular, GET /api/facturas/anulaciones.
(function () {
  'use strict';

  var MOTIVO_MIN = 10;
  var $ = function (id) { return document.getElementById(id); };
  var actual = null;   // { factura, cobros, bloqueos, ... } del diálogo abierto
  var enviando = false;

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
            '<button type="button" class="b b-danger b-sm" data-anular="' + f.id + '">Anular…</button>') + '</td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">No se pudo cargar el listado.</td></tr>';
      Shell.error(err, 'cargando las facturas');
    }
  }

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
        var acc = Array.isArray(a.acciones) ? a.acciones : [];
        var aCuenta = acc.filter(function (x) { return x.accion === 'A_CUENTA'; }).length;
        var anulados = acc.filter(function (x) { return x.accion === 'ANULAR_COBRO'; }).length;
        var partes = [];
        var rem = Array.isArray(a.remitos) ? a.remitos.length : 0;
        partes.push(rem + ' remito(s) liberado(s)');
        if (aCuenta) partes.push(aCuenta + ' cobro(s) a cuenta');
        if (anulados) partes.push(anulados + ' cobro(s) anulado(s)');
        return '<tr>' +
          '<td data-label="Cuándo">' + cuando(a.creado_en) + '</td>' +
          '<td data-label="Factura"><strong>' + esc(a.numero) + '</strong></td>' +
          '<td data-label="Motivo">' + esc(a.motivo) + '</td>' +
          '<td data-label="Quién">' + esc(a.usuario_nombre) + '</td>' +
          '<td class="solo-escritorio muted" data-label="Qué pasó">' + esc(partes.join(' · ')) + '</td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">No se pudo cargar el historial.</td></tr>';
      Shell.error(err, 'cargando el historial');
    }
  }

  $('btnBuscar').addEventListener('click', cargarFacturas);
  $('btnLimpiar').addEventListener('click', function () {
    $('filtroNumero').value = ''; $('filtroEstado').value = ''; cargarFacturas();
  });
  $('filtroNumero').addEventListener('keydown', function (e) { if (e.key === 'Enter') cargarFacturas(); });
  $('facturasGrid').addEventListener('click', function (e) {
    var b = e.target.closest('[data-anular]');
    if (b) abrirAnular(b.dataset.anular);
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
    $('btnConfirmarAnular').disabled = true; $('btnConfirmarAnular').textContent = 'Anular factura';
    limpiarError();
  }

  async function abrirAnular(id) {
    resetDialogo();
    try {
      var p = await apiFetch('/api/facturas/' + encodeURIComponent(id) + '/anulacion-preview');
      actual = p;
      var f = p.factura;
      $('anularTitulo').textContent = 'Anular factura ' + f.numero_factura;
      $('anularNumeroRef').textContent = f.numero_factura;
      $('anularResumen').innerHTML =
        '<strong>' + esc(f.tipo_factura || '') + ' ' + esc(f.numero_factura) + '</strong> · ' + esc(f.cliente_nombre) +
        '<br><span class="muted">' + Shell.fecha(f.fecha) + ' · Total ' + Shell.money(f.total) + ' (con IVA)</span>';

      var li = [];
      li.push('La factura queda <strong>ANULADA</strong> y deja de sumar en la deuda del cliente.');
      if (p.remitos.length) {
        li.push('Estos remitos vuelven a quedar <strong>pendientes de facturar</strong>: ' +
          p.remitos.map(function (r) { return esc(r.remito_numero || ('venta #' + r.venta_id)) + ' (' + r.unidades + ' u.)'; }).join(', ') + '.');
      } else {
        li.push('No tiene remitos asociados.');
      }
      li.push('El stock de transformadores <strong>no cambia</strong> (se mueve con el remito, no con la factura).');
      li.push('El número <strong>' + esc(f.numero_factura) + '</strong> puede volver a usarse para cargar la factura corregida.');
      $('anularConsecuencias').innerHTML = li.map(function (x) { return '<li>' + x + '</li>'; }).join('');

      if (p.cobros.length) {
        $('anularCobrosBloque').hidden = false;
        $('anularCobros').innerHTML = p.cobros.map(function (c) {
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
    var numOk = $('anularConfirmar').value.trim() === String(actual.factura.numero_factura).trim();
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
    btn.disabled = true; btn.textContent = 'Anulando…';
    var acciones = Array.prototype.map.call($('anularCobros').querySelectorAll('select[data-pago]'), function (s) {
      return { pago_id: parseInt(s.dataset.pago, 10), accion: s.value };
    });
    try {
      var r = await apiFetch('/api/facturas/' + encodeURIComponent(actual.factura.id) + '/anular', {
        method: 'POST',
        body: JSON.stringify({
          motivo: $('anularMotivo').value.trim(),
          confirmar_numero: $('anularConfirmar').value.trim(),
          acciones_cobros: acciones
        })
      });
      $('anularModal').close();
      Shell.toast('ok', 'Factura anulada', esc(r.message || ''));
      await Promise.all([cargarFacturas(), cargarHistorial()]);
    } catch (err) {
      // Error dentro del diálogo: un modal puede tapar el toast del shell.
      mostrarError(errorTexto(err, 'No se pudo anular la factura.'));
      btn.textContent = 'Anular factura';
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
    if (id && /^\d+$/.test(id)) abrirAnular(id);
  });
})();

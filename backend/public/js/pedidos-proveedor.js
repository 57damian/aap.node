// Pedidos a proveedores — armar el pedido de materia prima y descargar el
// PDF con membrete para mandarlo por correo.
// Backend: routes/pedidos-proveedor.routes.js
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var materiasPrimas = [];
  var pedidoActual = null; // { id, numero, estado } del diálogo "Ver" abierto

  // Todo lo que viene de la base (nombres, motivos, observaciones cargadas
  // por una persona) se escapa antes de armar HTML.
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function errorTexto(err, porDefecto) {
    return (err && (err.error || err.message)) || porDefecto;
  }

  /* ------------------------------------------------------------------ */
  /* Datos de referencia (proveedores, materias primas)                  */
  /* ------------------------------------------------------------------ */
  function fechaHoy() { return new Date().toISOString().split('T')[0]; }

  async function cargarProveedoresSelect() {
    var select = $('pp_proveedor_id');
    try {
      var proveedores = await apiFetch('/api/proveedores');
      select.innerHTML = '<option value="">Elegí un proveedor…</option>' +
        proveedores.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }).join('');
    } catch (err) {
      Shell.error(err, 'cargando proveedores');
    }
  }

  async function cargarMateriasPrimas() {
    try {
      materiasPrimas = await apiFetch('/api/materias-primas');
    } catch (err) {
      Shell.error(err, 'cargando materias primas');
      materiasPrimas = [];
    }
  }

  function opcionesMateriaPrima() {
    return '<option value="">Elegí un material…</option>' +
      materiasPrimas.map(function (mp) {
        return '<option value="' + mp.id + '" data-unidad="' + esc(mp.unidad_medida || 'UNI') + '">' +
          esc(mp.codigo ? mp.codigo + ' — ' + mp.nombre : mp.nombre) + '</option>';
      }).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Alta: armado de ítems                                               */
  /* ------------------------------------------------------------------ */
  function agregarFilaItem() {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><select class="select" data-campo="materia_prima_id" required>' + opcionesMateriaPrima() + '</select></td>' +
      '<td><input class="input" type="number" data-campo="cantidad" min="0.01" step="0.01" required></td>' +
      '<td><input class="input" type="text" data-campo="unidad_medida" maxlength="20"></td>' +
      '<td style="text-align:center"><input type="checkbox" data-campo="aproximado" title="Cantidad de referencia"></td>' +
      '<td><input class="input" type="text" data-campo="observaciones" maxlength="300" placeholder="Opcional"></td>' +
      '<td><button type="button" class="b b-ghost b-sm" data-quitar-item>Quitar</button></td>';

    var selectMp = tr.querySelector('[data-campo="materia_prima_id"]');
    var inputUnidad = tr.querySelector('[data-campo="unidad_medida"]');
    selectMp.addEventListener('change', function () {
      var op = selectMp.selectedOptions[0];
      inputUnidad.value = op ? (op.dataset.unidad || 'UNI') : '';
    });
    tr.querySelector('[data-quitar-item]').addEventListener('click', function () { tr.remove(); });

    $('pp_itemsBody').appendChild(tr);
  }

  function recolectarItems() {
    var filas = Array.prototype.slice.call($('pp_itemsBody').querySelectorAll('tr'));
    return filas.map(function (fila) {
      return {
        materia_prima_id: fila.querySelector('[data-campo="materia_prima_id"]').value,
        cantidad: fila.querySelector('[data-campo="cantidad"]').value,
        unidad_medida: fila.querySelector('[data-campo="unidad_medida"]').value,
        aproximado: fila.querySelector('[data-campo="aproximado"]').checked,
        observaciones: fila.querySelector('[data-campo="observaciones"]').value
      };
    }).filter(function (it) { return it.materia_prima_id; });
  }

  function resetFormPedido() {
    $('pedidoForm').reset();
    $('pp_fecha').value = fechaHoy();
    $('pp_itemsBody').innerHTML = '';
    agregarFilaItem();
  }

  async function handleSubmitPedido(e) {
    e.preventDefault();
    var items = recolectarItems();
    if (!items.length) {
      Shell.toast('warn', 'Agregá al menos un ítem con material seleccionado');
      return;
    }
    var body = {
      proveedor_id: $('pp_proveedor_id').value,
      fecha: $('pp_fecha').value,
      observaciones: $('pp_observaciones').value,
      items: items
    };
    if (!body.proveedor_id) {
      Shell.toast('warn', 'Elegí un proveedor');
      return;
    }
    try {
      await apiFetch('/api/pedidos-proveedor', { method: 'POST', body: JSON.stringify(body) });
      Shell.toast('ok', 'Pedido creado como borrador');
      resetFormPedido();
      $('panelNuevoPedido').hidden = true;
      cargarPedidos();
    } catch (err) {
      Shell.error(err, 'creando el pedido');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Listado                                                             */
  /* ------------------------------------------------------------------ */
  async function cargarPedidos() {
    var tbody = $('listaPedidos');
    tbody.innerHTML = '<tr><td colspan="6" class="muted">Cargando…</td></tr>';
    try {
      var pedidos = await apiFetch('/api/pedidos-proveedor');
      if (!pedidos.length) {
        tbody.innerHTML = '<tr><td colspan="6">' + Shell.vacio(
          'Todavía no hay pedidos a proveedores', 'Creá el primero con el botón "Nuevo pedido".') + '</td></tr>';
        return;
      }
      tbody.innerHTML = pedidos.map(function (p) {
        return '<tr>' +
          '<td><strong>' + esc(p.numero) + '</strong></td>' +
          '<td data-label="Proveedor">' + esc(p.proveedor_nombre) + '</td>' +
          '<td class="muted solo-escritorio" data-label="Fecha">' + Shell.fecha(p.fecha) + '</td>' +
          '<td class="num solo-escritorio" data-label="Ítems">' + esc(p.cantidad_items) + '</td>' +
          '<td data-label="Estado">' + Shell.pill(p.estado) + '</td>' +
          '<td><button type="button" class="b b-ghost b-sm" data-ver-pedido="' + p.id + '">Ver</button></td>' +
          '</tr>';
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">No se pudo cargar el listado.</td></tr>';
      Shell.error(err, 'cargando los pedidos a proveedores');
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ver-pedido]');
    if (b) verPedido(b.dataset.verPedido);
  });

  /* ------------------------------------------------------------------ */
  /* Ver pedido                                                          */
  /* ------------------------------------------------------------------ */
  function limpiarVpError() { $('vpError').hidden = true; $('vpError').textContent = ''; }
  function mostrarVpError(msg) { $('vpError').textContent = msg; $('vpError').hidden = false; }

  async function verPedido(id) {
    limpiarVpError();
    try {
      var p = await apiFetch('/api/pedidos-proveedor/' + encodeURIComponent(id));
      pedidoActual = { id: p.id, numero: p.numero, estado: p.estado };

      $('vpTitulo').textContent = 'Pedido ' + p.numero;
      $('vpResumen').innerHTML =
        '<strong>' + esc(p.proveedor_nombre) + '</strong> · ' + Shell.fecha(p.fecha) + ' · ' + Shell.pill(p.estado) +
        (p.estado === 'ANULADO' && p.motivo_anulacion
          ? '<div class="muted" style="margin-top:4px">Motivo de anulación: ' + esc(p.motivo_anulacion) + '</div>' : '');

      $('vpItems').innerHTML = p.items.map(function (it) {
        return '<tr>' +
          '<td>' + esc(it.materia_codigo || '—') + '</td>' +
          '<td>' + esc(it.materia_nombre) + '</td>' +
          '<td class="num">' + Number(it.cantidad).toLocaleString('es-AR') + (it.aproximado ? ' <span class="muted">(aprox.)</span>' : '') + '</td>' +
          '<td>' + esc(it.unidad_medida) + '</td>' +
          '<td class="muted">' + esc(it.observaciones || '') + '</td>' +
          '</tr>';
      }).join('');

      $('vpObservaciones').innerHTML = p.observaciones ? 'Observaciones: ' + esc(p.observaciones) : '';

      $('btnMarcarEnviado').hidden = p.estado !== 'BORRADOR';
      $('btnBorrarPedido').hidden = p.estado !== 'BORRADOR';
      $('btnAbrirAnularPedido').hidden = p.estado === 'ANULADO';

      $('verPedidoModal').showModal();
    } catch (err) {
      Shell.error(err, 'cargando el pedido');
    }
  }

  $('btnDescargarPdf').addEventListener('click', async function () {
    if (!pedidoActual) return;
    try {
      await descargarArchivoProtegido('api/pedidos-proveedor/' + pedidoActual.id + '/pdf', 'Pedido-' + pedidoActual.numero + '.pdf');
    } catch (err) {
      mostrarVpError(errorTexto(err, 'No se pudo descargar el PDF.'));
    }
  });

  $('btnMarcarEnviado').addEventListener('click', async function () {
    if (!pedidoActual) return;
    try {
      await apiFetch('/api/pedidos-proveedor/' + pedidoActual.id + '/enviar', { method: 'POST' });
      Shell.toast('ok', 'Pedido marcado como enviado');
      $('verPedidoModal').close();
      cargarPedidos();
    } catch (err) {
      mostrarVpError(errorTexto(err, 'No se pudo marcar como enviado.'));
    }
  });

  $('btnBorrarPedido').addEventListener('click', async function () {
    if (!pedidoActual) return;
    try {
      await apiFetch('/api/pedidos-proveedor/' + pedidoActual.id, { method: 'DELETE' });
      Shell.toast('ok', 'Pedido borrado');
      $('verPedidoModal').close();
      cargarPedidos();
    } catch (err) {
      mostrarVpError(errorTexto(err, 'No se pudo borrar el pedido.'));
    }
  });

  /* ------------------------------------------------------------------ */
  /* Anular pedido                                                       */
  /* ------------------------------------------------------------------ */
  function limpiarAnularError() { $('anularPedidoError').hidden = true; $('anularPedidoError').textContent = ''; }
  function mostrarAnularError(msg) { $('anularPedidoError').textContent = msg; $('anularPedidoError').hidden = false; }

  $('btnAbrirAnularPedido').addEventListener('click', function () {
    $('motivoAnularPedido').value = '';
    limpiarAnularError();
    $('anularPedidoModal').showModal();
  });

  $('btnConfirmarAnularPedido').addEventListener('click', async function () {
    if (!pedidoActual) return;
    var motivo = $('motivoAnularPedido').value.trim();
    if (motivo.length < 5) {
      mostrarAnularError('El motivo tiene que tener al menos 5 caracteres.');
      return;
    }
    try {
      await apiFetch('/api/pedidos-proveedor/' + pedidoActual.id + '/anular', {
        method: 'POST', body: JSON.stringify({ motivo: motivo })
      });
      $('anularPedidoModal').close();
      $('verPedidoModal').close();
      Shell.toast('ok', 'Pedido anulado');
      cargarPedidos();
    } catch (err) {
      mostrarAnularError(errorTexto(err, 'No se pudo anular el pedido.'));
    }
  });

  /* ------------------------------------------------------------------ */
  /* Inicio                                                              */
  /* ------------------------------------------------------------------ */
  $('pedidoForm').addEventListener('submit', handleSubmitPedido);
  $('btnAgregarItemPedido').addEventListener('click', agregarFilaItem);

  cargarProveedoresSelect();
  cargarMateriasPrimas().then(function () { resetFormPedido(); });
  cargarPedidos();
})();

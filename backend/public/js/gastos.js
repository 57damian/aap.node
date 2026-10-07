// Gastos varios — alta, edición, anulación y categorías.
// Backend: routes/gastos.routes.js
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var categorias = [];
  var gastos = [];
  var gastoEditandoId = null;   // null = alta
  var gastoAnulandoId = null;
  var categoriaEditandoId = null;

  var FORMAS = { EFECTIVO: 'Efectivo', TRANSFERENCIA: 'Transferencia', CHEQUE: 'Cheque', DEBITO: 'Débito automático', OTRO: 'Otro' };

  // Todo lo que viene de la base (descripciones, motivos, nombres) se escapa.
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function errorTexto(err, porDefecto) { return (err && (err.error || err.message)) || porDefecto; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fechaISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function mostrarError(id, msg) {
    var el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ------------------------------------------------------------------ */
  /* Categorías                                                          */
  /* ------------------------------------------------------------------ */
  async function cargarCategorias() {
    try {
      categorias = await apiFetch('/api/gastos/categorias');
    } catch (err) {
      Shell.error(err, 'cargando las categorías');
      categorias = [];
    }
    var filtro = $('fCategoria').value;
    $('fCategoria').innerHTML = '<option value="">Todas</option>' + categorias.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.nombre) + (c.activa ? '' : ' (desactivada)') + '</option>';
    }).join('');
    $('fCategoria').value = filtro;
    pintarCategorias();
  }

  function opcionesCategoriaGasto(seleccionada) {
    return categorias.filter(function (c) { return c.activa || String(c.id) === String(seleccionada); })
      .map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.nombre) + (c.activa ? '' : ' (desactivada)') + '</option>';
      }).join('');
  }

  function pintarCategorias() {
    $('categoriasBody').innerHTML = categorias.map(function (c) {
      return '<tr' + (c.activa ? '' : ' class="muted"') + '>' +
        '<td data-label="Nombre">' + esc(c.nombre) + (c.activa ? '' : ' <span class="muted">(desactivada)</span>') + '</td>' +
        '<td class="num" data-label="Gastos">' + c.cantidad + '</td>' +
        '<td data-label="Tipo">' + (c.es_impuesto ? 'Impuesto' : 'Gasto') + '</td>' +
        '<td><button type="button" class="b b-ghost b-sm" data-editar-cat="' + c.id + '">Editar</button> ' +
        '<button type="button" class="b b-ghost b-sm" data-toggle-cat="' + c.id + '">' + (c.activa ? 'Desactivar' : 'Activar') + '</button> ' +
        '<button type="button" class="b b-ghost b-sm" data-eliminar-cat="' + c.id + '">Eliminar</button></td>' +
        '</tr>';
    }).join('');
  }

  function resetFormCategoria() {
    categoriaEditandoId = null;
    $('categoriaForm').reset();
    $('c_label').textContent = 'Nueva categoría';
    $('btnGuardarCategoria').textContent = 'Agregar';
    $('btnCancelarCategoria').hidden = true;
    mostrarError('categoriaError', '');
  }

  var categoriaEnviando = false;
  async function guardarCategoria(e) {
    e.preventDefault();
    if (categoriaEnviando) return;
    categoriaEnviando = true;
    var btn = $('btnGuardarCategoria');
    btn.disabled = true;
    mostrarError('categoriaError', '');
    try {
      var body = { nombre: $('c_nombre').value, es_impuesto: $('c_impuesto').checked };
      if (categoriaEditandoId) {
        var actual = categorias.find(function (c) { return c.id === categoriaEditandoId; });
        body.activa = actual ? actual.activa : true;
        await apiFetch('/api/gastos/categorias/' + categoriaEditandoId, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/api/gastos/categorias', { method: 'POST', body: JSON.stringify(body) });
      }
      resetFormCategoria();
      await cargarCategorias();
      cargarGastos();
    } catch (err) {
      mostrarError('categoriaError', errorTexto(err, 'No se pudo guardar la categoría'));
    } finally {
      categoriaEnviando = false;
      btn.disabled = false;
      btn.textContent = categoriaEditandoId ? 'Guardar cambios' : 'Agregar';
    }
  }

  async function cambiarActiva(id) {
    var c = categorias.find(function (x) { return x.id === id; });
    if (!c) return;
    try {
      await apiFetch('/api/gastos/categorias/' + id, {
        method: 'PUT',
        body: JSON.stringify({ nombre: c.nombre, es_impuesto: c.es_impuesto, activa: !c.activa })
      });
      await cargarCategorias();
    } catch (err) {
      mostrarError('categoriaError', errorTexto(err, 'No se pudo cambiar la categoría'));
    }
  }

  async function eliminarCategoria(id) {
    try {
      await apiFetch('/api/gastos/categorias/' + id, { method: 'DELETE' });
      mostrarError('categoriaError', '');
      await cargarCategorias();
    } catch (err) {
      mostrarError('categoriaError', errorTexto(err, 'No se pudo eliminar la categoría'));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Listado                                                             */
  /* ------------------------------------------------------------------ */
  function paramsFiltro() {
    var p = new URLSearchParams();
    if ($('fDesde').value) p.set('desde', $('fDesde').value);
    if ($('fHasta').value) p.set('hasta', $('fHasta').value);
    if ($('fCategoria').value) p.set('categoria_id', $('fCategoria').value);
    if ($('fEstado').value) p.set('estado', $('fEstado').value);
    return p.toString();
  }

  function pintarKpis(r) {
    $('kpis').innerHTML =
      '<div class="kpi is-info"><div class="kpi-k">Total de gastos</div>' +
        '<div class="kpi-v">' + Shell.money(r.total) + '</div>' +
        '<div class="kpi-sub">' + r.cantidad + ' gasto' + (r.cantidad === 1 ? '' : 's') + ' en el período</div></div>' +
      '<div class="kpi is-warning"><div class="kpi-k">Impuestos</div>' +
        '<div class="kpi-v">' + Shell.money(r.impuestos) + '</div>' +
        '<div class="kpi-sub">categorías marcadas como impuesto</div></div>' +
      '<div class="kpi"><div class="kpi-k">Otros gastos</div>' +
        '<div class="kpi-v">' + Shell.money(r.otros) + '</div>' +
        '<div class="kpi-sub">contador, sueldos, banco, caja chica…</div></div>';
  }

  async function cargarGastos() {
    var tbody = $('listaGastos');
    tbody.innerHTML = '<tr><td colspan="8" class="muted">Cargando…</td></tr>';
    try {
      var q = paramsFiltro();
      var data = await apiFetch('/api/gastos' + (q ? '?' + q : ''));
      gastos = data.gastos;
      pintarKpis(data.resumen);
      if (!gastos.length) {
        tbody.innerHTML = '<tr><td colspan="8">' +
          Shell.vacio('No hay gastos en este período', 'Cargá el primero con "Nuevo gasto" o cambiá el filtro de fechas.') + '</td></tr>';
        return;
      }
      tbody.innerHTML = gastos.map(function (g) {
        var anulado = g.estado === 'ANULADO';
        var acciones = anulado
          ? '<span class="muted" title="' + esc(g.motivo_anulacion || '') + '">Anulado</span>'
          : '<button type="button" class="b b-ghost b-sm" data-editar="' + g.id + '">Editar</button> ' +
            '<button type="button" class="b b-ghost b-sm" data-anular="' + g.id + '">Anular…</button>';
        return '<tr' + (anulado ? ' class="muted"' : '') + '>' +
          '<td data-label="Fecha">' + Shell.fecha(g.fecha) + '</td>' +
          '<td data-label="Categoría">' + esc(g.categoria_nombre) + (g.es_impuesto ? ' <span class="muted">(impuesto)</span>' : '') + '</td>' +
          '<td data-label="Descripción">' + esc(g.descripcion) +
            (g.comprobante ? ' <span class="muted">· ' + esc(g.comprobante) + '</span>' : '') + '</td>' +
          '<td class="solo-escritorio" data-label="Forma de pago">' + esc(FORMAS[g.forma_pago] || '—') + '</td>' +
          '<td class="num solo-escritorio" data-label="Neto">' + Shell.money(g.neto) + '</td>' +
          '<td class="num solo-escritorio" data-label="IVA">' + (Number(g.iva) ? Shell.money(g.iva) : '—') + '</td>' +
          '<td class="num" data-label="Total">' + Shell.money(g.total) + '</td>' +
          '<td>' + acciones + '</td></tr>';
      }).join('');
    } catch (err) {
      Shell.error(err, 'cargando los gastos');
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No se pudieron cargar los gastos.</td></tr>';
    }
  }

  function exportarCsv() {
    if (!gastos.length) { Shell.toast('warn', 'No hay gastos para exportar'); return; }
    function celda(v) { return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'; }
    var num = function (v) { return String(Number(v) || 0).replace('.', ','); };
    var filas = [['Fecha', 'Categoría', 'Descripción', 'Forma de pago', 'Comprobante', 'Neto', 'IVA', 'Total', 'Estado']];
    gastos.forEach(function (g) {
      filas.push([g.fecha, g.categoria_nombre, g.descripcion, FORMAS[g.forma_pago] || '', g.comprobante || '',
        num(g.neto), num(g.iva), num(g.total), g.estado === 'ANULADO' ? 'Anulado' : 'Vigente']);
    });
    var csv = '﻿' + filas.map(function (f) { return f.map(celda).join(';'); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gastos-' + ($('fDesde').value || 'inicio') + '-a-' + ($('fHasta').value || 'hoy') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Alta / edición                                                      */
  /* ------------------------------------------------------------------ */
  function actualizarTotal() {
    var neto = Number(String($('g_neto').value).replace(',', '.')) || 0;
    var iva = Number(String($('g_iva').value).replace(',', '.')) || 0;
    $('g_total').textContent = Shell.money(Math.round((neto + iva) * 100) / 100);
  }

  function abrirGasto(gasto) {
    gastoEditandoId = gasto ? gasto.id : null;
    $('gastoForm').reset();
    mostrarError('gastoError', '');
    $('gastoTitulo').textContent = gasto ? 'Editar gasto' : 'Nuevo gasto';
    $('g_categoria').innerHTML = opcionesCategoriaGasto(gasto ? gasto.categoria_id : null);
    if (gasto) {
      $('g_fecha').value = gasto.fecha;
      $('g_categoria').value = gasto.categoria_id;
      $('g_descripcion').value = gasto.descripcion;
      $('g_neto').value = gasto.neto;
      $('g_iva').value = Number(gasto.iva) ? gasto.iva : '';
      $('g_forma_pago').value = gasto.forma_pago || '';
      $('g_comprobante').value = gasto.comprobante || '';
    } else {
      $('g_fecha').value = fechaISO(new Date());
    }
    actualizarTotal();
    $('gastoModal').showModal();
    $('g_descripcion').focus();
  }

  // Un doble click en "Guardar" mandaba dos POST idénticos y el gasto
  // quedaba duplicado (no hay UNIQUE que lo frene): flag + botón deshabilitado.
  var gastoEnviando = false;
  async function guardarGasto(e) {
    e.preventDefault();
    if (gastoEnviando) return;
    gastoEnviando = true;
    var btn = $('btnGuardarGasto');
    var texto = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    mostrarError('gastoError', '');
    try {
      var body = {
        fecha: $('g_fecha').value,
        categoria_id: $('g_categoria').value,
        descripcion: $('g_descripcion').value,
        neto: $('g_neto').value,
        iva: $('g_iva').value,
        forma_pago: $('g_forma_pago').value,
        comprobante: $('g_comprobante').value
      };
      if (gastoEditandoId) {
        await apiFetch('/api/gastos/' + gastoEditandoId, { method: 'PUT', body: JSON.stringify(body) });
        Shell.toast('ok', 'Gasto actualizado');
      } else {
        await apiFetch('/api/gastos', { method: 'POST', body: JSON.stringify(body) });
        Shell.toast('ok', 'Gasto guardado');
      }
      $('gastoModal').close();
      await cargarCategorias();
      cargarGastos();
    } catch (err) {
      mostrarError('gastoError', errorTexto(err, 'No se pudo guardar el gasto'));
    } finally {
      gastoEnviando = false;
      btn.disabled = false;
      btn.textContent = texto;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Anulación                                                           */
  /* ------------------------------------------------------------------ */
  function abrirAnular(id) {
    var g = gastos.find(function (x) { return x.id === id; });
    if (!g) return;
    gastoAnulandoId = id;
    $('anularResumen').innerHTML = esc(g.descripcion) + ' — <strong>' + Shell.money(g.total) + '</strong> (' + Shell.fecha(g.fecha) + ')';
    $('anularMotivo').value = '';
    mostrarError('anularError', '');
    $('anularModal').showModal();
    $('anularMotivo').focus();
  }

  var anulando = false;
  async function confirmarAnular() {
    if (anulando) return;
    anulando = true;
    var btn = $('btnConfirmarAnular');
    btn.disabled = true;
    mostrarError('anularError', '');
    try {
      await apiFetch('/api/gastos/' + gastoAnulandoId + '/anular', {
        method: 'POST', body: JSON.stringify({ motivo: $('anularMotivo').value })
      });
      $('anularModal').close();
      Shell.toast('ok', 'Gasto anulado');
      await cargarCategorias();
      cargarGastos();
    } catch (err) {
      mostrarError('anularError', errorTexto(err, 'No se pudo anular el gasto'));
    } finally {
      anulando = false;
      btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Eventos y arranque                                                  */
  /* ------------------------------------------------------------------ */
  $('btnNuevoGasto').addEventListener('click', function () { abrirGasto(null); });
  $('btnCategorias').addEventListener('click', function () { resetFormCategoria(); $('categoriasModal').showModal(); });
  $('btnFiltrar').addEventListener('click', cargarGastos);
  $('btnCsv').addEventListener('click', exportarCsv);
  ['fDesde', 'fHasta', 'fCategoria', 'fEstado'].forEach(function (id) { $(id).addEventListener('change', cargarGastos); });
  $('gastoForm').addEventListener('submit', guardarGasto);
  $('g_neto').addEventListener('input', actualizarTotal);
  $('g_iva').addEventListener('input', actualizarTotal);
  $('btnConfirmarAnular').addEventListener('click', confirmarAnular);
  $('categoriaForm').addEventListener('submit', guardarCategoria);
  $('btnCancelarCategoria').addEventListener('click', resetFormCategoria);

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-editar]');
    if (t) { var g = gastos.find(function (x) { return x.id === Number(t.dataset.editar); }); if (g) abrirGasto(g); return; }
    t = e.target.closest('[data-anular]');
    if (t) { abrirAnular(Number(t.dataset.anular)); return; }
    t = e.target.closest('[data-editar-cat]');
    if (t) {
      var c = categorias.find(function (x) { return x.id === Number(t.dataset.editarCat); });
      if (!c) return;
      categoriaEditandoId = c.id;
      $('c_nombre').value = c.nombre;
      $('c_impuesto').checked = c.es_impuesto;
      $('c_label').textContent = 'Editar categoría';
      $('btnGuardarCategoria').textContent = 'Guardar cambios';
      $('btnCancelarCategoria').hidden = false;
      $('c_nombre').focus();
      return;
    }
    t = e.target.closest('[data-toggle-cat]');
    if (t) { cambiarActiva(Number(t.dataset.toggleCat)); return; }
    t = e.target.closest('[data-eliminar-cat]');
    if (t) { eliminarCategoria(Number(t.dataset.eliminarCat)); }
  });

  (async function iniciar() {
    var hoy = new Date();
    $('fDesde').value = fechaISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    $('fHasta').value = fechaISO(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
    await cargarCategorias();
    cargarGastos();
  })();
})();

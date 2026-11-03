// Tareas y notas informales del panel de inicio (solo admin).
// Backend: routes/tareas.routes.js
// No entra en el refresco automático del dashboard: se carga una vez y se
// actualiza con las acciones del usuario (así no pisa lo que se esté escribiendo).
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var solapa = 'PENDIENTE';
  var tareas = [];
  var editandoId = null;
  var eliminandoId = null;
  var enviando = false;        // alta
  var guardandoEdicion = false;
  var eliminando = false;

  // Todo lo que viene de la base se escapa.
  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function errorTexto(err, porDefecto) { return (err && (err.error || err.message)) || porDefecto; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function mostrarError(id, msg) {
    var el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function usuarioEsAdmin() {
    try { return JSON.parse(localStorage.getItem('usuario') || '{}').rol === 'admin'; }
    catch (e) { return false; }
  }

  async function cargar() {
    try {
      var r = await apiFetch('/api/tareas?estado=' + solapa);
      tareas = r.tareas || [];
      $('tareaCantPendientes').textContent = r.pendientes ? '(' + r.pendientes + ')' : '';
      $('tareaCantCompletadas').textContent = r.completadas ? '(' + r.completadas + ')' : '';
    } catch (err) {
      Shell.error(err, 'cargando las tareas');
      tareas = [];
      $('tareaLista').innerHTML = '<li>' + Shell.vacio('No se pudieron cargar las tareas', 'Probá recargar la página.') + '</li>';
      return;
    }
    pintar();
  }

  function pintar() {
    var lista = $('tareaLista');
    if (!tareas.length) {
      lista.innerHTML = '<li>' + (solapa === 'PENDIENTE'
        ? Shell.vacio('No hay tareas pendientes', 'Anotá arriba lo que quieras no olvidarte.')
        : Shell.vacio('Todavía no completaste ninguna tarea', 'Las que tildes como hechas aparecen acá.')) + '</li>';
      return;
    }
    var hoy = hoyISO();
    lista.innerHTML = tareas.map(function (t) {
      var completada = t.estado === 'COMPLETADA';
      var meta = ['Cargada ' + Shell.fecha(t.creado_en)];
      if (completada) meta.push('Completada ' + Shell.fecha(t.completada_en));
      var limite = '';
      if (t.fecha_limite) {
        var vencida = !completada && t.fecha_limite < hoy;
        limite = ' <span class="pill ' + (vencida ? 'pill-danger' : 'pill-info') + '">' +
          (vencida ? 'Venció ' : 'Para el ') + Shell.fecha(t.fecha_limite) + '</span>';
      }
      return '<li class="tarea' + (completada ? ' hecha' : '') + (t.fijada ? ' fijada' : '') + '" data-id="' + t.id + '">' +
        '<label class="tarea-check" title="' + (completada ? 'Volver a pendiente' : 'Marcar como hecha') + '">' +
          '<input type="checkbox" data-tarea-check="' + t.id + '"' + (completada ? ' checked' : '') + '>' +
        '</label>' +
        '<div class="tarea-cuerpo">' +
          '<div class="tarea-texto">' + (t.fijada ? '<span class="tarea-pin" title="Fijada">📌</span> ' : '') + esc(t.texto) + limite + '</div>' +
          '<div class="tarea-meta muted">' + esc(meta.join(' · ')) + '</div>' +
        '</div>' +
        '<div class="tarea-acciones">' +
          (completada ? '' :
            '<button type="button" class="b b-ghost b-sm" data-tarea-fijar="' + t.id + '">' + (t.fijada ? 'Desfijar' : 'Fijar') + '</button>' +
            '<button type="button" class="b b-ghost b-sm" data-tarea-editar="' + t.id + '">Editar</button>') +
          '<button type="button" class="b b-ghost b-sm" data-tarea-eliminar="' + t.id + '">Eliminar</button>' +
        '</div>' +
        '</li>';
    }).join('');
  }

  function buscar(id) {
    return tareas.filter(function (t) { return String(t.id) === String(id); })[0];
  }

  /* ------------------------------------------------------------------ */
  /* Alta                                                                */
  /* ------------------------------------------------------------------ */
  async function agregar(e) {
    e.preventDefault();
    if (enviando) return;
    var texto = $('tareaTexto').value.trim();
    if (!texto) { mostrarError('tareaError', 'Escribí la tarea'); return; }
    mostrarError('tareaError', '');
    enviando = true;
    var btn = $('btnTareaAgregar');
    btn.disabled = true;
    btn.textContent = 'Agregando…';
    try {
      await apiFetch('/api/tareas', {
        method: 'POST',
        body: JSON.stringify({ texto: texto, fecha_limite: $('tareaLimite').value || null })
      });
      $('tareaTexto').value = '';
      $('tareaLimite').value = '';
      if (solapa !== 'PENDIENTE') cambiarSolapa('PENDIENTE'); else await cargar();
      $('tareaTexto').focus();
    } catch (err) {
      mostrarError('tareaError', errorTexto(err, 'No se pudo agregar la tarea'));
    } finally {
      enviando = false;
      btn.disabled = false;
      btn.textContent = 'Agregar';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Acciones de cada fila                                               */
  /* ------------------------------------------------------------------ */
  async function accion(url, cuerpo) {
    try {
      await apiFetch(url, { method: 'POST', body: JSON.stringify(cuerpo || {}) });
      await cargar();
    } catch (err) {
      Shell.error(err, 'actualizando la tarea');
      await cargar();   // vuelve a mostrar el estado real (por ejemplo, el check destildado)
    }
  }

  function abrirEditar(id) {
    var t = buscar(id);
    if (!t) return;
    editandoId = t.id;
    $('tareaEditarTexto').value = t.texto;
    $('tareaEditarLimite').value = t.fecha_limite || '';
    mostrarError('tareaEditarError', '');
    $('tareaEditarModal').showModal();
    $('tareaEditarTexto').focus();
  }

  async function guardarEdicion(e) {
    e.preventDefault();
    if (guardandoEdicion || editandoId === null) return;
    guardandoEdicion = true;
    var btn = $('btnTareaEditar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await apiFetch('/api/tareas/' + editandoId, {
        method: 'PUT',
        body: JSON.stringify({
          texto: $('tareaEditarTexto').value,
          fecha_limite: $('tareaEditarLimite').value || null
        })
      });
      $('tareaEditarModal').close();
      await cargar();
    } catch (err) {
      mostrarError('tareaEditarError', errorTexto(err, 'No se pudo guardar la tarea'));
    } finally {
      guardandoEdicion = false;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  }

  function abrirEliminar(id) {
    var t = buscar(id);
    if (!t) return;
    eliminandoId = t.id;
    $('tareaEliminarTexto').textContent = '¿Eliminar “' + t.texto + '”? No se puede deshacer.';
    mostrarError('tareaEliminarError', '');
    $('tareaEliminarModal').showModal();
  }

  async function confirmarEliminar() {
    if (eliminando || eliminandoId === null) return;
    eliminando = true;
    var btn = $('btnTareaEliminar');
    btn.disabled = true;
    btn.textContent = 'Eliminando…';
    try {
      await apiFetch('/api/tareas/' + eliminandoId, { method: 'DELETE' });
      $('tareaEliminarModal').close();
      await cargar();
    } catch (err) {
      mostrarError('tareaEliminarError', errorTexto(err, 'No se pudo eliminar la tarea'));
    } finally {
      eliminando = false;
      btn.disabled = false;
      btn.textContent = 'Eliminar';
    }
  }

  function cambiarSolapa(nueva) {
    solapa = nueva;
    document.querySelectorAll('[data-tarea-tab]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tarea-tab') === solapa);
    });
    cargar();
  }

  /* ------------------------------------------------------------------ */
  /* Arranque                                                            */
  /* ------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    if (!$('panelTareas')) return;
    // El panel es solo del admin (la API también lo exige).
    if (!usuarioEsAdmin()) { $('panelTareas').hidden = true; return; }

    $('tareaForm').addEventListener('submit', agregar);
    $('tareaEditarForm').addEventListener('submit', guardarEdicion);
    $('btnTareaEliminar').addEventListener('click', confirmarEliminar);
    document.querySelectorAll('[data-cerrar]').forEach(function (b) {
      b.addEventListener('click', function () { $(b.getAttribute('data-cerrar')).close(); });
    });

    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tarea-tab]');
      if (tab) { cambiarSolapa(tab.getAttribute('data-tarea-tab')); return; }
      var fijar = e.target.closest('[data-tarea-fijar]');
      if (fijar) {
        var t = buscar(fijar.getAttribute('data-tarea-fijar'));
        if (t) accion('/api/tareas/' + t.id + '/fijar', { fijada: !t.fijada });
        return;
      }
      var editar = e.target.closest('[data-tarea-editar]');
      if (editar) { abrirEditar(editar.getAttribute('data-tarea-editar')); return; }
      var elim = e.target.closest('[data-tarea-eliminar]');
      if (elim) abrirEliminar(elim.getAttribute('data-tarea-eliminar'));
    });

    $('tareaLista').addEventListener('change', function (e) {
      var chk = e.target.closest('[data-tarea-check]');
      if (!chk) return;
      var id = chk.getAttribute('data-tarea-check');
      accion('/api/tareas/' + id + (chk.checked ? '/completar' : '/reabrir'));
    });

    cargar();
  });
})();

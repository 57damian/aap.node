// Copias de seguridad — descargar y restaurar la base.
// Backend: routes/backup.routes.js (solo admin).
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var info = { etiqueta: '', base: '' };
  var descargando = false;
  var restaurando = false;

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function errorTexto(err, porDefecto) { return (err && (err.error || err.message)) || porDefecto; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function mostrar(id, msg) {
    var el = $(id);
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function nombreArchivo() {
    var d = new Date();
    return 'backup-' + (info.etiqueta || 'base') + '-' + (info.base || 'datos') + '-' +
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + '.sql.gz';
  }
  function tamano(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function etiquetaBase() {
    return (info.etiqueta === 'neon' ? 'Neon' : info.etiqueta === 'local' ? 'la base local' : info.etiqueta) +
      (info.base ? ' (' + info.base + ')' : '');
  }

  /* ------------------------------------------------------------------ */
  /* Descargar                                                           */
  /* ------------------------------------------------------------------ */
  // Pide el backup completo al servidor y lo guarda como descarga del navegador.
  async function bajarBackup() {
    await descargarArchivoProtegido('/api/backup/descargar', nombreArchivo());
  }

  $('btnDescargar').addEventListener('click', async function () {
    if (descargando) return;
    descargando = true;
    var btn = $('btnDescargar');
    btn.disabled = true;
    btn.textContent = 'Generando backup…';
    mostrar('descargaError', '');
    try {
      await bajarBackup();
      Shell.toast('ok', 'Backup descargado', 'Guardalo en un lugar seguro (por ejemplo, Drive).');
    } catch (err) {
      mostrar('descargaError', errorTexto(err, 'No se pudo generar el backup'));
    } finally {
      descargando = false;
      btn.disabled = false;
      btn.textContent = 'Descargar backup';
    }
  });

  /* ------------------------------------------------------------------ */
  /* Restaurar                                                           */
  /* ------------------------------------------------------------------ */
  $('archivoBackup').addEventListener('change', function () {
    mostrar('restaurarError', '');
    $('btnRestaurar').disabled = !this.files.length;
  });

  $('btnRestaurar').addEventListener('click', function () {
    var archivo = $('archivoBackup').files[0];
    if (!archivo) return;
    if (!/\.(sql\.gz|gz|sql)$/i.test(archivo.name)) {
      mostrar('restaurarError', 'El archivo tiene que ser un backup .sql.gz generado por este sistema.');
      return;
    }
    mostrar('restaurarError', '');
    $('rm_base').textContent = etiquetaBase();
    $('rm_archivo').textContent = archivo.name;
    $('rm_tamano').textContent = '(' + tamano(archivo.size) + ')';
    $('rm_confirmacion').value = '';
    $('rm_confirmar').disabled = true;
    $('rm_estado').hidden = true;
    mostrar('rm_error', '');
    $('restaurarModal').showModal();
    $('rm_confirmacion').focus();
  });

  $('rm_confirmacion').addEventListener('input', function () {
    $('rm_confirmar').disabled = restaurando || this.value.trim() !== 'RESTAURAR';
  });

  function estado(texto) {
    var el = $('rm_estado');
    el.textContent = texto;
    el.hidden = !texto;
  }

  $('rm_confirmar').addEventListener('click', async function () {
    if (restaurando) return;
    var archivo = $('archivoBackup').files[0];
    if (!archivo) return;
    restaurando = true;
    var btn = $('rm_confirmar');
    btn.disabled = true;
    $('rm_cancelar').disabled = true;
    $('rm_confirmacion').disabled = true;
    mostrar('rm_error', '');

    try {
      // 1) Red de seguridad: se baja el estado de ahora ANTES de tocar nada.
      //    Si esto falla, no se restaura.
      estado('1/2 Descargando un backup del estado actual (por si hay que volver atrás)…');
      try {
        await bajarBackup();
      } catch (err) {
        throw new Error('No se pudo descargar el backup previo, así que no se restauró nada. ' + errorTexto(err, ''));
      }

      // 2) Subir y restaurar.
      estado('2/2 Restaurando… esto puede tardar un momento. No cierres esta página.');
      var datos = new FormData();
      datos.append('archivo', archivo);
      datos.append('confirmacion', $('rm_confirmacion').value.trim());
      var r = await apiFetch('/api/backup/restaurar', { method: 'POST', body: datos });

      $('restaurarModal').close();
      $('rs_texto').textContent = 'Se restauraron ' + r.tablas + ' tablas y ' + r.filas + ' filas.';
      $('resultadoModal').showModal();
    } catch (err) {
      estado('');
      mostrar('rm_error', errorTexto(err, 'No se pudo restaurar el backup') + ' Los datos actuales no se modificaron.');
    } finally {
      restaurando = false;
      $('rm_cancelar').disabled = false;
      $('rm_confirmacion').disabled = false;
      $('rm_confirmar').disabled = $('rm_confirmacion').value.trim() !== 'RESTAURAR';
    }
  });

  $('resultadoModal').addEventListener('cancel', function (e) { e.preventDefault(); });
  $('rs_login').addEventListener('click', function () {
    try { localStorage.clear(); } catch (e) { /* sin storage */ }
    window.location.href = 'login.html';
  });

  /* ------------------------------------------------------------------ */
  /* Inicio                                                              */
  /* ------------------------------------------------------------------ */
  (async function iniciar() {
    try {
      info = await apiFetch('/api/backup/info');
      $('baseActual').innerHTML = 'Base conectada: <strong>' + esc(etiquetaBase()) + '</strong>';
    } catch (err) {
      $('baseActual').textContent = 'No se pudo consultar a qué base está conectado el sistema.';
    }
  })();
})();

// Pantalla de la calculadora de transformadores. La lógica está en calc-trafo.js.
// Los carreteles salen de data/carreteles.csv (tabla corregida). Los alambres del
// taller, los parámetros, las laminaciones y las medidas por carretel se guardan
// en localStorage (por navegador); no hay backend.
(function () {
  var CLAVE = 'calcTrafoDatos';
  var datos = cargar();

  function cargar() {
    var d = CalcTrafo.datosPorDefecto();
    try {
      var g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (g) {
        if (g.params) Object.assign(d.params, g.params);
        if (Array.isArray(g.stock) && g.stock.length) d.stock = g.stock;
        if (g.medidas) d.medidas = g.medidas;
        if (Array.isArray(g.laminaciones)) g.laminaciones.forEach(function (l) {
          var o = d.laminaciones.filter(function (x) { return x.familia === l.familia; })[0];
          if (o) Object.assign(o, l); else d.laminaciones.push(l);
        });
      }
    } catch (e) { /* sin datos guardados */ }
    return d;
  }
  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({
        params: datos.params, stock: datos.stock, laminaciones: datos.laminaciones, medidas: datos.medidas
      }));
    } catch (e) { /* almacenamiento bloqueado: sigue funcionando sin guardar */ }
  }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function f(n, d) { return n == null || !isFinite(n) ? '—' : n.toFixed(d == null ? 2 : d).replace('.', ','); }
  var $ = function (id) { return document.getElementById(id); };

  // --- Carreteles ---
  var carreteles = [];
  function lamDe(familia) {
    return datos.laminaciones.filter(function (l) { return l.familia === familia; })[0];
  }
  function habilitada() { return true; } // sin BA_ref se usa Se × B_taller (confianza baja)

  function familiasDisponibles() {
    var vistas = {}, out = [];
    carreteles.forEach(function (c) {
      if (c.estado !== 'excluido' && habilitada(c.familia) && !vistas[c.familia]) { vistas[c.familia] = true; out.push(c.familia); }
    });
    return out;
  }
  function llenarFamilias() {
    var sel = $('c_familia'), actual = sel.value;
    sel.innerHTML = '<option value="">Todas las familias habilitadas</option>' + familiasDisponibles().map(function (x) {
      return '<option value="' + esc(x) + '">' + esc(x) + '</option>';
    }).join('');
    sel.value = actual;
    var sin = {};
    carreteles.forEach(function (c) { if (c.estado !== 'excluido' && !habilitada(c.familia)) sin[c.familia] = true; });
    $('c_familiasSin').textContent = Object.keys(sin).length
      ? 'Sin BA_ref (flujo estimado con Se × B de taller, confianza baja): ' + Object.keys(sin).join(', ') + '.'
      : '';
  }
  function llenarCarreteles() {
    var fam = $('c_familia').value, pin = $('c_pines').value, sep = $('c_sep').value;
    var lista = carreteles.filter(function (c) {
      if (c.estado === 'excluido' || !habilitada(c.familia)) return false;
      if (fam && c.familia !== fam) return false;
      if (pin && (pin === 'con') !== !!c.pines) return false;
      if (sep && (sep === 'con') !== (c.n_camaras === 2)) return false;
      return true;
    });
    var sel = $('c_carretel'), actual = sel.value;
    sel.innerHTML = lista.map(function (c) {
      return '<option value="' + esc(c.codigo) + '">' + esc(c.codigo) + ' — ' + esc(c.descripcion) +
        (c.estado === 'revisar' ? ' ⚠ revisar' : '') + '</option>';
    }).join('');
    if (!lista.length) sel.innerHTML = '<option value="">Ningún carretel con esos filtros</option>';
    else if (lista.some(function (c) { return c.codigo === actual; })) sel.value = actual;
    mostrarCarretel();
  }
  function carretelActual() {
    var cod = $('c_carretel').value;
    return carreteles.filter(function (c) { return c.codigo === cod; })[0] || null;
  }

  function mostrarCarretel() {
    var c = carretelActual(), cont = $('c_carretelInfo');
    if (!c) { cont.innerHTML = ''; return; }
    var med = datos.medidas[c.codigo] || {};
    var g = CalcTrafo.geometria(c, lamDe(c.familia), datos.params, med);
    var h = '';
    if (c.estado === 'revisar') {
      h += '<div class="notice notice-warn" role="alert"><strong>Carretel a revisar:</strong> ' +
        c.avisos.map(esc).join('; ') + '.' + (c.notas ? ' <span class="muted">Nota: ' + esc(c.notas) + '</span>' : '') + '</div>';
    }
    h += '<p class="muted" style="margin:var(--space-2) 0">' +
      'N ' + f(c.N, 1) + ' · A ' + f(c.A, 1) + ' · I ' + f(c.I, 1) + ' · U ' + f(c.U, 1) + ' mm — ' +
      (c.n_camaras === 2 ? '2 cámaras: ' + f(c.camaras[0], 2) + ' y ' + f(c.camaras[1], 2) + ' mm (separador ' + f(c.separador, 2) + ' mm)' : '1 cámara de ' + f(c.I, 1) + ' mm') +
      (c.pines ? ' — pines ' + esc(c.pines) : ' — sin pines') + '. ' +
      'Profundidad ' + (g.estimado ? 'máxima <em>(estimada)</em>' : 'útil') + ': ' + f(g.limite, 2) + ' mm.</p>' +
      '<div class="form-grid">' +
      '<div class="field"><label>Pared medida (mm) ' + Ayuda.icono('calc_pared_medida') + '</label><input class="input" id="c_med_pared" type="number" step="any" min="0" value="' + (med.pared || '') + '" placeholder="' + datos.params.pared + ' (estimado)"></div>' +
      '<div class="field"><label>Profundidad útil medida (mm) ' + Ayuda.icono('calc_prof_util_medida') + '</label><input class="input" id="c_med_prof" type="number" step="any" min="0" value="' + (med.prof_util || '') + '" placeholder="sin medir"></div>' +
      '</div>';
    cont.innerHTML = h;
    ['c_med_pared', 'c_med_prof'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var m = datos.medidas[c.codigo] = datos.medidas[c.codigo] || {};
        var vp = num($('c_med_pared').value), vu = num($('c_med_prof').value);
        if (vp > 0) m.pared = vp; else delete m.pared;
        if (vu > 0) m.prof_util = vu; else delete m.prof_util;
        if (!Object.keys(m).length) delete datos.medidas[c.codigo];
        guardar(); mostrarCarretel();
      });
    });
  }
  ['c_familia', 'c_pines', 'c_sep'].forEach(function (id) { $(id).addEventListener('change', llenarCarreteles); });
  $('c_carretel').addEventListener('change', mostrarCarretel);

  // --- Formulario principal ---
  function opcionesHilo() {
    return '<option value="">Automático</option>' + datos.stock.map(function (s) {
      return '<option value="' + esc(s.alias) + '">' + esc(s.alias) + '</option>';
    }).join('');
  }
  function agregarSalida(v, i, sec) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="c_n"></td>' +
      '<td><input class="input s_v" type="number" min="0.1" step="any" value="' + v + '" required></td>' +
      '<td><input class="input s_i" type="number" min="0.001" step="any" value="' + i + '" required></td>' +
      '<td><select class="select s_sec"><option value="1">1</option><option value="2">2 (toma central)</option></select></td>' +
      '<td><select class="select s_hilo">' + opcionesHilo() + '</select></td>' +
      '<td><select class="select s_heb"><option value="">Auto</option><option>1</option><option>2</option><option>3</option></select></td>' +
      '<td><button type="button" class="b b-ghost s_quitar">Quitar</button></td>';
    tr.querySelector('.s_sec').value = String(sec);
    tr.querySelector('.s_quitar').addEventListener('click', function () {
      if ($('c_salidas').children.length > 1) { tr.remove(); numerar(); }
    });
    $('c_salidas').appendChild(tr);
    numerar();
  }
  function numerar() {
    Array.prototype.forEach.call($('c_salidas').children, function (tr, k) {
      tr.querySelector('.c_n').textContent = k + 1;
    });
  }
  agregarSalida(20, 0.1, 1);
  $('btnAgregarSalida').addEventListener('click', function () { agregarSalida(12, 0.1, 1); });

  $('calcForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var salidas = Array.prototype.map.call($('c_salidas').children, function (tr) {
      var s = { v: num(tr.querySelector('.s_v').value), i: num(tr.querySelector('.s_i').value), secciones: parseInt(tr.querySelector('.s_sec').value, 10) };
      var alias = tr.querySelector('.s_hilo').value;
      if (alias) s.hilo = { alias: alias, hebras: parseInt(tr.querySelector('.s_heb').value, 10) || null };
      return s;
    });
    try {
      if (!$('c_carretel').value) throw new Error('Elegí un carretel.');
      var r = CalcTrafo.calcular({
        vin: num($('c_vin').value), carretel: $('c_carretel').value, salidas: salidas, modo_tension: $('c_modo').value
      }, Object.assign({}, datos, { carreteles: carreteles }));
      mostrar(r);
    } catch (err) {
      $('c_resultado').innerHTML = '<div class="notice notice-err" role="alert">' + esc(err.message) + '</div>';
    }
  });

  function kpi(k, v, sub, cls) {
    return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="kpi-k">' + esc(k) + '</div><div class="kpi-v">' + v + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }
  var SEMAFORO = { verde: 'is-success', amarillo: 'is-warning', rojo: 'is-danger' };
  var PILL = { verde: 'pill-ok', amarillo: 'pill-warn', rojo: 'pill-danger' };

  function mostrar(r) { $('c_resultado').innerHTML = armarResultado(r); }

  function armarResultado(r) {
    var h = '';
    if (r.avisos_carretel.length) {
      h += '<div class="notice notice-warn" role="alert" style="margin-top:var(--space-3)"><strong>Carretel a revisar (' + esc(r.carretel) + '):</strong> ' +
        r.avisos_carretel.map(esc).join('; ') + '.</div>';
    }
    h += r.alertas.map(function (a) {
      return '<div class="notice notice-' + (a.nivel === 'err' ? 'err' : 'warn') + '" role="alert" style="margin-top:var(--space-3)">' + esc(a.texto) + '</div>';
    }).join('');

    h += '<div class="kpi-row" style="margin-top:var(--space-3)">' +
      kpi('Espiras por volt', f(r.nv, 2), esc(r.familia) + ' · BA ' + f(r.BA, 3) + ' T·cm² (' + esc(r.metodo_flujo) + ')') +
      kpi('Confianza', TXT_CONF[r.confianza], { alta: 'N/V de vueltas medidas', media: 'BA_ref de un trafo real de la familia', baja: 'solo Se × inducción de taller' }[r.confianza], { alta: 'is-success', media: 'is-info', baja: 'is-warning' }[r.confianza]) +
      kpi('Primario', r.Np + ' esp.', 'Ip ≈ ' + f(r.Ip * 1000, 1) + ' mA (estimada)') +
      kpi('Flujo relativo', f(r.flujo_rel * 100, 0) + ' %', 'a Vin+10 %: ' + f(r.flujo_rel * 110, 0) + ' %' +
        ' · B = ' + f(r.B_tesla, 2) + ' T', r.flujo_rel > 1.005 ? 'is-danger' : (r.flujo_rel * 1.1 > 1.005 ? 'is-warning' : 'is-success')) +
      kpi('R primario (60 °C)', f(r.Rp, 0) + ' Ω', '') +
      '</div>';

    h += '<div class="panel" style="margin-top:var(--space-3)"><div class="panel-head"><h2>Devanados</h2></div><div class="panel-body flush"><div class="table-wrap"><table class="t">' +
      '<thead><tr><th>Devanado</th><th class="num">Espiras</th><th>Alambre</th><th class="num">Hebras</th><th class="num">J (A/mm²) ' + Ayuda.icono('calc_J') + '</th>' +
      '<th class="num">Cámara</th><th class="num">Capas</th><th class="num">Espesor (mm)</th><th class="num">R (60 °C)</th></tr></thead><tbody>' +
      r.devanados.map(function (d) {
        return '<tr><td>' + esc(d.rol) + '</td>' +
          '<td class="num">' + d.N + (d.secciones === 2 ? ' + ' + d.N : '') + '</td>' +
          '<td>' + esc(d.hilo) + ' <span class="muted">(' + esc(d.alambre) + ', ⌀ ext ' + f(d.d_ext, 3) + ')</span></td>' +
          '<td class="num">' + d.hebras + '</td>' +
          '<td class="num">' + f(d.J, 2) + (d.cumple_J ? '' : ' ⚠') + '</td>' +
          '<td class="num">' + (d.camara + 1) + '</td>' +
          '<td class="num">' + (isFinite(d.capas) ? d.capas : '—') + '</td>' +
          '<td class="num">' + f(d.espesor, 2) + '</td>' +
          '<td class="num">' + f(d.R, 1) + ' Ω' + (d.secciones === 2 ? ' /sec.' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';

    h += '<div class="panel" style="margin-top:var(--space-3)"><div class="panel-head"><h2>Tensiones</h2></div><div class="panel-body flush"><div class="table-wrap"><table class="t">' +
      '<thead><tr><th>Salida</th><th class="num">Espiras</th><th class="num">V en vacío</th><th class="num">V con carga ' + Ayuda.icono('calc_v_carga') + '</th><th class="num">I (A)</th><th class="num">V continua (puente)</th></tr></thead><tbody>' +
      r.salidas.map(function (s, k) {
        return '<tr><td>' + (k + 1) + (s.secciones === 2 ? ' (toma central)' : '') + '</td>' +
          '<td class="num">' + s.Ns + '</td>' +
          '<td class="num">' + f(s.V0, 2) + ' V</td>' +
          '<td class="num"><strong>' + f(s.Vcarga, 2) + ' V</strong></td>' +
          '<td class="num">' + f(s.i, 3) + '</td>' +
          '<td class="num">' + f(s.Vdc, 1) + ' V</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';

    var g = r.geometria;
    h += '<div class="panel" style="margin-top:var(--space-3)"><div class="panel-head"><h2>Ventana del carretel</h2></div><div class="panel-body">' +
      r.camaras.map(function (c, k) {
        return '<p>Cámara ' + (k + 1) + ' (' + f(c.ancho, 1) + ' mm de ancho): ' +
          (c.ocupa
            ? 'altura bobinada <strong>' + f(c.altura, 2) + ' mm</strong>' +
              (c.pct != null ? ' <span class="pill ' + PILL[c.semaforo] + '">' + f(c.pct * 100, 0) + ' % del límite</span>' : '')
            : 'vacía') + '</p>';
      }).join('') +
      '<p class="muted">Límite de altura: ' + f(g.limite, 2) + ' mm (' + (g.estimado ? 'profundidad máxima ESTIMADA = (U − N)/2 − pared; cargá la medida real o la laminación para afinarla' : 'profundidad útil') + '). ' +
      'Verde hasta 85 %, amarillo de 85 a 100 %, rojo por encima.</p></div></div>';

    return h;
  }

  // --- Reingeniería: datos parciales ---
  var PILL_CONF = { alta: 'pill-ok', media: 'pill-warn', baja: 'pill-danger', insuficiente: 'pill-neutral' };
  var TXT_CONF = { alta: 'Alta', media: 'Media', baja: 'Baja', insuficiente: 'Insuficiente' };

  $('reForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var esm = function (id) { return $(id).value === '1'; };
    var vs = num($('r_vs').value);
    var entrada = {
      carretel: $('r_carretel').value.trim() || null, N: num($('r_N').value), A: num($('r_A').value), I: num($('r_I').value),
      vp: num($('r_vp').value), Np: num($('r_np').value), Rp: num($('r_rp').value), Rs: num($('r_rs').value),
      condicion: $('r_cond').value,
      dp: num($('r_dp').value) ? { valor: num($('r_dp').value), esmalte: esm('r_dpe') } : null,
      ds: num($('r_ds').value) ? { valor: num($('r_ds').value), esmalte: esm('r_dse') } : null,
      salidas: vs ? [{ v: vs, i: num($('r_is').value), ps: num($('r_ps').value), Ns: num($('r_ns').value), secciones: parseInt($('r_sec').value, 10) }] : []
    };
    if (entrada.carretel && !carreteles.some(function (c) { return c.codigo === entrada.carretel; })) {
      $('r_resultado').innerHTML = '<div class="notice notice-err" role="alert">El carretel ' + esc(entrada.carretel) + ' no está en la tabla.</div>';
      return;
    }
    try {
      mostrarReingenieria(CalcTrafo.reingenieria(entrada, Object.assign({}, datos, { carreteles: carreteles })));
    } catch (err) {
      $('r_resultado').innerHTML = '<div class="notice notice-err" role="alert">' + esc(err.message) + '</div>';
    }
  });

  function lista(titulo, items, cls) {
    if (!items.length) return '';
    return '<div class="notice ' + cls + '" style="margin-top:var(--space-3)"><strong>' + titulo + '</strong><ul style="margin:var(--space-1) 0 0 var(--space-4)">' +
      items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }

  function mostrarReingenieria(r) {
    var h = '<p style="margin-top:var(--space-3)">Confianza: <span class="pill ' + PILL_CONF[r.confianza] + '">' + TXT_CONF[r.confianza] + '</span>' +
      (r.fuentes_nv && r.fuentes_nv.length ? ' <span class="muted">N/V de ' + esc(r.fuentes_nv.join(' y ')) + '</span>' : '') + '</p>';
    if (r.insuficiente) {
      h += lista('Faltan datos para calcular', r.faltantes, 'notice-err');
      $('r_resultado').innerHTML = h;
      return;
    }
    h += r.avisos.map(function (a) {
      return '<div class="notice notice-' + (a.nivel === 'err' ? 'err' : 'warn') + '" role="alert" style="margin-top:var(--space-3)">' + esc(a.texto) + '</div>';
    }).join('');
    if (r.sin_corriente) {
      h += '<div class="kpi-row" style="margin-top:var(--space-3)">' +
        kpi('Espiras por volt', f(r.nv, 2), esc(r.familia) + ' · ' + esc(r.metodo_flujo)) +
        kpi('Primario', r.Np + ' esp.', '') +
        kpi('Secundario', r.salidas[0].Ns + ' esp.', f(r.salidas[0].V0, 2) + ' V en vacío') +
        kpi('B real', f(r.B_tesla, 2) + ' T', 'Se ' + f(r.Se, 3) + ' cm²') + '</div>' +
        r.alertas.map(function (a) { return '<div class="notice notice-' + (a.nivel === 'err' ? 'err' : 'warn') + '" style="margin-top:var(--space-3)">' + esc(a.texto) + '</div>'; }).join('');
    } else {
      h += armarResultado(r);
    }
    if (r.coherencia.length) {
      h += '<div class="panel" style="margin-top:var(--space-3)"><div class="panel-head"><h2>Coherencia con las resistencias medidas (20 °C)</h2></div><div class="panel-body flush"><div class="table-wrap"><table class="t"><thead><tr><th></th><th class="num">Medida</th><th class="num">Calculada</th><th class="num">Dif.</th><th class="num">MLT implícito</th><th class="num">MLT carretel</th></tr></thead><tbody>' +
        r.coherencia.map(function (c) {
          return '<tr><td>' + esc(c.nombre) + '</td><td class="num">' + f(c.medida, 1) + ' Ω</td><td class="num">' + f(c.calculada, 1) + ' Ω</td><td class="num">' + f(c.dif_R * 100, 0) + ' %</td><td class="num">' + f(c.mlt_real, 0) + ' mm</td><td class="num">' + f(c.mlt_calc, 0) + ' mm</td></tr>';
        }).join('') + '</tbody></table></div></div></div>';
    }
    if (r.sugerencias.length) {
      h += '<div class="panel" style="margin-top:var(--space-3)"><div class="panel-head"><h2>Carreteles más chicos que sí entran</h2></div><div class="panel-body"><p class="muted">Con el N/V recalculado para el flujo de cada familia (no se arrastran las vueltas medidas). Hasta 85 % de ocupación.</p><ul>' +
        r.sugerencias.map(function (c) {
          return '<li><strong>' + esc(c.codigo) + '</strong> — ' + esc(c.descripcion) + ' · primario ' + c.Np + ' esp. · ocupación ' + f(c.ocupacion * 100, 0) + ' %' + (c.estado === 'revisar' ? ' ⚠ carretel a revisar' : '') + '</li>';
        }).join('') + '</ul></div></div>';
    }
    h += lista('Datos faltantes que mejorarían el resultado', r.faltantes, 'notice-info');
    $('r_resultado').innerHTML = h;
  }

  // --- Alambres del taller ---
  function dibujarStock() {
    var cuerpo = $('c_stock');
    cuerpo.innerHTML = '';
    datos.stock.forEach(function (s, k) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input class="input" data-k="alias" value="' + esc(s.alias) + '" maxlength="20"></td>' +
        '<td><select class="select" data-k="alambre_id">' + datos.alambres.map(function (a) {
          return '<option value="' + esc(a.id) + '"' + (a.id === s.alambre_id ? ' selected' : '') + '>' + esc(a.id) + ' (⌀ ' + a.d_cu + ')</option>';
        }).join('') + '</select></td>' +
        '<td><select class="select" data-k="grado"><option value="1"' + (s.grado === 1 ? ' selected' : '') + '>G1</option><option value="2"' + (s.grado === 2 ? ' selected' : '') + '>G2</option></select></td>' +
        '<td><input class="input" data-k="d_medido" type="number" step="any" min="0" value="' + (s.d_medido || '') + '" placeholder="sin medir"></td>' +
        '<td><button type="button" class="b b-ghost">Quitar</button></td>';
      tr.querySelectorAll('[data-k]').forEach(function (el) {
        el.addEventListener('change', function () {
          var key = el.dataset.k;
          if (key === 'alias') s.alias = el.value.trim() || s.alias;
          else if (key === 'grado') s.grado = parseInt(el.value, 10);
          else if (key === 'd_medido') s.d_medido = num(el.value);
          else s[key] = el.value;
          guardar(); refrescarHilos();
        });
      });
      tr.querySelector('button').addEventListener('click', function () {
        if (datos.stock.length > 1) { datos.stock.splice(k, 1); guardar(); dibujarStock(); refrescarHilos(); }
      });
      cuerpo.appendChild(tr);
    });
  }
  function refrescarHilos() {
    Array.prototype.forEach.call(document.querySelectorAll('.s_hilo'), function (sel) {
      var actual = sel.value;
      sel.innerHTML = opcionesHilo();
      sel.value = actual;
    });
  }
  $('btnAgregarHilo').addEventListener('click', function () {
    datos.stock.push({ alias: 'nuevo', alambre_id: 'AWG30', grado: 1, d_medido: null });
    guardar(); dibujarStock(); refrescarHilos();
  });

  // --- Parámetros y laminaciones ---
  var ETIQUETAS = {
    f: 'Frecuencia (Hz)', B_taller: 'Inducción de taller B (T, familias sin BA_ref)', k_flujo: 'k_flujo (1 = flujo de referencia)', J_prim_max: 'J máx. primario (A/mm²)',
    J_sec_max: 'J máx. secundario (A/mm²)', eta: 'Rendimiento η', margen_brida: 'Margen de brida (mm/lado)',
    factor_capa: 'Factor de capa', papel_cada: 'Papel cada (capas)', papel_mm: 'Espesor papel (mm)',
    aislacion_entre: 'Aislación entre bobinados (mm)', cierre: 'Cierre (mm)', pared: 'Pared del carretel (mm, por defecto)',
    T_cobre: 'T cobre (°C)', alfa_cu: 'α Cu (1/°C)'
  };
  var CAMPOS_LAM = ['BA_ref', 'A_ref', 'pierna_mm', 'ventana_ancho_mm', 'ventana_alto_mm', 'apilado'];

  function dibujarParams() {
    var cont = $('c_params');
    cont.innerHTML = '';
    Object.keys(ETIQUETAS).forEach(function (k) {
      var div = document.createElement('div');
      div.className = 'field';
      div.innerHTML = '<label>' + esc(ETIQUETAS[k]) + ' ' + Ayuda.icono('calc_p_' + k) + '</label><input class="input" type="number" step="any" value="' + datos.params[k] + '">';
      div.querySelector('input').addEventListener('change', function (e) {
        var v = num(e.target.value);
        if (v == null || v <= 0) { e.target.value = datos.params[k]; return; }
        datos.params[k] = v; guardar(); mostrarCarretel();
      });
      cont.appendChild(div);
    });
  }
  function dibujarLaminaciones() {
    var cuerpo = $('c_lams');
    cuerpo.innerHTML = '';
    // Primero las habilitadas, después el resto por nombre.
    var lams = datos.laminaciones.slice().sort(function (a, b) {
      return (b.BA_ref ? 1 : 0) - (a.BA_ref ? 1 : 0) || a.familia.localeCompare(b.familia, 'es', { numeric: true });
    });
    lams.forEach(function (l) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(l.familia) + '</td>' + CAMPOS_LAM.map(function (k) {
        return '<td><input class="input" data-k="' + k + '" type="number" step="any" min="0" value="' + (l[k] == null ? '' : l[k]) + '" placeholder="sin dato"></td>';
      }).join('') + '<td class="muted" title="' + esc(l.trafo_referencia) + '">' + esc(l.BA_origen) + '</td>';
      tr.querySelectorAll('input').forEach(function (el) {
        el.addEventListener('change', function () {
          var v = num(el.value);
          l[el.dataset.k] = v > 0 ? v : null;
          if (el.dataset.k === 'BA_ref' && v > 0 && l.BA_origen === 'sin dato') { l.BA_origen = 'manual'; l.trafo_referencia = 'cargado a mano'; }
          if (el.dataset.k === 'BA_ref' && !(v > 0)) l.BA_origen = 'sin dato';
          guardar(); dibujarLaminaciones(); llenarFamilias(); llenarCarreteles();
        });
      });
      cuerpo.appendChild(tr);
    });
  }
  $('btnRestaurar').addEventListener('click', function () {
    try { localStorage.removeItem(CLAVE); } catch (e) { /* nada */ }
    datos = cargar();
    CalcTrafo.completarLaminaciones(datos.laminaciones, carreteles);
    dibujarStock(); dibujarParams(); dibujarLaminaciones(); refrescarHilos(); llenarFamilias(); llenarCarreteles();
    $('c_resultado').innerHTML = '';
  });

  dibujarStock();
  dibujarParams();

  // --- Carga de la tabla de carreteles ---
  fetch('data/carreteles.csv')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (txt) {
      carreteles = CalcTrafo.importarCarreteles(txt, datos.params.pared);
      CalcTrafo.completarLaminaciones(datos.laminaciones, carreteles);
      var estados = { ok: 0, revisar: 0, excluido: 0 };
      carreteles.forEach(function (c) { estados[c.estado]++; });
      $('c_resumenCarreteles').textContent = carreteles.length + ' carreteles cargados: ' + estados.ok + ' ok, ' +
        estados.revisar + ' a revisar, ' + estados.excluido + ' excluidos.';
      $('r_codigos').innerHTML = carreteles.filter(function (c) { return c.estado !== 'excluido'; }).map(function (c) {
        return '<option value="' + esc(c.codigo) + '">' + esc(c.descripcion) + '</option>';
      }).join('');
      dibujarLaminaciones(); llenarFamilias(); llenarCarreteles();
    })
    .catch(function (err) {
      $('c_carretelInfo').innerHTML = '<div class="notice notice-err" role="alert">No se pudo cargar la tabla de carreteles (' + esc(err.message) + ').</div>';
    });
})();

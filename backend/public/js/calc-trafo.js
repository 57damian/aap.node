// ============================================================================
// Calculadora de transformadores (30/09/2026): lógica pura, sin DOM.
//
// Se usa desde calculadora-trafo.html y también desde Node para los casos de
// prueba (scripts/probar-calculadora-trafo.js). Todo corre en el navegador: no
// hay API ni base de datos; los catálogos están acá abajo.
//
// Unidades: mm, ohm, V, A, Hz. Los nombres de campo siguen la especificación
// (d_cu, d_ext_g1, ohm_m, BA_ref, etc.).
// ============================================================================
(function (root) {
  'use strict';

  // --- Alambres: catálogo São Marco 2021 (IEC 60317-0-1) ---
  // [id, d_cu, d_ext_g1, d_ext_g2, ohm_m (a 20 °C), tension_max_kgf]
  var ALAMBRES_TABLA = [
    ['AWG26', 0.404, 0.443, 0.463, 0.134496, 0.963],
    ['AWG27', 0.361, 0.398, 0.417, 0.168445, 0.786],
    ['AWG28', 0.320, 0.354, 0.373, 0.214374, 0.638],
    ['AWG29', 0.287, 0.319, 0.337, 0.266507, 0.526],
    ['0.280', 0.280, 0.312, 0.329, 0.280005, 0.503],
    ['AWG30', 0.254, 0.285, 0.301, 0.340255, 0.423],
    ['0.250', 0.250, 0.281, 0.297, 0.351238, 0.411],
    ['AWG31', 0.226, 0.254, 0.268, 0.429789, 0.340],
    ['AWG32', 0.203, 0.229, 0.242, 0.532697, 0.279],
    ['0.200', 0.200, 0.226, 0.239, 0.548810, 0.272],
    ['AWG33', 0.180, 0.204, 0.217, 0.677528, 0.225],
    ['AWG34', 0.160, 0.182, 0.194, 0.857497, 0.181],
    ['AWG35', 0.142, 0.162, 0.173, 1.088669, 0.146],
    ['AWG36', 0.127, 0.146, 0.156, 1.361022, 0.112],
    ['AWG37', 0.114, 0.132, 0.141, 1.689129, 0.097],
    ['AWG38', 0.102, 0.119, 0.127, 2.109950, 0.081],
    ['AWG39', 0.089, 0.104, 0.112, 2.771358, 0.064],
    ['AWG40', 0.079, 0.093, 0.100, 3.517373, 0.053],
    ['AWG41', 0.071, 0.084, 0.091, 4.354676, 0.044],
    ['AWG42', 0.064, 0.077, 0.084, 5.359356, 0.037],
    ['AWG43', 0.056, 0.067, 0.074, 6.999975, 0.030],
    ['AWG44', 0.051, 0.061, 0.067, 8.439801, 0.026]
  ];
  var ALAMBRES = ALAMBRES_TABLA.map(function (r) {
    return { id: r[0], d_cu: r[1], d_ext_g1: r[2], d_ext_g2: r[3], ohm_m: r[4], tension_max_kgf: r[5] };
  });

  // Stock del taller: alias = cómo lo llama el taller; grado 1 o 2; d_medido
  // (opcional) reemplaza al d_ext del catálogo. Tipo recomendado: CORALSOLDA HA
  // (CHS, G1, soldable, clase 180 °C).
  var STOCK_INICIAL = [
    { alias: '0.08', alambre_id: 'AWG40', grado: 1, d_medido: 0.087 },
    { alias: '0.06', alambre_id: 'AWG43', grado: 1, d_medido: null }, // pendiente de confirmar (AWG42 o AWG43)
    { alias: '0.28', alambre_id: '0.280', grado: 1, d_medido: null }
  ];

  // --- Laminaciones (una fila por familia de carretel) ---
  // Una familia solo se ofrece en la calculadora si tiene BA_ref. A_ref es la
  // pila (cota A) del trafo real con el que se calibró: el BA de otro carretel
  // de la familia es BA_ref · A / A_ref. pierna_mm y ventana_* salen de SOMA
  // (pendientes): con ellos se calcula prof_util y reemplaza a prof_max.
  function laminacionVacia(familia) {
    return {
      familia: familia, BA_ref: null, A_ref: null, pierna_mm: null, ventana_ancho_mm: null,
      ventana_alto_mm: null, espesor_chapa: null, apilado: 0.92,
      tipo_chapa: 'L.37 grano no orientado, sin tratamiento', BA_origen: 'sin dato', trafo_referencia: ''
    };
  }
  function laminacionesIniciales() {
    var a = laminacionVacia('EI 37');
    a.BA_ref = 1.989; a.A_ref = 13; a.BA_origen = 'trafo real';
    a.trafo_referencia = '220 V, primario 4983 espiras (004080)';
    var b = laminacionVacia('EI 25');
    b.BA_ref = 2.477; b.A_ref = 13.5; b.BA_origen = 'trafo real';
    b.trafo_referencia = '220 V, primario 4000 espiras (012180)';
    return [a, b];
  }

  // --- Carreteles: importación del CSV corregido ---
  var TIPO_OK = 'Monofásico EI';
  var CAMPOS_NUM = ['N', 'A', 'I', 'E', 'T', 'U', 'L', 'dist_filas_pines', 'Y1', 'Y2', 'diam_pin'];
  function celda(v) {
    v = (v == null ? '' : String(v)).trim();
    return v === '' || v === '–' || v === '-' ? null : v;
  }
  /** Número o null. Devuelve `undefined` si hay texto que no es un número. */
  function celdaNum(v) {
    v = celda(v);
    if (v === null) return null;
    var n = Number(v.replace(',', '.'));
    return isFinite(n) ? n : undefined;
  }
  function mediana(xs) {
    var o = xs.slice().sort(function (a, b) { return a - b; }), m = o.length >> 1;
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  }

  /** Convierte el CSV (separador ;, decimal con punto, "–" = vacío) en
   *  carreteles con sus campos calculados y su `estado` (ok | revisar |
   *  excluido). "–" y "" quedan null, nunca 0. */
  function importarCarreteles(texto, pared) {
    pared = pared || 0.6;
    var lineas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    var filas = lineas.slice(1).map(function (l) {
      var c = l.split(';');
      var k = {
        tipo: celda(c[0]), familia: celda(c[1]), codigo: celda(c[2]), descripcion: celda(c[3]) || '',
        N: celdaNum(c[4]), A: celdaNum(c[5]), I: celdaNum(c[6]), E: celdaNum(c[7]), T: celdaNum(c[8]),
        U: celdaNum(c[9]), L: celdaNum(c[10]), pines: celda(c[11]), dist_filas_pines: celdaNum(c[12]),
        Y1: celdaNum(c[13]), Y2: celdaNum(c[14]), diam_pin: celdaNum(c[15]), dibujo: celda(c[16]),
        notas: celda(c[17]) || ''
      };
      k._invalido = CAMPOS_NUM.some(function (f) { return k[f] === undefined; });
      CAMPOS_NUM.forEach(function (f) { if (k[f] === undefined) k[f] = null; });
      return k;
    });

    // N típico de cada familia (mediana entre sus carreteles monofásicos).
    var ns = {};
    filas.forEach(function (k) {
      if (k.tipo === TIPO_OK && k.N != null) (ns[k.familia] = ns[k.familia] || []).push(k.N);
    });

    return filas.map(function (k) {
      var excluir = [], revisar = [];
      var tieneY1 = k.Y1 != null, tieneY2 = k.Y2 != null;
      k.n_camaras = tieneY1 && tieneY2 ? 2 : (!tieneY1 && !tieneY2 ? 1 : null);
      k.camaras = k.n_camaras === 2 ? [k.Y1, k.Y2] : (k.n_camaras === 1 && k.I != null ? [k.I] : []);
      k.separador = k.n_camaras === 2 && k.I != null ? Math.round((k.I - k.Y1 - k.Y2) * 100) / 100 : null;
      k.pared = pared;

      if (k.tipo !== TIPO_OK) excluir.push('es ' + k.tipo + ' (va en otra calculadora)');
      if (k.N == null || k.A == null || k.I == null) excluir.push('le falta N, A o I');
      if (k._invalido) excluir.push('tiene una medida que no es un número');
      if (k.n_camaras == null) excluir.push('tiene solo una de las dos cámaras (Y1/Y2)');
      if (/\bsep\b/i.test(k.descripcion) && k.n_camaras === 1) excluir.push('dice "sep" pero tiene una sola cámara');

      if (k.separador != null && (k.separador < 0.5 || k.separador > 4)) {
        revisar.push('el separador entre cámaras da ' + k.separador + ' mm (fuera de 0,5 a 4 mm)');
      }
      var tip = ns[k.familia] && ns[k.familia].length > 1 ? mediana(ns[k.familia]) : null;
      if (tip != null && k.N != null && Math.abs(k.N - tip) > 1) {
        revisar.push('su N (' + k.N + ' mm) difiere más de 1 mm del típico de la familia (' + tip + ' mm)');
      }
      if (/pin/i.test(k.descripcion) && !k.pines) revisar.push('dice "pin" pero no tiene pines cargados');
      var pct = /(\d+)\s*\/\s*(\d+)\s*%/.exec(k.descripcion);
      if (pct && k.n_camaras === 2) {
        var real = Math.max(k.Y1, k.Y2) / (k.Y1 + k.Y2) * 100, desc = Math.max(+pct[1], +pct[2]);
        if (Math.abs(real - desc) > 2.9) {
          revisar.push('la descripción dice ' + pct[1] + '/' + pct[2] + ' % pero las cámaras reales son ' +
            Math.round(real) + '/' + Math.round(100 - real) + ' % (se usan las medidas reales)');
        }
      }

      delete k._invalido;
      k.estado = excluir.length ? 'excluido' : (revisar.length ? 'revisar' : 'ok');
      k.avisos = excluir.length ? excluir : revisar;
      return k;
    });
  }

  /** Agrega una fila "sin dato" por cada familia de los carreteles que todavía
   *  no tenga laminación. */
  function completarLaminaciones(lams, carreteles) {
    var vistas = {};
    lams.forEach(function (l) { vistas[l.familia] = true; });
    carreteles.forEach(function (c) {
      if (c.familia && !vistas[c.familia]) { vistas[c.familia] = true; lams.push(laminacionVacia(c.familia)); }
    });
    return lams;
  }

  /** Geometría final de un carretel: pared, tope físico (prof_max), profundidad
   *  útil y el límite que se usa. `medidas` = {pared?, prof_util?} cargadas a
   *  mano para ese carretel. Sin prof_util se usa prof_max, marcado "estimado". */
  function geometria(c, lam, p, medidas) {
    medidas = medidas || {};
    var pared = medidas.pared || c.pared || p.pared;
    var prof_max = c.U != null ? (c.U - c.N) / 2 - pared : null;
    var prof_util = null;
    if (medidas.prof_util) prof_util = medidas.prof_util;
    else if (lam && lam.pierna_mm && lam.ventana_ancho_mm) {
      prof_util = (lam.ventana_ancho_mm - (c.N - lam.pierna_mm)) / 2 * 0.9;
    }
    return {
      pared: pared, prof_max: prof_max, prof_util: prof_util,
      limite: prof_util != null ? prof_util : prof_max, estimado: prof_util == null,
      perimetro_tubo: 2 * (c.N + c.A + 4 * pared)
    };
  }

  var PARAMS = {
    f: 50,               // Hz
    B_taller: 1.55,      // T, inducción de taller para familias sin BA_ref (trafos reales: 1,50 a 1,66)
    k_flujo: 1.00,       // 1 = mismo flujo que el trafo de referencia
    J_prim_max: 3.0,     // A/mm²
    J_sec_max: 3.0,      // A/mm²
    eta: 0.80,           // para estimar la corriente del primario
    margen_brida: 0.4,   // mm por lado
    factor_capa: 1.05,   // desorden entre capas
    papel_cada: 10,      // capas
    papel_mm: 0.025,     // aislación entre capas
    aislacion_entre: 0.2,// mm entre bobinados de la misma cámara
    cierre: 0.1,         // mm, vuelta final
    pared: 0.6,          // mm, pared del carretel (estimado)
    T_cobre: 60,         // °C para R en caliente
    alfa_cu: 0.00393     // 1/°C
  };

  var MAX_HEBRAS = 3;

  function copiar(o) { return JSON.parse(JSON.stringify(o)); }
  function porId(lista, campo, valor) {
    for (var i = 0; i < lista.length; i++) if (lista[i][campo] === valor) return lista[i];
    return null;
  }

  /** Hilo listo para calcular a partir de un renglón del stock. */
  function resolverHilo(stockItem, alambres) {
    var a = porId(alambres, 'id', stockItem.alambre_id);
    if (!a) return null;
    var dext = stockItem.d_medido || (stockItem.grado === 2 ? a.d_ext_g2 : a.d_ext_g1);
    return {
      alias: stockItem.alias, alambre_id: a.id, d_cu: a.d_cu, d_ext: dext, ohm_m: a.ohm_m,
      area: Math.PI * a.d_cu * a.d_cu / 4
    };
  }

  /** Elige hilo y hebras para una corriente por hebra-conjunto `I`.
   *  Entre los que cumplen densidad máxima, el de menor ocupación
   *  (hebras · secciones · d_ext²). Si ninguno cumple, el de menor densidad,
   *  con `cumple = false`. `forzado` = {alias, hebras} salta la elección. */
  function elegirHilo(I, secciones, Jmax, hilos, forzado) {
    var mejor = null, menosDenso = null, i, h, cand;
    function evaluar(hilo, hebras) {
      var J = I / (hilo.area * hebras);
      return { hilo: hilo, hebras: hebras, J: J, ocupacion: hebras * secciones * hilo.d_ext * hilo.d_ext, cumple: J <= Jmax };
    }
    if (forzado && forzado.alias) {
      for (i = 0; i < hilos.length; i++) {
        if (hilos[i].alias === forzado.alias) {
          if (forzado.hebras) return evaluar(hilos[i], forzado.hebras);
          for (var hb = 1; hb <= MAX_HEBRAS; hb++) {
            cand = evaluar(hilos[i], hb);
            if (cand.cumple) return cand;
          }
          return cand;
        }
      }
    }
    for (i = 0; i < hilos.length; i++) {
      for (var heb = 1; heb <= MAX_HEBRAS; heb++) {
        cand = evaluar(hilos[i], heb);
        if (!menosDenso || cand.J < menosDenso.J) menosDenso = cand;
        if (cand.cumple && (!mejor || cand.ocupacion < mejor.ocupacion)) mejor = cand;
      }
    }
    return mejor || menosDenso;
  }

  /** Capas y espesor de un devanado en una cámara de ancho `ancho`. */
  function llenar(ancho, N, hilo, hebras, secciones, p) {
    var porCapa = Math.floor((ancho - 2 * p.margen_brida) / (hilo.d_ext * hebras * secciones));
    if (!(porCapa >= 1)) return { por_capa: 0, capas: Infinity, espesor: Infinity };
    var capas = Math.ceil(N / porCapa);
    var espesor = capas * hilo.d_ext * p.factor_capa + Math.floor(capas / p.papel_cada) * p.papel_mm;
    return { por_capa: porCapa, capas: capas, espesor: espesor };
  }

  /** Simula un reparto de devanados en cámaras. `asig[i]` = cámara del devanado i
   *  (los devanados van en orden: el primario primero). */
  function simularCamaras(devs, asig, carr, p) {
    var camaras = carr.camaras.map(function (ancho) {
      return { ancho: ancho, devanados: [], suma: 0, altura: 0 };
    });
    var res = devs.map(function () { return null; });
    devs.forEach(function (d, i) {
      var cam = camaras[asig[i]];
      var r0 = cam.suma + p.aislacion_entre * cam.devanados.length;
      var ll = llenar(cam.ancho, d.N, d.hilo, d.hebras, d.secciones, p);
      var P0 = carr.perimetro_tubo;
      var MLT = P0 + 2 * Math.PI * (r0 + ll.espesor / 2);
      var R = d.N * MLT / 1000 * d.hilo.ohm_m / d.hebras * (1 + p.alfa_cu * (p.T_cobre - 20));
      cam.devanados.push(i);
      cam.suma += ll.espesor;
      res[i] = { camara: asig[i], por_capa: ll.por_capa, capas: ll.capas, espesor: ll.espesor, mlt: MLT, R: R };
    });
    var peor = 0;
    camaras.forEach(function (c) {
      c.altura = c.devanados.length
        ? c.suma + p.aislacion_entre * (c.devanados.length - 1) + p.cierre
        : 0;
      if (c.altura > peor) peor = c.altura;
    });
    return { camaras: camaras, devanados: res, peor: peor };
  }

  /** Con una cámara van todos juntos. Con separador se prueba el primario en
   *  cada cámara y todo lo demás en la otra; gana la que deja la cámara más
   *  llena más baja. */
  function mejorReparto(devs, carr, p) {
    var n = devs.length, opciones = [], i;
    if (carr.camaras.length === 1) {
      opciones.push(devs.map(function () { return 0; }));
    } else {
      for (var c = 0; c < carr.camaras.length; c++) {
        var asig = [];
        for (i = 0; i < n; i++) asig.push(i === 0 ? c : (c + 1) % carr.camaras.length);
        opciones.push(asig);
      }
    }
    var mejor = null;
    opciones.forEach(function (asig) {
      var sim = simularCamaras(devs, asig, carr, p);
      if (!mejor || sim.peor < mejor.peor) mejor = sim;
    });
    return mejor;
  }

  function calcularUnaVez(entrada, datos, ajustes) {
    var p = datos.params, carr = porId(datos.carreteles, 'codigo', entrada.carretel);
    if (!carr) throw new Error('Carretel inexistente: ' + entrada.carretel);
    if (carr.estado === 'excluido') throw new Error('El carretel ' + carr.codigo + ' está excluido: ' + carr.avisos.join('; '));
    var lam = porId(datos.laminaciones, 'familia', carr.familia);
    var geo = geometria(carr, lam, p, (datos.medidas || {})[carr.codigo]);
    var carrCalc = { camaras: carr.camaras, perimetro_tubo: geo.perimetro_tubo };
    // Un solo método de flujo, en este orden:
    //  1) familia con BA_ref (trafo real): BA = BA_ref · A / A_ref (escala con la pila);
    //  2) si no, sección del carretel Se = N · A · 0,92 con la inducción de taller (1,55 T).
    var Se = carr.N * carr.A * ((lam && lam.apilado) || 0.92) / 100; // cm²
    var conRef = !!(lam && lam.BA_ref);
    var medido = !!entrada.nv_fijo;
    var BA = conRef ? lam.BA_ref * (lam.A_ref ? carr.A / lam.A_ref : 1) : p.B_taller * Se;
    var hilos = datos.stock.map(function (s) { return resolverHilo(s, datos.alambres); }).filter(Boolean);
    if (!hilos.length) throw new Error('No hay alambres en el stock.');
    var vin = entrada.vin;

    // Reingeniería: N/V y Np pueden venir medidos (nv_fijo, Np_fijo) en vez de salir del flujo.
    var nv = entrada.nv_fijo || 1e4 / (4.44 * p.f * BA * p.k_flujo);
    if (entrada.nv_fijo) BA = 1e4 / (4.44 * p.f * nv * p.k_flujo);
    var Np = entrada.Np_fijo || Math.round(vin * nv);

    var salidas = entrada.salidas.map(function (s, k) {
      var sec = s.secciones || 1;
      var Ns = s.Ns_fijo ? s.Ns_fijo : Math.round(s.v * nv) + (ajustes[k] || 0);
      return { v: s.v, i: s.i, secciones: sec, Ns: Ns, hilo_forzado: s.hilo || null };
    });

    var potencia = salidas.reduce(function (a, s) { return a + s.v * s.i * s.secciones; }, 0);
    var Ip = potencia / (p.eta * vin);

    var prim = elegirHilo(Ip, 1, p.J_prim_max, hilos, entrada.primario_hilo);
    var devs = [{ N: Np, hilo: prim.hilo, hebras: prim.hebras, secciones: 1 }];
    var elecciones = [prim];
    salidas.forEach(function (s) {
      var e = elegirHilo(s.i, s.secciones, p.J_sec_max, hilos, s.hilo_forzado);
      elecciones.push(e);
      devs.push({ N: s.Ns, hilo: e.hilo, hebras: e.hebras, secciones: s.secciones });
    });

    var rep = mejorReparto(devs, carrCalc, p);
    var Rp = rep.devanados[0].R;

    var Ip_real = salidas.reduce(function (a, s) { return a + s.Ns * s.i * s.secciones; }, 0) / Np;

    var alertas = [];
    var devanados = devs.map(function (d, i) {
      var r = rep.devanados[i], e = elecciones[i];
      if (!e.cumple) alertas.push({ nivel: 'err', texto: (i === 0 ? 'Primario' : 'Salida ' + i) + ': ningún hilo del stock cumple la densidad máxima (J = ' + e.J.toFixed(2) + ' A/mm²).' });
      if (!isFinite(r.espesor)) alertas.push({ nivel: 'err', texto: (i === 0 ? 'Primario' : 'Salida ' + i) + ': el hilo no entra en la cámara (más ancho que la cámara útil).' });
      return {
        rol: i === 0 ? 'Primario' : 'Salida ' + i,
        N: d.N, secciones: d.secciones, hilo: d.hilo.alias, alambre: d.hilo.alambre_id, d_ext: d.hilo.d_ext,
        hebras: d.hebras, J: e.J, cumple_J: e.cumple,
        camara: r.camara, por_capa: r.por_capa, capas: r.capas, espesor: r.espesor, mlt: r.mlt, R: r.R
      };
    });

    var salidasRes = salidas.map(function (s, k) {
      var Rs = rep.devanados[k + 1].R;
      var V0 = vin * s.Ns / Np;
      var Vc = V0 - s.i * Rs - Ip_real * Rp * s.Ns / Np;
      var vdc = s.secciones === 2 ? 1.41 * Vc - 0.7 : 1.41 * Vc - 1.4;
      return { v_nominal: s.v, i: s.i, secciones: s.secciones, Ns: s.Ns, Rs: Rs, V0: V0, Vcarga: Vc, Vdc: vdc };
    });

    // Semáforo: verde hasta 85 % del límite, amarillo de 85 a 100 %, rojo por encima.
    var camaras = rep.camaras.map(function (c, idx) {
      var pct = geo.limite != null && c.altura > 0 ? c.altura / geo.limite : null;
      var semaforo = pct == null ? null : (pct > 1 ? 'rojo' : (pct >= 0.85 ? 'amarillo' : 'verde'));
      if (semaforo === 'rojo') {
        alertas.push({ nivel: 'err', texto: 'Cámara ' + (idx + 1) + ': altura ' + c.altura.toFixed(2) + ' mm supera ' +
          (geo.estimado ? 'la profundidad máxima estimada (' : 'la profundidad útil (') + geo.limite.toFixed(2) + ' mm).' });
      }
      return { ancho: c.ancho, altura: c.altura, pct: pct, semaforo: semaforo, excede: semaforo === 'rojo', ocupa: c.devanados.length > 0 };
    });

    var flujo_rel = (vin * 1e4 / (4.44 * p.f * Np)) / BA;
    if (flujo_rel > 1.005) alertas.push({ nivel: 'err', texto: 'Flujo ' + (flujo_rel * 100).toFixed(0) + '% del de referencia: por encima de 100%.' });
    if (flujo_rel * 1.1 > 1.005) alertas.push({ nivel: 'warn', texto: 'A Vin + 10 % el flujo llega a ' + (flujo_rel * 110).toFixed(0) + '% del de referencia.' });
    // B real: sobre la pierna central si se conoce, si no sobre el agujero del carretel (Se).
    var secB = lam && lam.pierna_mm ? lam.pierna_mm * carr.A * lam.apilado / 100 : Se;
    var B = (vin * 1e4 / (4.44 * p.f * Np)) / secB;
    if (B > 1.75) alertas.push({ nivel: 'err', texto: 'Saturación probable: B = ' + B.toFixed(2) + ' T (más de 1,75 T).' });
    else if (B < 1.1) alertas.push({ nivel: 'warn', texto: 'Núcleo sobredimensionado: B = ' + B.toFixed(2) + ' T (menos de 1,1 T).' });

    return {
      nv: nv, Np: Np, Ip: Ip, Ip_real: Ip_real, Rp: Rp, flujo_rel: flujo_rel, B_tesla: B,
      familia: carr.familia, BA: BA, metodo_flujo: medido ? 'vueltas medidas' : (conRef ? 'BA_ref de trafo real' : 'Se × ' + p.B_taller + ' T'), confianza: medido ? 'alta' : (conRef ? 'media' : 'baja'), Se: Se, geometria: geo, avisos_carretel: carr.estado === 'revisar' ? carr.avisos : [], carretel: carr.codigo, devanados: devanados, salidas: salidasRes,
      camaras: camaras, alertas: alertas
    };
  }

  /** Calcula el trafo. entrada = {vin, carretel, salidas:[{v, i, secciones?,
   *  hilo?:{alias, hebras?}}], primario_hilo?, modo_tension?: 'vacio'|'carga'}.
   *  datos = {params, alambres, stock, carreteles, laminaciones, medidas?} (ver `datosPorDefecto`).
   *  Con modo 'carga' la V de cada salida es la que se quiere con la corriente
   *  dada: se suman espiras hasta que el ajuste dé 0. */
  function calcular(entrada, datos) {
    var ajustes = entrada.salidas.map(function () { return 0; });
    var res = calcularUnaVez(entrada, datos, ajustes);
    if (entrada.modo_tension === 'carga') {
      for (var it = 0; it < 20; it++) {
        var cambio = false;
        res.salidas.forEach(function (s, k) {
          var extra = Math.round((s.v_nominal - s.Vcarga) * res.nv);
          if (extra !== 0) { ajustes[k] += extra; cambio = true; }
        });
        if (!cambio) break;
        res = calcularUnaVez(entrada, datos, ajustes);
      }
    }
    return res;
  }

  // --- Reingeniería: calcular con datos parciales ---
  // Todos los datos son opcionales. Se mide lo que se puede (Np, Ns, Ø, Rp, Rs,
  // medidas del núcleo) y el resto se estima, con una confianza explícita:
  //   alta         = hay Np o Ns medido (el N/V sale de una medición);
  //   media        = BA_ref de un trafo real de la misma familia;
  //   baja         = solo Se × inducción de taller;
  //   insuficiente = falta Vp o el núcleo.
  function calibreMedido(valor, esmalte, alambres) {
    var campo = esmalte ? 'd_ext_g1' : 'd_cu', mejor = null;
    alambres.forEach(function (a) {
      var dif = Math.abs(a[campo] - valor);
      if (!mejor || dif < mejor.dif) mejor = { a: a, dif: dif };
    });
    return mejor;
  }

  function reingenieria(entrada, datos) {
    var p = Object.assign({}, datos.params);
    if (entrada.J > 0) { p.J_prim_max = entrada.J; p.J_sec_max = entrada.J; }
    if (entrada.B_taller > 0) p.B_taller = entrada.B_taller;
    p.T_cobre = 20; // las resistencias de banco se miden a ~20 °C: no se corrigen
    var d2 = {
      params: p, alambres: datos.alambres, stock: datos.stock.slice(), carreteles: datos.carreteles.slice(),
      laminaciones: datos.laminaciones, medidas: datos.medidas
    };
    var faltantes = [], avisos = [], vp = entrada.vp;
    var sal = (entrada.salidas || []).filter(function (s) { return s && s.v > 0; });

    var cod = entrada.carretel;
    if (!cod && entrada.N > 0 && entrada.A > 0 && entrada.I > 0) {
      cod = '__manual__';
      d2.carreteles.push({
        codigo: cod, familia: '(medidas manuales)', descripcion: 'medidas manuales', N: entrada.N, A: entrada.A,
        I: entrada.I, U: null, pines: null, n_camaras: 1, camaras: [entrada.I], pared: p.pared, estado: 'ok', avisos: []
      });
    }
    if (!(vp > 0)) faltantes.push('Tensión primaria (Vp)');
    if (!cod) faltantes.push('Código de carretel o medidas N, A e I del núcleo');
    if (!sal.length) faltantes.push('Tensión secundaria (Vs)');
    if (!(vp > 0) || !cod) return { insuficiente: true, confianza: 'insuficiente', faltantes: faltantes, avisos: [], coherencia: [], sugerencias: [] };

    var sinCorriente = false;
    sal.forEach(function (s) {
      s.secciones = s.secciones || 1;
      s.i = s.i > 0 ? s.i : (s.ps > 0 ? s.ps / (s.v * s.secciones) : 0);
      if (!(s.i > 0)) { sinCorriente = true; s.i = 0.001; }
    });
    if (sinCorriente) {
      faltantes.push('Corriente (Is) o potencia (Ps) del secundario: sin ella no se calculan alambres ni ventana');
    }
    if (!sal.length) { sal = [{ v: 1, i: 0.001, secciones: 1 }]; sinCorriente = true; }

    var cond = entrada.condicion === 'carga' ? 'carga' : 'vacio';
    var s1 = sal[0], Ns1 = s1.Ns > 0 ? s1.Ns : null, Np = entrada.Np > 0 ? entrada.Np : null;

    // Ø medidos → se buscan en el catálogo y se fuerzan como hilo de ese devanado.
    function forzar(medido, nombre) {
      if (!medido || !(medido.valor > 0)) return null;
      var c = calibreMedido(medido.valor, medido.esmalte, d2.alambres);
      if (c.dif > 0.02) avisos.push({ nivel: 'warn', texto: 'Ø ' + nombre + ' medido (' + medido.valor + ' mm) no coincide con un calibre del catálogo; se usa ' + c.a.id + '.' });
      var alias = 'Ø' + nombre + ' medido ' + medido.valor;
      d2.stock.push({ alias: alias, alambre_id: c.a.id, grado: 1, d_medido: medido.esmalte ? medido.valor : null });
      return { alias: alias, hebras: medido.hebras || null };
    }
    var hiloP = forzar(entrada.dp, 'p'), hiloS = forzar(entrada.ds, 's');

    function armar(nv) {
      var e = {
        vin: vp, carretel: cod, modo_tension: cond === 'carga' && !Ns1 ? 'carga' : 'vacio',
        salidas: sal.map(function (s, k) {
          return { v: s.v, i: s.i, secciones: s.secciones, Ns_fijo: k === 0 ? Ns1 : null, hilo: k === 0 && hiloS ? hiloS : null };
        })
      };
      if (hiloP) e.primario_hilo = hiloP;
      if (Np) e.Np_fijo = Np;
      if (nv) e.nv_fijo = nv;
      return e;
    }
    function nvMedido(dropS) {
      var xs = [], fuentes = [];
      if (Np) { xs.push(Np / vp); fuentes.push('Np / Vp'); }
      if (Ns1) { xs.push(Ns1 / (s1.v + (dropS || 0))); fuentes.push('Ns / Vs' + (cond === 'carga' ? ' (corregido por la caída)' : ' (en vacío)')); }
      return xs.length ? { nv: xs.reduce(function (a, b) { return a + b; }, 0) / xs.length, fuentes: fuentes } : null;
    }

    var med = nvMedido(0), r;
    if (med) {
      r = calcular(armar(med.nv), d2);
      // Ns medido con carga: la tensión leída es menor que la de vacío; se suma la caída calculada.
      if (Ns1 && cond === 'carga') {
        for (var it = 0; it < 6; it++) {
          med = nvMedido(r.salidas[0].V0 - r.salidas[0].Vcarga);
          r = calcular(armar(med.nv), d2);
        }
      }
    } else {
      r = calcular(armar(null), d2);
    }
    if (Np && Ns1 && med) {
      var a = Np / vp, b = Ns1 / s1.v;
      if (Math.abs(a - b) / Math.max(a, b) > 0.05) {
        avisos.push({ nivel: 'warn', texto: 'Np/Vp (' + a.toFixed(2) + ') y Ns/Vs (' + b.toFixed(2) + ') difieren más de 5 %: ¿Vs medida con carga o vueltas mal contadas?' });
      }
    }
    if (Ns1 && cond === 'carga' && !Np) {
      avisos.push({ nivel: 'warn', texto: 'Vs medida con carga: el N/V se corrigió sumando la caída calculada con las resistencias estimadas.' });
    }

    // Coherencia con las resistencias medidas (a ~20 °C).
    var coherencia = [];
    function ohm(id) { return porId(d2.alambres, 'id', id).ohm_m; }
    function comparar(nombre, medida, dev, calc) {
      if (!(medida > 0) || !dev) return;
      var dR = (calc - medida) / medida;
      var mltReal = medida * 1000 * dev.hebras / (dev.N * ohm(dev.alambre));
      var dM = (dev.mlt - mltReal) / mltReal;
      coherencia.push({ nombre: nombre, medida: medida, calculada: calc, dif_R: dR, mlt_real: mltReal, mlt_calc: dev.mlt, dif_mlt: dM });
      if (Math.abs(dR) > 0.2) avisos.push({ nivel: 'warn', texto: nombre + ': la resistencia calculada (' + calc.toFixed(1) + ' Ω) difiere ' + (Math.abs(dR) * 100).toFixed(0) + ' % de la medida (' + medida + ' Ω).' });
      if (Math.abs(dM) > 0.15) avisos.push({ nivel: 'warn', texto: nombre + ': el largo medio de espira implícito en la medición (' + mltReal.toFixed(0) + ' mm) difiere ' + (Math.abs(dM) * 100).toFixed(0) + ' % del del carretel (' + dev.mlt.toFixed(0) + ' mm).' });
    }
    if (!sinCorriente) {
      comparar('Rp', entrada.Rp, r.devanados[0], r.Rp);
      comparar('Rs', entrada.Rs, r.devanados[1], r.salidas[0].Rs);
    }

    // Carretel más chico que entra. Al pasar a otra familia se recalcula el N/V con el
    // flujo de esa familia (no se arrastran las vueltas medidas).
    var sugerencias = [];
    if (!sinCorriente) {
      var actual = porId(d2.carreteles, 'codigo', cod), vistos = [];
      d2.carreteles.forEach(function (c) {
        if (c.estado === 'excluido' || c.codigo === cod || c.codigo === '__manual__') return;
        if (actual && c.n_camaras !== actual.n_camaras) return;
        try {
          var e = armar(null);
          delete e.Np_fijo; e.carretel = c.codigo; e.modo_tension = cond === 'carga' ? 'carga' : 'vacio';
          e.salidas.forEach(function (s) { s.Ns_fijo = null; });
          var rr = calcular(e, d2), peor = 0;
          rr.camaras.forEach(function (k) { if (k.pct != null && k.pct > peor) peor = k.pct; });
          if (rr.geometria.limite == null || peor > 0.85 || rr.alertas.some(function (x) { return x.nivel === 'err'; })) return;
          vistos.push({ codigo: c.codigo, descripcion: c.descripcion, familia: c.familia, Np: rr.Np, ocupacion: peor, Se: rr.Se, estado: c.estado });
        } catch (err) { /* este carretel no se puede calcular */ }
      });
      vistos.sort(function (x, y) { return x.Se - y.Se; });
      sugerencias = vistos.slice(0, 3);
    }

    // Lo que falta medir para ganar confianza.
    if (!Np && !Ns1) faltantes.push('Medir Np (o Ns) del original: con eso la confianza pasa a alta');
    if (!entrada.dp) faltantes.push('Medir Øp');
    if (!entrada.ds) faltantes.push('Medir Øs');
    if (!(entrada.Rp > 0)) faltantes.push('Medir Rp');
    if (!(entrada.Rs > 0)) faltantes.push('Medir Rs');
    var lam = porId(d2.laminaciones, 'familia', porId(d2.carreteles, 'codigo', cod).familia);
    if (!lam || !lam.pierna_mm || !lam.ventana_ancho_mm) faltantes.push('Pierna y ancho de ventana de la laminación (SOMA), para la profundidad útil');

    r.confianza = med ? 'alta' : r.confianza;
    r.fuentes_nv = med ? med.fuentes : [];
    r.faltantes = faltantes;
    r.avisos = avisos;
    r.coherencia = coherencia;
    r.sugerencias = sugerencias;
    r.sin_corriente = sinCorriente;
    return r;
  }

  function datosPorDefecto() {
    return {
      params: copiar(PARAMS), alambres: copiar(ALAMBRES), stock: copiar(STOCK_INICIAL),
      carreteles: [], laminaciones: laminacionesIniciales(), medidas: {}
    };
  }

  var api = {
    calcular: calcular, reingenieria: reingenieria, datosPorDefecto: datosPorDefecto, PARAMS: PARAMS,
    importarCarreteles: importarCarreteles, completarLaminaciones: completarLaminaciones, geometria: geometria
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcTrafo = api;
})(typeof window !== 'undefined' ? window : this);

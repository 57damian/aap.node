// Informes contables — balance, ventas vs compras, IVA e impuestos.
// Backend: routes/informes.routes.js (services/informes.js)
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var informe = null; // última respuesta, para el CSV

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fechaISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function mesTexto(m) {
    var p = String(m).split('-');
    var nombres = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return nombres[Number(p[1]) - 1] + ' ' + p[0];
  }
  function suma(arr, campo) { return arr.reduce(function (s, x) { return s + (Number(x[campo]) || 0); }, 0); }

  /* ------------------------------------------------------------------ */
  /* Piezas de HTML                                                      */
  /* ------------------------------------------------------------------ */
  function kpi(clase, titulo, valor, sub) {
    return '<div class="kpi ' + clase + '"><div class="kpi-k">' + titulo + '</div>' +
      '<div class="kpi-v">' + Shell.money(valor) + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }

  function panel(titulo, cuerpo) {
    return '<div class="panel" style="margin-top:var(--space-3)">' +
      (titulo ? '<div class="panel-head"><h2>' + titulo + '</h2></div>' : '') +
      '<div class="panel-body flush"><div class="table-wrap">' + cuerpo + '</div></div></div>';
  }

  // filas: [[concepto, importe, opciones?]] — opciones: { fuerte, muted }
  function tablaConceptos(filas) {
    return '<table class="t"><tbody>' + filas.map(function (f) {
      var o = f[2] || {};
      var estilo = o.fuerte ? ' style="font-weight:600"' : (o.muted ? ' class="muted"' : '');
      return '<tr' + estilo + '><td>' + f[0] + '</td><td class="num">' +
        (f[1] === null ? '' : Shell.money(f[1])) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function tablaMensual(columnas, filas, totales) {
    var head = '<tr><th>Mes</th>' + columnas.map(function (c) { return '<th class="num">' + c.titulo + '</th>'; }).join('') + '</tr>';
    var cuerpo = filas.map(function (m) {
      return '<tr><td data-label="Mes">' + mesTexto(m.mes) + '</td>' + columnas.map(function (c) {
        return '<td class="num" data-label="' + c.titulo + '">' + Shell.money(m[c.campo]) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var pie = '<tr style="font-weight:600"><td>Total</td>' + columnas.map(function (c) {
      return '<td class="num">' + Shell.money(totales[c.campo]) + '</td>';
    }).join('') + '</tr>';
    return '<table class="t"><thead>' + head + '</thead><tbody>' + cuerpo + pie + '</tbody></table>';
  }

  function tablaGastosPorCategoria(porCategoria, conIva) {
    if (!porCategoria.length) return '<p class="muted" style="padding:var(--space-3)">No hay gastos cargados en el período.</p>';
    var head = '<tr><th>Categoría</th>' + (conIva ? '<th class="num">Neto</th><th class="num">IVA</th>' : '') + '<th class="num">Total</th></tr>';
    var cuerpo = porCategoria.map(function (c) {
      return '<tr><td>' + esc(c.nombre) + (c.es_impuesto ? ' <span class="muted">(impuesto)</span>' : '') + '</td>' +
        (conIva ? '<td class="num">' + Shell.money(c.neto) + '</td><td class="num">' + Shell.money(c.iva) + '</td>' : '') +
        '<td class="num">' + Shell.money(c.total) + '</td></tr>';
    }).join('');
    return '<table class="t"><thead>' + head + '</thead><tbody>' + cuerpo + '</tbody></table>';
  }

  /* ------------------------------------------------------------------ */
  /* Por fecha de factura                                                */
  /* ------------------------------------------------------------------ */
  function pintarDevengado(d) {
    var b = d.balance, iva = d.iva;
    var gastosTotal = b.gastos_netos + b.impuestos_pagados;
    var claseIva = iva.estado === 'A_PAGAR' ? 'is-danger' : iva.estado === 'A_FAVOR' ? 'is-success' : '';
    var tituloIva = iva.estado === 'A_PAGAR' ? 'IVA en contra (a pagar)' : iva.estado === 'A_FAVOR' ? 'IVA a favor' : 'Saldo de IVA';

    $('kpis').innerHTML =
      kpi('is-success', 'Ventas netas', b.ventas_netas, d.ventas.cantidad + ' factura(s) · sin IVA') +
      kpi('is-warning', 'Compras netas', b.compras_netas, d.compras.cantidad + ' factura(s) · sin IVA') +
      kpi('is-info', 'Gastos e impuestos', gastosTotal + b.percepciones_y_provinciales, 'gastos varios, impuestos y percepciones') +
      kpi(b.resultado >= 0 ? 'is-success' : 'is-danger', 'Resultado', b.resultado, b.resultado >= 0 ? 'ganancia del período' : 'pérdida del período') +
      kpi(claseIva, tituloIva, Math.abs(iva.saldo), 'débito ' + Shell.money(iva.debito) + ' − crédito ' + Shell.money(iva.credito_total));

    // --- Balance
    $('tab-balance').innerHTML =
      panel('Balance del período', tablaConceptos([
        ['Ventas netas <span class="muted">(sin IVA, menos notas de crédito)</span>', b.ventas_netas],
        ['Compras de materia prima <span class="muted">(neto)</span>', -b.compras_netas],
        ['Gastos <span class="muted">(neto)</span>', -b.gastos_netos],
        ['Impuestos pagados', -b.impuestos_pagados],
        ['Percepciones e impuestos provinciales de las compras', -b.percepciones_y_provinciales],
        ['Resultado', b.resultado, { fuerte: true }]
      ])) +
      '<p class="muted" style="margin:var(--space-2) 0">El IVA no entra en el resultado: lo que se cobra y se paga de IVA se compensa en el informe de IVA. ' +
      'Las retenciones que te hicieron los clientes son pagos a cuenta de impuestos (se ven en Impuestos) y tampoco restan.</p>' +
      panel('Mes a mes', tablaMensual([
        { campo: 'ventas', titulo: 'Ventas' }, { campo: 'compras', titulo: 'Compras' },
        { campo: 'gastos', titulo: 'Gastos' }, { campo: 'impuestos', titulo: 'Impuestos' },
        { campo: 'resultado', titulo: 'Resultado' }
      ], d.mensual, {
        ventas: suma(d.mensual, 'ventas'), compras: suma(d.mensual, 'compras'), gastos: suma(d.mensual, 'gastos'),
        impuestos: suma(d.mensual, 'impuestos'), resultado: suma(d.mensual, 'resultado')
      }));

    // --- Ventas vs compras
    var dif = d.ventas.neto - d.compras.neto;
    $('tab-vsc').innerHTML =
      panel('Ventas contra compras (sin IVA)', tablaConceptos([
        ['Facturado a clientes <span class="muted">(' + d.ventas.cantidad + ' factura(s))</span>', d.ventas.facturado_neto],
        ['Notas de crédito <span class="muted">(' + d.ventas.notas_credito.cantidad + ')</span>', -d.ventas.notas_credito.neto],
        ['Ventas netas', d.ventas.neto, { fuerte: true }],
        ['Compras de materia prima <span class="muted">(' + d.compras.cantidad + ' factura(s))</span>', d.compras.neto, { fuerte: true }],
        ['Diferencia (ventas − compras)', dif, { fuerte: true }]
      ])) +
      panel('Mes a mes', tablaMensual([
        { campo: 'ventas', titulo: 'Ventas' }, { campo: 'compras', titulo: 'Compras' }, { campo: 'dif', titulo: 'Diferencia' }
      ], d.mensual.map(function (m) { return Object.assign({}, m, { dif: m.ventas - m.compras }); }), {
        ventas: suma(d.mensual, 'ventas'), compras: suma(d.mensual, 'compras'), dif: dif
      }));

    // --- IVA
    var filasIva = [
      ['IVA débito <span class="muted">(el que cobraste en las ventas, neto de notas de crédito)</span>', iva.debito],
      ['IVA crédito de compras', -iva.credito_compras],
      ['IVA crédito de gastos', -iva.credito_gastos],
      [iva.estado === 'A_PAGAR' ? 'Saldo de IVA en contra (a pagar)' : iva.estado === 'A_FAVOR' ? 'Saldo de IVA a favor' : 'Saldo de IVA',
        Math.abs(iva.saldo), { fuerte: true }]
    ];
    if (iva.retenciones_iva_sufridas) {
      filasIva.push(['Retenciones de IVA que te hicieron los clientes <span class="muted">(se computan aparte, no están descontadas)</span>',
        iva.retenciones_iva_sufridas, { muted: true }]);
    }
    var sinDetalle = Math.abs(iva.credito_compras_sin_detalle) >= 0.005
      ? '<tr class="muted"><td>Sin detalle de alícuota <span class="muted">(facturas cargadas sin ítems)</span></td><td class="num"></td><td class="num">' +
        Shell.money(iva.credito_compras_sin_detalle) + '</td></tr>'
      : '';
    var alicuotas = iva.por_alicuota.length || sinDetalle
      ? panel('Crédito de compras por alícuota', '<table class="t"><thead><tr><th>Alícuota</th><th class="num">Neto</th><th class="num">IVA</th></tr></thead><tbody>' +
          iva.por_alicuota.map(function (a) {
            return '<tr><td>' + a.alicuota + '%</td><td class="num">' + Shell.money(a.neto) + '</td><td class="num">' + Shell.money(a.iva) + '</td></tr>';
          }).join('') + sinDetalle + '</tbody></table>')
      : '';
    $('tab-iva').innerHTML =
      panel('IVA del período', tablaConceptos(filasIva)) +
      '<p class="muted" style="margin:var(--space-2) 0">Un saldo positivo es IVA en contra: lo que cobraste de IVA supera lo que pagaste, y se paga. Uno a favor se arrastra al mes siguiente.</p>' +
      alicuotas +
      panel('Mes a mes', tablaMensual([
        { campo: 'iva_debito', titulo: 'IVA débito' }, { campo: 'iva_credito', titulo: 'IVA crédito' }, { campo: 'iva_saldo', titulo: 'Saldo' }
      ], d.mensual, {
        iva_debito: suma(d.mensual, 'iva_debito'), iva_credito: suma(d.mensual, 'iva_credito'), iva_saldo: suma(d.mensual, 'iva_saldo')
      }));

    // --- Impuestos
    pintarImpuestos(d, true);
  }

  function pintarImpuestos(d, devengado) {
    var imp = d.impuestos;
    var filas = [['Impuestos pagados <span class="muted">(gastos de categoría impuesto)</span>', imp.pagados]];
    if (devengado) {
      filas.push(['Percepciones en facturas de compra', imp.percepciones_compras]);
      filas.push(['Impuestos provinciales en facturas de compra', imp.impuestos_provinciales_compras]);
    }
    var retenciones = imp.retenciones_sufridas.length
      ? imp.retenciones_sufridas.map(function (r) { return [esc(r.tipo), r.total]; })
      : [['Sin retenciones en el período', null, { muted: true }]];

    $('tab-impuestos').innerHTML =
      panel('Impuestos del período', tablaConceptos(filas)) +
      panel('Retenciones que te hicieron los clientes (impuestos a favor)',
        tablaConceptos(retenciones.concat(imp.retenciones_sufridas.length
          ? [['Total retenciones sufridas', imp.retenciones_sufridas_total, { fuerte: true }]] : []))) +
      panel('Gastos por categoría', tablaGastosPorCategoria(d.gastos.por_categoria, devengado));
  }

  /* ------------------------------------------------------------------ */
  /* Por fecha de cobro y de pago                                        */
  /* ------------------------------------------------------------------ */
  function pintarPercibido(d) {
    var f = d.flujo;
    $('kpis').innerHTML =
      kpi('is-success', 'Cobrado', f.cobrado, f.cobros + ' cobro(s) acreditado(s)') +
      kpi('is-warning', 'Pagado a proveedores', f.pagado_proveedores, f.pagos + ' pago(s)') +
      kpi('is-info', 'Gastos', f.gastos, 'con IVA incluido') +
      kpi(f.saldo >= 0 ? 'is-success' : 'is-danger', 'Saldo', f.saldo, f.saldo >= 0 ? 'entró más de lo que salió' : 'salió más de lo que entró');

    $('tab-balance').innerHTML =
      panel('Flujo de plata del período', tablaConceptos([
        ['Cobrado <span class="muted">(sin retenciones)</span>', f.cobrado],
        ['Pagado a proveedores <span class="muted">(sin retenciones)</span>', -f.pagado_proveedores],
        ['Gastos <span class="muted">(con IVA)</span>', -f.gastos],
        ['Saldo', f.saldo, { fuerte: true }]
      ])) +
      '<p class="muted" style="margin:var(--space-2) 0">Un cheque de un cliente que endosaste a un proveedor cuenta como cobrado y como pagado. ' +
      'Con este criterio no se calcula el IVA: se liquida por fecha de factura.</p>' +
      panel('Mes a mes', tablaMensual([
        { campo: 'cobrado', titulo: 'Cobrado' }, { campo: 'pagado_proveedores', titulo: 'Pagado a proveedores' },
        { campo: 'gastos', titulo: 'Gastos' }, { campo: 'saldo', titulo: 'Saldo' }
      ], d.mensual, {
        cobrado: suma(d.mensual, 'cobrado'), pagado_proveedores: suma(d.mensual, 'pagado_proveedores'),
        gastos: suma(d.mensual, 'gastos'), saldo: suma(d.mensual, 'saldo')
      }));
    $('tab-vsc').innerHTML = '';
    $('tab-iva').innerHTML = '';
    pintarImpuestos(d, false);
  }

  /* ------------------------------------------------------------------ */
  /* Carga                                                               */
  /* ------------------------------------------------------------------ */
  function paramsActuales() {
    return new URLSearchParams({ desde: $('iDesde').value, hasta: $('iHasta').value, criterio: $('iCriterio').value }).toString();
  }

  function mostrarTab(nombre) {
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === nombre); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.toggle('active', c.id === 'tab-' + nombre); });
  }

  var cargando = false;
  async function cargar() {
    if (cargando) return;
    if (!$('iDesde').value || !$('iHasta').value) return;
    cargando = true;
    $('informeError').hidden = true;
    var btn = $('btnActualizar');
    btn.disabled = true;
    try {
      var d = await apiFetch('/api/informes/resumen?' + paramsActuales());
      informe = d;
      var devengado = d.criterio === 'factura';
      // Con el criterio de cobro/pago no hay IVA ni comparación de facturas.
      $('tabBtnVsc').hidden = !devengado;
      $('tabBtnIva').hidden = !devengado;
      $('tabBtnBalance').textContent = devengado ? 'Balance' : 'Flujo de plata';
      var activa = document.querySelector('.tab.active');
      if (!devengado && activa && (activa.dataset.tab === 'vsc' || activa.dataset.tab === 'iva')) mostrarTab('balance');
      if (devengado) pintarDevengado(d); else pintarPercibido(d);
    } catch (err) {
      informe = null;
      var el = $('informeError');
      el.textContent = (err && (err.error || err.message)) || 'No se pudo armar el informe';
      el.hidden = false;
    } finally {
      cargando = false;
      btn.disabled = false;
    }
  }

  function exportarCsv() {
    if (!informe) { Shell.toast('warn', 'Todavía no hay un informe para exportar'); return; }
    var devengado = informe.criterio === 'factura';
    var num = function (v) { return String(Number(v) || 0).replace('.', ','); };
    function celda(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }
    var filas;
    if (devengado) {
      filas = [['Mes', 'Ventas netas', 'Compras netas', 'Gastos', 'Impuestos', 'Resultado', 'IVA débito', 'IVA crédito', 'Saldo de IVA']];
      informe.mensual.forEach(function (m) {
        filas.push([m.mes, num(m.ventas), num(m.compras), num(m.gastos), num(m.impuestos), num(m.resultado),
          num(m.iva_debito), num(m.iva_credito), num(m.iva_saldo)]);
      });
      var b = informe.balance;
      filas.push(['Total', num(b.ventas_netas), num(b.compras_netas), num(b.gastos_netos),
        num(b.impuestos_pagados + b.percepciones_y_provinciales), num(b.resultado),
        num(informe.iva.debito), num(informe.iva.credito_total), num(informe.iva.saldo)]);
    } else {
      filas = [['Mes', 'Cobrado', 'Pagado a proveedores', 'Gastos', 'Saldo']];
      informe.mensual.forEach(function (m) {
        filas.push([m.mes, num(m.cobrado), num(m.pagado_proveedores), num(m.gastos), num(m.saldo)]);
      });
      var f = informe.flujo;
      filas.push(['Total', num(f.cobrado), num(f.pagado_proveedores), num(f.gastos), num(f.saldo)]);
    }
    var csv = '﻿' + filas.map(function (r) { return r.map(celda).join(';'); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = 'informe-' + informe.criterio + '-' + informe.desde + '-a-' + informe.hasta + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function atajo(tipo) {
    var hoy = new Date();
    var a = hoy.getFullYear(), m = hoy.getMonth();
    var desde, hasta;
    if (tipo === 'mes') { desde = new Date(a, m, 1); hasta = new Date(a, m + 1, 0); }
    else if (tipo === 'anterior') { desde = new Date(a, m - 1, 1); hasta = new Date(a, m, 0); }
    else { desde = new Date(a, 0, 1); hasta = new Date(a, 11, 31); }
    $('iDesde').value = fechaISO(desde);
    $('iHasta').value = fechaISO(hasta);
    cargar();
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { mostrarTab(t.dataset.tab); });
  });
  document.querySelectorAll('[data-atajo]').forEach(function (b) {
    b.addEventListener('click', function () { atajo(b.dataset.atajo); });
  });
  $('btnActualizar').addEventListener('click', cargar);
  ['iDesde', 'iHasta', 'iCriterio'].forEach(function (id) { $(id).addEventListener('change', cargar); });
  $('btnCsv').addEventListener('click', exportarCsv);
  $('btnPdf').addEventListener('click', function () {
    if (!$('iDesde').value || !$('iHasta').value) { Shell.toast('warn', 'Elegí las fechas del período'); return; }
    verArchivoProtegido('api/informes/resumen/pdf?' + paramsActuales());
  });

  atajo('mes');
})();

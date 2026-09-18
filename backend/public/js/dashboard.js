/* =====================================================================
 * dashboard.js — Panel de control
 * ---------------------------------------------------------------------
 * Migrado al shell (F1.17 del plan de rediseño). La plata primero: cuatro
 * KPI de deuda/dólar, la tabla de facturas de compra que requieren
 * atención y los cheques por debitarse. Nada de "0 Clientes / 0
 * Proveedores": esos números no obligan a hacer nada.
 *
 * Endpoints usados (los que ya existen y alcanzan, según el plan):
 *   GET /api/cobros/resumen
 *   GET /api/pagos-proveedores/resumen
 *   GET /api/pagos-proveedores/alertas/facturas-pendientes
 *   GET /api/pagos-proveedores/cheques/alertas
 *   GET /api/precios/parametros/dolar
 * ===================================================================== */

(function () {
  'use strict';

  function comprobante(f) {
    var pv = f.punto_venta ? String(f.punto_venta).padStart(4, '0') : '';
    var nro = f.numero_factura ? String(f.numero_factura).padStart(8, '0') : '';
    return (f.tipo_factura || '') + (pv ? ' ' + pv + '-' + nro : nro);
  }

  function estadoPill(estadoAlerta) {
    return estadoAlerta === 'vencida' ? Shell.pill('VENCIDA') : Shell.pill('PENDIENTE');
  }

  async function cargarKpis() {
    try {
      const r = await apiFetch('/api/cobros/resumen');
      document.getElementById('kDeudaCli').textContent = Shell.money(r.deuda.deuda_total);
      document.getElementById('kDeudaCliSub').textContent =
        r.deuda.clientes_con_deuda + ' clientes · ' + Shell.money(r.deuda.vencido) + ' vencido';
      document.getElementById('kGestion').textContent = Shell.money(r.deuda.en_gestion);
      document.getElementById('kGestionSub').textContent =
        (r.cheques_en_cartera.cantidad || 0) + ' cheques sin acreditar';
    } catch (e) {
      Shell.error(e, 'No se pudo cargar el resumen de cobros');
    }

    try {
      const r = await apiFetch('/api/pagos-proveedores/resumen');
      document.getElementById('kDeudaProv').textContent = Shell.money(r.deuda.deuda_total);
      document.getElementById('kDeudaProvSub').textContent =
        r.deuda.proveedores_con_deuda + ' proveedores · ' + Shell.money(r.deuda.vencido) + ' vencido';
    } catch (e) {
      Shell.error(e, 'No se pudo cargar el resumen de pagos a proveedores');
    }

    try {
      const r = await apiFetch('/api/precios/parametros/dolar');
      document.getElementById('kDolar').textContent = Shell.money(r.dolar);
      document.getElementById('kDolarSub').textContent = r.fecha
        ? 'Actualizado ' + Shell.fecha(r.fecha)
        : 'Sin actualizar';
    } catch (e) {
      Shell.error(e, 'No se pudo cargar la cotización del dólar');
    }
  }

  async function cargarAtencion() {
    const tb = document.getElementById('tbAtencion');
    try {
      const r = await apiFetch('/api/pagos-proveedores/alertas/facturas-pendientes?dias_vencimiento=7');
      const filas = (r.vencidas || []).concat(r.por_vencer || [])
        .sort(function (a, b) { return (b.dias_restantes < a.dias_restantes) ? -1 : 1; })
        .slice(0, 8);

      tb.innerHTML = filas.length ? filas.map(function (f) {
        return '<tr class="clickable">' +
          '<td><strong>' + f.proveedor_nombre + '</strong></td>' +
          '<td class="muted" data-label="Comprobante">' + comprobante(f) + '</td>' +
          '<td data-label="Vence">' + Shell.fecha(f.fecha_vencimiento) + '</td>' +
          '<td class="num" data-label="Monto">' + Shell.money(f.saldo_pendiente) + '</td>' +
          '<td data-label="Estado">' + estadoPill(f.estado_alerta) + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="5">' + Shell.vacio(
        'Nada que requiera atención esta semana',
        'No hay facturas de compra vencidas ni por vencer en los próximos 7 días.'
      ) + '</td></tr>';

      Shell.badge('alertas', (r.vencidas || []).length);
    } catch (e) {
      Shell.error(e, 'No se pudieron cargar las facturas pendientes');
      tb.innerHTML = '<tr><td colspan="5">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
    }
  }

  async function cargarCheques() {
    const tb = document.getElementById('tbCheques');
    try {
      const r = await apiFetch('/api/pagos-proveedores/cheques/alertas?dias=7');
      tb.innerHTML = r.cheques && r.cheques.length ? r.cheques.map(function (c) {
        return '<tr>' +
          '<td><strong>' + c.proveedor_nombre + '</strong></td>' +
          '<td data-label="Cheque">' + (c.cheque_numero || '—') + '</td>' +
          '<td data-label="Banco">' + (c.cheque_banco || '—') + '</td>' +
          '<td data-label="Se debita">' + Shell.fecha(c.cheque_fecha_cobro) + '</td>' +
          '<td class="num" data-label="Monto">' + Shell.money(c.monto) + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="5">' + Shell.vacio(
        'No hay cheques por debitarse',
        'Los próximos 7 días están libres de compromisos de caja en valores.'
      ) + '</td></tr>';
    } catch (e) {
      Shell.error(e, 'No se pudieron cargar los cheques por debitarse');
      tb.innerHTML = '<tr><td colspan="5">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('fechaHoy').textContent =
      new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' — al día de hoy';

    cargarKpis();
    cargarAtencion();
    cargarCheques();

    setInterval(function () {
      cargarKpis();
      cargarAtencion();
      cargarCheques();
    }, 5 * 60 * 1000);
  });
})();

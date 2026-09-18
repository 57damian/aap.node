/* =====================================================================
 * ayuda.js — GLOSARIO CONTEXTUAL
 * ---------------------------------------------------------------------
 * Un solo diccionario con los términos del negocio que no se entienden
 * solos. En el HTML se marca así:
 *
 *   <th>En gestión <button class="ayuda" data-ayuda="en_gestion">?</button></th>
 *
 * y Ayuda.init() se encarga del resto (hover, foco, teclado, cerrar).
 * Para agregar un término: una entrada acá. No escribir textos de ayuda
 * sueltos en las páginas — si está en dos lugares, se desincroniza.
 *
 * Cada entrada: { t: título, d: qué es, n: cuándo importa (opcional) }
 * ===================================================================== */

(function (global) {
  'use strict';

  var GLOSARIO = {
    /* ---------- Cobros a clientes ---------- */
    saldo: {
      t: 'Saldo',
      d: 'Lo que el cliente todavía debe: total de la factura, menos las notas de crédito, menos los cobros que ya se acreditaron.',
      n: 'El saldo nunca se guarda en la base: se calcula cada vez que se consulta, así no puede quedar desactualizado.'
    },
    en_gestion: {
      t: 'En gestión de cobro',
      d: 'Plata que el cliente ya entregó pero que todavía no se hizo efectiva: cheques en cartera o depositados que aún no se acreditaron.',
      n: 'No baja la deuda. Está separado justamente para que una factura con un cheque en camino no parezca deuda olvidada.'
    },
    a_favor: {
      t: 'Saldo a favor',
      d: 'Plata cobrada al cliente que todavía no se imputó a ninguna factura. Son los cobros a cuenta o anticipos.',
      n: 'No se descuenta de la deuda hasta que se imputa a una factura concreta.'
    },
    imputar: {
      t: 'Imputar',
      d: 'Decir a qué factura se aplica un cobro. Un cobro puede repartirse entre varias facturas, y una factura puede recibir varios cobros.',
      n: 'La imputación se hace desde una forma de pago concreta (el cheque tal, la transferencia tal), no desde el cobro entero. Por eso si un cheque rebota, la deuda de esa factura vuelve sola.'
    },
    a_cuenta: {
      t: 'Cobro a cuenta',
      d: 'Un cobro que se registró sin decir a qué factura corresponde. Queda como saldo a favor del cliente hasta que se impute.'
    },
    en_cartera: {
      t: 'En cartera',
      d: 'El cheque está en nuestro poder, todavía no se depositó ni se endosó.',
      n: 'Es el único estado desde el que un cheque se puede endosar a un proveedor.'
    },
    acreditado: {
      t: 'Acreditado',
      d: 'El cheque se cobró y la plata ya está en la cuenta. Recién en este momento la factura del cliente queda cancelada.'
    },
    rechazado: {
      t: 'Rechazado',
      d: 'El cheque rebotó. Sus imputaciones dejan de contar automáticamente y la deuda de esas facturas vuelve a quedar abierta.',
      n: 'No hay que revertir nada a mano.'
    },
    endosar: {
      t: 'Endosar',
      d: 'Entregarle a un proveedor un cheque que nos dio un cliente, en vez de pagarle con plata nuestra.',
      n: 'El cheque endosado sigue el destino del original: si al cliente se lo rechazan, la deuda con el proveedor vuelve automáticamente.'
    },
    retencion: {
      t: 'Retención',
      d: 'Impuesto que el cliente retiene al pagarnos (IIBB, Ganancias, IVA, SUSS) y deposita al fisco en nuestro nombre.',
      n: 'Cuenta como cobrado: cancela deuda igual que el efectivo.'
    },
    recibo: {
      t: 'Recibo',
      d: 'El comprobante que se le entrega al cliente por uno o varios cobros. Sale de un talonario numerado.',
      n: 'Un cobro con recibo emitido no se puede anular: primero hay que anular el recibo.'
    },

    /* ---------- Pagos a proveedores ---------- */
    en_valores: {
      t: 'En valores',
      d: 'De lo que figura como pagado, la parte que todavía no salió de la cuenta: cheques propios o endosados entregados pero no debitados.',
      n: 'La factura del proveedor ya figura cancelada (se la pagamos al entregarle el cheque), pero es un compromiso de caja que falta afrontar.'
    },
    entregado: {
      t: 'Entregado',
      d: 'El cheque ya está en manos del proveedor, pero todavía no se debitó de nuestra cuenta.',
      n: 'Para la cuenta del proveedor la factura ya está saldada; para la caja, todavía no.'
    },
    debitado: {
      t: 'Debitado',
      d: 'El cheque salió efectivamente de la cuenta bancaria. No cambia la deuda (ya estaba cancelada): saca el monto del compromiso de caja pendiente.'
    },
    exceso_pagado: {
      t: 'Exceso pagado',
      d: 'Plata imputada de más sobre facturas que ya estaban canceladas. Aparece cuando una factura queda con saldo negativo.'
    },
    dias_credito: {
      t: 'Días de crédito',
      d: 'Plazo acordado con el proveedor para pagar. Se usa para calcular el vencimiento de cada factura de compra: fecha de emisión + estos días.',
      n: 'Si está en 0, toda factura vence el mismo día que se emite y aparece vencida enseguida. Cargalo en la ficha del proveedor.'
    },

    /* ---------- Común a los dos lados ---------- */
    cuenta_corriente: {
      t: 'Cuenta corriente',
      d: 'El detalle movimiento por movimiento, con saldo acumulado: qué se facturó, qué se cobró o pagó, y cómo quedó el saldo después de cada uno.',
      n: 'El panel de deuda muestra solo los saldos positivos; la cuenta corriente muestra todos los movimientos. Por eso pueden no dar igual si hay algo pagado de más.'
    },
    vencido: {
      t: 'Vencido',
      d: 'Saldo de facturas cuya fecha de vencimiento ya pasó.',
      n: 'El vencimiento sale de los días de crédito acordados, no de la fecha de la factura.'
    },
    nota_credito: {
      t: 'Nota de crédito',
      d: 'Comprobante que anula total o parcialmente una factura ya emitida. Descuenta del saldo del cliente sin necesidad de un cobro.'
    },

    /* ---------- Stock y precios ---------- */
    stock_bajo: {
      t: 'Stock bajo',
      d: 'El material tiene existencia, pero igual o por debajo del mínimo configurado para ese material.'
    },
    variacion_precio: {
      t: 'Variación de precio',
      d: 'Cuánto cambió el precio de este material respecto de la última compra al MISMO proveedor.',
      n: 'Se calcula en dólares, no en pesos, para que una devaluación no se lea como un aumento del material.'
    },
    dolar_banco: {
      t: 'Dólar Banco Nación',
      d: 'Cotización que el sistema usa para convertir los precios en USD a pesos al registrar una entrega.',
      n: 'Al cargar una factura de compra se puede informar la cotización de ese día sin pisar este valor.'
    },
    precio_referencia: {
      t: 'Precio de referencia',
      d: 'Lo último que se pagó por este material, sin importar a qué proveedor. Sirve para valorizar el stock de un vistazo.'
    }
  };

  var pop = null;

  function cerrar() { if (pop) { pop.remove(); pop = null; } }

  function abrir(btn) {
    cerrar();
    var e = GLOSARIO[btn.dataset.ayuda];
    if (!e) return;

    pop = document.createElement('div');
    pop.className = 'ayuda-pop';
    pop.setAttribute('role', 'tooltip');
    pop.innerHTML = '<b>' + e.t + '</b>' + e.d + (e.n ? '<em>' + e.n + '</em>' : '');
    document.body.appendChild(pop);

    var r = btn.getBoundingClientRect();
    var p = pop.getBoundingClientRect();
    var left = Math.min(Math.max(8, r.left + r.width / 2 - p.width / 2), innerWidth - p.width - 8);
    var top = r.bottom + 8;
    if (top + p.height > innerHeight - 8) top = Math.max(8, r.top - p.height - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  global.Ayuda = {
    GLOSARIO: GLOSARIO,

    init: function () {
      if (this._listo) return;
      this._listo = true;

      // Delegado: funciona también con contenido que se dibuja después.
      document.addEventListener('mouseover', function (e) {
        var b = e.target.closest && e.target.closest('.ayuda');
        if (b) abrir(b);
      });
      document.addEventListener('mouseout', function (e) {
        var b = e.target.closest && e.target.closest('.ayuda');
        if (b) cerrar();
      });
      document.addEventListener('focusin', function (e) {
        var b = e.target.closest && e.target.closest('.ayuda');
        if (b) abrir(b);
      });
      document.addEventListener('focusout', cerrar);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
      addEventListener('scroll', cerrar, true);

      // Accesibilidad: cada (?) necesita tipo y etiqueta.
      document.querySelectorAll('.ayuda').forEach(function (b) {
        if (!b.getAttribute('type')) b.setAttribute('type', 'button');
        var e = GLOSARIO[b.dataset.ayuda];
        if (e) b.setAttribute('aria-label', 'Qué significa ' + e.t);
        if (!b.textContent.trim()) b.textContent = '?';
      });
    },

    /** Genera el (?) desde JS, para tablas que se dibujan con innerHTML. */
    icono: function (clave) {
      var e = GLOSARIO[clave];
      if (!e) return '';
      return '<button type="button" class="ayuda" data-ayuda="' + clave +
             '" aria-label="Qué significa ' + e.t + '">?</button>';
    }
  };
})(window);

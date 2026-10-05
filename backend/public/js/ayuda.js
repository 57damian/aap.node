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
    por_cobrar: {
      t: 'Por cobrar',
      d: 'Lo que los clientes todavía nos deben: facturas emitidas, menos notas de crédito, menos cobros que ya se acreditaron.',
      n: 'Los cheques en cartera todavía no se descuentan: figuran aparte como "en gestión".'
    },
    por_pagar: {
      t: 'Por pagar',
      d: 'Lo que les debemos a los proveedores: facturas de compra, menos lo que ya se pagó.',
      n: 'Un cheque entregado ya cuenta como pagado aunque todavía no se haya debitado de la cuenta.'
    },
    saldo: {
      t: 'Saldo',
      d: 'Lo que el cliente todavía debe: total de la factura, menos las notas de crédito, menos los cobros que ya se acreditaron.',
      n: 'Se calcula en el momento con los cobros acreditados, así que siempre está al día.'
    },
    en_gestion: {
      t: 'En gestión de cobro',
      d: 'Plata que el cliente ya entregó pero que todavía no se hizo efectiva: cheques en cartera o depositados que aún no se acreditaron.',
      n: 'No baja el saldo. Está separado justamente para que una factura con un cheque en camino no parezca un saldo olvidado.'
    },
    a_favor: {
      t: 'Saldo a favor',
      d: 'Plata cobrada al cliente que todavía no se imputó a ninguna factura. Son los cobros a cuenta o anticipos.',
      n: 'No se descuenta del saldo hasta que se imputa a una factura concreta.'
    },
    imputar: {
      t: 'Imputar',
      d: 'Asignar un cobro a una o más facturas para descontarlas de lo que el cliente debe. Un cobro puede repartirse entre varias facturas, y una factura puede recibir varios cobros.',
      n: 'Cada forma de pago (el cheque tal, la transferencia tal) se imputa por separado: si un cheque rebota, el saldo de esa factura vuelve solo.'
    },
    a_cuenta: {
      t: 'A favor del cliente',
      d: 'Un cobro que se registró sin asignarlo a ninguna factura. Queda como saldo a favor del cliente hasta que se impute.'
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
      d: 'El cheque rebotó. Sus imputaciones dejan de contar automáticamente y el saldo de esas facturas vuelve a quedar abierto.',
      n: 'No hay que revertir nada a mano.'
    },
    endosar: {
      t: 'Endosar',
      d: 'Entregarle a un proveedor un cheque que nos dio un cliente, en vez de pagarle con plata nuestra.',
      n: 'El cheque endosado sigue el destino del original: si al cliente se lo rechazan, el saldo con el proveedor vuelve automáticamente.'
    },
    retencion: {
      t: 'Retención',
      d: 'Impuesto que el cliente retiene al pagarnos (IIBB, Ganancias, IVA, SUSS) y deposita al fisco en nuestro nombre.',
      n: 'Cuenta como cobrado: cancela saldo igual que el efectivo.'
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
      d: 'El cheque salió efectivamente de la cuenta bancaria. No cambia el saldo (ya estaba cancelado): saca el importe del compromiso de caja pendiente.'
    },
    exceso_pagado: {
      t: 'Exceso pagado',
      d: 'Plata imputada de más sobre facturas que ya estaban canceladas. Aparece cuando una factura queda con saldo negativo.'
    },
    dias_credito: {
      t: 'Días de crédito',
      d: 'Plazo acordado con el proveedor para pagar. Se usa para calcular el vencimiento de cada factura de compra: fecha de emisión + estos días.',
      n: 'Si está en 0, toda factura vence el mismo día que se emite y aparece vencida enseguida. Se carga en la ficha del proveedor.'
    },

    /* ---------- Común a los dos lados ---------- */
    cuenta_corriente: {
      t: 'Cuenta corriente',
      d: 'El detalle movimiento por movimiento, con saldo acumulado: qué se facturó, qué se cobró o pagó, y cómo quedó el saldo después de cada uno.',
      n: 'El panel de cuentas por cobrar y por pagar muestra solo los saldos positivos; la cuenta corriente muestra todos los movimientos. Por eso pueden no dar igual si hay algo pagado de más.'
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
      d: 'La materia prima tiene existencia, pero igual o por debajo del mínimo configurado.'
    },
    variacion_precio: {
      t: 'Variación de precio',
      d: 'Cuánto cambió el precio de esta materia prima respecto de la última compra al MISMO proveedor.',
      n: 'Se calcula en dólares, no en pesos, para que una devaluación no se lea como un aumento de la materia prima.'
    },
    dolar_banco: {
      t: 'Dólar Banco Nación',
      d: 'Cotización que el sistema usa para convertir los precios en USD a pesos al registrar una entrega y al facturar.',
      n: 'Al cargar una factura de compra se puede informar la cotización de ese día sin pisar este valor.'
    },
    precio_referencia: {
      t: 'Precio de referencia',
      d: 'Lo último que se pagó por esta materia prima, sin importar a qué proveedor. Sirve para valorizar el stock de un vistazo.'
    },

    /* ---------- Calculadora de transformadores ---------- */
    calc_vin: {
      t: 'Tensión de entrada',
      d: 'Tensión de la red a la que se conecta el primario.',
      n: 'Cómo se mide: con tester en alterna sobre el enchufe. En Argentina, 220 V.'
    },
    calc_familia: {
      t: 'Familia de carretel',
      d: 'Serie de núcleo EI a la que pertenece el carretel (EI 25, EI 37, EI 62…). Todos los de una familia comparten la chapa.',
      n: 'Se lee en la descripción del carretel o en el catálogo. Sin BA_ref cargado, el flujo se estima y la confianza es baja.'
    },
    calc_pines: {
      t: 'Pines',
      d: 'Filtra los carreteles con o sin pines (patitas) para soldar a plaqueta.',
      n: 'Se ve a simple vista en el carretel.'
    },
    calc_sep: {
      t: 'Separador',
      d: 'Carretel de 2 cámaras: una pared divide el bobinado en dos zonas. Sirve para aislar primario de secundario.',
      n: 'Se ve a simple vista. Las medidas de cada cámara salen del catálogo (Y1 e Y2).'
    },
    calc_carretel: {
      t: 'Carretel',
      d: 'El soporte del bobinado. Define N, A, I, la cantidad de cámaras y la profundidad donde cabe el cobre.',
      n: 'El código está en el catálogo (ej. 004080). Si "a revisar", mirá el aviso: hay una medida dudosa.'
    },
    calc_modo: {
      t: 'Condición de la tensión de salida',
      d: 'En vacío: la tensión pedida es la que mide el secundario sin carga. Con carga: es la que debe quedar con la corriente indicada, y la calculadora suma espiras para compensar la caída.',
      n: 'Cómo se mide: con tester en el secundario, sin carga (vacío) o con la carga conectada.'
    },
    calc_salida_v: {
      t: 'V de la salida',
      d: 'Tensión de cada sección del secundario.',
      n: 'Con toma central (14+14) se carga 14, no 28.'
    },
    calc_salida_i: {
      t: 'I de la salida',
      d: 'Corriente que debe entregar cada sección. Define el grosor del alambre.',
      n: 'Cómo se mide: tester en serie (amperímetro) con la carga, o se calcula como potencia / tensión.'
    },
    calc_secciones: {
      t: 'Secciones',
      d: '1 = bobinado simple. 2 = con toma central: dos secciones iguales, con V e I dados por sección.',
      n: 'Se ve al contar los cables del secundario: 3 salidas = 2 secciones.'
    },
    calc_alambre: {
      t: 'Alambre',
      d: 'Automático elige el más fino del stock que cumple la densidad de corriente máxima. También se puede forzar uno.',
      n: 'El diámetro real se mide con micrómetro en el alambre del taller y se carga en "Alambres del taller".'
    },
    calc_hebras: {
      t: 'Hebras',
      d: 'Cantidad de alambres en paralelo (bifilar = 2). Reparte la corriente y baja la resistencia.',
      n: 'Se cuenta al desarmar el bobinado. Automático prueba 1, 2 y 3.'
    },
    calc_pared_medida: {
      t: 'Pared del carretel',
      d: 'Espesor de la pared del tubo y de la brida que resta espacio al cobre. Estimado: 0,6 mm.',
      n: 'Cómo se mide: calibre o micrómetro sobre la pared del carretel.'
    },
    calc_prof_util_medida: {
      t: 'Profundidad útil medida',
      d: 'Altura real disponible para el bobinado, desde el tubo hasta el borde de la chapa. Reemplaza a la máxima estimada.',
      n: 'Cómo se mide: calibre desde la superficie del tubo hasta el borde de la ventana de la chapa ya montada.'
    },
    calc_codigo: {
      t: 'Código de carretel',
      d: 'Carretel del trafo que querés analizar. Completa N, A, I y las cámaras desde la tabla.',
      n: 'Está en el catálogo. Sin código, cargá N, A e I a mano.'
    },
    calc_nai: {
      t: 'N, A e I del núcleo',
      d: 'N = ancho del tubo (pierna central). A = pila: alto del paquete de chapas. I = largo bobinable.',
      n: 'Cómo se miden (mm, con calibre): N y A en el tubo del carretel por dentro; I es el largo del tubo entre las bridas.'
    },
    calc_vp: {
      t: 'Vp',
      d: 'Tensión a la que trabaja el primario.',
      n: 'Con tester en alterna sobre la entrada, o la que dice la placa.'
    },
    calc_vs: {
      t: 'Vs',
      d: 'Tensión del secundario, por sección.',
      n: 'Con tester en alterna sobre el secundario, con el primario conectado a Vp.'
    },
    calc_is_ps: {
      t: 'Is o Ps',
      d: 'Corriente (A) o potencia (VA) que entrega el secundario. Con ella se calculan alambres y ventana; sin ella solo se obtienen espiras y flujo.',
      n: 'Is: amperímetro en serie con la carga. Ps = Vs × Is.'
    },
    calc_cond: {
      t: 'Vs en vacío o con carga',
      d: 'Si se midió con carga, Vs queda por debajo de la de vacío por la caída en el cobre. La calculadora lo corrige para no subestimar las espiras por volt.',
      n: 'Anotá en qué condición medís: sin nada conectado es vacío.'
    },
    calc_np: {
      t: 'Np medido',
      d: 'Vueltas reales del primario. Con este dato las espiras por volt salen de una medición y la confianza pasa a alta.',
      n: 'Cómo se mide: contando al desarmar, o con un contador de espiras. Alternativa: una vuelta de prueba y relación de tensiones.'
    },
    calc_ns: {
      t: 'Ns medido',
      d: 'Vueltas reales del secundario (por sección). Da las espiras por volt como Ns / Vs.',
      n: 'Cómo se mide: contando al desarmar. Vale solo si Vs está medida en vacío (o indicá que fue con carga).'
    },
    calc_dp: {
      t: 'Ø medido',
      d: 'Diámetro del alambre. Se acopla al calibre más cercano del catálogo. Desnudo = solo el cobre; con esmalte = cobre más barniz.',
      n: 'Cómo se mide: micrómetro sobre un tramo sin esmalte raspado (desnudo) o tal cual (con esmalte).'
    },
    calc_rp_rs: {
      t: 'Rp / Rs',
      d: 'Resistencia en continua del bobinado. Se compara con la calculada para detectar vueltas o calibres mal estimados.',
      n: 'Cómo se mide: óhmetro en los extremos del bobinado, trafo frío (~20 °C) y sin nada conectado.'
    },
    calc_alias: {
      t: 'Alias',
      d: 'Cómo le dice el taller al alambre (ej. "0.08").',
      n: 'Es solo un nombre para reconocerlo.'
    },
    calc_alambre_cat: {
      t: 'Alambre (catálogo)',
      d: 'Calibre del catálogo São Marco al que corresponde. De acá salen el diámetro del cobre y los ohm por metro.',
      n: 'Elegí el AWG o diámetro más cercano al que medís con micrómetro.'
    },
    calc_grado: {
      t: 'Grado',
      d: 'Espesor del esmalte. G1 = fino, G2 = grueso (más diámetro exterior).',
      n: 'Viene indicado en el carrete del proveedor. CORALSOLDA HA es G1.'
    },
    calc_d_medido: {
      t: 'Diámetro medido',
      d: 'Diámetro exterior real, con esmalte. Si lo cargás, reemplaza al del catálogo en el cálculo de capas.',
      n: 'Cómo se mide: micrómetro sobre el alambre tal cual, sin raspar el esmalte.'
    },
    calc_p_f: {
      t: 'Frecuencia',
      d: 'Frecuencia de la red. Entra en la fórmula de espiras por volt.',
      n: 'En Argentina, 50 Hz.'
    },
    calc_p_B_taller: {
      t: 'Inducción de taller',
      d: 'Densidad de flujo supuesta cuando la familia no tiene un trafo real de referencia. Los trafos del taller trabajan a 1,50–1,66 T.',
      n: 'Cómo se obtiene: B = flujo / sección del núcleo, de un trafo real armado y probado.'
    },
    calc_p_k_flujo: {
      t: 'k_flujo',
      d: 'Multiplicador del flujo respecto del trafo de referencia. 1 = igual; menos de 1 = más espiras y menos calentamiento.',
      n: 'Con 0,93 se reproduce el trafo de 380 V del taller.'
    },
    calc_p_J_prim_max: {
      t: 'J máx. primario',
      d: 'Densidad de corriente máxima en el cobre del primario. Define el alambre más fino permitido.',
      n: 'Se calibra con la temperatura de trafos reales: 2,5–3 A/mm² es lo habitual.'
    },
    calc_p_J_sec_max: {
      t: 'J máx. secundario',
      d: 'Densidad de corriente máxima en el cobre del secundario.',
      n: 'Igual que el primario; el secundario suele trabajar más holgado.'
    },
    calc_p_eta: {
      t: 'Rendimiento',
      d: 'Cociente entre potencia de salida y de entrada. Sirve para estimar la corriente del primario.',
      n: 'Cómo se mide: potencia de salida / potencia de entrada con carga nominal. 0,80 es típico en trafos chicos.'
    },
    calc_p_margen_brida: {
      t: 'Margen de brida',
      d: 'Espacio sin bobinar a cada lado de la cámara, contra la brida.',
      n: 'Cómo se mide: calibre entre la brida y la primera espira. Unos 0,4 mm.'
    },
    calc_p_factor_capa: {
      t: 'Factor de capa',
      d: 'Aumento de altura por el desorden entre capas (las espiras no apilan perfectas).',
      n: 'Se calibra comparando la altura calculada con la real de trafos armados. 1,05 = 5 %.'
    },
    calc_p_papel_cada: {
      t: 'Papel cada',
      d: 'Cada cuántas capas de alambre se pone una vuelta de papel aislante.',
      n: 'Es la costumbre del bobinado del taller.'
    },
    calc_p_papel_mm: {
      t: 'Espesor del papel',
      d: 'Grosor del papel aislante entre capas.',
      n: 'Cómo se mide: micrómetro sobre el papel.'
    },
    calc_p_aislacion_entre: {
      t: 'Aislación entre bobinados',
      d: 'Espesor del aislante entre primario y secundario cuando comparten cámara.',
      n: 'Cómo se mide: calibre sobre la cinta o el papel usado.'
    },
    calc_p_cierre: {
      t: 'Cierre',
      d: 'Altura de la vuelta final de cinta que cierra el bobinado.',
      n: 'Cómo se mide: calibre sobre la cinta.'
    },
    calc_p_pared: {
      t: 'Pared por defecto',
      d: 'Espesor de pared que se usa en los carreteles que no tienen una medida propia.',
      n: 'Cómo se mide: calibre en la pared del carretel. Se puede cargar uno por carretel.'
    },
    calc_p_T_cobre: {
      t: 'T cobre',
      d: 'Temperatura a la que se calculan las resistencias. En diseño, 60 °C (cobre caliente).',
      n: 'Cómo se mide: termómetro o variación de resistencia en funcionamiento.'
    },
    calc_p_alfa_cu: {
      t: 'α del cobre',
      d: 'Cuánto sube la resistencia del cobre por cada grado de temperatura.',
      n: 'Constante física: 0,00393 por °C.'
    },
    calc_ba_ref: {
      t: 'BA_ref',
      d: 'Flujo de referencia de la familia: inducción × sección del núcleo. Da las espiras por volt: 1e4 / (4,44 · f · BA_ref).',
      n: 'Cómo se obtiene: de un trafo real: BA = V · 1e4 / (4,44 · f · Np), con Np contado.'
    },
    calc_a_ref: {
      t: 'A_ref',
      d: 'Pila (cota A) del trafo con el que se calibró BA_ref. Otro carretel de la familia escala el flujo con A / A_ref.',
      n: 'Es la cota A del carretel del trafo de referencia.'
    },
    calc_pierna: {
      t: 'Pierna',
      d: 'Ancho de la pierna central de la chapa. Con él se calcula B real y la profundidad útil.',
      n: 'Cómo se mide: calibre sobre la pierna central de una chapa suelta.'
    },
    calc_ventana_ancho: {
      t: 'Ancho de ventana',
      d: 'Ancho del hueco de la chapa por donde pasa el bobinado. Con la pierna da la profundidad útil.',
      n: 'Cómo se mide: calibre en la ventana de una chapa suelta (o del catálogo de la chapa).'
    },
    calc_ventana_alto: {
      t: 'Alto de ventana',
      d: 'Alto del hueco de la chapa.',
      n: 'Cómo se mide: calibre en la ventana de una chapa suelta.'
    },
    calc_apilado: {
      t: 'Apilado',
      d: 'Fracción de la pila que es hierro (el resto es aire y barniz entre chapas). Típico 0,92.',
      n: 'Se calibra comparando la sección medida con la geométrica.'
    },
    calc_J: {
      t: 'J (A/mm²)',
      d: 'Densidad de corriente: amperes por mm² de cobre. Más alta calienta más.',
      n: 'Cálculo: corriente / (área del cobre × hebras). Pasar del máximo marca ⚠.'
    },
    calc_v_carga: {
      t: 'V con carga',
      d: 'Tensión que queda a la corriente indicada: la de vacío menos la caída en las resistencias del cobre.',
      n: 'Cómo se mide: tester en el secundario con la carga conectada.'
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

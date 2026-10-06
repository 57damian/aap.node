/* =====================================================================
 * shell.js — NAVEGACIÓN ÚNICA DE LA APP
 * ---------------------------------------------------------------------
 * Antes cada pantalla tenía su propia botonera copiada a mano: había 5
 * menús distintos, con nombres distintos ("Produccion" vs "Producción")
 * y con links a pantallas que no existen. Ahora el menú se genera de
 * NAV, que es la única fuente de verdad. Agregar una pantalla = agregar
 * una línea acá, y aparece en las 16 páginas.
 *
 * Uso en cada página:
 *   <link rel="stylesheet" href="css/styles.css">
 *   <link rel="stylesheet" href="css/app.css">
 *   <script src="js/shell.js"></script>
 *   ...
 *   <script>Shell.montar({ titulo: 'Cobros', sub: 'Cuentas por cobrar' });</script>
 *
 * Shell.montar() arma <div class="app"> con sidebar + topbar y mete
 * adentro lo que la página ya tenía en <main data-content>.
 * ===================================================================== */

(function (global) {
  'use strict';

  /* --- Íconos: SVG inline. No se usa Font Awesome por CDN porque la CSP
     del server no lo permite y porque 13 pantallas lo usaban sin cargarlo
     (por eso se veían cuadraditos vacíos). --- */
  var ICON = {
    panel:    'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    clientes: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    oc:       'M9 11H3v10h6zM21 3h-6v18h6zM15 7H9v14h6z',
    pedido:   'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 3a2 2 0 0 0 0 4h6a2 2 0 0 0 0-4M9 12h6M9 16h6',
    ventas:   'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 18.5a2.5 2.5 0 1 0 0 1M18.5 18.5a2.5 2.5 0 1 0 0 1',
    cobros:   'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    prov:     'M20 7h-9M14 17H5M17 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M7 13a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    factura:  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
    pagos:    'M22 4H2v16h20zM2 10h20',
    ficha:    'M9 2h6v4H9zM4 6h16v16H4zM8 12h8M8 16h5',
    prod:     'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    stock:    'M21 16V8l-9-5-9 5v8l9 5zM3.3 7 12 12l8.7-5M12 22V12',
    precios:  'M20.6 13.4 12 22l-9-9V3h10zM7 7h.01',
    usuarios: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 11h-6',
    correcciones: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    alerta:   'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17h.01',
    salir:    'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    buscar:   'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
    menu:     'M3 12h18M3 6h18M3 18h18',
    panelIzq: 'M3 3h18v18H3zM9 3v18',
    ojo:      'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    ojoOff:   'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22',
    vacio:    'M22 12h-6l-2 3h-4l-2-3H2M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z'
  };

  function svg(nombre, cls) {
    var d = ICON[nombre] || ICON.panel;
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  /* --- ÚNICA FUENTE DE VERDAD DEL MENÚ ---
     `roles`: quién lo ve. `alias`: palabras extra para el buscador Ctrl+K.

     Dos roles (17/09/2026): 'admin' ve todo; 'operario' solo carga producción
     y consulta cantidades de stock. Esto es lo que se DIBUJA: quien manda es
     el backend, que le responde 403 al operario en todo lo demás. */
  var NAV = [
    { grupo: 'Panel', items: [
      { id: 'dashboard', txt: 'Dashboard', url: 'dashboard.html', icon: 'panel', roles: ['admin'], alias: 'inicio home tablero' }
    ]},
    { grupo: 'Comercial', items: [
      { id: 'clientes', txt: 'Clientes',           url: 'clientes.html', icon: 'clientes', roles: ['admin'] },
      { id: 'oc',       txt: 'Órdenes de compra',  url: 'oc.html',       icon: 'oc',       roles: ['admin'], alias: 'oc pedidos' },
      { id: 'ventas',   txt: 'Remitos y facturación', url: 'ventas.html',   icon: 'ventas',   roles: ['admin'], alias: 'ventas remito entrega facturar' },
      { id: 'cobros',   txt: 'Cobros',             url: 'cobros.html',   icon: 'cobros',   roles: ['admin'], alias: 'deuda por cobrar clientes cheques recibos quien me debe' },
      { id: 'correcciones', txt: 'Anulaciones',    url: 'correcciones.html', icon: 'correcciones', roles: ['admin'], alias: 'correcciones anular factura remito orden error borrar corregir auditoria' }
    ]},
    { grupo: 'Compras', items: [
      { id: 'proveedores', txt: 'Proveedores',        url: 'proveedores.html',        icon: 'prov',    roles: ['admin'] },
      { id: 'pedidosprov', txt: 'Pedidos a proveedores', url: 'pedidos-proveedor.html', icon: 'pedido', roles: ['admin'], alias: 'pedir materia prima pdf orden de compra remito proveedor' },
      { id: 'fc',          txt: 'Facturas de compra', url: 'facturas-compra.html',    icon: 'factura', roles: ['admin'], alias: 'compras remitos proveedor cargar nueva' },
      { id: 'fc-lista',    txt: 'Facturas cargadas',  url: 'facturas-lista-simple.html', icon: 'factura', roles: ['admin'], alias: 'ver listado facturas de compra detalle historial' },
      { id: 'pagosprov',   txt: 'Pagos a proveedores',url: 'pagos-proveedores.html',  icon: 'pagos',   roles: ['admin'], alias: 'deuda pagar cheques endoso a quien le debo' },
      { id: 'alertas',     txt: 'Alertas de pago',    url: 'alertas-pagos.html',      icon: 'alerta',  roles: ['admin'], alias: 'vencimientos vencidas' }
    ]},
    { grupo: 'Producción', items: [
      { id: 'ficha',   txt: 'Fichas técnicas', url: 'ficha.html',      icon: 'ficha', roles: ['admin'], alias: 'modelos transformador' },
      { id: 'prod',    txt: 'Producción',      url: 'produccion.html', icon: 'prod',  roles: ['admin','operario'] },
      { id: 'stock',   txt: 'Stock',           url: 'stock.html',      icon: 'stock', roles: ['admin'], alias: 'materias primas materiales' },
      { id: 'calctrafo', txt: 'Calculadora de trafos', url: 'calculadora-trafo.html', icon: 'ficha', roles: ['admin'], alias: 'calcular espiras alambre carretel bobinado' }
    ]},
    { grupo: 'Configuración', items: [
      { id: 'precios',  txt: 'Precios y dólar', url: 'precios.html',  icon: 'precios',  roles: ['admin'], alias: 'cotizacion tipo de cambio aumento' },
      { id: 'usuarios', txt: 'Usuarios',        url: 'usuarios.html', icon: 'usuarios', roles: ['admin'] }
    ]}
  ];

  function usuarioActual() {
    try { return JSON.parse(localStorage.getItem('usuario') || '{}'); } catch (e) { return {}; }
  }
  function puedeVer(item, rol) { return !item.roles || item.roles.indexOf(rol) !== -1; }

  /* --- Montos ocultos (27/09/2026) ---
     Como el "ojo" de las apps de banco: la plata se muestra como "$ •••••"
     hasta que se toca el ojo de la barra superior. Es para que no se vea por
     descuido (el celular abierto en el taller, mostrarle algo a un
     empleado), NO es seguridad: el servidor manda los datos igual.

     Cambio 28/09/2026: antes se volvía a ocultar sola (a los 10 minutos o
     tras 30 s en segundo plano) recargando la página, y eso borraba lo que
     se estuviera cargando en un formulario; además cada toque del ojo
     recargaba todo (lento). Ahora:
       - arranca oculto en cada inicio de sesión (login.html borra la marca);
       - si el usuario lo pone visible, queda así hasta que lo cambie a mano o
         vuelva a iniciar sesión;
       - mostrar/ocultar es instantáneo, sin recargar: los formateadores
         devuelven siempre el valor real y lo registran (registrarMonto);
         mientras está oculto, un MutationObserver reemplaza en pantalla cada
         monto registrado por la máscara y guarda el texto original para
         poder devolverlo al mostrar. El observer corre antes de pintar, así
         que el monto real no llega a verse. */
  var CLAVE_VISIBLES = 'montosVisibles';
  var MASCARA = '$ •••••';

  function privado() {
    try { return localStorage.getItem(CLAVE_VISIBLES) !== '1'; } catch (e) { return true; }
  }

  // Textos de montos que produjeron los formateadores en esta página, con la
  // máscara que va en su lugar (texto → máscara).
  var montosConocidos = {};
  var patronMontos = null;
  function registrarMonto(texto, mascara) {
    texto = String(texto);
    if (texto && !montosConocidos.hasOwnProperty(texto)) {
      montosConocidos[texto] = mascara || MASCARA;
      patronMontos = null;
    }
    return texto;
  }
  function patron() {
    if (!patronMontos) {
      var lista = Object.keys(montosConocidos)
        .sort(function (a, b) { return b.length - a.length; })
        .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
      patronMontos = lista.length ? new RegExp(lista.join('|'), 'g') : null;
    }
    return patronMontos;
  }

  // Nodos de texto enmascarados: [{ nodo, original, enmascarado }].
  var enmascarados = [];
  var NO_TOCAR = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };

  function enmascararNodo(nodo) {
    var re = patron();
    if (!re || !nodo.nodeValue || (nodo.parentNode && NO_TOCAR[nodo.parentNode.nodeName])) return;
    var original = nodo.nodeValue;
    re.lastIndex = 0;
    if (!re.test(original)) return;
    re.lastIndex = 0;
    var nuevo = original.replace(re, function (t) { return montosConocidos[t]; });
    nodo.nodeValue = nuevo;
    enmascarados.push({ nodo: nodo, original: original, enmascarado: nuevo });
  }
  function enmascararDentro(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) { enmascararNodo(raiz); return; }
    if (raiz.nodeType !== 1 || NO_TOCAR[raiz.nodeName]) return;
    var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null);
    var n, nodos = [];
    while ((n = w.nextNode())) nodos.push(n);
    nodos.forEach(enmascararNodo);
  }

  var observador = null;
  function activarMascara() {
    enmascararDentro(document.body);
    if (observador || !global.MutationObserver) return;
    observador = new MutationObserver(function (cambios) {
      cambios.forEach(function (c) {
        if (c.type === 'characterData') enmascararNodo(c.target);
        else for (var i = 0; i < c.addedNodes.length; i++) enmascararDentro(c.addedNodes[i]);
      });
    });
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function desactivarMascara() {
    if (observador) { observador.disconnect(); observador = null; }
    enmascarados.forEach(function (e) {
      // Si la pantalla ya cambió ese texto, no se pisa.
      if (e.nodo.isConnected && e.nodo.nodeValue === e.enmascarado) e.nodo.nodeValue = e.original;
    });
    enmascarados = [];
  }

  function pintarBotonOjo() {
    var b = document.querySelector('[data-montos]');
    if (!b) return;
    var oculto = privado();
    var txt = oculto ? 'Mostrar montos' : 'Ocultar montos';
    b.setAttribute('aria-pressed', String(!oculto));
    b.setAttribute('aria-label', txt);
    b.title = txt;
    b.innerHTML = svg(oculto ? 'ojoOff' : 'ojo');
  }

  function cambiarMontos() {
    var mostrar = privado();
    try {
      if (mostrar) localStorage.setItem(CLAVE_VISIBLES, '1');
      else localStorage.removeItem(CLAVE_VISIBLES);
    } catch (e) { return; }
    if (mostrar) desactivarMascara(); else activarMascara();
    pintarBotonOjo();
  }

  function paginaActual() {
    var f = location.pathname.split('/').pop() || 'dashboard.html';
    return f.toLowerCase();
  }

  var Shell = {
    NAV: NAV,
    icon: svg,

    montar: function (opts) {
      opts = opts || {};
      var rol = usuarioActual().rol || '';
      var aqui = paginaActual();

      /* El contenido que la página ya traía */
      var origen = document.querySelector('[data-content]');
      var contenido = origen ? origen.innerHTML : document.body.innerHTML;
      if (!origen) document.body.innerHTML = '';

      var colapsado = localStorage.getItem('sidebarColapsado') === '1';

      var html = '';
      html += '<div class="app' + (colapsado ? ' sidebar-collapsed' : '') + '" id="app">';
      html += '<div class="sidebar-scrim" data-cerrar-nav></div>';

      /* -------- sidebar -------- */
      html += '<nav class="sidebar" aria-label="Menú principal">';
      // El logo lleva a la primera pantalla que ese rol puede ver: para un
      // operario, dashboard.html sería un rebote al login.
      var inicio = 'produccion.html';
      var elegida = usuarioActual().pantalla_inicio;
      if (elegida && /^[a-z_-]+\.html$/.test(elegida)) inicio = elegida;
      else NAV.some(function (g) {
        var primero = g.items.filter(function (i) { return puedeVer(i, rol); })[0];
        if (primero) { inicio = primero.url; return true; }
        return false;
      });
      html += '<a class="sidebar-brand" href="' + inicio + '">' + svg('stock') + '<span>TRANSFORMADORES</span></a>';

      NAV.forEach(function (g) {
        var visibles = g.items.filter(function (i) { return puedeVer(i, rol); });
        if (!visibles.length) return;
        html += '<div class="sidebar-group"><div class="sidebar-group-label">' + g.grupo + '</div>';
        visibles.forEach(function (i) {
          var act = i.url.toLowerCase() === aqui ? ' active' : '';
          html += '<a class="sidebar-link' + act + '" href="' + i.url + '"' +
                  (act ? ' aria-current="page"' : '') + '>' +
                  svg(i.icon) + '<span>' + i.txt + '</span>' +
                  '<span class="sidebar-badge" data-badge="' + i.id + '" hidden></span></a>';
        });
        html += '</div>';
      });

      html += '<div class="sidebar-footer">';
      html += '<a class="sidebar-link" href="#" data-logout>' + svg('salir') + '<span>Salir</span></a>';
      html += '</div></nav>';

      /* -------- main -------- */
      html += '<div class="main">';
      html += '<header class="topbar">';
      html += '<button class="icon-btn nav-toggle" data-abrir-nav aria-label="Abrir menú">' + svg('menu') + '</button>';
      html += '<button class="icon-btn" data-colapsar aria-label="Contraer menú lateral" title="Contraer menú (Ctrl+B)">' + svg('panelIzq') + '</button>';
      html += '<div><div class="topbar-title">' + (opts.titulo || document.title) + '</div>';
      if (opts.sub) html += '<div class="topbar-sub">' + opts.sub + '</div>';
      html += '</div><div class="topbar-spacer"></div>';
      var oculto = privado();
      html += '<button class="icon-btn" data-montos aria-pressed="' + !oculto + '" ' +
              'aria-label="' + (oculto ? 'Mostrar montos' : 'Ocultar montos') + '" ' +
              'title="' + (oculto ? 'Mostrar montos' : 'Ocultar montos') + '">' +
              svg(oculto ? 'ojoOff' : 'ojo') + '</button>';
      html += '<button class="search-trigger" data-cmdk>' + svg('buscar') + '<span>Buscar pantalla…</span><kbd>Ctrl K</kbd></button>';
      html += '</header>';
      html += '<main class="content">' + contenido + '</main>';
      html += '</div></div>';
      html += '<div class="toasts" id="toasts"></div>';

      document.body.innerHTML = html;
      this._conectar();
      if (global.Ayuda) global.Ayuda.init();

      // Si entró con una contraseña temporal, el modal se abre acá mismo, sin
      // esperar a que alguna llamada a la API devuelva PASSWORD_CHANGE_REQUIRED.
      if (usuarioActual().debe_cambiar_password) Shell.pedirCambioPassword();
    },

    _conectar: function () {
      var app = document.getElementById('app');

      document.querySelector('[data-colapsar]').addEventListener('click', function () {
        app.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebarColapsado', app.classList.contains('sidebar-collapsed') ? '1' : '0');
      });
      var abrir = document.querySelector('[data-abrir-nav]');
      if (abrir) abrir.addEventListener('click', function () { app.classList.add('nav-open'); });
      var scrim = document.querySelector('[data-cerrar-nav]');
      if (scrim) scrim.addEventListener('click', function () { app.classList.remove('nav-open'); });

      document.querySelector('[data-logout]').addEventListener('click', function (e) {
        e.preventDefault();
        localStorage.clear();
        location.href = 'login.html';
      });

      document.querySelector('[data-cmdk]').addEventListener('click', Shell.abrirBuscador);

      // Mostrar/ocultar sin recargar (ver "Montos ocultos" arriba).
      document.querySelector('[data-montos]').addEventListener('click', cambiarMontos);
      if (privado()) activarMascara();

      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); Shell.abrirBuscador(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          document.querySelector('[data-colapsar]').click();
        }
      });
    },

    /** Contador rojo al lado de un ítem del menú (ej. alertas vencidas). */
    badge: function (id, n) {
      var el = document.querySelector('[data-badge="' + id + '"]');
      if (!el) return;
      if (n > 0) { el.textContent = n > 99 ? '99+' : n; el.hidden = false; }
      else el.hidden = true;
    },

    /* ---------------- Buscador global ---------------- */
    abrirBuscador: function () {
      if (document.querySelector('.cmdk-backdrop')) return;
      var rol = usuarioActual().rol || '';
      var todo = [];
      NAV.forEach(function (g) {
        g.items.forEach(function (i) { if (puedeVer(i, rol)) todo.push({ i: i, grupo: g.grupo }); });
      });

      var bd = document.createElement('div');
      bd.className = 'cmdk-backdrop';
      bd.innerHTML = '<div class="cmdk" role="dialog" aria-label="Buscar pantalla">' +
        '<input type="text" placeholder="Ir a…  (escribí el nombre de una pantalla)" autocomplete="off">' +
        '<div class="cmdk-list" role="listbox"></div></div>';
      document.body.appendChild(bd);

      var input = bd.querySelector('input');
      var lista = bd.querySelector('.cmdk-list');
      var sel = 0, filtrados = todo;

      function norm(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

      function pintar() {
        if (!filtrados.length) { lista.innerHTML = '<div class="cmdk-empty">Sin resultados</div>'; return; }
        lista.innerHTML = filtrados.map(function (r, n) {
          return '<div class="cmdk-item" role="option" data-n="' + n + '" aria-selected="' + (n === sel) + '">' +
                 svg(r.i.icon) + '<span>' + r.i.txt + '</span><span class="grp">' + r.grupo + '</span></div>';
        }).join('');
      }
      function filtrar() {
        var q = norm(input.value.trim());
        filtrados = !q ? todo : todo.filter(function (r) {
          return norm(r.i.txt + ' ' + (r.i.alias || '') + ' ' + r.grupo).indexOf(q) !== -1;
        });
        sel = 0; pintar();
      }
      function ir() { if (filtrados[sel]) location.href = filtrados[sel].i.url; }
      function cerrar() { bd.remove(); }

      input.addEventListener('input', filtrar);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, filtrados.length - 1); pintar(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); pintar(); }
        else if (e.key === 'Enter') { e.preventDefault(); ir(); }
        else if (e.key === 'Escape') cerrar();
      });
      lista.addEventListener('click', function (e) {
        var it = e.target.closest('.cmdk-item');
        if (it) { sel = +it.dataset.n; ir(); }
      });
      bd.addEventListener('click', function (e) { if (e.target === bd) cerrar(); });

      pintar();
      input.focus();
    },

    /* ---------------- Toasts ----------------
       Reemplaza a los alert() y a los toasts que mostraban err.message crudo
       ("Cannot read properties of undefined"). El detalle técnico va abajo,
       en chico, y solo si sirve. */
    toast: function (tipo, titulo, detalle) {
      var cont = document.getElementById('toasts');
      if (!cont) return;
      var t = document.createElement('div');
      t.className = 'toast ' + (tipo || 'ok');
      t.innerHTML = '<div><b>' + titulo + '</b>' + (detalle ? '<div class="det">' + detalle + '</div>' : '') + '</div>';
      cont.appendChild(t);
      setTimeout(function () { t.remove(); }, tipo === 'err' ? 8000 : 4000);
    },

    /** Mensaje de error legible a partir de lo que tire apiFetch. */
    error: function (err, queHaciamos) {
      var det = (err && (err.error || err.message)) || '';
      var esTecnico = /undefined|null|NetworkError|Failed to fetch|JSON/i.test(det);
      Shell.toast('err', queHaciamos || 'No se pudo completar la operación',
        esTecnico ? 'Revisá que el servidor esté corriendo. (' + det + ')' : det);
    },

    /* ---------------- Helpers de formato ---------------- */
    /** true mientras los montos estén ocultos (ver "Montos ocultos" arriba). */
    privado: privado,
    MASCARA: MASCARA,
    /** Los formateadores propios de cada pantalla pasan su resultado por
     *  acá: devuelve el mismo texto y lo anota para que el ojo lo oculte. */
    monto: registrarMonto,

    /** Precio de compra de una materia prima: el que viene por kg (material que se
     *  lleva en gramos) lleva el "/kg" al lado. `unidad` = unidad_precio de la API. */
    precioCompra: function (v, unidad) {
      var m = Shell.money(v);
      return String(unidad || '').toUpperCase() === 'KG' ? m + ' /kg' : m;
    },

    money: function (v) {
      var n = parseFloat(v);
      if (!isFinite(n)) return '—';
      return registrarMonto(n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }));
    },
    fecha: function (v) {
      if (!v) return '—';
      var d = new Date(v.length <= 10 ? v + 'T00:00:00' : v);
      return isNaN(d) ? '—' : d.toLocaleDateString('es-AR');
    },
    /** Cuándo se espera que un cheque entregado salga de nuestra cuenta: el
     *  proveedor lo deposita desde la fecha del cheque y el banco lo debita
     *  24-48 h después (el servidor manda debito_desde / debito_hasta). */
    rangoDebito: function (c) {
      if (!c || !c.debito_desde) return '—';
      var d = Shell.fecha(c.debito_desde), h = Shell.fecha(c.debito_hasta);
      return d === h ? d : d + ' al ' + h;
    },
    /** Badge de estado: un color por significado, igual en toda la app. */
    pill: function (estado) {
      var e = String(estado || '').toUpperCase();
      var clase = 'pill-neutral';
      if (/^(PAGADA|COBRADA|FACTURADA|ACREDITADO|DEBITADO|IMPUTADO|ENTRADA)$/.test(e)) clase = 'pill-ok';
      else if (/^(PARCIAL|EN_GESTION|EN_CARTERA|PAGADA_EN_VALORES|A_CUENTA|SIN_FACTURAR|AJUSTE)$/.test(e)) clase = 'pill-warn';
      else if (/^(VENCIDA|RECHAZADO|SALIDA|MERMA)$/.test(e)) clase = 'pill-danger';
      else if (e === 'SOBRE_COBRADA' || e === 'SOBRE_PAGADA') clase = 'pill-review';
      else if (/^(PENDIENTE|DEPOSITADO|ENTREGADO)$/.test(e)) clase = 'pill-info';
      var texto = e === 'SOBRE_COBRADA' ? 'COBRADA DE MÁS'
        : e === 'SOBRE_PAGADA' ? 'PAGADA DE MÁS'
        : e === 'A_CUENTA' ? 'A FAVOR DEL CLIENTE'
        : e === 'PAGADA_EN_VALORES' ? 'PAGO EN PROCESO' : e.replace(/_/g, ' ');
      return '<span class="pill ' + clase + '">' + texto + '</span>';
    },
    /** Estado vacío que dice qué hacer, no solo que no hay nada. */
    vacio: function (titulo, texto, accion) {
      return '<div class="empty">' + svg('vacio') +
        '<div class="empty-title">' + titulo + '</div>' +
        (texto ? '<div class="empty-text">' + texto + '</div>' : '') +
        (accion ? '<a class="b b-primary" href="' + accion.url + '">' + accion.txt + '</a>' : '') +
        '</div>';
    },

    /* ---------------- Cambio obligatorio de contraseña ----------------
       Se abre cuando el backend responde PASSWORD_CHANGE_REQUIRED, o sea
       cuando la persona entró con la contraseña temporal que le dio el
       administrador. No se puede cerrar: hasta que no la cambie, el resto
       del sistema le responde 403. */
    pedirCambioPassword: function () {
      if (document.getElementById('modal-password')) return;

      var bd = document.createElement('div');
      bd.className = 'cmdk-backdrop';
      bd.id = 'modal-password';
      bd.innerHTML =
        '<div class="panel" role="dialog" aria-modal="true" aria-labelledby="mp-t" style="max-width:440px;width:100%;margin:auto">' +
          '<div class="panel-head"><h2 id="mp-t" style="margin:0">Cambiá tu contraseña</h2></div>' +
          '<div class="panel-body">' +
            '<p class="muted" style="margin-top:0">Estás usando una contraseña temporal. ' +
              'Elegí una nueva para poder seguir.</p>' +
            '<form id="mp-form">' +
              '<div class="field"><label for="mp-actual">Contraseña temporal</label>' +
                '<input class="input" type="password" id="mp-actual" autocomplete="current-password" required></div>' +
              '<div class="field"><label for="mp-nueva">Contraseña nueva</label>' +
                '<input class="input" type="password" id="mp-nueva" autocomplete="new-password" minlength="10" required>' +
                '<small class="muted">Al menos 10 caracteres. Una frase que recuerdes es mejor que algo corto y complicado.</small></div>' +
              '<div class="field"><label for="mp-repetir">Repetir la nueva</label>' +
                '<input class="input" type="password" id="mp-repetir" autocomplete="new-password" minlength="10" required></div>' +
              '<div class="notice" id="mp-error" hidden></div>' +
              '<button class="b b-primary" type="submit" id="mp-ok" style="width:100%">Guardar y continuar</button>' +
            '</form>' +
          '</div>' +
        '</div>';
      document.body.appendChild(bd);
      document.getElementById('mp-actual').focus();

      var error = document.getElementById('mp-error');
      function mostrarError(txt) { error.textContent = txt; error.hidden = false; }

      document.getElementById('mp-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var actual = document.getElementById('mp-actual').value;
        var nueva = document.getElementById('mp-nueva').value;
        var repetir = document.getElementById('mp-repetir').value;

        if (nueva !== repetir) return mostrarError('Las contraseñas no coinciden.');
        if (nueva.length < 10) return mostrarError('La contraseña debe tener al menos 10 caracteres.');

        var boton = document.getElementById('mp-ok');
        boton.disabled = true;
        boton.textContent = 'Guardando…';

        // API_URL lo define js/api.js (es un const global, no una propiedad de
        // window). Si esa pantalla no lo cargó, la URL relativa alcanza porque
        // el front se sirve desde el mismo server.
        var base = (typeof API_URL !== 'undefined') ? API_URL : '';

        fetch(base + '/api/usuarios/cambiar-password', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + localStorage.getItem('token')
          },
          body: JSON.stringify({
            password_actual: actual,
            password_nueva: nueva,
            password_confirmacion: repetir
          })
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
          .then(function (res) {
            if (!res.ok) throw new Error(res.d.error || 'No se pudo cambiar la contraseña');
            // El backend invalida los tokens viejos y devuelve uno nuevo:
            // sin guardarlo, la próxima request sería un 401.
            if (res.d.token) localStorage.setItem('token', res.d.token);
            bd.remove();
            Shell.toast('ok', 'Contraseña actualizada');
            setTimeout(function () { location.reload(); }, 800);
          })
          .catch(function (err) {
            mostrarError(err.message);
            boton.disabled = false;
            boton.textContent = 'Guardar y continuar';
          });
      });
    }
  };

  global.Shell = Shell;
})(window);

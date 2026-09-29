# Módulo: Reportes

*Última actualización: 29/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin pantalla propia todavía.** No hay una sección "Reportes" separada en el sistema — cada módulo que necesita un informe filtrable lo resuelve en su propia pantalla (ver "Patrón" abajo). Este doc no es una auditoría de un módulo existente: es la receta a copiar cada vez que se le agrega un informe con filtros de fecha y exportación a una pantalla nueva.

## Por qué existe este documento

El 29/09/2026 Damian pidió mejorar el módulo de Stock para poder ver informes más detallados (qué se compró en un mes, qué día, con qué observación, peso/unidad) y poder exportarlos — y pidió explícitamente documentar el enfoque para repetirlo en otros módulos. El diagnóstico de ese caso (ver `claude/modulo-stock.md`, sección "Informe de movimientos") fue: **el dato ya estaba completo en la base y el backend ya sabía filtrar por fecha — el frontend nunca mandaba esos filtros ni mostraba todas las columnas, y no existía ningún botón de exportar.** Ese mismo patrón de brecha es probable que se repita en otras pantallas, así que se documenta la receta acá en vez de reinventarla cada vez.

## Patrón: informe con filtros de fecha + exportación CSV

### 1. Backend — extender, no crear un endpoint nuevo

Casi siempre el endpoint de listado de la entidad (`GET /api/<recurso>`) ya existe. Extenderlo es preferible a crear un `GET /api/<recurso>/reporte` aparte, porque terminaría duplicando la misma query con otro nombre (esto solo cambia si además hace falta una **agregación** con `GROUP BY` que no tiene sentido pedir siempre — ahí sí un endpoint de resumen aparte se justifica).

- Sumar `desde`/`hasta` como filtro sobre la columna de fecha relevante (`WHERE tabla.fecha >= $n AND tabla.fecha <= $n`), de forma **aditiva**: nunca rompas una llamada existente que no manda esos parámetros.
- Sumar las dimensiones propias del módulo que hagan falta (`proveedor_id`, `cliente_id`, `estado`, `tipo`, etc.), mismo patrón `if (param) { query += ' AND columna = $n'; params.push(param); }`.
- Asegurate de que el `JOIN` ya traiga todo lo que un informe necesita mostrar (nombre en vez de solo id, observaciones, quien lo cargó) — si el dato ya está en la tabla pero el SELECT no lo trae, agregalo ahí, no inventes una vuelta al cliente para completarlo.
- **No implementes paginación real (page/limit/offset)** a menos que el volumen de datos de ese módulo realmente la necesite. Este es un ERP a medida de un solo negocio: en la mayoría de los casos alcanza con que el frontend siempre mande un rango de fechas razonable (por defecto el mes en curso) y con dejar un `LIMIT` generoso como salvaguarda (no como mecanismo de recorte). El único lugar del repo con paginación real hoy es `usuarios.routes.js` — cópialo solo si el caso lo justifica.
- Ejemplo de referencia ya implementado con este patrón: `backend/routes/stock.routes.js`, endpoint `GET /movimientos` (filtros `materia_prima_id`/`proveedor_id`/`desde`/`hasta`/`tipo`, JOIN a `materias_primas`/`usuarios`/`facturas_compra`/`proveedores`).

### 2. Frontend — filtros que pegan al servidor, tabla completa

- Bloque `<div class="filters">` con `<div class="field">` por cada filtro — inputs `<input class="input" type="date">` para desde/hasta, `<select class="input">` para las demás dimensiones — y `<div class="filters-actions">` con los botones (mínimo "Limpiar" y "Filtrar/Aplicar"; sumar "Exportar CSV" ahí mismo, ver punto 3). Es el mismo bloque que ya usan `stock.html` (tab Materiales) y `cobros.html`/`pagos-proveedores.html` (pestaña Historial).
- Armar `URLSearchParams` con los valores de los filtros y pegarle al servidor (`apiFetch(`${endpoint}?${params}`)`) — **no** traer todo y filtrar en el cliente salvo que el dataset ya sea chico de por sí (ese es otro patrón, el de `contiene()` en `correcciones.js`/`oc.js`/`facturas-lista-simple.js`, para búsquedas de texto sobre una lista ya cargada, no para rangos de fecha).
- Mostrar en la tabla **todas** las columnas que el JOIN del backend ya trae — es el error más común (el dato viaja en la respuesta pero la función de render no lo pinta). No truncar el resultado en el cliente (`.slice(0, N)`): si el volumen es un problema, se resuelve acotando el filtro de fecha, no cortando en silencio lo que se muestra.
- Usar siempre `Shell.fecha()`, `Shell.money()`, `Shell.pill()` y `Shell.vacio()` en vez de formateo manual o badges ad hoc (evitá clases tipo `bg-success`/`text-danger` sueltas — son resabio de Bootstrap, ya sacado del resto de la app). Si el informe usa un estado/tipo que `Shell.pill()` todavía no reconoce, sumalo a los regex de `Shell.pill()` en `shell.js` en vez de armar un badge nuevo — es aditivo y lo hereda toda la app.
- Ejemplo de referencia: `backend/public/js/cobros.js` → `cargarHistorial()` (pestaña Historial de `cobros.html`).

### 3. Exportación — CSV armado en el navegador, no en el servidor

No hay ninguna librería de generación de CSV/Excel en el backend (`csv-writer`, `exceljs`, `json2csv` no están en `package.json`), y sumar una solo para esto sería desproporcionado para el volumen de datos de este negocio. El patrón ya usado y a repetir es armar el CSV **en el cliente**, a partir del dataset que ya está en memoria (el mismo que se ve filtrado en pantalla, sin volver a pedirle nada al servidor):

```js
function exportarXCSV() {
  if (!datosCache.length) { Shell.toast('err', 'No hay datos para exportar'); return; }
  let csvContent = 'data:text/csv;charset=utf-8,';
  const headers = ['Columna 1', 'Columna 2', /* ... */];
  csvContent += headers.join(',') + '\n';
  datosCache.forEach(fila => {
    const valores = [ /* mismo orden que headers; texto entre comillas y `"` escapado */ ];
    csvContent += valores.join(',') + '\n';
  });
  const link = document.createElement('a');
  link.href = encodeURI(csvContent);
  link.download = `nombre-del-reporte-${rango_o_fecha}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  Shell.toast('ok', 'Reporte exportado');
}
```

- El nombre del archivo debe reflejar el filtro aplicado (rango de fechas si lo hay, o la fecha de hoy si no).
- Escapar comillas dobles en cualquier campo de texto libre (observaciones, nombres) para no romper el CSV.
- Ejemplos de referencia: `backend/public/js/alertas-pagos.js:exportarReporte()` (el primero y más prolijo) y, ya aplicado con este mismo patrón, `backend/public/js/stock.js:exportarMovimientosCSV()`.
- Un PDF de reporte (reusando `services/pdf-base.js`) es una alternativa más pesada de construir, pensada para "algo para imprimir o mandar" más que para "datos para mirar en una planilla" — no usar ese camino salvo que se pida explícitamente un documento, no una exportación de datos.

### 4. PDF con previsualización y descarga (agregado 29/09/2026, pedido explícito de Damian)

Además del CSV (para analizar los datos en una planilla), cada informe debe
poder verse y bajarse como PDF — mismo criterio que ya usa el resto del
sistema para remitos/facturas/cobros/fichas (ver "Descarga de PDF" en
`CLAUDE.md`), no un mecanismo nuevo:

- **Backend**: un endpoint `GET /api/<recurso>/reporte/pdf` (mismos query
  params `desde`/`hasta`/filtros que el endpoint de datos) que arma el PDF
  con el generador genérico `backend/services/pdf-reporte.js`
  (`generarPdfReporte`, sobre `dibujarTabla()` de `pdf-base.js` — tabla
  paginada con membrete, apaisada para tener más columnas). Responder con
  `Content-Type: application/pdf` y `Content-Disposition: attachment`
  (mismo header que ya usan los demás PDF del sistema): no afecta la
  previsualización porque el frontend nunca ve ese header — llega como blob
  (ver frontend).
- **Frontend**: un botón "PDF" que llama a `verArchivoProtegido()`
  (`js/api.js`) contra ese endpoint — abre el PDF en una pestaña nueva con el
  visor nativo del navegador, que ya resuelve **previsualización y descarga**
  en un solo lugar (el visor nativo trae su propio botón de descargar), sin
  necesitar dos botones separados ni un componente nuevo. Es el mismo patrón
  ya usado en `oc_detalle.js`, `cobros.js`, `ficha.js`, `pedidos-proveedor.js`
  — no `descargarArchivoProtegido()` (esa fuerza la descarga directa, sin
  preview).
- El PDF muestra los mismos filtros aplicados (encabezado con el rango de
  fechas) y las mismas columnas que la tabla en pantalla — no hace falta que
  sea idéntico al CSV al byte, pero sí consistente en qué datos incluye.

## Estado por módulo (actualizado 29/09/2026)

El patrón (filtros de fecha + export CSV + PDF con previsualización) ya está
aplicado en todos los módulos que registran movimientos de negocio:

| Módulo | Pantalla | Filtros | CSV | PDF |
|---|---|---|---|---|
| Stock / compras | `stock.html` → tab Movimientos | desde/hasta/proveedor/material/tipo | sí | sí |
| Stock / evolución de precios de compra | `stock.html` → tab Evolución de precios (nueva) | desde/hasta/material/proveedor | sí | sí |
| Producción | `produccion.html` → tab Historial | desde/hasta/modelo (ya existían) | sí | sí |
| Ventas / remitos (entregas a clientes) | `ventas.html` | desde/hasta/cliente | sí | sí |
| Cobros | `cobros.html` → pestaña Historial | desde/hasta/cliente/estado (ya existían) | sí | sí |
| Pagos a proveedores | `pagos-proveedores.html` → pestaña Historial | desde/hasta/proveedor/estado (ya existían) | sí | sí |
| Precios de venta por modelo | `precios.html` → pestaña Precios por modelo → Historial | desde/hasta/modelo (`""` = todos) | sí | sí |
| Cotización del dólar | `precios.html` → pestaña Dólar → Cotizaciones anteriores | desde/hasta | sí | sí |

Backend: nuevo generador genérico `backend/services/pdf-reporte.js`
(`generarPdfReporte`), reusado por todos los endpoints `GET
.../reporte/pdf` (o `.../historial/pdf` donde el endpoint de datos ya se
llamaba así) en vez de un archivo por módulo. Dos endpoints agregados
nuevos que no existían (antes solo había "un material/modelo a la vez"):
`GET /api/materias-primas/historial-precios` y `GET
/api/precios/modelo/historial`, ambos registrados **antes** de su
`/:id` correspondiente en el router (si no, Express los tapa — ver
comentario "IMPORTANTE" en el código de ambos). La variación % de precios
de venta se calcula con `LAG(precio) OVER (PARTITION BY ficha_id ORDER BY
fecha_desde)` dentro de una subquery sin filtrar por fecha, con el
`desde`/`hasta` aplicado recién en el `WHERE` de afuera — si se filtrara
antes de calcular el `LAG()`, la primera fila visible perdería su precio
anterior real y la variación saldría mal.

De paso se corrigieron dos bugs preexistentes en `stock.html`/`stock.js`
encontrados al tocar esta zona: el modal "Historial de precios" (botón
"Precios" de la tabla de Materiales) apuntaba a un `id` de tabla
(`preciosBody`) que no existía en el HTML real (`preciosTableBody`) — el
modal nunca pudo mostrar datos — y su `<thead>` tenía 4 columnas mientras
el JS pintaba 6 filas por fila. Se alinearon ambos.

## Candidatos que quedan sin export (fuera de este pedido)

Pantallas con datos históricos pero sin filtro de fecha por rango,
detectadas de paso — no forman parte de "lo que el sistema registra" en el
sentido de movimientos de negocio con fecha (son más bien catálogos o
configuración), así que no se tocaron:
- `stock-mp.html` (ABM de materiales, no tiene noción de "período").
- Historial de precios de un material individual dentro del ABM de
  materias primas, si en algún momento se agrega uno aparte del de
  `stock.html`.

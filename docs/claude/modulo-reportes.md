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

## Candidatos detectados para aplicar este patrón (no implementados todavía)

- **Ventas / remitos**: no tiene botón de exportar.
- **Pagos a proveedores** (pestaña Historial): ya tiene filtro de fecha (`filtroHistDesde`/`filtroHistHasta`), le falta el paso 3 (exportar).
- Cualquier pantalla nueva de listado con filtro de fecha debería salir directamente con exportación incluida desde el principio, siguiendo esta receta, en vez de agregarla después.

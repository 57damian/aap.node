# Módulo: Stock (materias primas)

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: auditado, diseño acordado e implementado, verificado en vivo.** Primer módulo trabajado en la reorganización (rama `reorganizacion`).

Hay dos conceptos de stock distintos en el sistema: stock de **materia prima** (comprada a proveedores, para construir transformadores) y stock de **producto terminado** (transformadores ya producidos, listos para entrega/venta). Este doc cubre solo el de materia prima, que es el que estaba funcionando mal. El de producto terminado no se tocó — ver nota al final.

## Diagnóstico confirmado contra la BD real

- `materias_primas` (3 filas), `facturas_compra` (14), `factura_items` (9), `stock_movimientos` (15), `historial_precios_materias` (6) son las tablas **reales y activas** — alimentadas por `facturas-compra.routes.js`, que es el único punto donde se cargan compras hoy.
- `compras` (1 fila), `compra_items` (1 fila) y `precios_materia_prima` (1 fila) son tablas **legacy de una versión anterior del sistema** (antes de la reconstrucción con `facturas_compra`/`factura_items`) — casi sin datos, ya no se cargan desde ningún lado activo.
- `productos_stock`: existe pero con **0 filas** — tabla huérfana, nada la lee de forma útil hoy.
- `stock_produccion` (vista, 4 filas): real y en uso, sin problemas.
- `stock_materias_primas` (vista, 3 filas): existe (creada por `scripts/fix-stock-system.js`) pero **ningún endpoint la usa** — vista muerta, candidata a eliminar en una limpieza de BD futura (junto con `compras`/`compra_items`/`precios_materia_prima`/`productos_stock`, decisión a tomar al cerrar Proveedores).

## Bugs corregidos en el código (rama `reorganizacion`)

1. **`backend/db.js`**: los scripts sueltos no cargaban `.env` (`DATABASE_URL` quedaba `undefined` al correrlos con `node scripts/...`). Se agregó `require('dotenv').config()` al principio de `db.js`.
2. **`backend/routes/stock.routes.js`** reescrito completo: dejó de depender de `compras`/`compra_items`/`precios_materia_prima` (legacy); usa `materias_primas.precio_referencia`/`fecha_ultima_compra` y `stock_movimientos.proveedor_id`/`factura_id` directamente. Se agregaron los alias de campo (`fecha`, `articulo_nombre`, `usuario`, `observacion`) que el frontend (`stock.js`) esperaba y nunca recibía (la tabla de Movimientos mostraba "-" siempre). Se sacó un `INSERT INTO productos_stock` muerto/riesgoso de `POST /ajuste`.
3. **`backend/routes/materias-primas.routes.js`**: el filtro `proveedor_id` de `GET /materias-primas` corregido para usar `stock_movimientos` en vez del JOIN legacy contra `compra_items`/`compras`.
4. **`backend/public/css/styles.css`**: la pestaña "Movimientos" de `stock.html` no reaccionaba al click porque Bootstrap CSS nunca se cargó (solo el JS, por CDN). Se agregó un bloque CSS equivalente para `.nav-tabs`/`.tab-pane`. **Confirmado funcionando en vivo.**
5. **`backend/public/stock.html`**: encabezado corregido — decía "Stock de Producción / Modelos Producidos" pero toda la pantalla es sobre materias primas/compras. Ahora dice "Stock de Materias Primas".
6. **`backend/routes/materias-primas.routes.js` → `GET /:id/historial-precios`**: tiraba error 500 (`no existe la columna hpm.observaciones`) — la columna no existe en `historial_precios_materias`. Se sacó del SELECT. **Confirmado funcionando en vivo** (devuelve el historial completo con proveedor).
7. **Bug de esquema (no de código) — `factura_items_factura_id_fkey` apuntaba a la tabla equivocada**: la FK de `factura_items.factura_id` referenciaba `facturas` (ventas) en vez de `facturas_compra` (compras) — mismo patrón de bug que aparece de nuevo, más grave, en Proveedores. Por esto, **cargar cualquier factura de compra nueva fallaba** con un error de violación de FK. Diagnosticado y corregido el 12/09 con `backend/scripts/check-fix-factura-items-fk.js` (Damian lo corrió; el script recreó la constraint apuntando a `facturas_compra(id)`). **Confirmado funcionando en vivo**: se creó y verificó una factura de compra de prueba de punta a punta después del fix.
8. **ABM de Materias Primas (`stock-mp.html` / `stock-mp.js`) — campo "Stock Actual" editable pero sin efecto real**: tanto `POST /api/materias-primas` (crear) como `PUT /api/materias-primas/:id` (editar) nunca leían ni escribían la columna `stock_actual` — el input del modal era decorativo, el usuario podía cambiar el valor y guardar sin que pasara nada, sin ningún aviso. Es consistente con el diseño ya acordado (el stock entra por factura de compra o por ajuste manual en `stock.html`, nunca desde el ABM). Se sacó el campo editable: al crear no aparece, al editar se muestra de solo lectura con un link a "Ajuste de Stock". De paso se corrigió que el modal de "Historial de Precios" mostraba siempre el mismo título genérico sin importar qué material se estaba viendo — ahora dice "Historial de Precios — {nombre del material}" (probado desde los dos puntos de entrada: ícono de la tabla y botón dentro del modal de edición). **Confirmado funcionando en vivo** (edición, creación e historial, sin tocar el backend).

## Bug encontrado, no corregido todavía (baja prioridad)

- **`DELETE /api/facturas-compra/:id` falla si esa factura generó algún registro en `historial_precios_materias`** (viola la FK `historial_precios_materias_factura_id_fkey`, porque esa tabla no tiene su fila borrada/desvinculada antes de borrar la factura). Encontrado al intentar borrar una factura de prueba (`TEST-CLAUDE-0003`, id 31, quedó en la base — es inofensiva, datos de prueba). No es urgente (borrar facturas de compra ya cargadas no es un flujo común), pero conviene arreglarlo cuando se toque Facturación/Compras: la corrección más simple es que el DELETE también borre (o desvincule con `factura_id = NULL`) las filas de `historial_precios_materias` asociadas antes de borrar la factura, igual que ya hace con `stock_movimientos` y `factura_items`.

## Diseño acordado e implementado (12/09/2026)

**Ingreso de stock (ENTRADA) — implementado, ya funcionaba así:**
- La vía normal y única es la **factura de compra**. Para la carga inicial única de stock físico existente al empezar a usar el sistema, se usa el ajuste manual ya existente (movimiento tipo AJUSTE, sin factura) — no se construyó nada nuevo para esto.

**Precio y proveedor — implementado y verificado en vivo:**
- El precio de cada material ahora queda **ligado al proveedor** que lo vendió: en `facturas-compra.routes.js`, la comparación de precio para detectar variación se hace contra la última compra de ese material **a ese mismo proveedor** (vía `stock_movimientos`), no contra un "último precio" global. El "último precio" que se muestra en el listado de Stock sigue siendo el de la compra más reciente sin importar el proveedor (solo como referencia rápida).
- Historial de precios completo por material y proveedor: `GET /api/materias-primas/:id/historial-precios` (ya existía, se le corrigió el bug de la columna inexistente y se le agregó proveedor a la tabla del modal "Historial de Precios" en `stock.html`).
- **Indicador persistente de variación de precio** agregado en la Vista General de `stock.html`: columna "Variación" que muestra ▲/▼ y el porcentaje (rojo si subió, verde si bajó) respecto a la última compra a ese mismo proveedor, sin tener que abrir ningún modal. Alimentado por un `LEFT JOIN LATERAL` a `historial_precios_materias` en `GET /api/stock`.
- **Verificado en vivo de punta a punta**: se cargó una factura de compra de prueba (materia prima "alambre 0,07", un proveedor de prueba, $150→$180) y se confirmó que el indicador mostró correctamente "▲ 20.0%", el historial de precios quedó registrado con el proveedor correcto, y el "último precio" global se actualizó.
- **Actualización 13/09/2026**: al auditar `facturas-compra.routes.js` para Proveedores se confirmó que la cotización del dólar por factura quedó efectivamente implementada — el archivo tiene `dolar_historial_id`, inserta en `historial_dolar` por factura, y calcula la variación de precio en USD contra la compra anterior al mismo proveedor.

**Moneda (dólar vs. peso) — implementado:**
- Las facturas de los proveedores llegan en pesos y se cargan tal cual. `facturas-compra.routes.js` liga cada factura a una cotización específica del dólar (`dolar_historial_id` → `historial_dolar`), con carga manual por factura (no hay todavía auto-completado desde una fuente externa tipo API de Banco Nación — eso sigue pendiente si se quiere).

**Unidades — ya funcionaba así:**
- Cada material tiene una unidad fija (kg, unidad o litro), sin conversión entre unidades. No requirió cambios.

**Salida de stock (consumo para producción) — manual, sin cambios de código en Stock:**
- Queda manual (un operario carga cuánto se usó), sin automatizar por receta. La idea de receta/lista de materiales por modelo de transformador (para proyectar necesidad de material, ej. alambre/carreteles para un pedido de N transformadores) queda anotada como punto de entrada del módulo **Producción** — ver `claude/modulo-produccion.md`.

**Trazabilidad de stock (`stock_anterior`/`stock_nuevo`) — implementado y verificado en vivo:**
- Antes quedaban en null/0 para los movimientos generados desde una factura de compra (solo se completaban en los ajustes manuales). Se corrigió `facturas-compra.routes.js` para que también los complete, igual que en `POST /api/stock/ajuste`. **Verificado en vivo**: la factura de prueba dejó `stock_anterior: 718, stock_nuevo: 728` correctamente en `stock_movimientos`.

## Idea anotada para más adelante (fuera del alcance de Stock)

- **Orden de compra**: documento para mandarle al proveedor lo que se necesita con el último precio conocido (sin que tenga que coincidir con lo que termine facturando). Se diseña junto con Proveedores/Compras — ver `claude/modulo-ordenes-compra.md` y `claude/modulo-proveedores.md` (pregunta abierta #5).

## Nota: Stock de producto terminado

No auditado ni tocado durante el trabajo de Stock. Probablemente se revise al trabajar el módulo Producción (ver `claude/modulo-produccion.md`), dado que es donde entran los transformadores terminados al stock.

## Pendientes menores

- Confirmar que Damian corrió los `git rm` de 3 archivos muertos (`stock-movimientos.js`, `auth.controller.js`, `clientes.controller.js`) y comitear los cambios de Stock en la rama `reorganizacion`.
- Opcionalmente borrar la factura de prueba `TEST-CLAUDE-0003` (id 31).

# ERP Transformadores — Estado real y pasos para seguir con Sonnet

*Revisión del proyecto en disco por Claude Opus, 15/09/2026.*
*Verificado sobre `C:\Users\Damian\Documents\mi-proyecto`, no sobre los planes.*

---

## Cómo verifiqué esto

No me fié de los planes ni de lo que decían los commits. Levanté las seis pantallas migradas en Chromium (escritorio y teléfono), revisé el DOM de cada una, y comprobé hallazgo por hallazgo contra el código real.

Dos veces estuve por reportar que el servidor no arrancaba —`asyncHandler.js` y `config/jwt.js` parecían no existir— y las dos veces era que mi copia local estaba incompleta. **Los dos archivos existen y el server arranca.** Lo aclaro porque el método importa: cada cosa de la lista de abajo está verificada contra el disco.

---

## Resumen en una línea

**El grueso está hecho y bien hecho.** Falta una cosa seria (nadie sabe si las migraciones de base se corrieron), 12 pantallas de las 22 sin migrar, y limpieza.

---

## Lo que está terminado

### Auditoría de bugs (13/09) — 17 de 19 hallazgos críticos y de seguridad

| ID | Qué era | Estado |
|---|---|---|
| C1 | Handlers async sin try/catch mataban el proceso | ✅ `middlewares/asyncHandler.js` creado y aplicado en clientes, ventas y reportes |
| C2 | `PUT /api/usuarios/cambiar-password` tapado por `/:id` | ✅ reordenado + `router.param` con guarda numérica |
| C3 | Notas de crédito: tabla inexistente + `NaN` | ✅ `nota_credito_items` se crea en `migracion-facturacion-ventas.sql` |
| C4 | `ON CONFLICT` sin índice único en items de OC | ✅ `uq_oci_orden_ficha` en `migracion-ordenes-compra.sql` |
| C5 | `SUM` anidado al cerrar una OC | ✅ reescrito con subconsulta |
| C6 | `vi.precio_unitario` inexistente en reportes | ✅ ahora usa `services/cuenta-cliente` |
| C7 | `apiRequest` no existía → 2 pantallas muertas | ✅ resuelto |
| C8 | `/api/pagos/*` no montado | ✅ sacado del menú |
| C9 | `factura_items` compartida por ventas y compras | ✅ **resuelto mejor de lo que yo había propuesto**: creó `factura_venta_items` y dejó `factura_items` para compras. Más limpio que mi versión |
| C10 | `/api/stock-produccion/resumen` tapado por `/:ficha_id` | ✅ reordenado |
| S1 | `/reset-password-admin` sin auth | ✅ borrado |
| S2 | `/test-login` como oráculo de contraseñas | ✅ borrado |
| S3 | `/debug-paths` y `/test-db` sin auth | ✅ borrados |
| S4 | Login sin rate limit | ✅ `loginLimiter` y el limitador general ahora van antes de `/api/auth` |
| S5 | `JWT_SECRET` con fallback hardcodeado en 2 archivos | ✅ centralizado en `config/jwt.js` |
| S6 | Logs con hash de contraseña | ✅ borrados |
| S9 | Validaciones del login decorativas | ✅ `validationResult` aplicado |
| D3 | No se podía cargar `dias_credito` de un proveedor | ✅ backend y formulario |
| M1, M2, M4 | Riesgos de la migración de pagos | ✅ aplicados (el `ALTER TABLE ADD COLUMN fecha_vencimiento` está, en la línea 243) |

### Plan de interfaz (15/09) — Fase 0 completa y 6 de 22 pantallas

- **Fase 0 ✅.** `css/app.css`, `js/shell.js` y `js/ayuda.js` están en su lugar. `shell.js` y `ayuda.js` quedaron **byte por byte idénticos** a los que entregué.
- **`app.css` fue extendido correctamente**: +123 líneas con 7 componentes nuevos (`.drawer`, `.aging`, `.form-grid`, `.forma`, `.notice`, `.table-items-editable`, `.totales-inline`). Todos en `app.css`, ninguno como `<style>` en una página. Se respetó la regla.
- **6 pantallas migradas y verificadas en navegador**: dashboard, cobros, pagos-proveedores, clientes, proveedores, facturas-compra.

Lo que devolvió el chequeo automático en las seis, a 1440px y a 390px:

| Chequeo | Resultado |
|---|---|
| Menú lateral con 15 links, ítem correcto marcado | ✅ en las 6 |
| Botonera vieja (`.navbar`) | ✅ 0 en las 6 |
| `<style>` inline | ✅ 0 en las 6 |
| Íconos Font Awesome huérfanos | ✅ 0 en las 6 |
| Scroll horizontal en teléfono | ✅ ninguno |
| Errores de JavaScript | ✅ ninguno |

- **F3.4 ✅**: `dias_credito` y `forma_pago_habitual` están en el alta de proveedores.

---

## Lo que falta

### 🔴 1. Nadie sabe si las migraciones de base se corrieron — *lo más urgente*

Hay **cuatro** archivos de migración esperando:

| Archivo | Fecha |
|---|---|
| `scripts/migracion-cobros.sql` | 13/09 |
| `scripts/migracion-pagos-proveedores.sql` | 14/09 |
| `scripts/migracion-ordenes-compra.sql` | 14/09 |
| `scripts/migracion-facturacion-ventas.sql` | 14/09 |

**El indicio de que no se corrieron:** `docs/ESQUEMA_BD.md.txt` sigue fechado el 13/09 y **`scripts/generar-esquema.js` nunca se creó**. Ese script era el paso B0.1 del plan de bugs, el prerequisito de todo lo demás, y es el único que quedó sin hacer de esa lista.

Por qué importa tanto: buena parte de los fixes de arriba **no existen hasta que la migración corra**. `nota_credito_items` (C3) y `uq_oci_orden_ficha` (C4) son tablas e índices, no código. Si las migraciones no corrieron, esos dos siguen rotos exactamente igual que antes, aunque el código diga lo contrario.

No lo puedo verificar desde acá: no tengo acceso a la Postgres local. Lo tiene que correr Damian.

### 🟡 2. Doce pantallas sin migrar

Mi plan decía 16 pantallas. **Son 22.** Se me pasaron `oc_detalle.html`, `venta_detalle.html` y `facturas-lista-simple.html`, que son pantallas reales, no duplicados.

**Migradas (6):** dashboard · cobros · pagos-proveedores · clientes · proveedores · facturas-compra

**Faltan (12):** ventas · oc · oc_detalle · venta_detalle · produccion · stock · stock-mp · ficha · precios · usuarios · facturas-lista-simple · alertas-pagos

**No necesitan shell (2):** `index.html` (redirección) · `login.html` (única pantalla sin menú)

**A borrar (5):** `trazabilidad-pagos.html` · `pagos-clientes.html` · `pagos-proveedores-mejorado.html` · `facturas-compra-corregida.html` · `proveedores.html.bak`

Los links a `reportes.html` y `pagos.html` (que no existen) siguen vivos, pero **solo en las 12 sin migrar**. Se van solos a medida que cada una se convierte.

### 🟡 3. Tooltips a medias

| Pantalla | Tooltips puestos | Deberían |
|---|---|---|
| cobros | 7 | 12 |
| dashboard | 4 | 4 ✅ |
| pagos-proveedores | 2 | 7 |
| clientes | 0 | 3 |
| proveedores | 0 | 3 |
| facturas-compra | 0 | 2 |

### 🟢 4. Limpieza pendiente

- Routers muertos: `routes/pagos.routes.js` (40 KB), `routes/proveedores-extended.routes.js` (11 KB). Ninguno está montado en `index.js`.
- JS muerto: `proveedores.js` + `proveedores.js.bak` (41 KB cada uno, la pantalla usa `proveedores-nuevo.js`), `pagos-proveedores.js.backup`, `facturas-compra-backup.js`, `facturas-compra-corregido.js`, `pagos-proveedores-mejorado.js`, `proveedores-integrado.js`, `trazabilidad-pagos.js`.
- `mi-proyecto.bundle` (1.1 MB) en la raíz.
- Los ~55 scripts `check-*` / `test-*` / `fix-*`.
- Fase 4 completa (limpiar `styles.css`) sin empezar.
- **M3**: la migración de pagos no fuerza `factura_compra_id` después del rename. Riesgo bajo, pero conviene cerrarlo.

---

# Los pasos, uno por sesión de Sonnet

Cada bloque de abajo es **una sesión**. El texto en gris es para copiar y pegar tal cual. No mezclar bloques: el valor de hacerlo por partes es poder verificar entre uno y otro.

**Antes de arrancar**, una sola vez:

```bash
cd C:\Users\Damian\Documents\mi-proyecto
git status
git add -A && git commit -m "wip: estado antes de continuar con el plan"
git push -u origin reorganizacion
```

Sigue sin estar pusheado: todo el trabajo del 12 al 15/09 vive en un solo disco.

---

## PASO 1 — Cerrar la base de datos 🔴 *hacer antes que nada*

> Esto desbloquea todo lo demás. Mientras no esté, no se sabe qué fixes están realmente activos.

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Leé claude/auditoria-bugs-2026-09-13.md, sección "B0.1".

Quedó pendiente el único paso que era prerequisito de todo: regenerar el esquema
real de la base. Hacé esto:

1. Creá backend/scripts/generar-esquema.js exactamente como está especificado en
   B0.1 del doc (vuelca tablas, vistas, columnas, constraints e índices a Markdown).

2. Creá backend/scripts/estado-migraciones.js: un script que se conecte a la base
   y reporte, para cada una de las 4 migraciones, si ya está aplicada o no.
   Chequeá la existencia de estos objetos, que son la huella de cada migración:
     - migracion-cobros.sql          -> columna pago_items.estado, y que NO exista pago_items.cheque_estado
     - migracion-pagos-proveedores.sql -> tabla pago_proveedor_items, y columna facturas_compra.fecha_vencimiento
     - migracion-ordenes-compra.sql  -> índice uq_oci_orden_ficha
     - migracion-facturacion-ventas.sql -> tablas factura_venta_items y nota_credito_items
   Que imprima una tabla clara: MIGRACIÓN | APLICADA (sí/no) | QUÉ FALTA.

3. Pasame los comandos exactos que tengo que correr yo, en orden, incluyendo
   el backup previo con pg_dump.

No toques nada más en esta sesión.
```

Después Damian corre lo que le pase Sonnet. **Si alguna migración no está aplicada, correrla antes de seguir al Paso 2.** Y tener el backup hecho antes: las migraciones borran columnas.

---

## PASO 2 — Verificar de punta a punta que el backend anda

> Con la base al día, comprobar que los 19 fixes realmente funcionan. Es la diferencia entre "el código dice que está arreglado" y "está arreglado".

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Ya corrí las 4 migraciones de backend/scripts/. Leé claude/auditoria-bugs-2026-09-13.md.

Creá backend/scripts/verificar-fixes.js: un script que pruebe contra la base y
la API local que cada fix de la auditoría está activo. Para cada hallazgo, un
chequeo que dé OK o FALLA con el motivo:

  C2  PUT /api/usuarios/cambiar-password responde 200 (no 403 ni 500)
  C3  INSERT en nota_credito_items funciona y factura_items.precio_unitario_sin_iva
      ya no se usa
  C4  POST /api/ordenes-compra/:id/items dos veces con el mismo modelo suma cantidad
  C5  PUT /api/ordenes-compra/:id/cerrar no tira "aggregate function calls cannot be nested"
  C6  GET /api/reportes/saldo/cliente/:id devuelve el MISMO saldo que
      GET /api/cobros/clientes/:id y que GET /api/clientes/:id/estado
  C9  ninguna fila de factura_items apunta a un id de facturas (ventas), y
      ninguna de factura_venta_items apunta a facturas_compra
  C10 GET /api/stock-produccion/resumen responde 200
  S1,S2,S3  POST /reset-password-admin, POST /test-login y GET /debug-paths dan 404
  S4  11 logins fallidos seguidos: el último da 429
  S5  el server NO arranca si falta JWT_SECRET en .env

Al final, la invariante de plata para todo cliente y todo proveedor:
  saldo del panel de deuda − exceso = saldo de la cuenta corriente

Dame el comando para correrlo y el resultado esperado.
```

---

## PASO 3 — Migrar pantallas, tanda 1: el circuito de ventas (4 pantallas)

> Desde acá es trabajo repetitivo. Cuatro pantallas por sesión es el punto donde Sonnet mantiene la calidad sin perder el patrón.

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Leé claude/plan-ux-rediseno-2026-09-15.md, sección "FASE 1 — La receta".

Ya están migradas y sirven de modelo: dashboard.html, cobros.html,
pagos-proveedores.html, clientes.html, proveedores.html, facturas-compra.html.
Copiá EXACTAMENTE ese patrón.

Migrá estas 4, en este orden:
  1. ventas.html
  2. oc.html
  3. venta_detalle.html
  4. oc_detalle.html

Ojo con estas tres, que no estaban en el plan original:
- venta_detalle.html y oc_detalle.html son pantallas de detalle: el título de
  page-head tiene que incluir a qué venta / OC pertenece, y llevan un botón
  "volver" al listado (ese sí corresponde, es navegación jerárquica real, no
  el "Volver al Dashboard" que hay que sacar).
- ventas.html tiene un emoji de camión en el <h1>: sacalo.
- oc.html tiene un formulario de 3 campos estirado a todo el ancho: usá .form-grid.

En las 4: sacar los links a reportes.html y pagos.html (no existen), cada <td>
con su data-label, montos con Shell.money(), errores con Shell.error().

Un commit por pantalla, con el nombre de la pantalla en el mensaje.
```

**Verificar antes de seguir** (abrir las 4 desde `http://localhost:3000`, no desde el Live Server):

```bash
cd backend/public
grep -l 'class="navbar"' ventas.html oc.html venta_detalle.html oc_detalle.html   # sin resultados
grep -c "<style" ventas.html oc.html venta_detalle.html oc_detalle.html           # 0 en las 4
```

---

## PASO 4 — Migrar pantallas, tanda 2: producción y stock (3 pantallas)

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Leé claude/plan-ux-rediseno-2026-09-15.md, sección "FASE 1 — La receta".
Seguí el patrón de las pantallas ya migradas.

Migrá estas 3:
  1. produccion.html
  2. stock.html
  3. stock-mp.html

Puntos específicos:
- stock.html y stock-mp.html cargan el JS de Bootstrap SIN su CSS (hallazgo F3.3):
  sacá el <script> de Bootstrap, los componentes de app.css ya lo reemplazan.
- Las dos usan <i class="fas ..."> sin cargar Font Awesome: reemplazá por
  Shell.icon() o sacá el ícono.
- El hero de stock.html acumula título + subtítulo + sub-subtítulo + badge de
  dólar + 2 botones. Dejá título y subtítulo en .page-head, el dólar como un
  .kpi más, y los botones en .page-head-actions.
- stock.html y stock-mp.html se linkean entre sí con textos confusos ("Ir a Stock
  de Materias Primas" desde una pantalla que se llama igual). Aclará qué es cada
  una: una es materias primas y la otra producto terminado.

Tooltips de esta tanda: stock_bajo, variacion_precio, precio_referencia.

Un commit por pantalla.
```

---

## PASO 5 — Migrar pantallas, tanda 3: las difíciles (3 pantallas)

> Las tres más grandes. Van juntas porque las tres necesitan reorganizar contenido, no solo cambiar el marco.

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Leé claude/plan-ux-rediseno-2026-09-15.md, secciones "FASE 1 — La receta",
"F1.18" y "F1.19".

Migrá estas 3. Son las más grandes, tomate el tiempo:

1. precios.html (22 KB, 11 KB de <style> inline)
   Además de migrar: reorganizar en 2 pestañas, como dice F1.18.
     - "Dólar": cotización actual + actualizar + historial
     - "Precios por modelo": listado + aplicar aumento + historial
   Hoy son 6 bloques apilados de 3000px de alto, con dos secciones de historial
   casi idénticas que nadie puede distinguir.
   Tiene un bug visible: "Ultima actualizacion: Invalid Date Invalid Date".
   Usá Shell.fecha().

2. usuarios.html (36 KB, con TODO el JS adentro del HTML)
   Sacá el JavaScript a js/usuarios.js. No dejes lógica en el HTML.

3. ficha.html (23 KB, 7 KB de <style>)
   Formulario largo de ficha técnica: usá .form-grid y agrupá en secciones
   con .panel (datos generales / primario / secundario / laminación).

Un commit por pantalla.
```

---

## PASO 6 — Migrar pantallas, tanda 4: lo que queda, y borrar lo muerto

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Leé claude/plan-ux-rediseno-2026-09-15.md.

Parte A — migrar las 2 últimas:
  1. alertas-pagos.html — además, aplicar F1.19: sacar jQuery y DataTables.
     Los dos están BLOQUEADOS por la CSP de index.js (code.jquery.com y
     cdn.datatables.net no están permitidos), así que la pantalla funciona
     desde el Live Server y falla desde el puerto 3000. Reemplazá la tabla por
     table.t y el filtro por .filters.
  2. facturas-lista-simple.html — revisá primero si sigue haciendo falta o si
     la reemplaza facturas-compra.html. Si está de más, borrala en vez de migrarla.
     Preguntame antes de borrar.

Parte B — borrar lo muerto (verificá con grep que nadie los use antes de cada rm):
  git rm backend/routes/pagos.routes.js
  git rm backend/routes/proveedores-extended.routes.js
  git rm backend/public/trazabilidad-pagos.html backend/public/js/trazabilidad-pagos.js
  git rm backend/public/pagos-clientes.html
  git rm backend/public/pagos-proveedores-mejorado.html backend/public/js/pagos-proveedores-mejorado.js
  git rm backend/public/facturas-compra-corregida.html backend/public/js/facturas-compra-corregido.js
  git rm backend/public/proveedores.html.bak backend/public/js/proveedores.js.bak
  git rm backend/public/js/proveedores.js          (la pantalla usa proveedores-nuevo.js)
  git rm backend/public/js/proveedores-integrado.js
  git rm backend/public/js/facturas-compra-backup.js
  git rm backend/public/js/pagos-proveedores.js.backup
  git rm mi-proyecto.bundle

Parte C — al terminar, correr y pegarme el resultado:
  cd backend/public
  grep -rnE "['\"=](reportes|pagos)\.html" .     # tiene que dar vacío
  grep -rn 'class="fas|class="fa '  .            # vacío
  grep -rn "<style" *.html                       # solo login.html, si acaso
  grep -l 'class="navbar"' *.html                # vacío
```

---

## PASO 7 — Completar los tooltips

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Leé claude/plan-ux-rediseno-2026-09-15.md, sección "FASE 2".

El glosario de js/ayuda.js ya tiene los 24 términos. Faltan colocar los (?) en
varias pantallas. Estado actual:
  dashboard 4/4 ✅ | cobros 7/12 | pagos-proveedores 2/7
  clientes 0/3 | proveedores 0/3 | facturas-compra 0/2

Completalos según la tabla de F2.1, y agregá los de las pantallas que migramos
en los pasos 3 a 6.

Regla: el (?) va donde el término aparece por primera vez en la pantalla
(encabezado de columna o etiqueta de KPI), NO en cada celda.

Si algún término que hace falta no está en el glosario, agregalo a
js/ayuda.js — nunca escribas el texto de ayuda suelto en una pantalla.

Después, aplicá Shell.vacio() a las tablas que todavía digan "No hay datos"
(sección F2.2).
```

---

## PASO 8 — Limpiar `styles.css`

> Último. Antes no: `styles.css` es la red de contención mientras quede una pantalla sin migrar.

```
Contexto: proyecto ERP en C:\Users\Damian\Documents\mi-proyecto, rama reorganizacion.
Leé claude/plan-ux-rediseno-2026-09-15.md, sección "FASE 4".

Ya están las 20 pantallas migradas. Ahora limpiar css/styles.css (~50 KB):

1. F4.1 — Arreglar la regla de origen del bug de checkboxes. styles.css:422 dice
   `input, select, textarea { width: 100% }` sin excluir checkbox ni radio.
   Cambiala a:
     input:not([type="checkbox"]):not([type="radio"]), select, textarea { width: 100%; ... }
   y borrá el parche que app.css tiene por eso (está comentado como CAUSA RAÍZ).

2. F4.2 y F4.3 — Borrar las clases sin uso. Antes de borrar cada una,
   verificá con grep -rn "nombre-clase" backend/public/. Si aparece, no la borres.
   Candidatas: .navbar*, .dashboard-header, .page-header, .oc-*, .ficha-* de
   layout, .proveedores-table*, .usuarios-grid, .welcome-*, .quick-*, .status-*,
   .stock-card, .pagos-toolbar, .produccion-actions.

3. F4.4 — styles.css tiene que quedar solo con tokens, reset y los estilos de
   login.html. Debería bajar de 50 KB a menos de 10 KB.

4. F4.5 — Borrar js/css-utilities.js y js/navbar-filter.js si quedaron sin uso.
   Reemplazar README-ESTILOS.md por uno corto: tokens en styles.css, componentes
   en app.css, menú en shell.js, ayudas en ayuda.js.

Al terminar, abrí las 20 pantallas y confirmá que ninguna se rompió.
Es el paso con más riesgo de romper algo: andá de a poco y commiteá seguido.
```

---

## Resumen de la ruta

| Paso | Qué | Sesiones | Bloquea a |
|---|---|---|---|
| 1 | Esquema + estado de migraciones 🔴 | 1 | todo lo demás |
| 2 | Verificar los fixes end-to-end | 1 | — |
| 3 | Migrar ventas · oc · venta_detalle · oc_detalle | 1–2 | — |
| 4 | Migrar produccion · stock · stock-mp | 1–2 | — |
| 5 | Migrar precios · usuarios · ficha | 2 | — |
| 6 | Migrar alertas-pagos + borrar lo muerto | 1 | 7 y 8 |
| 7 | Completar tooltips | 1 | — |
| 8 | Limpiar styles.css | 1–2 | — |

**9 a 12 sesiones.** Los pasos 1 y 2 son los importantes: sin ellos no se sabe qué está realmente funcionando. Los pasos 3 a 8 son mecánicos y se pueden hacer de a ratos.

---

## Tres cosas para decidir vos

1. **`facturas-lista-simple.html`** — ¿la usás, o quedó de una versión anterior de facturas de compra? Si no la usás, se borra en vez de migrarse (Paso 6).

2. **Reportes** — hay 11 pantallas que linkean a `reportes.html`, que nunca existió. ¿Querés una pantalla de reportes, o los botones se sacan y listo? Por ahora el plan los saca.

3. **Las migraciones y el backup** — antes del Paso 1, asegurate de tener el `pg_dump` hecho. Las migraciones borran columnas (`neto_pagado`, `saldo_pendiente`, `cheque_estado`). El proyecto no tiene datos reales, así que el riesgo es bajo, pero un backup de 10 segundos evita una tarde perdida.

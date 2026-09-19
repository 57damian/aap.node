# ERP Transformadores — Auditoría completa y orden de trabajo para Sonnet

*Auditoría hecha por Claude Opus el 13/09/2026 sobre `C:\Users\Damian\Documents\mi-proyecto` (rama local `reorganizacion`, no pusheada a GitHub — en `origin` solo existe `main`).*

---

## Cómo usar este documento

Este doc **no es una lista de sugerencias**: es una orden de trabajo. Cada hallazgo tiene:

- un **ID** (`C1`, `S3`, `D7`…) para referenciarlo en commits y en el chat,
- **archivo:línea exactos**,
- el **síntoma** que ve el usuario,
- la **causa**,
- el **fix concreto**,
- **cómo verificar** que quedó arreglado.

**Regla para Sonnet:** trabajar de arriba hacia abajo. El Bloque 0 es obligatorio antes de tocar código: sin el esquema real, varios de los fixes de abajo no se pueden validar. No saltear bloques. Un commit por ID (o por grupo de IDs del mismo archivo), con el ID en el mensaje: `fix(C2): mover PUT /cambiar-password antes de PUT /:id`.

**Qué se verificó empíricamente y qué no.** Los hallazgos marcados **[VERIFICADO]** se reprodujeron en una Postgres 16 levantada en la nube o en un Express 4.18 real durante esta auditoría: son errores seguros, no sospechas. Los marcados **[VERIFICAR]** dependen de columnas que el código usa pero que no están en `docs/ESQUEMA_BD.md.txt` (que está fechado 08/04/2025 y quedó viejo); hay que confirmarlos contra la base antes de tocar nada — por eso existe el Bloque 0.

---

## Resumen ejecutivo

| Bloque | Qué es | Cantidad |
|---|---|---|
| 0 | Trabajo previo obligatorio | 2 |
| 1 | Críticos: tiran el server o rompen una pantalla entera | 11 |
| 2 | Seguridad | 10 |
| 3 | Plata mal calculada | 12 |
| 4 | Riesgos de la migración pendiente | 4 |
| 5 | Limpieza y deuda técnica | 8 |

**Los cinco más urgentes, en orden:**

1. **C1** — cualquier error de base en 4 endpoints **mata el proceso de Node entero**. Server caído, no un 500.
2. **S1** — `POST /reset-password-admin` **sin autenticación**: cualquiera que llegue al server resetea la clave del admin a `admin123`.
3. **C2** — cambiar la contraseña propia está roto para todos los roles.
4. **C7** — `alertas-pagos.html` y `trazabilidad-pagos.html` no ejecutan una sola línea: llaman a una función que no existe.
5. **M1** — la migración pendiente de Pagos a Proveedores puede fallar entera y hacer rollback por un índice sobre una columna que quizás no existe.

---

# BLOQUE 0 — Antes de tocar código

## B0.1 — Regenerar el esquema real de la base

**Por qué primero.** `docs/ESQUEMA_BD.md.txt` dice "Generado automáticamente el 2025-04-08" y ya no describe la base. Ejemplos concretos encontrados en esta auditoría:

- el código usa `materias_primas.precio_referencia`; el doc dice `ultimo_precio`,
- el código usa `stock_movimientos.proveedor_id` y `stock_movimientos.precio_unitario`; el doc no los lista,
- el código usa `facturas_compra.cae` y `facturas_compra.dolar_historial_id`; el doc no los lista,
- el código usa `historial_precios_materias.precio_nuevo_usd` y `precio_anterior_usd`; el doc no los lista,
- el doc todavía lista `facturas_compra.neto_pagado`, que la migración de Pagos elimina.

Con el doc viejo no se puede distinguir "bug real" de "doc desactualizado". Por eso varios hallazgos de abajo están marcados **[VERIFICAR]**.

**Qué hacer.** Crear `backend/scripts/generar-esquema.js` y correrlo. Damian ejecuta:

```bash
cd backend
node scripts/generar-esquema.js > ../docs/ESQUEMA_BD.md
```

```js
// backend/scripts/generar-esquema.js
require('dotenv').config();
const pool = require('../db');

(async () => {
  const out = [];
  const hoy = new Date().toISOString().slice(0, 10);
  out.push(`# Esquema real de la base — generado ${hoy}\n`);

  const tablas = await pool.query(`
    SELECT c.relname AS nombre,
           CASE c.relkind WHEN 'r' THEN 'TABLA' WHEN 'v' THEN 'VISTA'
                          WHEN 'm' THEN 'VISTA MATERIALIZADA' ELSE c.relkind::text END AS tipo
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
    ORDER BY c.relkind, c.relname`);

  for (const t of tablas.rows) {
    out.push(`\n## ${t.nombre}  _(${t.tipo})_\n`);
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [t.nombre]);
    out.push('| Columna | Tipo | Nulo | Defecto |');
    out.push('|---|---|---|---|');
    for (const c of cols.rows) {
      out.push(`| ${c.column_name} | ${c.data_type} | ${c.is_nullable} | ${c.column_default || ''} |`);
    }
    if (t.tipo === 'TABLA') {
      const cons = await pool.query(`
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype, conname`, [t.nombre]);
      if (cons.rows.length) {
        out.push('\n**Constraints:**\n');
        cons.rows.forEach(c => out.push(`- \`${c.conname}\`: ${c.def}`));
      }
      const idx = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`, [t.nombre]);
      if (idx.rows.length) {
        out.push('\n**Índices:**\n');
        idx.rows.forEach(i => out.push(`- ${i.indexdef}`));
      }
    } else {
      const def = await pool.query(`SELECT pg_get_viewdef($1::regclass, true) AS d`, [t.nombre]);
      out.push('\n```sql\n' + def.rows[0].d + '\n```');
    }
  }
  console.log(out.join('\n'));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
```

**Verificación:** el archivo generado debe incluir las definiciones de las vistas `stock_produccion`, `stock_actual` y `vista_facturas_vencimiento`, y las constraints de `factura_items`. Con eso en mano, resolver todos los **[VERIFICAR]** de este doc antes de seguir.

## B0.2 — Rama y punto de retorno

La rama `reorganizacion` existe solo en la máquina de Damian. Antes de empezar:

```bash
git status                      # ver qué quedó sin commitear del 13/09
git add -A && git commit -m "wip: estado previo a la auditoría del 13/09"
git push -u origin reorganizacion
git checkout -b fix/auditoria-opus
```

Pushear `reorganizacion` no es opcional: hoy todo el trabajo del 12 y 13/09 vive en un solo disco.

---

# BLOQUE 1 — Críticos

## C1 — Un error de base tira el proceso de Node entero **[VERIFICADO]**

**Archivos:**
- `backend/routes/clientes.routes.js:52` (`GET /`)
- `backend/routes/clientes.routes.js:71` (`GET /:id`)
- `backend/routes/ventas.routes.js:247` (`GET /:id/estado-facturacion`)
- `backend/routes/ventas.routes.js:269` (`PUT /:id/remito`)

**Síntoma.** El server "se cae solo" cada tanto y hay que reiniciarlo. No queda un 500 en el log: queda un stack trace y el proceso muerto.

**Causa.** Son handlers `async` sin `try/catch`. Express 4 **no** captura promesas rechazadas (eso recién llega en Express 5), así que la excepción sale como *unhandled rejection*, y Node 18+ por defecto termina el proceso.

Reproducido en esta auditoría con Express 4.18.2 + Node 22: `exit code 1`, proceso muerto, el cliente ni siquiera recibe respuesta.

**Fix.** Lo correcto no es poner cuatro `try/catch` a mano — es blindar el router entero para que esto no pueda volver a pasar. Crear `backend/middlewares/asyncHandler.js`:

```js
// Envuelve un handler async y manda cualquier rechazo al manejador de errores de Express.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { asyncHandler };
```

Y aplicarlo en los cuatro handlers. Ejemplo (`clientes.routes.js:52`):

```js
const { asyncHandler } = require('../middlewares/asyncHandler');

router.get('/', authorize(['admin','control','operario']), asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM clientes ORDER BY nombre');
  res.json(result.rows);
}));
```

Además, red de seguridad en `backend/index.js`, justo antes de `app.listen`:

```js
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (no debería pasar, revisar handler async):', err);
});
```

**Verificación.** Parar la Postgres local, pegarle a `GET /api/clientes`, y comprobar que devuelve 500 y que **el server sigue vivo** para la siguiente request.

---

## C2 — Cambiar la contraseña propia está roto **[VERIFICADO]**

**Archivo:** `backend/routes/usuarios.routes.js`, líneas 242, 498 y 563.

**Síntoma.** En `usuarios.html`, el modal de "cambiar contraseña" siempre falla: a un `operario` o `empleado` le dice "Acceso denegado"; a un `admin` le tira un 500 con `invalid input syntax for type integer: "cambiar-password"`.

**Causa.** Orden de rutas en Express. `PUT /:id` está declarado en la línea 242 y `PUT /cambiar-password` en la 498. Como `/:id` matchea cualquier segmento, se come la ruta específica. Lo mismo pasa con `GET /stats` (línea 563), tapado por `GET /:id` (línea 80).

Reproducido con Express 4.18.2:

```
PUT /api/usuarios/cambiar-password -> {"handler":"PUT /:id","id":"cambiar-password"}
GET /api/usuarios/stats            -> {"handler":"GET /:id","id":"stats"}
```

Es el mismo patrón que ya había dejado muertas dos pestañas en Pagos a Proveedores (ver hallazgo general #3 del resumen del proyecto). `cobros.routes.js` y `pagos-proveedores.routes.js` ya lo resolvieron bien; `usuarios.routes.js` quedó afuera.

**Fix.** Reordenar `usuarios.routes.js` con la misma estructura que usa `cobros.routes.js`:

1. Mover `PUT /cambiar-password` (línea 498) y `GET /stats` (línea 563) **antes** de cualquier ruta con `:id`.
2. Al final del archivo, justo antes del primer `router.get('/:id')`, agregar la guarda numérica:

```js
router.param('id', (req, res, next, valor) => {
  if (!/^\d+$/.test(valor)) return res.status(404).json({ error: 'Ruta no encontrada' });
  next();
});
```

El orden final debe ser: `/` → `/alta` → `/cambiar-password` → `/stats` → `router.param('id')` → `/:id` → `/:id/reset-password`.

**Verificación.** Loguearse como `operario` y cambiar la contraseña propia: debe devolver 200. Después `GET /api/usuarios/stats` como admin: 200 con las estadísticas, no un 500.

---

## C3 — Crear una nota de crédito es imposible

**Archivo:** `backend/routes/notas_credito.routes.js`, líneas 72, 108 y 114.

**Síntoma.** `POST /api/notas-credito` siempre falla. No hay pantalla que lo llame todavía, pero el endpoint está roto de dos formas distintas.

**Causa 1 — tabla inexistente (línea 114).** El código inserta en `nota_credito_items`. Esa tabla no está en el esquema documentado. **[VERIFICAR]** con el Bloque 0: si no existe, todo `POST` rompe con `relation "nota_credito_items" does not exist` y hace rollback.

**Causa 2 — columna que nunca se escribe (líneas 72 y 108).** El cálculo es:

```js
const sub = item.cantidad * facturaItem.precio_unitario_sin_iva;
```

`factura_items.precio_unitario_sin_iva` es nullable, y **ningún INSERT del sistema la completa**: `facturas.routes.js:163` inserta `precio_unitario` pero no `precio_unitario_sin_iva`. Entonces `sub` da `NaN`, `total` da `NaN`, y la comparación `if (total > saldoActual)` con `NaN` siempre da `false` — o sea que la validación "la nota no puede superar el saldo" **nunca se dispara**, y la nota se graba con montos `NaN`/`null`.

**Causa 3 — IVA hardcodeado (línea 9).** `const IVA = 0.21`, mientras que `facturas.routes.js:12` lee el IVA de `parametros.iva_general`. Si alguien cambia el IVA desde `PUT /api/precios/parametros/iva`, las facturas usan el nuevo y las notas de crédito el viejo.

**Fix.**

1. Crear la tabla si no existe (agregar a una migración nueva `backend/scripts/migracion-notas-credito.sql`):

```sql
CREATE TABLE IF NOT EXISTS nota_credito_items (
  id                serial PRIMARY KEY,
  nota_credito_id   integer NOT NULL REFERENCES notas_credito(id) ON DELETE CASCADE,
  factura_item_id   integer NOT NULL REFERENCES factura_items(id),
  cantidad          numeric(15,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario   numeric(15,2) NOT NULL,
  subtotal          numeric(15,2) NOT NULL,
  iva_21            numeric(15,2) NOT NULL,
  total             numeric(15,2) NOT NULL,
  created_at        timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nc_items_nota ON nota_credito_items(nota_credito_id);
```

2. Derivar el precio sin IVA en vez de leer una columna vacía. Reemplazar `facturaItem.precio_unitario_sin_iva` por:

```js
const precioSinIva = facturaItem.precio_unitario_sin_iva != null
  ? parseFloat(facturaItem.precio_unitario_sin_iva)
  : parseFloat(facturaItem.precio_unitario) / (1 + ivaPorcentaje);
if (!Number.isFinite(precioSinIva)) {
  throw new Error(`El item ${facturaItem.id} no tiene precio unitario válido`);
}
```

3. Leer el IVA de `parametros`, igual que `facturas.routes.js` (extraer `getIVA()` a un helper compartido, por ejemplo `backend/services/parametros.js`, para que no queden dos copias).

4. Sacar la doble lectura de `factura_items`: hoy el archivo consulta cada item dos veces (líneas 57 y 101). Calcular una sola vez en el primer loop y guardar el resultado.

5. Agregar un guard antes de insertar: `if (!Number.isFinite(total) || total <= 0) throw new Error('Nota de crédito con montos inválidos');`

**Verificación.** Facturar una venta, emitir una NC parcial, y comprobar en `/api/cobros/clientes/:id` que el saldo de esa factura bajó exactamente el total de la NC (el servicio `cuenta-cliente.js` ya descuenta `notas_credito`).

---

## C4 — Agregar items a una orden de compra siempre falla **[VERIFICADO]**

**Archivo:** `backend/routes/ordenesCompra.routes.js:73`.

**Síntoma.** `POST /api/ordenes-compra/:id/items` devuelve 500 con `there is no unique or exclusion constraint matching the ON CONFLICT specification`.

**Causa.** El INSERT usa `ON CONFLICT (orden_compra_id, ficha_id)` pero `orden_compra_items` **no tiene** un índice único sobre ese par. Reproducido en Postgres 16 con el esquema documentado: error exacto.

**Fix.** Crear el índice que el código ya asume (va en la migración nueva, junto con C3):

```sql
-- Un modelo aparece una sola vez por orden de compra; pedir más suma cantidad.
DELETE FROM orden_compra_items a USING orden_compra_items b
  WHERE a.id > b.id AND a.orden_compra_id = b.orden_compra_id AND a.ficha_id = b.ficha_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_oci_orden_ficha
  ON orden_compra_items(orden_compra_id, ficha_id);
```

(El `DELETE` previo es necesario porque si ya hay duplicados cargados el `CREATE UNIQUE INDEX` falla. Como no hay datos reales, borrar los duplicados quedándose con el más viejo es aceptable.)

Además, validar la entrada, que hoy no se valida nada:

```js
const cantidad = parseInt(cantidad_pedida, 10);
if (!ficha_id || !Number.isInteger(cantidad) || cantidad <= 0) {
  return res.status(400).json({ error: 'Falta el modelo o la cantidad no es un entero positivo' });
}
```

**Verificación.** Agregar el mismo modelo dos veces a una OC: la segunda vez debe sumar la cantidad, no crear una fila nueva ni tirar 500.

---

## C5 — Cerrar una orden de compra siempre falla **[VERIFICADO]**

**Archivo:** `backend/routes/ordenesCompra.routes.js:123`.

**Síntoma.** `PUT /api/ordenes-compra/:id/cerrar` devuelve 500 con `aggregate function calls cannot be nested`.

**Causa.** La consulta hace `SUM(oci.cantidad_pedida - COALESCE(SUM(vi.cantidad), 0))`: un `SUM` adentro de otro `SUM`. Postgres no lo permite. Reproducido.

**Fix.** Agregar primero en una subconsulta y sumar después:

```js
const pendientes = await pool.query(`
  SELECT COALESCE(SUM(d.pendiente), 0) AS pendiente
  FROM (
    SELECT oci.cantidad_pedida - COALESCE(SUM(vi.cantidad), 0) AS pendiente
    FROM orden_compra_items oci
    LEFT JOIN ventas v       ON v.orden_compra_id = oci.orden_compra_id
    LEFT JOIN venta_items vi ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
    WHERE oci.orden_compra_id = $1
    GROUP BY oci.id, oci.cantidad_pedida
  ) d
`, [req.params.id]);

if (Number(pendientes.rows[0].pendiente) > 0) {
  return res.status(400).json({ error: 'La OC todavía tiene pendiente' });
}
```

Ojo con el `GROUP BY`: tiene que ser por `oci.id`, no por `oci.orden_compra_id`, para que cada línea de la OC se evalúe por separado.

Además, unificar el estado: la tabla usa `'abierta'`/`'cerrada'` en minúscula, contra la decisión general del proyecto de "un solo campo de estado, en MAYÚSCULAS, con CHECK". Migrar a `'ABIERTA'`/`'CERRADA'` con `CHECK`, y actualizar `ordenesCompra.routes.js:138` y el frontend (`js/oc.js`).

**Verificación.** Crear una OC con 10 unidades, entregar 10 en una venta, cerrar: 200. Crear otra con 10, entregar 5, cerrar: 400 con "todavía tiene pendiente".

---

## C6 — El reporte de saldo por cliente siempre falla **[VERIFICADO]**

**Archivo:** `backend/routes/reportes.routes.js:15` y `:22`.

**Síntoma.** `GET /api/reportes/saldo/cliente/:id` devuelve 500 con `column vi.precio_unitario does not exist`.

**Causa.** `venta_items` tiene `precio_unitario_usd` y `precio_unitario_pesos`, no `precio_unitario`. Reproducido.

Pero arreglar el nombre de la columna no alcanza: la consulta además

- suma desde `pagos_clientes`, la tabla legacy, en vez del circuito nuevo de Cobros (`pago_items` + `aplicacion_pagos`), así que el "total pagado" da 0 aunque haya cobros cargados,
- y hace un producto cartesiano entre `venta_items` y `pagos_clientes` (ver **D1**), así que los números salen multiplicados.

**Fix.** No parchear la consulta: reemplazar el endpoint entero por el servicio compartido, que es la única definición de saldo del sistema:

```js
const { resumenCliente } = require('../services/cuenta-cliente');

router.get('/saldo/cliente/:cliente_id', authorize(['admin','control']), asyncHandler(async (req, res) => {
  const cli = await pool.query('SELECT id, nombre FROM clientes WHERE id = $1', [req.params.cliente_id]);
  if (!cli.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

  const t = await resumenCliente(pool, req.params.cliente_id);
  res.json({
    cliente_id: cli.rows[0].id,
    nombre: cli.rows[0].nombre,
    total_vendido: parseFloat(t.total_facturado),
    total_pagado: parseFloat(t.total_cobrado),
    saldo: parseFloat(t.saldo)
  });
}));
```

**Verificación.** El saldo que devuelve este endpoint tiene que dar **idéntico** al de `GET /api/cobros/clientes/:id` y al de `GET /api/clientes/:id/estado`. Si los tres no coinciden, hay otra definición de saldo escondida en algún lado.

---

## C7 — `alertas-pagos.html` y `trazabilidad-pagos.html` no ejecutan una sola línea

**Archivos:**
- `backend/public/js/alertas-pagos.js:49` y `:69`
- `backend/public/js/trazabilidad-pagos.js:35`, `:73`, `:266`, `:368`, `:436`

**Síntoma.** Las dos pantallas cargan la maqueta y quedan vacías. En la consola: `ReferenceError: apiRequest is not defined`.

**Causa.** Los dos archivos llaman a `apiRequest('GET', url)`. Esa función **no está definida en ningún lado del proyecto** — `js/api.js` define `apiFetch(endpoint, options)`, con otra firma. `dashboard.js` tenía el mismo problema y se corrigió el 13/09 (ver el comentario en `dashboard.js:50`); estos dos quedaron afuera.

Detalle que importa: el backend de `/api/pagos-proveedores/alertas/facturas-pendientes` fue escrito a propósito devolviendo `{success, data, ...}` "por compatibilidad con dashboard.js y alertas-pagos.js" (`pagos-proveedores.routes.js:278`). Esa compatibilidad hoy no sirve de nada porque la llamada ni siquiera se ejecuta.

**Fix (alertas-pagos.js)** — funciona contra un endpoint que sí existe, así que es un cambio chico:

```js
// antes:  const response = await apiRequest('GET', '/api/proveedores');
//         if (response.success) { proveedoresData = response.data; ... }
// después: /api/proveedores devuelve un array plano, no {success, data}
const proveedores = await apiFetch('/api/proveedores');
proveedoresData = Array.isArray(proveedores) ? proveedores : [];
```

```js
// antes:  const response = await apiRequest('GET', '/api/pagos-proveedores/alertas/facturas-pendientes');
//         if (response.success) { alertasData = response.data; ... }
const response = await apiFetch('/api/pagos-proveedores/alertas/facturas-pendientes');
alertasData = response.data || [];
```

Ojo: son **dos contratos distintos**. `/api/proveedores` devuelve un array pelado; `/alertas/facturas-pendientes` devuelve un objeto con `data`. No asumir uno solo.

**Fix (trazabilidad-pagos.js)** — es más profundo, ver **C8**: además de `apiRequest`, llama a `/api/pagos/...`, un prefijo que no existe. Esa pantalla hay que decidirla, no parchearla.

**Verificación.** Abrir `alertas-pagos.html` con la consola abierta: cero errores, el selector de proveedores poblado, y la tabla mostrando las facturas de compra con saldo. Contrastar el total contra `GET /api/pagos-proveedores/resumen`.

---

## C8 — `/api/pagos/*` no existe, y `pagos.routes.js` es un archivo zombie

**Archivos:** `backend/routes/pagos.routes.js` (1.200+ líneas), `backend/public/js/trazabilidad-pagos.js:73,266,368,436`.

**Síntoma.** Toda la pantalla de trazabilidad devuelve 404 (además del `ReferenceError` de C7).

**Causa.** `backend/index.js` **nunca hace `require` ni `app.use` de `pagos.routes.js`**. El archivo está en el repo, se le hicieron ediciones el 13/09 (tiene una nota de cabecera actualizada sobre `cheque_estado`), pero está desconectado. Y su contenido ya no compila contra la base nueva:

- `pagos.routes.js:532,533,538,567,577,1014,1024,1118,1119,1125` leen `fc.neto_pagado`, **columna eliminada** por `migracion-pagos-proveedores.sql:233`;
- `pagos.routes.js:1062,1063,1194` leen `fc.saldo_pendiente`, **también eliminada**;
- `pagos.routes.js:787,831,854,881,912,940,963` usan `ordenes_pago_proveedores`, tabla que el rediseño sacó del circuito;
- `pagos.routes.js:267,534,558,561,1015,1018,1120` usan `EXTRACT(DAY FROM fecha_a - fecha_b)`, que en Postgres es **un error**, no un cero: `date - date` devuelve `integer` y `EXTRACT` no acepta `integer`. Reproducido: `function pg_catalog.extract(unknown, integer) does not exist`;
- y su propia cabecera admite un bug de fondo sin resolver: joinea `pago_items` (cobros de **clientes**) contra `pagos_proveedores`, así que puede devolver cheques de clientes como si fueran de un proveedor.

**Fix.** Decisión de producto antes que de código. Dos caminos:

**(a) Borrar — recomendado.** La funcionalidad de trazabilidad ya está cubierta por `GET /api/pagos-proveedores/cheques` (que sí filtra por proveedor, fecha, estado y tipo) y `GET /api/pagos-proveedores/:id`. Entonces:

```bash
git rm backend/routes/pagos.routes.js
git rm backend/public/js/trazabilidad-pagos.js backend/public/trazabilidad-pagos.html
```

y sacar los botones "Trazabilidad" de `dashboard.html:23` y `trazabilidad-pagos.html:25`.

**(b) Reescribir.** Si Damian quiere la pantalla, reescribirla sobre `/api/pagos-proveedores/cheques` con `apiFetch`, y borrar `pagos.routes.js` igual.

**Antes de decidir, preguntarle a Damian:** *"¿Usás la pantalla de Trazabilidad de pagos, o te alcanza con la pestaña de Cheques de Pagos a Proveedores?"* — hoy no funciona ninguna de las dos formas, así que no hay nada que perder.

**Verificación.** `grep -rn "api/pagos/" backend/public/` no debe devolver nada. Si devuelve algo, quedó una pantalla apuntando a un prefijo muerto.

---

## C9 — `factura_items` la comparten ventas y compras con formas incompatibles

**Archivos:** `backend/routes/facturas.routes.js:163` (ventas) y `backend/routes/facturas-compra.routes.js:455` (compras).

**Síntoma.** Es el hallazgo estructural más serio de la auditoría, y explica el bug recurrente "FK de `factura_items` a la tabla equivocada" que figura en el resumen del proyecto.

**Causa.** Los dos módulos escriben en la **misma tabla** con columnas que no se solapan:

| | facturas de venta (`facturas.routes.js:163`) | facturas de compra (`facturas-compra.routes.js:455`) |
|---|---|---|
| `factura_id` apunta a | `facturas` | `facturas_compra` |
| columnas que llena | `venta_item_id`, `ficha_id`, `cantidad`, `precio_unitario`, `subtotal`, `iva`, `total` | `materia_prima_id`, `codigo`, `nombre`, `descripcion`, `unidad_medida`, `iva_porcentaje`, `es_item_manual`, `creado_como_materia_prima` |
| deja en NULL | `materia_prima_id` | `venta_item_id`, `ficha_id` |

`factura_items.factura_id` sólo puede tener FK a **una** de las dos tablas. Y el esquema documentado marca `materia_prima_id` como `NOT NULL`, lo que haría fallar todo INSERT del lado de ventas. **[VERIFICAR]** con el Bloque 0 cuál es el estado real hoy: probablemente la FK y/o el `NOT NULL` se hayan dropeado con algún script suelto (`scripts/check-fix-factura-items-fk.js` existe justamente por esto), y la tabla haya quedado sin integridad referencial de ningún lado.

Consecuencia práctica: un `id` de `facturas` y un `id` de `facturas_compra` pueden coincidir, y entonces `GET /api/facturas-compra/:id/items` puede devolver items de una factura de **venta**, y viceversa. Es plata mal atribuida, silenciosa.

**Fix.** Separar en dos tablas, que es lo que el modelo pide. Migración:

```sql
BEGIN;

-- Los items de compra se van a su propia tabla.
CREATE TABLE IF NOT EXISTS factura_compra_items (LIKE factura_items INCLUDING ALL);
ALTER TABLE factura_compra_items DROP COLUMN IF EXISTS venta_item_id;
ALTER TABLE factura_compra_items DROP COLUMN IF EXISTS ficha_id;

INSERT INTO factura_compra_items
SELECT fi.* FROM factura_items fi
WHERE EXISTS (SELECT 1 FROM facturas_compra fc WHERE fc.id = fi.factura_id)
  AND fi.venta_item_id IS NULL;

DELETE FROM factura_items fi
WHERE EXISTS (SELECT 1 FROM facturas_compra fc WHERE fc.id = fi.factura_id)
  AND fi.venta_item_id IS NULL;

-- Ahora sí cada tabla puede tener su FK real.
ALTER TABLE factura_compra_items
  ADD CONSTRAINT fci_factura_fk FOREIGN KEY (factura_id)
  REFERENCES facturas_compra(id) ON DELETE CASCADE;

ALTER TABLE factura_items
  DROP COLUMN IF EXISTS codigo, DROP COLUMN IF EXISTS nombre,
  DROP COLUMN IF EXISTS unidad_medida, DROP COLUMN IF EXISTS es_item_manual,
  DROP COLUMN IF EXISTS creado_como_materia_prima;
ALTER TABLE factura_items ALTER COLUMN materia_prima_id DROP NOT NULL;
ALTER TABLE factura_items
  ADD CONSTRAINT fi_factura_fk FOREIGN KEY (factura_id)
  REFERENCES facturas(id) ON DELETE CASCADE;

COMMIT;
```

**Ojo:** esta migración asume que hoy no hay FK sobre `factura_items.factura_id` (si la hay, el `ADD CONSTRAINT` puede chocar) y que los items de compra son exactamente los que tienen `venta_item_id IS NULL`. Confirmar ambas cosas con el esquema del Bloque 0 **antes** de correrla, y correrla primero en la réplica de la nube, como ya se hizo con Cobros y Pagos.

Después, actualizar todas las referencias en `facturas-compra.routes.js` (INSERT de la línea 455, y los SELECT de items — buscar con `grep -n "factura_items" backend/routes/facturas-compra.routes.js`).

**Verificación.** Después de migrar: `SELECT COUNT(*) FROM factura_items fi WHERE NOT EXISTS (SELECT 1 FROM facturas f WHERE f.id = fi.factura_id);` debe dar 0. Lo mismo para `factura_compra_items` contra `facturas_compra`.

---

## C10 — `GET /api/stock-produccion/resumen` tapado por `/:ficha_id`

**Archivo:** `backend/routes/stock-produccion.routes.js`.

**Síntoma.** 500 con `invalid input syntax for type integer: "resumen"`.

**Causa.** Mismo patrón que C2: `GET /:ficha_id` está declarado antes que `GET /resumen`.

**Fix.** Mover `/resumen` arriba de `/:ficha_id` y agregar el mismo `router.param('ficha_id', ...)` con la guarda numérica.

**Verificación.** `GET /api/stock-produccion/resumen` devuelve 200. `GET /api/stock-produccion/abc` devuelve 404, no 500.

---

## C11 — `proveedores.js` llama a `/api/compras`, que no está montado

**Archivo:** `backend/public/js/proveedores.js:687` y `:1055`.

**Síntoma.** En la pantalla de proveedores, la sección de compras queda vacía y el alta de compra falla con 404.

**Causa.** `index.js` no monta ningún router en `/api/compras`. La ruta más parecida que existe es `GET /api/proveedores/:id/compras` (`proveedores.routes.js:225`), pero esa lee la tabla legacy `compras`, que está prácticamente vacía y marcada para limpieza.

**Fix.** Como funcionalidad de negocio, "compras" fue reemplazada por "facturas de compra". Apuntar el frontend a lo que existe:

```js
// proveedores.js:687 — antes: `/api/compras${...}`
const endpoint = `/api/facturas-compra${params.toString() ? '?' + params : ''}`;
```

Y el alta de la línea 1055 debe ir contra `POST /api/facturas-compra`, adaptando el body al contrato de `facturas-compra.routes.js` (`proveedor_id`, `fecha_emision`, `tipo_factura`, `numero_factura`, `items[]`), que es distinto del que manda hoy.

Si el formulario de "nueva compra" de `proveedores.html` duplica al de `facturas-compra.html`, lo más limpio es sacarlo y linkear a esa pantalla. **Preguntarle a Damian** antes de borrar UI.

**Verificación.** `grep -rn "api/compras" backend/public/` no debe devolver nada.

---

# BLOQUE 2 — Seguridad

> Todo este bloque es barato de arreglar y ninguno de los fixes rompe funcionalidad. Hacerlo completo en un solo commit.

## S1 — `POST /reset-password-admin` sin autenticación — **el peor de todos**

**Archivo:** `backend/index.js:146-165`.

Cualquiera que llegue al server, sin token ni nada, hace:

```
POST /reset-password-admin
```

y la contraseña del usuario `admin` queda en `admin123`. Está declarado en la línea 146, **antes** del middleware de autenticación de la línea 203, así que no hay nada que lo proteja. Y como la app está pensada para desplegarse en Railway, "cualquiera" significa cualquiera en internet.

**Fix.** Borrar el bloque completo (líneas 145-165). La funcionalidad legítima ya existe y está protegida: `POST /api/usuarios/:id/reset-password` y `POST /api/auth/usuarios/:id/reset-password`, ambas con `authorize(['admin'])`. Para recuperar el acceso sin server, ya existe `backend/scripts/reset-admin-password.js`, que se corre desde la consola de la máquina.

## S2 — `POST /test-login` sin autenticación: oráculo de contraseñas

**Archivo:** `backend/index.js:121-143`.

Devuelve `{ usuarioExiste, contrasenaValida, hashAlmacenado }`. Sirve para (1) enumerar usuarios válidos, (2) probar contraseñas sin límite, y (3) leer los primeros 20 caracteres del hash bcrypt. **Borrar el bloque completo.**

## S3 — `/debug-paths` y `/test-db` sin autenticación

**Archivos:** `backend/index.js:247-274` y `:186-194`.

`/debug-paths` lista el contenido del directorio del proyecto en el server. `/test-db` confirma que hay una base viva. **Borrar los dos**, o dejarlos detrás de `if (process.env.NODE_ENV !== 'production')`.

## S4 — El login no tiene rate limit

**Archivo:** `backend/index.js`, líneas 197 vs 215.

`app.use('/api/auth', authRoutes)` está en la línea **197**; `app.use('/api/', limiter)` en la **215**. Express corre los middlewares en orden de registro, así que **`/api/auth/login` nunca pasa por el limitador**. Fuerza bruta sin límite contra el login.

Además, `max: process.env.RATE_LIMIT_MAX || 100` pasa un **string** cuando la variable de entorno está definida (`"100"`), que no es lo que `express-rate-limit` espera.

**Fix.** Mover el limitador arriba de todo y ponerle uno más estricto al login:

```js
// va ANTES de app.use('/api/auth', authRoutes)
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 100),
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
  skip: (req) => req.path === '/health'
});
app.use('/api/', limiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos de login. Esperá 15 minutos.' }
});
app.use('/api/auth/login', loginLimiter);

app.use('/api/auth', authRoutes);
```

**Verificación.** 11 logins fallidos seguidos: el último devuelve 429.

## S5 — `JWT_SECRET` con fallback hardcodeado, en dos archivos

**Archivos:** `backend/middlewares/auth.js:4` y `backend/routes/auth.routes.js:10`.

```js
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro_cambiar_en_produccion';
```

Si la variable falta (un deploy mal configurado, un `.env` no cargado), el sistema arranca igual con un secreto público, y cualquiera puede firmarse un token de admin. El fallback silencioso es peor que el crash.

**Fix.** Un solo lugar, y que reviente si falta. Crear `backend/config/jwt.js`:

```js
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET no está definido o es demasiado corto (mínimo 32 caracteres). Revisá el .env.');
}
module.exports = { JWT_SECRET, JWT_EXPIRES_IN: '8h' };
```

Importarlo desde los dos archivos y borrar las constantes duplicadas. Damian tiene que generar uno nuevo (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) y ponerlo en `.env`. Al cambiarlo, todas las sesiones abiertas se caen — es lo esperado.

También borrar los `console.log('🔑 JWT_SECRET ... existe?', ...)` de ambos archivos.

## S6 — Los logs imprimen credenciales

**Archivo:** `backend/routes/auth.routes.js`, líneas 19-21, 26, 34, 42-48.

Se loguea el nombre de usuario de cada intento, los primeros 20 caracteres del hash bcrypt (línea 34) y si la contraseña coincidió. En Railway esos logs quedan guardados.

**Fix.** Borrar los `console.log` del flujo de login. Dejar uno solo, sin datos:

```js
console.warn('Login fallido para un usuario inexistente o con clave incorrecta');
```

También sacar `detalle: error.message` de la respuesta 500 de la línea 85: filtra detalles internos al cliente.

## S7 — Endpoints financieros sin control de rol

**Archivos:** `backend/routes/proveedores.routes.js` (líneas 19, 71, 225, 244, 283, 328, 352, 383, 407) y `backend/routes/stock.routes.js` (líneas 20, 104, 139, 196, 319).

Todos usan `verificarToken` pero **ninguno** usa `authorize(...)`. Cualquier usuario logueado — incluido un `empleado` de planta — puede leer la cuenta corriente de todos los proveedores, la deuda, los cheques entregados, y todo el stock valorizado con precios.

**Fix.** Aplicar los mismos dos niveles que ya usan `cobros.routes.js:29-30` y `pagos-proveedores.routes.js:39-40`:

```js
const GESTION = authorize(['admin', 'control']);
const LECTURA = authorize(['admin', 'control', 'operario']);
```

- `proveedores.routes.js`: `GET /` y `GET /:id` → `LECTURA`. Todo lo que sea cuenta corriente, facturas, cheques y resumen → `GESTION`.
- `stock.routes.js`: `GET /`, `/actual`, `/movimientos`, `/materia-prima/:id/movimientos` → `LECTURA`. `/resumen` (que expone el valor total del stock) → `GESTION`.

Nota: `pagos-proveedores.routes.js:40` incluye el rol `'compras'` en `LECTURA`, pero ese rol no existe: los válidos son `admin`, `control`, `operario`, `empleado` (`usuarios.routes.js:6`). Lo mismo en `facturas-compra.routes.js:590`. Sacarlo o crear el rol — pero elegir una.

## S8 — Contraseña temporal fija y devuelta en la respuesta

**Archivo:** `backend/routes/auth.routes.js:275` y `:290`.

`const passwordTemporal = 'Temp123456'` — igual para todos los resets, y se devuelve en el JSON.

**Fix.** Generarla al azar y obligar el cambio en el próximo login:

```js
const passwordTemporal = require('crypto').randomBytes(9).toString('base64url'); // 12 chars
```

Y agregar `usuarios.debe_cambiar_password boolean DEFAULT false`, ponerla en `true` al resetear, y que el frontend fuerce el modal de cambio cuando el login la devuelva.

## S9 — Las validaciones del login son decorativas

**Archivo:** `backend/routes/auth.routes.js:15-18`.

Se declaran `body('usuario').notEmpty().trim().escape()` y `body('password').notEmpty()`, pero el handler **nunca llama a `validationResult(req)`**. El resto del archivo sí lo hace (líneas 108, 172).

Aparte, `.escape()` convierte caracteres HTML: un usuario que se llame `a&b` nunca va a poder loguearse, porque se guardó como `a&b` y se busca como `a&amp;b`. En un campo de usuario, `.escape()` no aporta nada (la protección contra XSS va en la salida, no en la entrada).

**Fix.** Sacar `.escape()`, y agregar al principio del handler:

```js
const errors = validationResult(req);
if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
```

## S10 — La CSP bloquea jQuery y DataTables

**Archivo:** `backend/index.js:55-68`.

La política permite scripts solo de `'self'`, `cdn.jsdelivr.net` y `cdnjs.cloudflare.com`. Pero las páginas cargan también:

- `https://code.jquery.com` — 3 referencias (`alertas-pagos.html:364`, `trazabilidad-pagos.html:266`, y una más)
- `https://cdn.datatables.net` — 6 referencias (scripts **y** hojas de estilo)

Cuando esas páginas se sirven desde Express (puerto 3000), el navegador bloquea esos recursos sin mostrar nada útil, y la pantalla queda a medias. Servidas desde el Live Server de VS Code funcionan, porque ahí no se aplica esta CSP — por eso el bug aparece y desaparece según cómo se abra la página.

**Fix.** Dos opciones, elegir una:

- **(a) Recomendada:** cambiar las 9 referencias para que jQuery y DataTables también salgan de `cdnjs.cloudflare.com`, que ya está permitido. Menos hosts, menos superficie.
- **(b)** agregar `https://code.jquery.com` a `scriptSrc`, y `https://cdn.datatables.net` a `scriptSrc` **y** a `styleSrc`.

Aprovechar y sacar `"'unsafe-inline'"` de `scriptSrcAttr` (línea 61): está ahí para soportar los `onclick="..."` del HTML. Migrar esos handlers a `addEventListener` es el arreglo de fondo, pero es trabajo aparte — anotarlo como deuda, no hacerlo ahora.

**Verificación.** Abrir cada pantalla desde `http://localhost:3000` (no desde el Live Server) con la consola abierta: cero errores de CSP.

---

# BLOQUE 3 — Plata mal calculada

> Estos no rompen la pantalla: muestran números equivocados, que es peor, porque nadie se da cuenta.

## D1 — Producto cartesiano: los totales de la OC salen multiplicados **[VERIFICADO]**

**Archivo:** `backend/routes/reportesOC.routes.js:23-31`. Mismo patrón en `reportes.routes.js:15-22` (ya cubierto por C6).

**Síntoma.** `GET /api/reportes-oc/orden-compra/:id/resumen` devuelve un facturado y un cobrado inflados.

**Causa.** La consulta hace `LEFT JOIN venta_items` (N filas) y `LEFT JOIN pagos_clientes` (M filas) en el mismo nivel. El resultado son N×M filas, así que `SUM(vi.cantidad * vi.precio_unitario_pesos)` queda multiplicado por M y `SUM(pc.monto)` por N.

Reproducido: una OC con 2 items de $1.000 y 2 cobros de $500 debería dar `facturado=2000, cobrado=1000`. La consulta devuelve **`facturado=4000, cobrado=2000`**. Exactamente el doble en los dos lados — y por eso el saldo *parece* correcto, lo que hace el bug mucho más difícil de notar.

**Fix.** Agregar cada cosa por separado con subconsultas laterales, como ya hace bien el endpoint `/facturas` del mismo archivo (líneas 113-134):

```sql
SELECT
  oc.id, oc.numero_oc, oc.fecha_oc, oc.estado, c.nombre AS cliente,
  COALESCE(f.total_facturado, 0) AS total_facturado,
  COALESCE(p.total_cobrado, 0)   AS total_cobrado,
  COALESCE(f.total_facturado, 0) - COALESCE(p.total_cobrado, 0) AS saldo
FROM ordenes_compra oc
JOIN clientes c ON c.id = oc.cliente_id
LEFT JOIN LATERAL (
  SELECT SUM(vi.cantidad * vi.precio_unitario_pesos) AS total_facturado
  FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
  WHERE v.orden_compra_id = oc.id
) f ON true
LEFT JOIN LATERAL (
  SELECT SUM(ap.monto_aplicado) AS total_cobrado
  FROM ventas v
  JOIN facturas fa      ON fa.cliente_id = v.cliente_id
  JOIN aplicacion_pagos ap ON ap.factura_id = fa.id
  JOIN pago_items pi    ON pi.id = ap.pago_item_id
  WHERE v.orden_compra_id = oc.id AND pi.estado = 'ACREDITADO'
) p ON true
WHERE oc.id = $1
```

**Atención:** ese segundo `LATERAL` es una aproximación — hoy no existe un vínculo directo entre una factura de venta y su orden de compra, así que ata por cliente, lo que puede contar cobros de otras OC del mismo cliente. **Esto es una pregunta de diseño para Damian, no algo que Sonnet deba decidir solo:** *"¿Querés que el cobrado de una OC sean los cobros imputados a las facturas que salieron de esa OC? Para eso hay que guardar `facturas.orden_compra_id` al facturar."* Si la respuesta es sí, el fix real es agregar esa columna en `facturas.routes.js:131` y atar por ahí.

## D2 — Los reportes leen la tabla legacy `pagos_clientes`

**Archivos:** `reportesOC.routes.js:31` y `:132`, `reportes.routes.js:22`.

El circuito de cobros nuevo escribe en `pagos` + `pago_items` + `aplicacion_pagos`. `pagos_clientes` es de la versión anterior del sistema y ya nadie la escribe, así que todo "total cobrado" que salga de ahí da **0**.

**Fix.** Ver D1 y C6: pasar todo por `services/cuenta-cliente.js`. Después, agregar `pagos_clientes` a la lista de tablas legacy a eliminar (hallazgo general #12 del resumen).

## D3 — No se puede cargar los días de crédito de un proveedor → todo figura vencido

**Archivo:** `backend/routes/proveedores.routes.js:88-131` (POST) y `:134-183` (PUT).

**Síntoma.** En el panel "¿a quién le debo?", **todas** las facturas de compra aparecen VENCIDAS desde el día uno.

**Causa.** `services/cuenta-proveedor.js:91-94` deriva el vencimiento así:

```sql
COALESCE(fc.fecha_vencimiento, (fc.fecha_emision + (COALESCE(pr.dias_credito, 0) || ' days')::interval)::date)
```

Pero ni el POST ni el PUT de proveedores aceptan `dias_credito` ni `forma_pago_habitual` en el body: no están en el destructuring de las líneas 89-92 y 135-138. Así que `dias_credito` se queda siempre en su default, `0`, y el vencimiento termina siendo igual a la fecha de emisión. Una factura cargada hoy ya está "vencida" mañana.

Y `GET /api/pagos-proveedores/deuda` (línea 139) sí devuelve `pr.dias_credito` al frontend, con lo cual la pantalla muestra "0 días" para todos, sin forma de corregirlo.

**Fix.** Agregar los dos campos al POST y al PUT:

```js
const {
  nombre, cuit, direccion, telefono, email,
  contacto, condicion_iva, observaciones, activo,
  dias_credito, forma_pago_habitual          // <-- agregar
} = req.body;
```

En el INSERT (línea 111) y el UPDATE (línea 158), sumar:

```sql
dias_credito = COALESCE($N, dias_credito),
forma_pago_habitual = COALESCE($M, forma_pago_habitual)
```

Y agregar los dos inputs al formulario de `proveedores.html` (el `<select>` de forma de pago con las opciones `TRANSFERENCIA`, `CHEQUE`, `EFECTIVO`).

**Verificación.** Cargar un proveedor con 30 días, cargarle una factura de hoy, y confirmar que en el panel de deuda aparece como PENDIENTE con `dias_atraso` negativo, no como VENCIDA.

## D4 — La producción se atribuye a un usuario que manda el cliente

**Archivo:** `backend/routes/produccion.routes.js:19`.

```js
const usuario_id = req.headers['usuario_id'] || req.body.usuario_id;
```

El id del usuario sale de **un header o del body**, o sea de datos que el cliente controla. Cualquiera puede registrar producción a nombre de otro operario. Y en la práctica el frontend no manda ninguno de los dos, así que `usuario_id` queda `null` y la columna "registrado por" del listado (línea 89) sale siempre vacía.

**Fix.** El token ya trae el usuario verificado:

```js
const usuario_id = req.usuario.id;
```

`verificarToken` (aplicado en la línea 6) ya dejó `req.usuario` cargado desde la base. Es el mismo patrón que usa `stock.routes.js:289`.

## D5 — El ajuste de stock miente en el libro de movimientos

**Archivo:** `backend/routes/stock.routes.js:272`.

```js
const stockNuevo = Math.max(0, stockAnterior + parseFloat(cantidad));
```

Si hay 10 unidades y se pide un ajuste de −50, el stock queda en 0 (bien), pero el movimiento se graba con `cantidad = -50` y `stock_nuevo = 0`. El libro de movimientos deja de cuadrar: sumando los movimientos no se llega al stock actual, y no hay forma de auditar la diferencia.

**Fix.** Rechazar en vez de recortar en silencio:

```js
const delta = parseFloat(cantidad);
if (!Number.isFinite(delta) || delta === 0) {
  return res.status(400).json({ error: 'La cantidad del ajuste tiene que ser un número distinto de cero' });
}
const stockNuevo = stockAnterior + delta;
if (stockNuevo < 0) {
  await client.query('ROLLBACK');
  return res.status(400).json({
    error: `No se puede descontar ${Math.abs(delta)}: el stock actual es ${stockAnterior}`
  });
}
```

Y validar el tipo de movimiento, que hoy es texto libre del cliente:

```js
const TIPOS = ['ENTRADA', 'SALIDA', 'AJUSTE', 'MERMA'];
if (!TIPOS.includes(String(tipo_movimiento).toUpperCase())) {
  return res.status(400).json({ error: `Tipo de movimiento inválido: "${tipo_movimiento}"` });
}
```

Acompañarlo con un `CHECK` en la base, siguiendo la regla general del proyecto:

```sql
ALTER TABLE stock_movimientos ADD CONSTRAINT stock_mov_tipo_chk
  CHECK (tipo_movimiento IN ('ENTRADA','SALIDA','AJUSTE','MERMA'));
```

(Correr primero `SELECT DISTINCT tipo_movimiento FROM stock_movimientos;` y normalizar lo que haya, o el `ALTER` falla.)

## D6 — Una venta sin orden de compra desaparece del sistema

**Archivo:** `backend/routes/ventas.routes.js:37` y `:212`.

```sql
FROM ventas v
JOIN clientes c ON c.id = v.cliente_id
JOIN ordenes_compra oc ON oc.id = v.orden_compra_id   -- INNER JOIN
```

`ventas.orden_compra_id` es nullable, pero el `JOIN` es interno: una venta sin OC no aparece en el listado y `GET /api/ventas/:id` devuelve 404 aunque la venta exista.

Hoy `POST /api/ventas` exige `orden_compra_id` (línea 79), así que no debería haber ventas huérfanas — pero si alguna vez se carga una desde un script o se borra una OC, la venta se vuelve invisible sin ningún error.

**Fix.** `LEFT JOIN ordenes_compra` en las dos consultas.

## D7 — `GET /api/ventas/:id/items` rompe si la venta no existe

**Archivo:** `backend/routes/ventas.routes.js:169`.

```js
const tipo_cambio = ventaRes.rows[0].tipo_cambio;
```

Sin chequear que `rows` tenga algo. Con un `venta_id` inexistente: `TypeError: Cannot read properties of undefined` → 500 críptico en vez de un 404.

**Fix.**

```js
if (!ventaRes.rows.length) return res.status(404).json({ error: 'Venta no encontrada' });
```

## D8 — Dos parámetros distintos para el dólar

**Archivos:** `backend/routes/precios.routes.js:191` y `:248`, `backend/routes/ventas.routes.js:106`.

Conviven `parametros.tipo_cambio_default` y `parametros.dolar_banco`, los dos con su propio GET y PUT. `ventas.routes.js` usa `dolar_banco`; `precios.routes.js` expone los dos. Nadie sabe cuál es el bueno, y si se actualiza uno el otro queda viejo.

Peor: `ventas.routes.js:110` tiene un fallback hardcodeado de `1415.00` si no encuentra el parámetro. Una venta cargada con un dólar inventado de hace meses.

**Fix.** Quedarse con `dolar_banco` (es el que usa el circuito real y el que alimenta `historial_dolar`). Eliminar los endpoints de `tipo_cambio` (`precios.routes.js:188-241`) y la fila del parámetro. Y en `ventas.routes.js`, reemplazar el fallback por un error explícito:

```js
if (!tipoCambio || isNaN(tipoCambio)) {
  return res.status(400).json({
    error: 'No hay cotización del dólar cargada. Cargala en Precios antes de registrar la venta.'
  });
}
```

## D9 — `endosos_cheques.estado` tiene dos convenciones conviviendo

**Archivos:** `cobros.routes.js:755` escribe `'PENDIENTE'`; `pagos-proveedores.routes.js:521` y `:529` escriben `'APLICADO'`; `proveedores.routes.js:431` cuenta solo los `'PENDIENTE'`.

Es exactamente el patrón que el proyecto ya decidió eliminar ("un solo campo de estado por entidad, en MAYÚSCULAS, con CHECK"), y que causó los tres bugs más caros del sistema. `endosos_cheques` quedó afuera de las dos migraciones.

Consecuencia hoy: `GET /api/proveedores/:id/resumen` devuelve `endosos_pendientes` contando solo los endosos creados desde la pantalla de Cobros, e ignorando los creados desde Pagos a Proveedores.

**Fix.** Definir el ciclo de vida y ponerle un `CHECK`:

```sql
UPDATE endosos_cheques SET estado = upper(estado) WHERE estado <> upper(estado);
ALTER TABLE endosos_cheques ADD CONSTRAINT endosos_estado_chk
  CHECK (estado IN ('PENDIENTE','APLICADO','RECHAZADO'));
```

Semántica: `PENDIENTE` = se endosó desde Cobros pero todavía no se usó para pagar; `APLICADO` = se entregó a un proveedor dentro de un pago; `RECHAZADO` = el cheque original rebotó. Documentarlo en `claude/modulo-pagos.md`.

Y arreglar `proveedores.routes.js:431` para que cuente `estado IN ('PENDIENTE','APLICADO')`.

## D10 — Las facturas de venta anuladas siguen sumando deuda

**Archivo:** `backend/services/cuenta-cliente.js:32` y `:135`.

`CTE_FACTURAS` hace `FROM facturas f` sin filtrar por estado. `facturas.estado` existe (default `'emitida'`), así que una factura anulada sigue contando como deuda del cliente.

El lado espejo, `cuenta-proveedor.js:107`, sí filtra: `WHERE COALESCE(fc.estado,'PENDIENTE') <> 'ANULADA'`. Los dos servicios tienen que ser simétricos.

**Fix.** En `cuenta-cliente.js`, agregar a `CTE_FACTURAS` (línea 32) y a la primera rama del `UNION ALL` de `cuentaCorriente` (línea 135):

```sql
WHERE COALESCE(f.estado, 'EMITIDA') NOT IN ('ANULADA', 'anulada')
```

Y de paso normalizar `facturas.estado` a mayúsculas con `CHECK`, como pide la regla general:

```sql
UPDATE facturas SET estado = upper(estado) WHERE estado <> upper(estado);
ALTER TABLE facturas ADD CONSTRAINT facturas_estado_chk
  CHECK (estado IN ('EMITIDA','ANULADA'));
```

(Correr `SELECT DISTINCT estado FROM facturas;` primero.)

## D11 — `ficha_transformador.deleted_at` no se usa en ningún lado, y el DELETE es duro

**Archivos:** `backend/routes/ficha.routes.js:190-208`, y todas las consultas sobre `ficha_transformador`.

La columna `deleted_at` existe en el esquema, pero `grep -rn "deleted_at" backend/` no devuelve **ni una** referencia. O sea: alguien pensó el borrado lógico y quedó a medio hacer.

Mientras tanto, `DELETE /api/ficha-transformador/:id` borra físicamente. Si el modelo tiene producción, ventas, precios o items de OC, Postgres lo rechaza por FK y el usuario recibe un 500 con el mensaje crudo de la base.

**Fix.** Cerrar el borrado lógico, que es lo que el esquema ya pide:

```js
router.delete('/:id', authorize(['admin','control']), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });

  const result = await pool.query(
    'UPDATE ficha_transformador SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    [id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Ficha no encontrada o ya eliminada' });
  res.json({ ok: true, deletedId: id });
}));
```

Y agregar `AND ft.deleted_at IS NULL` a todas las consultas de listado. Buscarlas con:

```bash
grep -rn "ficha_transformador" backend/routes/
```

Hay que tocar al menos `ficha.routes.js`, `produccion.routes.js:296`, `ordenesCompra.routes.js:100`, `reportesOC.routes.js:61,126` y `ventas.routes.js:227`. En las que son un `JOIN` para resolver el nombre del modelo (por ejemplo el detalle de una venta vieja) **no** hay que filtrar: si no, desaparece el modelo de una venta ya hecha. Filtrar solo en los listados donde el usuario elige un modelo.

## D12 — La vista `stock_produccion` probablemente ignora los ajustes manuales **[VERIFICAR]**

**Archivos:** `backend/routes/produccion.routes.js:55,137,173` y `stock-produccion.routes.js`.

`stock_produccion` es una vista que calcula `producido_total - entregado_total`. Existe además `stock_produccion_ajustes`, con su endpoint `POST /api/stock-produccion/ajuste`. Si la vista no contempla esa tabla, todo ajuste manual de producto terminado se registra pero **no cambia el stock que se muestra**.

No se puede confirmar estáticamente: la definición de la vista no está en el repo. Con el Bloque 0 hecho, mirar el `pg_get_viewdef` de `stock_produccion`. Si no menciona `stock_produccion_ajustes`, recrearla:

```sql
CREATE OR REPLACE VIEW stock_produccion AS
SELECT
  ft.id AS ficha_id, ft.modelo, ft.cliente_id,
  COALESCE(pr.total, 0)  AS producido_total,
  COALESCE(ve.total, 0)  AS entregado_total,
  COALESCE(aj.total, 0)  AS ajustes_total,
  COALESCE(pr.total, 0) - COALESCE(ve.total, 0) + COALESCE(aj.total, 0) AS stock_actual
FROM ficha_transformador ft
LEFT JOIN (SELECT ficha_id, SUM(cantidad) AS total FROM produccion GROUP BY ficha_id) pr ON pr.ficha_id = ft.id
LEFT JOIN (SELECT ficha_id, SUM(cantidad) AS total FROM venta_items GROUP BY ficha_id) ve ON ve.ficha_id = ft.id
LEFT JOIN (
  SELECT ficha_id,
         SUM(CASE WHEN tipo_ajuste = 'SALIDA' THEN -cantidad ELSE cantidad END) AS total
  FROM stock_produccion_ajustes GROUP BY ficha_id
) aj ON aj.ficha_id = ft.id
WHERE ft.deleted_at IS NULL;
```

**Antes de correr esto**, confirmar contra la base qué valores tiene `stock_produccion_ajustes.tipo_ajuste` (`SELECT DISTINCT tipo_ajuste FROM stock_produccion_ajustes;`) — el `CASE` de arriba asume `'ENTRADA'`/`'SALIDA'` y hay que ajustarlo a lo que haya.

**Verificación.** Registrar 10 unidades de producción, un ajuste de −3, y confirmar que `GET /api/produccion/stock/:ficha_id` devuelve 7.

---

# BLOQUE 4 — Riesgos de la migración pendiente

> `backend/scripts/migracion-pagos-proveedores.sql` **todavía no se corrió** (es el punto 1 de "Próximos pasos" del resumen del proyecto). Revisar estos cuatro puntos **antes** de que Damian la ejecute, porque el script está todo dentro de un `BEGIN…COMMIT`: si falla en cualquier línea, hace rollback completo y no se aplica nada.

## M1 — `facturas_compra.fecha_vencimiento` puede no existir → la migración falla entera

**Archivo:** `backend/scripts/migracion-pagos-proveedores.sql:239`.

```sql
CREATE INDEX IF NOT EXISTS idx_fc_vencimiento ON facturas_compra(fecha_vencimiento);
```

El script **nunca crea** esa columna — el comentario de la línea 236 dice "se mantiene como dato cargable", dando por hecho que ya está. Pero no figura en el esquema documentado, ningún script del repo la agrega, y el alta de facturas de compra (`facturas-compra.routes.js:283-291`) no la escribe.

Si la columna no existe, el `CREATE INDEX` tira `column "fecha_vencimiento" does not exist`, el `COMMIT` no llega, y **toda la migración se revierte**. Peor: `services/cuenta-proveedor.js:92` y `:101` la leen, así que si alguien creó el índice a mano y la columna no está, todo el módulo de proveedores devuelve 500.

**Fix.** Agregar arriba del índice, en el script:

```sql
ALTER TABLE facturas_compra ADD COLUMN IF NOT EXISTS fecha_vencimiento date;
```

Es idempotente y no rompe nada si la columna ya existía.

**Verificación previa.** Que Damian corra antes:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'facturas_compra' ORDER BY ordinal_position;
```

## M2 — El `CHECK` de estado puede rechazar filas que ya están cargadas

**Archivo:** `backend/scripts/migracion-pagos-proveedores.sql:245-251`.

```sql
ALTER TABLE facturas_compra ADD CONSTRAINT facturas_compra_estado_chk
  CHECK (estado IN ('PENDIENTE','PAGADA','ANULADA'));
```

La línea 243 normaliza a mayúsculas, pero si alguna factura tiene un estado que no esté en esa lista (`'RECIBIDA'`, `'PARCIAL'`, `NULL`…), el `ALTER` falla y se cae toda la migración.

**Fix.** Normalizar antes de agregar el constraint:

```sql
UPDATE facturas_compra SET estado = 'PENDIENTE'
WHERE estado IS NULL OR upper(estado) NOT IN ('PENDIENTE','PAGADA','ANULADA');
```

**Verificación previa.** `SELECT DISTINCT estado FROM facturas_compra;` — si aparece algo fuera de las tres, decidir con Damian a cuál mapea antes de correr nada.

## M3 — El rename puede dejar la tabla con columnas viejas

**Archivo:** `backend/scripts/migracion-pagos-proveedores.sql:152-169`.

El script renombra `pagos_proveedores_items` → `aplicacion_pagos_proveedores` (línea 158) y **después** hace `CREATE TABLE IF NOT EXISTS aplicacion_pagos_proveedores (...)` (línea 163). Como después del rename la tabla ya existe, el `CREATE` es un no-op: la tabla conserva las columnas viejas.

Si `pagos_proveedores_items` tenía, por ejemplo, `factura_id` en vez de `factura_compra_id`, la migración termina "bien" pero todo `services/cuenta-proveedor.js` (que lee `ap.factura_compra_id` en la línea 57) falla en runtime con `column ap.factura_compra_id does not exist`.

**Fix.** Después del `CREATE TABLE IF NOT EXISTS`, forzar la forma esperada:

```sql
ALTER TABLE aplicacion_pagos_proveedores ADD COLUMN IF NOT EXISTS factura_compra_id integer;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='aplicacion_pagos_proveedores' AND column_name='factura_id') THEN
    UPDATE aplicacion_pagos_proveedores SET factura_compra_id = factura_id
      WHERE factura_compra_id IS NULL;
    ALTER TABLE aplicacion_pagos_proveedores DROP COLUMN factura_id;
  END IF;
END $$;
```

**Verificación previa.** `\d pagos_proveedores_items` en psql, antes de correr la migración.

## M4 — Dos índices únicos idénticos sobre `endosos_cheques`

**Archivos:** `migracion-cobros.sql:223-225` crea `uq_endosos_cheque_activo`; `migracion-pagos-proveedores.sql:256-258` crea `uq_endoso_pago_item`. Las dos son parciales sobre `endosos_cheques(pago_item_id) WHERE estado <> 'RECHAZADO'`.

No rompe nada, pero duplica el trabajo de escritura y confunde a cualquiera que mire el esquema. **Fix:** quedarse con `uq_endoso_pago_item` y agregar `DROP INDEX IF EXISTS uq_endosos_cheque_activo;` al script de pagos.

---

# BLOQUE 5 — Limpieza y deuda técnica

> Todo esto es seguro de hacer y reduce mucho el ruido para las próximas sesiones. Un solo commit de limpieza al final.

## L1 — Navegación rota en 16 pantallas

`reportes.html` y `pagos.html` **no existen** en `backend/public/`, pero hay botones que apuntan a ellas en:

- `reportes.html` → `dashboard.html:24`, `oc.html:26`, `oc_detalle.html:24`, `stock.html:23`, `proveedores.html:374`, `ventas.html:21`, `venta_detalle.html:21`, `ficha.html:326`, `facturas-lista-simple.html:50`, `trazabilidad-pagos.html:26`
- `pagos.html` → `oc_detalle.html:23`, `ventas.html:20`, `venta_detalle.html:20`, `ficha.html:325`, `produccion.html:20`

Servidas desde Express, esas rutas caen en el comodín `app.get('*')` de `index.js:278` y devuelven `index.html`, así que el usuario termina en una página en blanco sin saber por qué.

Hay además una **navbar inconsistente**: `cobros.html` y `pagos-proveedores.html` (las pantallas nuevas) solo están linkeadas desde 6 y 10 páginas respectivamente. Las demás siguen con el menú viejo.

**Fix.** Extraer la navbar a un solo componente. Crear `backend/public/js/navbar.js` que genere el menú a partir de una lista única y lo inyecte en un `<nav id="navbar-principal">`, respetando `data-roles` como hoy. Después reemplazar los 16 bloques de botones por ese contenedor. Es media hora de trabajo y elimina para siempre esta clase de bug.

Menú correcto hoy: Dashboard · Clientes · Ventas · OC · Producción · Stock · Stock MP · Proveedores · Facturas de compra · **Cobros** · **Pagos a proveedores** · Alertas · Precios · Usuarios.

## L2 — Bootstrap JS sin su CSS

`backend/public/stock.html` y `backend/public/stock-mp.html` cargan el bundle JS de Bootstrap pero **no** la hoja de estilos. Cualquier modal, alert o badge de Bootstrap en esas páginas se ve a medias.

**Fix.** O agregar el `<link>` del CSS, o —mejor, según el criterio de unificación visual acordado— sacar el JS de Bootstrap y usar las variables de `css/styles.css`, como ya hacen `cobros.html` y `pagos-proveedores.html`.

## L3 — Routers no montados

- `backend/routes/pagos.routes.js` — ver **C8**. `git rm`.
- `backend/routes/proveedores-extended.routes.js` — no lo requiere nadie en `index.js`. Revisar si tiene algo que valga la pena rescatar (`grep -n "^router\." backend/routes/proveedores-extended.routes.js`) y después `git rm`.

## L4 — Archivos duplicados y de backup en el repo

Están trackeados en git:

```bash
git rm backend/public/js/facturas-compra-backup.js
git rm backend/public/js/pagos-proveedores.js.backup
git rm backend/public/js/proveedores.js.bak
git rm backend/public/proveedores.html.bak
git rm mi-proyecto.bundle          # 1.1 MB, bundle de git con ramas viejas
```

Candidatos a revisar antes de borrar (hay que confirmar cuál es la versión viva de cada uno):

- `backend/public/js/facturas-compra-corregido.js` vs `facturas-compra.js`
- `backend/public/js/pagos-proveedores-mejorado.js` vs `pagos-proveedores.js` (¿y `pagos-proveedores-mejorado.html`?)
- `backend/public/js/proveedores-integrado.js`, `proveedores-nuevo.js` vs `proveedores.js`
- `backend/public/facturas-compra-corregida.html` vs `facturas-compra.html`
- `backend/public/pagos-clientes.html` — hoy es solo una redirección a `cobros.html`; borrar cuando no queden links viejos
- `backend/public/js/pagos.js` — mencionado en el comentario de `pagos-clientes.html`
- `test-auth.html`, `test-navegacion.html`, `test-ultimo-numero.js` en la raíz del repo

Para cada uno: `grep -rn "<nombre>" backend/public/*.html` y si no lo carga ninguna página, borrarlo.

## L5 — Más de 60 scripts sueltos de diagnóstico

`backend/*.js` y `backend/scripts/*.js` tienen unos 60 archivos `check-*`, `fix-*`, `test-*`, `verificar-*`, `diagnostico-*`, `crear-*`, `corregir-*`. Ninguno es una suite repetible: son parches puntuales de sesiones viejas.

**Fix.** Mover todo lo que no sea una migración a `backend/scripts/_archivo/` (con un `README.md` de una línea diciendo que son históricos), y dejar en `backend/scripts/` únicamente:

- `migracion-cobros.sql`
- `migracion-pagos-proveedores.sql`
- `generar-esquema.js` (nuevo, B0.1)
- `create-admin.js`
- `reset-admin-password.js`
- `migrate.js`

Más adelante vale la pena convertir las verificaciones importantes en tests de verdad, pero eso es otro trabajo.

## L6 — Dos sistemas de autenticación en paralelo

`/api/auth/usuarios/*` (`auth.routes.js:148-332`) y `/api/usuarios/*` (`usuarios.routes.js`) hacen lo mismo con contratos distintos: el primero devuelve `{ok, usuarios}`, el segundo un array. `usuarios.html` usa `/api/usuarios`.

**Fix.** Borrar las rutas de usuarios de `auth.routes.js` (líneas 148-332), dejando ahí solo `login`, `verificar` y `cambiar-password`. Antes, confirmar que ningún frontend las use: `grep -rn "api/auth/usuarios" backend/public/`.

Nota: `POST /api/auth/cambiar-password` y `PUT /api/usuarios/cambiar-password` también están duplicados. La de `auth.routes.js` funciona; la de `usuarios.routes.js` está rota por **C2**. Después de arreglar C2, elegir una y borrar la otra — recomiendo quedarse con la de `usuarios.routes.js`, que es la que llama `usuarios.html:842`.

## L7 — `.gitignore`: bien

Verificado: `.env` está ignorado y **no** está trackeado en `main`. Nada que hacer acá — lo anoto para que no se pierda tiempo revisándolo.

## L8 — Documentación vieja del repo

`docs/DOCUMENTACION_COMPLETA.md` (36 KB), `docs/SISTEMA_PAGOS_PROVEEDORES.md`, `docs/SISTEMA_FACTURAS_COMPRA.md`, `docs/TROUBLESHOOTING_FACTURACION.md` describen circuitos que ya no existen (órdenes de pago, saldos guardados, `pagos_clientes`). Alguien que los lea va a sacar conclusiones equivocadas.

**Fix.** Moverlos a `docs/_historico/` con una nota al principio de cada uno: *"Describe el sistema anterior a la reorganización del 13/09/2026. Para el estado actual ver `claude/00-resumen-y-metodologia.md`."*

---

# Apéndice A — Orden de ejecución sugerido

| # | Qué | IDs | Riesgo |
|---|---|---|---|
| 1 | Regenerar esquema + pushear `reorganizacion` | B0.1, B0.2 | ninguno |
| 2 | Resolver todos los **[VERIFICAR]** con el esquema nuevo | C3, C9, D12 | ninguno |
| 3 | Seguridad completa (un commit) | S1–S10 | bajo |
| 4 | Estabilidad del server | C1 | bajo |
| 5 | Orden de rutas | C2, C10 | bajo |
| 6 | Pantallas muertas | C7, C8, C11, L1, L2 | bajo |
| 7 | Arreglar la migración **antes** de correrla | M1–M4 | medio |
| 8 | Damian corre la migración en local | — | medio |
| 9 | Plata mal calculada | D1–D11 | medio |
| 10 | Órdenes de compra | C4, C5 | medio |
| 11 | Notas de crédito | C3 | medio |
| 12 | Separar `factura_items` (probar primero en réplica) | C9 | **alto** |
| 13 | Limpieza | L3–L8 | bajo |

Los pasos 7, 8, 9 y 12 tocan la base: seguir el método que ya funcionó dos veces — reconstruir el esquema en una Postgres de la nube, correr la migración ahí, probar el router end-to-end, y recién después escribir en el disco de Damian.

# Apéndice B — Comandos de verificación

Después de cada bloque, que Damian corra:

```bash
# 1. El server levanta y sobrevive a un error de base
cd backend && npm start
# en otra terminal, con la Postgres parada:
curl -i http://localhost:3000/api/clientes -H "Authorization: Bearer $TOKEN"
# debe dar 500 y el server debe seguir vivo

# 2. Los endpoints que estaban rotos
curl -X PUT  http://localhost:3000/api/usuarios/cambiar-password -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"password_actual":"...","password_nueva":"..."}'
curl http://localhost:3000/api/usuarios/stats                 -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/api/stock-produccion/resumen       -H "Authorization: Bearer $TOKEN"
curl http://localhost:3000/api/reportes/saldo/cliente/1       -H "Authorization: Bearer $TOKEN"

# 3. Los endpoints que NO deben existir más
curl -i -X POST http://localhost:3000/reset-password-admin    # 404
curl -i -X POST http://localhost:3000/test-login              # 404
curl -i http://localhost:3000/debug-paths                     # 404

# 4. Nada apunta a prefijos muertos
grep -rn "api/pagos/\|api/compras\|apiRequest" backend/public/   # sin resultados
```

## La invariante, después de cada cambio en dinero

La regla ya acordada en el proyecto, que sigue siendo el chequeo más barato:

```
saldo del panel de deuda − exceso pagado/cobrado = saldo de la cuenta corriente
```

para todo cliente y todo proveedor. Comparar:

- `GET /api/cobros/resumen` contra la suma de `GET /api/cobros/deuda`
- `GET /api/pagos-proveedores/resumen` contra la suma de `GET /api/pagos-proveedores/deuda`
- y, para un cliente puntual, que `GET /api/clientes/:id/estado`, `GET /api/cobros/clientes/:id` y `GET /api/reportes/saldo/cliente/:id` devuelvan los **tres** el mismo saldo.

Si los tres no coinciden, quedó otra definición de saldo escondida en algún lado y hay que encontrarla antes de seguir.

# CLAUDE.md — ERP Transformadores

ERP a medida para un negocio de transformadores. Backend Node.js + Express + PostgreSQL; frontend HTML/CSS/JS vanilla servido desde `backend/public/` (el `frontend-react/` está iniciado pero no funciona, se ignora). Todo el código, comentarios, mensajes y commits van **en español**.

Notas de contexto detalladas por módulo y auditorías: `docs/claude/` (empezar por `00-resumen-y-metodologia.md`).

## Entornos

| | Local (desarrollo) | Producción |
|---|---|---|
| Servidor | `cd backend && npm run dev` (nodemon) o `npm start`, puerto 3000 | **Railway** (deploy desde GitHub `57damian/aap.node`) |
| Base de datos | Postgres 16 local, base `transformadores` | **Neon** (`neondb`, región eu-central-1) |
| Variables | `backend/.env` (no se commitea) | Pestaña **Variables** del servicio en Railway — Railway **no lee** el `.env` |

- En `backend/.env` la línea `DATABASE_URL` de Neon está **comentada**; la activa es `localhost`. Antes de correr cualquier script contra la base, confirmar a cuál apunta (mostrar solo el host, nunca la contraseña).
- Nunca correr migraciones ni scripts que escriben contra Neon sin que Damian lo pida explícitamente y sin backup previo.

## Variables de entorno (backend)

| Variable | Obligatoria | Notas |
|---|---|---|
| `DATABASE_URL` | sí | En Railway: la connection string de Neon (con `sslmode=require`). |
| `JWT_SECRET` | **sí, ≥ 32 caracteres** | Si falta o es corta el server **no arranca** (`config/jwt.js`, a propósito: antes había un secreto fijo en el código). Generar con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Usar uno distinto en producción y en local. Cambiarlo cierra todas las sesiones abiertas. |
| `NODE_ENV` | en prod | `production` en Railway: saca los orígenes localhost de CORS y activa la verificación del certificado SSL de la base. |
| `JWT_EXPIRES_IN` | no | Default `8h`. |
| `CORS_ORIGIN` | no | Orígenes extra separados por coma. El dominio público de Railway (`RAILWAY_PUBLIC_DOMAIN`) se autoriza solo. |
| `DB_SSL_NO_VERIFY` | no | `true` solo si el proveedor de la base usa un certificado propio. |
| `RATE_LIMIT_WINDOW`, `RATE_LIMIT_MAX`, `PORT` | no | |

**Incidente 19/09/2026:** el deploy en Railway crasheó con `JWT_SECRET no está definido o es demasiado corto`. Causa: la variable no estaba cargada en Railway (sí en el `.env` local). Solución: cargar `JWT_SECRET` en Variables del servicio y redeployar.

## Migraciones

No hay un sistema de migraciones automático: son archivos SQL idempotentes en `backend/scripts/`, que se corren a mano **en este orden**:

1. `migracion-cobros.sql` (13/09)
2. `migracion-pagos-proveedores.sql` (14/09)
3. `migracion-ordenes-compra.sql` (14/09)
4. `migracion-facturacion-ventas.sql` (14/09)
5. `migracion-roles.sql` (17/09) — ⚠️ además de remapear roles **borra** los usuarios `control1` y `test_final` (ya corrió en local y en Neon).
6. `migracion-seguridad.sql` (17/09) — columnas nuevas de `usuarios` que usa el login actual: sin esta migración el login falla.
7. `migracion-factura-multi-remito.sql` (19/09) — `facturas.orden_compra_id`, `facturas.tipo_cambio`, `factura_venta_items.precio_unitario_usd` y el DEFAULT de `facturas.estado` en `'EMITIDA'` (sin eso no se puede crear ninguna factura de venta).

8. `migracion-fix-retenciones.sql` (19/09) — elimina el CHECK viejo `pago_items_tipo_check`, que no admitía `RETENCION`: sin esto **no se puede registrar ninguna retención** desde Cobros. Aplicada en Neon; **en la base local falta correrla** (`psql -U postgres -h localhost -d transformadores -f backend/scripts/migracion-fix-retenciones.sql`).

9. `migracion-anulacion-facturas.sql` (21/09) — tabla `auditoria_anulaciones`, columnas `facturas.anulada_en/anulada_por/motivo_anulacion` y reemplazo del UNIQUE `unique_numero_factura` por el índice único parcial `uq_facturas_numero_vigente` (el número de una factura ANULADA se puede reusar). Sin esto no funciona "Anular factura" ni se puede dar de alta una factura (el código nuevo espera el índice). **Aplicada en Neon el 21/09/2026; falta correrla en la base local** (ver "Anular facturas, remitos y OC" abajo).
10. `migracion-anulacion-remitos-oc.sql` (21/09) — columnas `anulada_en/anulada_por/motivo_anulacion` en `ventas` (remitos) y `ordenes_compra`. **Requiere la 9** (usa `auditoria_anulaciones`). Sin esto fallan el listado de remitos y las anulaciones de remitos y OC. **Aplicada en Neon el 21/09/2026 (junto con la 9, con backup en `docs/_backup/neon-datos-antes-de-migraciones-9-10-2026-09-21.json`); falta correrla en la base local.**

11. `migracion-ficha-devanados.sql` (21/09) — pasa `ficha_transformador.espiras_primario/espiras_secundario` de `integer` a `varchar(40)` (para guardar "422 + 422" de un secundario con punto medio; los valores existentes se conservan) y crea `ficha_devanados_extra` (devanados terciario, cuarto…). Sin esto falla **el detalle y el guardado de toda ficha** (la API lee/escribe la tabla nueva). **Aplicada en Neon el 21/09/2026 (backup en `docs/_backup/neon-datos-antes-de-migracion-11-2026-09-21.json`); falta correrla en la base local.**

- Ver qué falta: `cd backend && node scripts/estado-migraciones.js` (solo lectura; hoy chequea las 1-4 y de la 7 a la 11, no la 5 ni la 6).
- Contra Neon (PowerShell): `$env:DATABASE_URL="<url de Neon>"; node scripts/estado-migraciones.js`
- Aplicar: `psql "<url>" -f backend/scripts/<archivo>.sql` (las 5 y 6 usan `\set ON_ERROR_STOP`, requieren `psql`).
- **Antes de migrar Neon:** crear un branch/backup desde la consola de Neon (Branches → Create branch) y, si se puede, probar la migración primero en ese branch.
- Además de las 7, `scripts/agregar-dolar-facturas-compra.js` (12/09) agrega `facturas_compra.dolar_historial_id` y `historial_precios_materias.precio_*_usd`; ya está aplicado en local y en Neon.
- **Estado al 19/09/2026:** local y **Neon** con las 7 migraciones + el script del dólar aplicados (Neon se aplicó ese día, en una sola transacción; el esquema resultante coincide con el local salvo tablas/columnas viejas del local que el código no usa: `cheques_propios`, `talonarios`, `recibo_pagos`, `facturas.saldo`, `clientes.activo`, etc.). El código de la rama `reorganizacion` necesita las 7 en la base a la que apunte.
- **Neon tenía todo sin migrar** cuando se subió el código a Railway → el login fallaba aunque la clave fuera correcta (faltaban las columnas de `migracion-seguridad.sql`). Antes de un deploy que toque el esquema, migrar Neon primero.
- Las claves de Neon y del local son **distintas** (bases separadas). Para recuperar acceso: `node scripts/reset-admin-password.js <usuario>` con `DATABASE_URL` apuntando a Neon; genera una clave temporal aleatoria.
- **Backups de Neon:** el `pg_dump` local es 16 y Neon corre Postgres 17, así que `pg_dump` se niega. Alternativas: branch en la consola de Neon (recomendado) o volcado lógico a JSON con Node (los del 19/09 están en `docs/_backup/`, ignorada por git; restaurar es manual).
- **Neon limpiado el 19/09/2026:** se borraron los datos de prueba de compras, pagos a proveedores, OC, producción, y los clientes, proveedores y materias primas. Se conservaron fichas de transformador (sin cliente asignado: reasignar al cargar los clientes reales), `precios_modelo`, `historial_dolar`, parámetros, roles y usuarios. Neon no tenía ventas, facturas de venta ni cobros.
- **Carga inicial de ventas y cobros en Neon (19/09/2026)**, desde el Excel de cuentas de los clientes (un cuaderno manual, no una tabla; **no está en el repo**, ver `.gitignore`). Se cargó solo lo abierto: facturas, remitos, la producción faltante para cubrir lo entregado y los cobros, más un saldo a favor. Reglas usadas: los importes del Excel **incluyen IVA 21%**; el dólar es la columna **Venta** del CSV de cotizaciones a la fecha de la factura; los precios en pesos son los del Excel y el USD sale de dividir. Todo llevaba `Carga inicial desde Excel…` en observaciones. Ese detalle (clientes, números y montos) no se documenta acá porque el repo puede ser público; está en el backup de esa fecha en `docs/_backup/` (ignorada por git). Esa carga se borró el 21/09.
- **Neon limpiado de nuevo el 21/09/2026** (pedido de Damian): se borró **toda** la carga del 19/09 (OC, remitos, facturas de venta, cobros, producción) y quedó vacío el movimiento de ventas, cobros, compras, pagos y stock. Se conservan `clientes`, `proveedores` (hoy 0), fichas de transformador y `precios_modelo`, `materias_primas` (hoy 0), `usuarios`, `roles`, `parametros`, `historial_dolar` y las tablas `_vistas_respaldo_*`. Backup: `docs/_backup/neon-datos-antes-de-limpiar-general-2026-09-21.json`. El script de carga inicial del 19/09 no se guardó; los datos de esa carga están en el backup de `neon-datos-antes-de-limpiar-general-…`.
- `migracion-roles.sql` ya corrió en Neon: se borraron `control1` y `test_final`, y los usuarios con rol `empleado` pasaron a `operario`.
- Al agregar una migración nueva: que sea idempotente, fechada, con el "por qué" en el encabezado, sumarla a esta lista y a `estado-migraciones.js`.

## Circuito de ventas (OC de cliente → remitos → factura)

- `ordenes_compra` / `orden_compra_items` = la OC que manda el **cliente** (no una OC a proveedores). Pantallas `oc.html` y `oc_detalle.html`.
- Ítems de la OC: se agregan (`POST`, suma si el modelo se repite), se corrigen (`PUT .../items/:itemId`, fija la cantidad) y se borran (`DELETE`). No se puede bajar por debajo de lo entregado, borrar un ítem con entregas, ni tocar una OC `cerrada`.
- Cada entrega es una fila de `ventas` (con número de remito) + `venta_items`, creadas en una sola transacción; el trigger de stock rechaza entregar más de lo producido.
- **Los remitos se facturan juntos, no uno por uno**: `oc_detalle.html` → "Facturas y pagos" → "Facturar remitos". Una factura = uno o varios remitos de la misma OC; un renglón por modelo; cotización del dólar y precio USD editables, precio ARS calculado o cargado a mano. `POST /api/facturas` con `venta_ids` y `precios`.
- `factura_venta_items` tiene una fila por `venta_item` (índice único → cada ítem se factura una sola vez). `venta_items.precio_unitario_*` es el precio histórico de la entrega y **no** se modifica al facturar.

## Anular facturas, remitos y OC (pantalla Correcciones)

Decisión (21/09/2026): **anular, no borrar**. No hay rol superadmin ni borrado desde la app; el borrado físico de datos sigue siendo por script con backup (como las limpiezas de Neon). La anulación la hace cualquier `admin`.

- Pantalla `correcciones.html` (menú Configuración → Correcciones, solo admin): solapas **Facturas de venta**, **Remitos**, **Órdenes de compra** e **Historial de anulaciones**, cada una con "Anular…". Desde `oc_detalle.html` (tab Facturas y pagos) hay un enlace "Anular…" que abre `correcciones.html?factura=ID`.
- Diálogo de confirmación: muestra qué va a pasar (remitos que vuelven a quedar pendientes de facturar, cobros imputados), pide un **motivo** (≥ 10 caracteres) y que se **tipee el número** de la factura, del remito o de la OC; los errores del servidor salen dentro del diálogo.
- API (`routes/facturas.routes.js`, lógica en `services/anulaciones.js`): `GET /api/facturas`, `GET /api/facturas/:id/anulacion-preview`, `POST /api/facturas/:id/anular` con `{ motivo, confirmar_numero, acciones_cobros: [{ pago_id, accion }] }` (`accion` = `A_CUENTA` por defecto | `ANULAR_COBRO`), `GET /api/facturas/anulaciones`. Una sola transacción; queda una fila en `auditoria_anulaciones` con copia (`snapshot`) de lo tocado.
- Qué hace: la factura pasa a `ANULADA` (`CTE_FACTURAS` la excluye de la deuda); se borran sus `factura_venta_items` (los remitos vuelven a ser facturables); cada cobro imputado queda **a cuenta** del cliente con una nota en `pagos.observaciones` de qué factura venía, o se anula entero. El stock no cambia (se mueve con el remito).
- No se puede anular si la factura tiene notas de crédito (todavía no hay forma de anular una NC), ni anular un cobro con recibo o con cheque endosado a un proveedor. `POST /api/cobros/:id/anular` usa la misma función (`anularCobro`) y ahora rechaza un cobro ya anulado.
- **Remito** (`routes/ventas.routes.js`): `GET|POST /api/ventas/:id/anulacion-preview|anular`. Solo si **no está facturado** (si lo está: anular primero la factura). Se guarda una copia de sus ítems en la auditoría y se **borran los `venta_items`**: el stock (`stock_actual`, `stock_produccion`) y el "entregado" de la OC se calculan de esa tabla, así que vuelven solos. La fila de `ventas` queda con `anulada_en` y **desaparece del listado** `GET /api/ventas` (se ve en el historial). No se puede editar, agregar ítems ni facturar un remito anulado.
- **OC** (`routes/ordenesCompra.routes.js`): `GET|POST /api/ordenes-compra/:id/anulacion-preview|anular`. Solo si **no tiene remitos con entregas ni facturas vigentes**. Pasa a `estado = 'anulada'` (minúscula, como `abierta`/`cerrada`), conserva sus ítems y ya no admite ítems nuevos, edición de ítems, cierre ni entregas.
- `GET /api/facturas/anulaciones` devuelve el historial de las tres entidades (`entidad` = `FACTURA_VENTA` | `REMITO` | `ORDEN_COMPRA`). El número de un remito o de una OC anulados se puede reusar (no hay restricción de unicidad).
- Orden para anular todo un circuito: primero la factura, después los remitos, al final la OC.
- Pendiente: anular recibo y nota de crédito, y reemplazar los `prompt()`/`confirm()` de cobros y pagos a proveedores por diálogos.

## Fichas técnicas: devanados

- Primario y secundario viven en columnas de `ficha_transformador`; las **espiras son texto** (`"422 + 422"` si el secundario tiene punto medio). Los devanados **terciario, cuarto… hasta décimo** (máximo 8 adicionales) viven en `ficha_devanados_extra` (`orden` 3 en adelante, un renglón por devanado: alambre, diámetro, espiras, pines, peso).
- `ficha.html` tiene el botón "Agregar devanado" (cada uno con "Quitar"). El formulario manda la lista como JSON en el campo `devanados_extra`; `POST`/`PUT /api/ficha-transformador` la validan y **reemplazan** los guardados en la misma transacción que la ficha (si el campo no viene en un `PUT`, no se tocan). `GET /api/ficha-transformador/:id` devuelve `devanados_extra`; el listado no.
- Todo lo tipeado se escapa al mostrarlo (`escHtml` en `ficha.js`).

## Seguridad (auditoría del 21/09/2026)

- **El repositorio de GitHub tiene que ser privado.** Estaba público: cualquiera podía leer el código y el historial (que incluye un `.env` viejo de febrero con la clave del Postgres local y la clave por defecto de aquel momento). Nada de datos del negocio ni claves de Neon/Railway llegó a estar en git, pero **no** documentar acá nombres de clientes o proveedores, montos, números de factura ni nombres de usuarios reales. Los datos de trabajo (Excel de cuentas, cotizaciones, backups) van fuera del repo (`.gitignore` los excluye).
- **Fotos subidas (`/uploads`)**: solo se sirven con sesión (las de OC solo para admin) y con cabeceras que impiden ejecutarlas como página. El frontend las pide con el token y las muestra como blob (`cargarImagenProtegida` en `js/api.js`); **no usar `<img src="uploads/...">` directo**. Subida en `middlewares/uploadImagen.js`: solo JPG/PNG/WEBP/GIF (sin SVG), extensión según el tipo, nombre aleatorio, firma real del archivo comprobada, máx. 5 MB.
- **El operario puede escribir texto** en fichas técnicas y observaciones de producción, y el administrador lo ve en muchas pantallas: el servidor rechaza `<` y `>` en esos campos (y comillas dobles, `\` y comilla invertida en los datos cortos), y `ficha.js` escapa lo que muestra con `escHtml`. Al mostrar en pantalla texto que cargó una persona, **escaparlo** siempre.
- La CSP permite scripts en línea (`'unsafe-inline'`) y el token vive en `localStorage`: cualquier XSS roba sesiones. Es deuda conocida; mientras tanto, escapar todo lo que viene de la base.
- Dependencias: `cd backend && npm audit --omit=dev` debe dar 0 vulnerabilidades (revisar antes de cada deploy importante).
- **No pegar contraseñas ni cadenas de conexión en chats.** Para correr algo contra Neon, guardar la URL en `backend/.env.neon` (git la ignora) y borrarla al terminar. Si una clave se pegó en algún lado, rotarla.

## Convenciones

- Estados de entidades en **MAYÚSCULAS** con `CHECK` (excepción pendiente: `ordenes_compra.estado` sigue en minúscula, `'abierta'`/`'cerrada'`).
- Operaciones de varias escrituras: transacción con `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK` + `client.release()`.
- Rutas protegidas con `verificarToken` y `soloAdmin` / `adminYOperario` (`backend/middlewares/auth.js`). Roles: `admin` y `operario` (nada contable para operario).
- Frontend: cada pantalla usa `Shell.montar(...)`, `apiFetch` (`js/api.js`), `Shell.toast/money/fecha/pill/vacio`. Para confirmaciones y datos usar `<dialog class="panel">`, **no** `confirm()`/`prompt()` (quedaban bloqueados en algunos navegadores). Los botones `data-cerrar="<id>"` se cablean en cada página.
- Commits: `tipo(ámbito): descripción` en español (`feat(oc): ...`, `fix(backend): ...`).

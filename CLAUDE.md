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
5. `migracion-roles.sql` (17/09) — ⚠️ además de remapear roles **borra** los usuarios `control1` y `test_final` (confirmado solo para la base local); revisar antes de correrla en Neon.
6. `migracion-seguridad.sql` (17/09) — columnas nuevas de `usuarios` que usa el login actual: sin esta migración el login falla.
7. `migracion-factura-multi-remito.sql` (19/09) — `facturas.orden_compra_id`, `facturas.tipo_cambio`, `factura_venta_items.precio_unitario_usd` y el DEFAULT de `facturas.estado` en `'EMITIDA'` (sin eso no se puede crear ninguna factura de venta).

- Ver qué falta: `cd backend && node scripts/estado-migraciones.js` (solo lectura; hoy chequea las 1-4 y la 7, no la 5 ni la 6).
- Contra Neon (PowerShell): `$env:DATABASE_URL="<url de Neon>"; node scripts/estado-migraciones.js`
- Aplicar: `psql "<url>" -f backend/scripts/<archivo>.sql` (las 5 y 6 usan `\set ON_ERROR_STOP`, requieren `psql`).
- **Antes de migrar Neon:** crear un branch/backup desde la consola de Neon (Branches → Create branch) y, si se puede, probar la migración primero en ese branch.
- Estado al 19/09/2026: base local con las 7 aplicadas; **Neon sin verificar**. El código de la rama `reorganizacion` necesita las 7 en la base a la que apunte.
- Al agregar una migración nueva: que sea idempotente, fechada, con el "por qué" en el encabezado, sumarla a esta lista y a `estado-migraciones.js`.

## Circuito de ventas (OC de cliente → remitos → factura)

- `ordenes_compra` / `orden_compra_items` = la OC que manda el **cliente** (no una OC a proveedores). Pantallas `oc.html` y `oc_detalle.html`.
- Ítems de la OC: se agregan (`POST`, suma si el modelo se repite), se corrigen (`PUT .../items/:itemId`, fija la cantidad) y se borran (`DELETE`). No se puede bajar por debajo de lo entregado, borrar un ítem con entregas, ni tocar una OC `cerrada`.
- Cada entrega es una fila de `ventas` (con número de remito) + `venta_items`, creadas en una sola transacción; el trigger de stock rechaza entregar más de lo producido.
- **Los remitos se facturan juntos, no uno por uno**: `oc_detalle.html` → "Facturas y pagos" → "Facturar remitos". Una factura = uno o varios remitos de la misma OC; un renglón por modelo; cotización del dólar y precio USD editables, precio ARS calculado o cargado a mano. `POST /api/facturas` con `venta_ids` y `precios`.
- `factura_venta_items` tiene una fila por `venta_item` (índice único → cada ítem se factura una sola vez). `venta_items.precio_unitario_*` es el precio histórico de la entrega y **no** se modifica al facturar.

## Convenciones

- Estados de entidades en **MAYÚSCULAS** con `CHECK` (excepción pendiente: `ordenes_compra.estado` sigue en minúscula, `'abierta'`/`'cerrada'`).
- Operaciones de varias escrituras: transacción con `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK` + `client.release()`.
- Rutas protegidas con `verificarToken` y `soloAdmin` / `adminYOperario` (`backend/middlewares/auth.js`). Roles: `admin` y `operario` (nada contable para operario).
- Frontend: cada pantalla usa `Shell.montar(...)`, `apiFetch` (`js/api.js`), `Shell.toast/money/fecha/pill/vacio`. Para confirmaciones y datos usar `<dialog class="panel">`, **no** `confirm()`/`prompt()` (quedaban bloqueados en algunos navegadores). Los botones `data-cerrar="<id>"` se cablean en cada página.
- Commits: `tipo(ámbito): descripción` en español (`feat(oc): ...`, `fix(backend): ...`).

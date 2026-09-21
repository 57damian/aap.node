# Seguridad de autenticación, contraseñas y roles

*Implementado el 17/09/2026. Reemplaza lo que decían sobre login, usuarios, contraseñas y permisos los documentos anteriores (`auditoria-bugs-2026-09-13.md`, hallazgos S1–S10, S7 y L6).*

---

## Los dos roles

| | admin | operario |
|---|---|---|
| Cargar producción | sí | **sí** |
| Ver stock de transformadores | sí | **sí** |
| Ver cantidades de materia prima | sí | **sí** (sin precios) |
| Reporte de producción | sí | no |
| Cobros, pagos, cheques | sí | no |
| Clientes, proveedores, ventas, OC, facturas | sí | no |
| Precios, dólar, stock valorizado | sí | no |
| Ajustes de stock y ABM de materiales | sí | no |
| Usuarios | sí | no |

**El operario nunca ve nada contable.** No es que la pantalla lo esconda: `services/vista-operario.js` borra los campos de precio, variación y proveedor de la respuesta antes de que salga del server. Lo que no se manda no se puede leer con la consola abierta.

El operario trabaja en una sola pantalla, `produccion.html`, que tiene sus pestañas: Registrar producción · Stock de transformadores · **Stock de materia prima** (nueva) · Historial.

### Cómo se llegó acá

Había **cuatro** roles declarados (`admin`, `control`, `operario`, `empleado`) y cada endpoint elegía a mano a quién dejaba pasar: 11 combinaciones distintas repartidas en 20 routers, más un rol `'compras'` que no existía en ninguna parte.

El resultado, medido contra la API con un token real de operario: **podía leer la deuda de todos los clientes, el resumen de cobros, a quién le debíamos, los cheques, los clientes, los proveedores, el stock de materia prima con precios y la cotización del dólar.** El menú no le mostraba esas pantallas, pero la API se las servía igual.

Además estaban cruzados: un `control` no podía cargar producción, y el operario —el que la carga— no podía ver el stock de producto terminado, que sí veía el `empleado`.

Mapeo de los usuarios que había: `empleado` → `operario`, `control` → `admin`. `control1` y `test_final` se borraron (cuentas de prueba que nunca iniciaron sesión). Quedaron los usuarios reales: administradores y operarios.

### Dónde se define

- **`config/roles.js`** — los dos roles y la pantalla inicial de cada uno. Única fuente de verdad.
- **`middlewares/auth.js`** — `soloAdmin` y `adminYOperario`. Ningún router vuelve a escribir una lista de roles a mano.
- **`services/vista-operario.js`** — qué campos no salen del server para un no-admin.
- **`js/shell.js`** (menú nuevo) y **`js/roleGuard.js`** (pantallas viejas) — lo que se dibuja. Es cosmético: quien protege es el backend.

Agregar un módulo nuevo = elegir `soloAdmin` o `adminYOperario` en su router, y una línea en `NAV`.

---

## Cómo funciona ahora, en una página

### Entrar

`POST /api/auth/login` es el único endpoint de entrada. Busca el usuario sin distinguir mayúsculas, compara con bcrypt (costo 12) y devuelve un token JWT que dura lo que diga `JWT_EXPIRES_IN` (8 horas por defecto).

Tres protecciones:

- **Un solo mensaje de error.** Usuario inexistente, usuario desactivado y contraseña incorrecta responden exactamente lo mismo: "Usuario o contraseña incorrectos". Antes, un usuario desactivado respondía "Usuario inactivo", que le confirma a cualquiera que ese nombre existe.
- **Tiempos parejos.** Cuando el usuario no existe igual se ejecuta un `bcrypt.compare` contra un hash de descarte. Sin eso, la respuesta instantánea delata qué nombres existen.
- **Bloqueo por cuenta.** Cinco intentos fallidos seguidos bloquean esa cuenta 15 minutos. Es distinto del límite por IP de `index.js`, que no sirve cuando el ataque viene de muchas IP.

### Restablecer una contraseña

No hay recuperación por email (no hay servidor de correo configurado). El circuito es:

1. El administrador entra a **Usuarios** y toca "Restablecer contraseña".
2. El sistema genera una **contraseña temporal aleatoria** (`crypto`, 12 caracteres) y la muestra **una sola vez**, con botón de copiar.
3. En ese mismo momento: la contraseña anterior deja de servir, **las sesiones abiertas de esa persona se cierran** y la cuenta queda desbloqueada.
4. La persona entra con la temporal. El login no la deja pasar: le pide elegir una nueva ahí mismo.
5. Hasta que no la cambie, **toda la API le responde 403 `PASSWORD_CHANGE_REQUIRED`**. No se puede saltear desde el navegador.

El administrador ya no puede elegir la contraseña de otro. Cuando podía, terminaba poniéndole la misma a todos y quedaba escrita en el cuerpo de la request.

### Si el administrador se queda afuera

Desde la consola de la máquina donde corre el server:

```bash
cd backend
node scripts/reset-admin-password.js <nombre_usuario>
```

Genera una temporal, la muestra una vez y marca el cambio obligatorio. `--listar` muestra los administradores. Antes este script ponía la contraseña en `admin123`, un valor conocido y publicado en el repositorio.

Para una instalación nueva: `node scripts/create-admin.js <nombre_usuario> [email]`.

### Contraseñas

Mínimo **10 caracteres** y no pueden contener el nombre de usuario. No se exigen símbolos ni mayúsculas a propósito: una frase larga y memorable resiste más que `Abc123!`, que termina anotado en un papel. La regla vive en una sola función (`validarPassword`, en `usuarios.routes.js`) y la usan los tres lugares donde se fija una contraseña.

### Sesiones

El token lleva un campo `pwd` con la marca de cuándo se fijó la contraseña con la que se emitió. El middleware la compara contra la base en cada request: si no coinciden, la contraseña cambió después y **ese token murió**. Así, cambiar o restablecer una contraseña expulsa de verdad a quien tuviera la sesión abierta —o el token robado— en vez de esperar 8 horas.

Quien cambia su propia contraseña recibe un token nuevo en la misma respuesta, así que no se autoexpulsa.

---

## Qué se cambió

### Base de datos — `scripts/migracion-seguridad.sql` (aplicada el 17/09)

En `usuarios`: `debe_cambiar_password`, `password_actualizado_en`, `intentos_fallidos`, `bloqueado_hasta`. Más un `CHECK` sobre `rol` (que no existía: la validación era solo de aplicación) y un índice único sobre `lower(nombre_usuario)`.

### Se eliminó la superficie duplicada

`/api/auth` y `/api/usuarios` tenían **las dos** el ABM de usuarios y el cambio de contraseña, con contratos y guardas distintas: uno prohibía la auto-edición y el auto-reset, el otro no. La misma operación era segura o insegura según a qué URL se le pegara.

Ahora **`/api/auth` solo tiene `login` y `verificar`**; todo el resto quedó en `/api/usuarios`, que es el que usa la pantalla. Se borraron unas 190 líneas de `auth.routes.js` (ningún archivo del frontend las llamaba).

También se sacó una **tercera vía sin control**: `PUT /api/usuarios/:id` permitía a un admin escribir el `password_hash` de cualquiera —incluido el suyo— pasando `password` en el body, sin la contraseña actual y sin validar nada. Ese campo ahora se ignora.

### Guardas que no funcionaban

La protección de "no eliminar al último administrador" leía `usuarioActual.rol`, pero la consulta no traía `rol`: era siempre `undefined`, así que **nunca se disparaba** y el sistema se podía quedar sin ningún admin. Corregida, y extendida a `PUT /:id` para que tampoco se pueda dejar sin admin cambiando roles o desactivando.

Nadie puede eliminarse, desactivarse ni cambiarse el rol a sí mismo.

### Exposición a internet

- **CORS**: aceptaba como origen **cualquier** dominio terminado en `.railway.app`. Ahora la lista es explícita y sale de `CORS_ORIGIN` (variable que estaba en el `.env` y no leía nadie).
- **HTTPS**: con `NODE_ENV=production`, redirección de http a https, HSTS de un año y `upgrade-insecure-requests`.
- **Rate limit propio** para el cambio de contraseña, que antes caía en el límite general de 100.
- El rol inexistente `'compras'` estaba en 10 `authorize()` de facturas de compra y pagos a proveedores: nunca podía asignarse, así que era una rama muerta. Pasó a `'control'`.
- El 403 de `authorize()` ya no dice qué roles hacen falta.

### Secretos que se filtraban

- `middlewares/auth.js` imprimía **el token completo** ante un token inválido.
- `db.js` imprimía los primeros 40 caracteres de `DATABASE_URL`, que es justo la parte con usuario y contraseña.
- Se borraron `get-token.js` (tenía `admin/admin123` hardcodeado) y `check-usuarios.js` (volcaba los hashes a consola).
- `create-usuarios-table.js` y `update-usuarios-table.js` sembraban un admin con `admin123`: ya no crean usuarios, indican correr `create-admin.js`.
- Nueve handlers de `usuarios.routes.js` devolvían `err.message` crudo al cliente.

### Frontend

- **Un solo login.** `js/auth.js` enganchaba su propio listener al mismo formulario que `login.html`, así que cada intento disparaba **dos** POST y el de `auth.js` escribía en un `#error` que no existe en esa página. `index.html` era un segundo login: ahora solo redirige.
- El link "¿Olvidaste tu contraseña?" decía "próximamente disponible". Ahora explica el camino real.
- `shell.js` hacía `usuarioActual().rol || 'admin'`: **sin rol, asumía admin** y dibujaba el menú completo.
- `usuarios.html` dejaba entrar a `control`, pero el backend exige `admin`: se veían los botones y todo fallaba con 403 sin explicación.
- **Bug de CSS encontrado al probar**: `styles.css` no tenía regla para `[hidden]`, así que cualquier elemento con `hidden` pero con una clase que fije `display` se seguía viendo. Corregido globalmente.

---

## Cómo verificarlo

Con el server corriendo:

```bash
cd backend
node scripts/verificar-seguridad.js <usuario_admin> <password_admin>
node scripts/verificar-roles.js
```

- **`verificar-seguridad.js`** — 29 chequeos: enumeración de usuarios, tiempos de respuesta, endpoints eliminados, el circuito completo de reset con cambio obligatorio, invalidación de sesiones, bloqueo por intentos y protecciones de administración.
- **`verificar-roles.js`** — 45 chequeos: para cada módulo, que cada rol acceda a lo suyo y reciba 403 en el resto; y que al operario le lleguen las cantidades de stock **sin** precios ni proveedor, mientras el admin los sigue viendo.

Los dos crean usuarios de prueba y los borran al terminar. **Al 17/09 pasan los 74.**

Ojo al correrlos seguidos: el límite por IP del login (10 intentos cada 15 minutos) se agota con tantas pruebas y el segundo script puede fallar con un 429 que no es un problema del sistema. Reiniciar el server limpia ese contador.

Además se probó en el navegador con un operario real: entra directo a Producción, ve solo ese botón en el menú, la pestaña de materia prima muestra cantidades sin precios, y escribir a mano la URL de Cobros o de Stock lo devuelve a Producción.

---

## Lo que queda pendiente

- **`'unsafe-inline'` en la CSP** (`scriptSrc` y `scriptSrcAttr`). Mientras esté, un XSS puede llevarse el token del `localStorage`. Sacarlo exige migrar todos los `onclick=` del HTML a `addEventListener`: conviene hacerlo junto con la migración de pantallas del plan de interfaz.
- **`rejectUnauthorized`** de la base ahora se valida en producción (`DB_SSL_NO_VERIFY=true` lo desactiva si el proveedor usa un certificado propio). Confirmar contra el proveedor real antes de desplegar.
- **La contraseña temporal viaja en la respuesta JSON** del reset. Es inevitable sin email: el administrador tiene que verla para poder pasarla. Va sobre HTTPS, se muestra una vez y no se loguea. Si algún día hay servidor de correo, conviene mandarla por ahí.
- Los usuarios que quedaron siguen con sus contraseñas: la migración no las tocó. Pero **el `JWT_SECRET` cambió**, así que todas las sesiones abiertas se cerraron una vez.
- **`stock.html` (Control de Stock) es del admin.** Tiene ajustes, cotización del dólar, filtro por proveedor y stock valorizado: para un operario quedaba llena de 403 y mostrando "STOCK VALORIZADO $0,00". Por eso el operario consulta las cantidades desde la pestaña de Producción. Cuando esa pantalla se migre al menú nuevo, se puede revisar si conviene una vista de solo lectura ahí.
- **`js/navbar-filter.js` quedó sin uso**: su lógica (esconder botones por `data-roles`) ahora vive en `roleGuard.js`, que sí cargan las 19 pantallas. Se puede borrar en la limpieza.
- `dashboard.js` se cargaba en 9 pantallas que no son el dashboard: pedía los KPI de plata y escribía en elementos que no existen, o sea un `TypeError` y —para un operario— cuatro 403 en la consola por cada carga. Se sacó de todas menos de `dashboard.html`.

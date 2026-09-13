# ERP Transformadores — Resumen general y metodología de trabajo

*Repo: https://github.com/57damian/aap.node (rama de trabajo: `reorganizacion`, base `main`)*
*Última actualización: 13/09/2026*

Este doc es el punto de entrada del proyecto: contexto general, metodología acordada y estado de cada módulo. El detalle técnico de cada módulo (auditoría, bugs, diseño) vive en su propio doc — ver el índice al final. Antes de este reorg, todo estaba en un solo doc largo (`analisis-inicial-y-plan-de-trabajo.md`); ese doc se mantiene como bitácora cronológica de decisiones, pero para trabajar un módulo puntual conviene leer directamente el doc de ese módulo, no la bitácora completa.

## Qué es el proyecto

ERP a medida para un negocio de transformadores. Backend Node.js + Express + PostgreSQL (Neon/Railway), frontend en HTML/CSS/JS vanilla servido desde `backend/public/` (hay un `frontend-react/` iniciado pero no funcional, se ignora por ahora). Módulos: clientes, proveedores, órdenes de compra, ventas, facturación de ventas, facturas de compra, pagos (clientes y proveedores, con cheques y endosos), stock de materias primas y de producto terminado, producción, precios, reportes. Auth con JWT y roles (admin, control, operario, empleado). ~100+ endpoints en `backend/routes/`.

**Importante:** el proyecto es una prueba que nunca pasó a producción — tiene algunos productos cargados pero **no hay información crítica real**. Esto da bastante libertad para reescribir partes, cambiar esquema de BD, etc. sin miedo a romper datos de negocio reales.

## Nota técnica: cómo trabaja Claude en esta etapa

Claude está conectado a la carpeta local del proyecto (lectura, edición y escritura de archivos) y puede editar código y escribirlo directamente en el disco de Damian. Pero **no tiene terminal en la máquina de Damian** (ni por el puente de archivos ni por control de pantalla — las terminales/IDEs solo se pueden controlar en modo "click", sin poder tipear). Por eso git, npm/node, levantar el server y las consultas a la Postgres local las sigue ejecutando Damian, siguiendo los comandos exactos que Claude le pasa. División de trabajo acordada (12/09/2026): Claude escribe y corrige el código, prepara los scripts SQL/Node necesarios, y verifica en vivo por navegador; Damian corre los comandos puntuales (git, levantar/reiniciar el server, correr scripts de diagnóstico/fix); la lógica de negocio se discute en conjunto en el chat.

Para verificación en vivo del frontend, Claude usa directamente la extensión Claude en Chrome (control de click/tipeo/consola/JS sobre una pestaña de Chrome) en vez de pedirle a Damian que pruebe y reporte — esto evitó bastante ida y vuelta confusa cuando se depuró el bug de la pestaña "Movimientos" (ver doc de Stock). Nota práctica: reiniciar el backend a veces también tira abajo el Live Server de VS Code (puerto 5502) que sirve el frontend estático — si una pantalla deja de cargar después de un reinicio, primero chequear si el Live Server sigue vivo.

**Modos de trabajo (acordado 12/09/2026):** para evitar mezclar sin querer depuración de código con definición de lógica de negocio (lo que generó una sesión confusa y circular), se trabaja declarando explícitamente en qué modo se está: **modo debug** (tocar código, probar en vivo) o **modo diseño** (conversación pura, sin tocar código ni navegador, para definir cómo debe comportarse el sistema antes de programarlo). No se cambia de modo sin decirlo.

**Nota sobre acceso a VS Code (12/09/2026):** Damian habilitó el permiso de "control de pantalla" para Visual Studio Code. Aun así, la plataforma restringe IDEs/terminales a modo **"click" únicamente**: Claude puede ver la ventana y hacer clic, pero no puede tipear texto, apretar teclas ni pegar contenido ahí. No cambia la división de trabajo de arriba — Claude sigue editando archivos por el puente de carpeta conectada, y Damian sigue corriendo git/npm/server a mano.

## Metodología de trabajo acordada

1. Trabajar directo en la carpeta local conectada (no en un clon aparte), contra la base Postgres local (`localhost:5432/transformadores`, confirmado activo en `.env`).
2. Antes de tocar nada: crear una rama nueva de git para esta reorganización. **Hecho: rama `reorganizacion`** (creada desde `main`, actualizada con `origin/main`). `main` queda intacta hasta que cada parte esté probada y se pueda mergear.
3. Por cada módulo: auditoría de código (comparar rutas contra el esquema real de BD) → **si la lógica de negocio no está clara o quedó rota por cambios acumulados, primero modo diseño (conversación pura) para definir el comportamiento esperado, revisando de reojo cómo conecta con el módulo siguiente antes de cerrarlo** → recién ahí ajustar/reescribir el código (aprovechando para unificar CSS/diseño visual de esa pantalla) → probar localmente (server + DB local, con Claude verificando en vivo por Chrome) → decidir si se arregla, se reordena o se reescribe esa parte → commitear en la rama de trabajo.
4. Registrar avances y decisiones en el doc del módulo correspondiente (o en este resumen si es una decisión general), no crear más READMEs sueltos en el repo.
5. Pasar al siguiente módulo recién cuando el anterior esté cerrado.

## Decisiones generales del usuario

- **Alcance de la reorganización (12/09/2026)**: reordenar y limpiar es la prioridad, pero está abierto a reescribir partes puntuales que estén muy rotas. Como no hay datos críticos reales, se puede ser más agresivo con cambios de esquema/reescrituras que en un sistema en producción.
- **Dónde trabajar (12/09/2026)**: carpeta local conectada, contra Postgres local.
- **Git (12/09/2026)**: rama `reorganizacion`, ver arriba.
- **División de trabajo (12/09/2026)**: Claude hace el código/DB (scripts, fixes) y la verificación en vivo por navegador, Damian ejecuta comandos puntuales (git, server, diagnósticos), la lógica de negocio se decide en conjunto.
- **Orden de módulos a auditar/arreglar**: **Stock → Producción → Clientes** (por orden de dependencia de datos), luego Ventas/Órdenes de Compra, y por último Facturación/Pagos (que ya tienen documentación y troubleshooting previos en el repo) y Login/seguridad. **Proveedores se adelantó y entró en modo diseño el 13/09/2026** porque salió a la luz con el mismo problema que tenía Stock (ver doc de Proveedores).
- **Método de avance — módulo por módulo, no todo el circuito de una vez (12/09/2026)**: se evaluó diseñar todo el ERP de punta a punta antes de programar nada, contra ir cerrando un módulo a la vez. Se decidió seguir módulo por módulo, agregando una revisión liviana de "costuras" con el módulo siguiente antes de dar por cerrado el diseño de cada uno (ejemplo: la receta por modelo de transformador se identificó al cerrar Stock pero se dejó anotada para resolver al diseñar Producción, en vez de forzarla ahí mismo). Diseñar el circuito completo por adelantado se descartó por el mismo motivo por el que Stock estaba roto: el diseño se desactualiza apenas se empieza a usar el sistema real, y el desfasaje es peor cuanto más grande es el diseño hecho de antemano sin validar.
- **Unificación visual/CSS — incremental, no un rediseño aparte (12/09/2026)**: en vez de un proyecto de rediseño visual separado, cada vez que se entra en modo debug a tocar una pantalla existente, de paso se deja usando un criterio visual único (mismo header, paleta, componentes). En algún momento conviene cargar la hoja de estilos real de Bootstrap (en vez de seguir parchando a mano equivalentes sueltos, como se hizo puntualmente en `stock.html`) y definir ahí un criterio visual único para el resto de las pantallas.

## Hallazgos generales (aplican a todo el sistema, no a un módulo puntual)

1. **Patrón de bugs repetido**: varios errores graves ocurrieron por desincronización entre el código y el esquema real de la BD (columna `usuario`→`nombre_usuario` sin actualizar; FK de `factura_items` apuntando a la tabla equivocada; tabla `entidades` referenciada en Proveedores pero inexistente). Correcciones hechas a mano vía SQL directo, sin migraciones versionadas ni tests automatizados. Ante la duda sobre el esquema real, chequear contra la BD en vez de confiar en la documentación vieja del repo (ver punto siguiente).
2. **`docs/ESQUEMA_BD.md.txt` del repo está desactualizado** (fechado 08/04/2025) — le faltan columnas agregadas después (`facturas_compra.saldo_pendiente`, `fecha_vencimiento`, `cae`, `dolar_historial_id`; `historial_precios_materias.precio_anterior_usd`/`precio_nuevo_usd`) y probablemente más. En el repo local el archivo real se llama `docs/Esquema de Base de Datos.md` y solo cubre el módulo de pagos de clientes.
3. Muchos scripts sueltos `check-*.js`, `fix-*.js`, `test-*.js` en `backend/` y `backend/scripts/` — diagnóstico puntual, no suite repetible. Además tenían un bug propio: no cargaban `.env` (corregido en `backend/db.js` con `require('dotenv').config()`).
4. Seguridad: contraseña admin por defecto `admin123`, `JWT_SECRET` de ejemplo débil en la doc del repo.
5. Duplicación: dos sistemas de auth (`/api/auth` y `/api/usuarios`); dos versiones de `proveedores.html`, y varios `.js` de frontend duplicados/backup (`facturas-compra.js` / `facturas-compra-backup.js` / `facturas-compra-corregido.js`, `pagos-proveedores.js` / `pagos-proveedores-mejorado.js` / `.js.backup`, `proveedores.js` / `proveedores-integrado.js` / `proveedores-nuevo.js` / `.js.bak`). Pendiente de limpieza cuando se llegue a esos módulos.
6. Repo con archivo `mi-proyecto.bundle` (1.1MB, bundle de git con ramas viejas: develop, feature-mejore-precios, ventasyfacturas) — descarte accidental. En GitHub además de `main` existe la rama `pagos-simplificado` (había cambios sin commitear ahí del lado local, se descartaron por decisión de Damian el 12/09).
7. Documentación vieja del repo con tono optimista ("completamente funcional y listo para producción") que no debe tomarse como garantía.
8. **Diseño visual desprolijo y desparejo** entre pantallas: al menos parte del problema es que Bootstrap se carga por CDN solo en su versión JS, sin la hoja de estilos CSS de Bootstrap — así que cualquier pantalla que dependa de clases de Bootstrap para verse bien puede estar mostrando algo roto o inconsistente a medias (confirmado en `stock.html`, corregido puntualmente ahí).
9. **Tablas legacy de una versión anterior del sistema**, casi vacías y candidatas a limpieza (decisión pendiente, probablemente al cerrar Proveedores): `compras`, `compra_items`, `precios_materia_prima`, `productos_stock` (0 filas), vista `stock_materias_primas` (sin uso). Ver doc de Proveedores, pregunta abierta #2, antes de borrar `precios_materia_prima` — podría reactivarse en vez de eliminarse.

## Estado de la documentación por módulo (índice)

| Módulo | Estado | Doc |
|---|---|---|
| Stock — materias primas | Auditado, diseño cerrado e implementado (12-13/09/2026) | `claude/modulo-stock.md` |
| Stock — producto terminado | No tocado, no auditado | `claude/modulo-stock.md` (nota al final) |
| Proveedores | Auditado, en modo diseño — preguntas abiertas, un bug urgente ya corregido (13/09/2026) | `claude/modulo-proveedores.md` |
| Facturas de compra | Motor compartido con Stock/Proveedores (`facturas-compra.routes.js`), ya auditado como parte de esos dos módulos; documentación propia en el repo (`docs/`) marcada como buena | `claude/modulo-facturas-compra.md` |
| Producción | Sin auditar — siguiente en la cola después de Proveedores | `claude/modulo-produccion.md` |
| Clientes | Sin auditar | `claude/modulo-clientes.md` |
| Órdenes de compra | Sin auditar (además, como funcionalidad de negocio, ni siquiera existe todavía — ver doc) | `claude/modulo-ordenes-compra.md` |
| Ventas | Sin auditar | `claude/modulo-ventas.md` |
| Facturación de ventas | Sin auditar por Claude; documentación propia en el repo marcada como buena | `claude/modulo-facturacion-ventas.md` |
| Pagos (clientes y proveedores, cheques, endosos) | Sin auditar en general; el lado de pagos a proveedores ya salió a la luz con bugs serios durante la auditoría de Proveedores | `claude/modulo-pagos.md` |
| Precios | Precios de materias primas cubierto dentro de Stock/Proveedores; precios de venta sin auditar | `claude/modulo-precios.md` |
| Reportes | Sin auditar | `claude/modulo-reportes.md` |
| Login / seguridad | Sin auditar (prioridad baja, al final de la cola) | — (ver hallazgo general #4 arriba) |

## Próximos pasos generales

1. Definir en el chat las preguntas de diseño abiertas de Proveedores (ver `claude/modulo-proveedores.md`).
2. Con eso decidido, pasar a modo debug para Proveedores.
3. Pendientes menores de Stock: confirmar que Damian corrió los `git rm` de 3 archivos muertos (`stock-movimientos.js`, `auth.controller.js`, `clientes.controller.js`) y comitear los cambios de Stock en la rama `reorganizacion`; opcionalmente borrar la factura de prueba `TEST-CLAUDE-0003` (id 31).
4. Después de Proveedores, seguir con **Producción**, empezando por la receta/lista de materiales por modelo de transformador (anotada al cerrar Stock, ver `claude/modulo-produccion.md`).

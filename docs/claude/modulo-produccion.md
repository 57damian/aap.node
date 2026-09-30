# Módulo: Producción

*Última actualización: 30/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditar en general.** Siguiente módulo en la cola después de Proveedores (orden acordado: Stock → Producción → Clientes → Ventas/Órdenes de compra → Facturación/Pagos → Login) — salvo la funcionalidad de "Consumo de materiales" de abajo, diseñada e implementada puntualmente el 30/09/2026 a pedido de Damian, sin esperar a esa auditoría general.

## Puntos de entrada ya anotados desde otros módulos (para no perderlos al empezar la auditoría)

- **Receta / lista de materiales (BOM) por modelo de transformador**: identificada al cerrar el diseño de Stock, todavía **no implementada** (ver "A futuro" en la sección de abajo). La idea es poder definir, por modelo de transformador, qué materiales y en qué cantidad lleva, para poder proyectar necesidad de material ante un pedido de N unidades (ej. cuánto alambre/carreteles hacen falta) y para pre-completar la carga manual de consumo. Ver `claude/modulo-stock.md`, sección "Salida de stock".
- **Stock de producto terminado**: no auditado todavía (a diferencia del de materia prima, que ya se cerró en Stock). Probablemente entra acá, ya que es donde se generan los transformadores terminados que pasan a ese stock. Ver `claude/modulo-stock.md`, nota final.

## Pendiente

Auditoría de código general todavía no arrancada: falta comparar rutas de producción contra el esquema real de BD, entender el modelo de datos actual y decidir si hace falta modo diseño antes de tocar código, siguiendo la metodología general (ver `claude/00-resumen-y-metodologia.md`).

## Consumo de materiales por producción (30/09/2026)

Pedido de Damian: poder ir descontando materia prima a medida que se produce,
distinguiendo lo **usado** (entró al producto) de lo **desperdiciado**
(carreteles rotos, bobinados cortados, o un rollo que en la práctica quedó
vacío aunque la cuenta diga que debería sobrar algo) — sin depender de una
receta/BOM por modelo, que todavía no existe. También quería ver el consumo
por cada carga de producción, para evaluar mejor las compras.

**Decisión de terminología**: "pedido" en el pedido original de Damian se
resolvió como **cada carga de Producción** (una fila de `produccion`: tal
modelo, tal cantidad, tal fecha) — no la OC del cliente (`ordenes_compra`),
que hoy no tiene ningún vínculo con producción en la base. En la UI y en el
código se usa "carga de producción"/"lote de producción", nunca "pedido",
para no confundirla con la OC.

**Sin trazabilidad por rollo/lote individual comprado** — se sigue llevando
stock agregado por material, como en Stock. El caso "el rollo quedó vacío"
se resuelve con "Vaciar resto" (abajo), una corrección de merma sobre ese
agregado, no con una tabla de lotes nueva.

**El operario carga uso y merma libremente**, sin aprobación de un admin —
mismo criterio que ya tenía el sistema para la cantidad producida (decisión
explícita con Damian, no un efecto colateral). Queda trazado (usuario,
observaciones, a qué carga de producción pertenece) para revisión posterior
vía el informe agregado (admin).

### Diseño

- **Migración `migracion-consumo-materiales-produccion.sql`** (18 en
  `CLAUDE.md`): `stock_movimientos.produccion_id` (`ON DELETE RESTRICT`,
  nunca `SET NULL` — una producción no se borra directo, se anula, ver
  abajo), un índice simple sobre esa columna y uno compuesto
  `(fecha_movimiento, materia_prima_id, tipo_movimiento) WHERE produccion_id
  IS NOT NULL` para el informe agregado; y `produccion.anulada_en/anulada_por/
  motivo_anulacion` (mismo patrón que facturas/remitos/OC). También redefine
  la vista `stock_produccion` (antes en `scripts/fix-stock-system.js`)
  agregando `AND p.anulada_en IS NULL` al `LEFT JOIN produccion` — sin esto,
  una producción anulada seguía contando como stock de producto terminado
  aunque su material ya se hubiera revertido.
- **`backend/services/stock-movimientos.js`** (nuevo): extrae la lógica que
  antes vivía inline en `POST /api/stock/ajuste` — `aplicarMovimientoStock(client,
  { materiaPrimaId, tipoMovimiento, delta, observaciones, usuarioId,
  fechaMovimiento, produccionId })` hace el `SELECT ... FOR UPDATE`, valida
  tipo y stock no negativo, inserta el movimiento y actualiza
  `stock_actual`. **Es la fuente de verdad para cualquier movimiento de
  stock nuevo** — tanto el Ajuste manual de Stock como el consumo de
  Producción y la reversión por anulación pasan por acá, en vez de duplicar
  la lógica de lock+validar+insertar. `stock_movimientos.cantidad` se
  guarda **con signo** (negativo para SALIDA/MERMA) — verificado contra el
  código real antes de tocarlo, no asumido.
- **`POST /api/produccion`** acepta un array opcional `materiales:
  [{ materia_prima_id, cantidad_usada, cantidad_desperdiciada, observaciones
  }]`. Se valida todo (`validarMateriales()` en `produccion.routes.js`)
  antes de abrir transacción: cantidades finitas ≥ 0 (nunca se "arreglan"
  negativos con `Math.abs()`, eso ocultaría un error de carga real), sin
  `materia_prima_id` repetido, al menos una cantidad > 0 por fila, sin `<`/`>`
  en observaciones. El array se ordena por `materia_prima_id` ascendente
  antes de procesarlo, para que dos cargas concurrentes que comparten
  materiales pidan los locks (`FOR UPDATE`) siempre en el mismo orden global
  y no haya deadlock. Dentro de la transacción: por cada material, `SALIDA`
  si `cantidad_usada > 0` y/o `MERMA` si `cantidad_desperdiciada > 0`, ambos
  con `produccion_id` = la carga recién insertada y fechados con
  `fecha_produccion` del lote (no la fecha de hoy). Si falta stock de algún
  material, se hace `ROLLBACK` de todo — incluida la fila de `produccion` —
  nunca queda una carga a medio cargar.
- **Anulación de producción** (`services/anulaciones.js`,
  `vistaPreviaAnulacionProduccion`/`anularProduccion`, mismo patrón que
  facturas/remitos/OC — ver "Anular facturas, remitos y OC" en `CLAUDE.md`):
  no hay "editar" una carga, para corregir un error se anula y se vuelve a
  cargar bien. `POST /api/produccion/:id/anular` (solo admin, motivo ≥ 10
  caracteres + confirmar el número de la carga) genera, por cada movimiento
  original ligado a esa `produccion_id`, un `AJUSTE` de signo contrario que
  devuelve el material a stock, y marca la carga como anulada (no la borra:
  el historial completo — carga original + reversión — queda para
  auditoría en `auditoria_anulaciones`, `entidad = 'PRODUCCION'`).
  `GET /:id/anulacion-preview` muestra qué va a volver antes de confirmar.
  Todo lo que suma `produccion.cantidad` (la vista `stock_produccion`,
  `GET /api/produccion/reporte`, el listado `GET /api/produccion`) excluye
  `anulada_en IS NOT NULL`.
- **Informe de consumo**: `GET /api/produccion/:id/materiales` (detalle de
  una carga puntual, `adminYOperario`, columnas sin precio) y
  `GET /api/produccion/materiales-informe?desde&hasta&ficha_id&materia_prima_id`
  (agregado por material, solo admin, con `% merma = desperdiciado /
  (usado + desperdiciado)`). El agregado **siempre filtra
  `sm.produccion_id IS NOT NULL`** y excluye producciones anuladas — así una
  merma manual cargada desde el botón "Vaciar" de Stock (ver
  `claude/modulo-stock.md`) nunca contamina este informe, que es
  específicamente sobre consumo de producción. Tiene versión PDF
  (`/materiales-informe/pdf`) con `generarPdfReporte` (`claude/modulo-reportes.md`).
  **Fuera de alcance de esta entrega**: cruzar este informe con las entradas
  de compra y su costo, para pasar de "cuánto consumí" a "cuánto debería
  comprar" — queda anotado para cuando se diseñe esa vista.

### Frontend (`produccion.html`/`produccion.js`)

- Formulario "Registrar": sección "Material consumido" (opcional), filas
  dinámicas "+ Agregar material" (mismo patrón que `oc.js`), poblada desde
  `GET /api/stock` (no `/api/materias-primas`, que es solo admin). Botón
  "Vaciar resto" por fila: precarga `cantidad_desperdiciada = stock
  conocido - usado` (clamp en 0) para el caso "el rollo se terminó justo en
  esta tanda" — y sí queda con `produccion_id`, por eso entra en el informe
  (a diferencia del "Vaciar" de Stock, que es un ajuste suelto). Si se
  cambia la cantidad usada después de tocar "Vaciar resto", el desperdicio
  se recalcula solo.
- Tab "Historial": columna "Acciones" con "Ver consumo" (abre un `<dialog>`
  con el detalle de `GET /:id/materiales`) y "Anular" (solo admin, abre un
  `<dialog>` con el preview, motivo y confirmación del número — mismo
  patrón que `correcciones.js`).
- Tab nueva "Consumo de materiales" (solo admin): filtros desde/hasta/
  modelo/material, tabla con usado/desperdiciado/% merma, exportar CSV y
  PDF (`verArchivoProtegido`).

### A futuro (no implementado en esta entrega)

Tabla `ficha_materiales` (receta/BOM: `ficha_id, materia_prima_id,
cantidad_por_unidad, unidad`) — cuando se vaya cargando, el formulario de
alta de Producción podría pre-completar "Material consumido" con
`cantidad_por_unidad × cantidad_producida` por cada material de la receta,
dejando solo ajustar la merma real. No cambia nada de lo construido acá,
solo ahorraría tipeo cuando exista.

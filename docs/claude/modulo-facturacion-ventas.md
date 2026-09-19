# Módulo: Facturación de ventas

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditar por Claude.** Marcado en el análisis inicial como uno de los módulos "bien documentados" en la documentación propia del repo (carpeta `docs/`). Va al final de la cola junto con Pagos, justamente porque ya tiene documentación y troubleshooting previo — pero esa documentación no fue verificada todavía contra el esquema real de la BD, y ya se confirmó que al menos el doc de esquema general (`docs/ESQUEMA_BD.md.txt`) está desactualizado (ver hallazgo general #2 en el resumen), así que no debería asumirse que este módulo está libre de los mismos problemas encontrados en Stock/Proveedores hasta auditarlo.

## Circuito actual: una factura para varios remitos (19/09/2026)

- Los remitos (entregas parciales o totales) de una OC **no se facturan uno por uno**: desde `oc_detalle.html` → pestaña "Facturas y pagos" → **Facturar remitos** se elige qué remitos pendientes entran y se emite **una sola factura**.
- La factura muestra **un renglón por modelo** (suma de los remitos). El precio se ajusta al facturar: cotización del dólar (por defecto la de hoy) + precio USD por modelo (por defecto el de lista actual); el precio ARS se calcula solo y se puede escribir a mano.
- `POST /api/facturas` recibe `venta_ids` (sigue aceptando `venta_id`) y `precios` opcionales. Guarda una fila de `factura_venta_items` **por venta_item** (así las notas de crédito siguen sabiendo de qué remito salió cada unidad) y deja `venta_items` sin tocar, como valor histórico de la entrega.
- `facturas.orden_compra_id` y `facturas.tipo_cambio` (migración `migracion-factura-multi-remito.sql`) → el resumen de la OC calcula facturado/cobrado sobre las facturas reales de esa OC (se resolvió la aproximación "por cliente" de D1).
- La misma migración corrige el DEFAULT de `facturas.estado` (`'emitida'` → `'EMITIDA'`): con el CHECK de `migracion-facturacion-ventas.sql`, crear cualquier factura de venta fallaba.
- `venta_detalle.html`: si la venta tiene OC, el botón lleva a la OC para facturar (`oc_detalle.html?id=..&tab=facturas`).

## Pendiente

Auditoría de código todavía no arrancada — cuando se llegue a este módulo, empezar releyendo la documentación existente en `docs/` del repo pero verificando cada afirmación contra el esquema real de la BD, siguiendo la misma metodología que en Stock y Proveedores.

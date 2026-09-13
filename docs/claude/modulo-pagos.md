# Módulo: Pagos (clientes y proveedores, cheques, endosos)

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditoría dedicada todavía, pero el lado de pagos a proveedores ya salió a la luz con bugs serios durante la auditoría de Proveedores.** Marcado en el análisis inicial como uno de los módulos "bien documentados" en la doc propia del repo — igual que con Facturación de ventas, esa doc no fue verificada contra el esquema real y ya se sabe que al menos parte del sistema de pagos a proveedores está roto.

## Lo ya confirmado (pagos a proveedores, vía auditoría de Proveedores — 13/09/2026)

Ver detalle completo en `claude/modulo-proveedores.md`, bug 3 y preguntas abiertas #3 y #4. Resumen:

- Dos convenciones de `estado` incompatibles entre `pagos_proveedores` (lee `'CONFIRMADO'`) y `pagos.routes.js` (escribe `'pendiente'`/`'aplicado'`) — un pago cargado nunca se refleja como reducción de deuda.
- La consulta de cheques de `pagos.routes.js` (líneas ~142-385) joinea `pago_items.pago_id` contra `pagos_proveedores.id`, pero la FK real de `pago_items.pago_id` apunta a `pagos` (tabla de pagos de **clientes**) — puede devolver cheques de clientes mostrados como si fueran de un proveedor.
- Hay tres campos de "cuánto se pagó" (`facturas_compra.neto_pagado`, `facturas_compra.saldo_pendiente`, agregado de `pagos_proveedores`) y ninguno funciona de forma confiable — hay que decidir cuál es la fuente de verdad antes de arreglar nada acá.
- `pagos_proveedores` es una tabla plana, sin campos estructurados de cheque (número, banco, fecha de cobro) como sí tiene el sistema de pagos de **clientes** (`pago_items`) — pregunta abierta sobre si conviene estructurarlo igual, incluyendo la posibilidad de endosar un cheque recibido de un cliente directamente a un proveedor (`endosos_cheques` existe a medias, mal conectado a los pagos reales).
- `pagos_proveedores` está vacía (0 filas) en la instalación de prueba — los bugs de arriba son de código, no se pudieron observar todavía con datos reales cargados.

## Lo que falta auditar

- El lado de **pagos de clientes** (incluyendo cheques recibidos y endosos) no se tocó todavía — solo se lo menciona como referencia de "sistema con más detalle estructurado" al comparar con pagos a proveedores. Falta auditoría propia.
- Notas de crédito: mencionadas en el análisis inicial como módulo sin documentar, sin ningún detalle relevado todavía.

## Pendiente

Auditoría de código dedicada todavía no arrancada (más allá de lo que salió de rebote en Proveedores). Cuando se llegue a este módulo, resolver primero la pregunta abierta #4 de Proveedores (fuente de verdad de la deuda) porque pagos depende directamente de eso.

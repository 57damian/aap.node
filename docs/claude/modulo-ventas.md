# Módulo: Ventas

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditar.** En la cola después de Clientes, junto con Órdenes de compra.

## Nota de esquema a tener en cuenta

- La tabla `facturas` (ventas) fue mencionada en la auditoría de Stock: la FK de `factura_items.factura_id` estaba apuntando por error a `facturas` en vez de a `facturas_compra` — ya corregida (ver `claude/modulo-stock.md`, bug 7). No implica un bug en Ventas en sí, pero conviene tenerlo presente porque son tablas con nombres parecidos (`facturas` = ventas, `facturas_compra` = compras) y ya generaron confusión una vez en el código.

## Pendiente

Auditoría de código todavía no arrancada.

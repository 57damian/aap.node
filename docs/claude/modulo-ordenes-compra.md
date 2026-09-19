# Módulo: Órdenes de compra

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditar y, como funcionalidad de negocio, probablemente ni siquiera implementada todavía.**

## Qué se sabe hasta ahora

- La idea de "orden de compra" (documento para mandarle al proveedor lo que se necesita, con el último precio conocido, sin que tenga que coincidir con lo que termine facturando) quedó anotada como pendiente tanto al cerrar Stock como durante la auditoría de Proveedores — no se confirmó todavía si existe código/tablas para esto en el repo.
- Probablemente se diseñe junto con la pregunta abierta #2 de Proveedores (catálogo proveedor↔materia prima): si ese catálogo existe, la orden de compra se arma sola desde ahí. Ver `claude/modulo-proveedores.md`, pregunta abierta #5.

## OC de clientes (`ordenes_compra`, `oc.html` / `oc_detalle.html`) — 19/09/2026

Ojo: lo que existe en el código con el nombre `ordenes_compra` es la **OC que manda el cliente** (no la OC a proveedores de arriba). Circuito: se cargan los ítems → se entrega en uno o varios remitos (`ventas`) → se factura todo junto (ver `modulo-facturacion-ventas.md`).

- Los ítems se pueden **corregir** (`PUT /api/ordenes-compra/:id/items/:itemId`, fija la cantidad) y **borrar** (`DELETE`). No se puede bajar la cantidad por debajo de lo ya entregado, ni borrar un ítem con entregas, ni tocar una OC cerrada. Para cambiar de modelo: borrar y volver a agregar.

## Pendiente

Confirmar si existe algo de código/esquema para esto antes de auditar (podría ser un módulo a diseñar desde cero más que a "arreglar").

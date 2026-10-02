# Módulo: Órdenes de compra

*Última actualización: 02/10/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditar y, como funcionalidad de negocio, probablemente ni siquiera implementada todavía.**

## Qué se sabe hasta ahora

- La idea de "orden de compra" (documento para mandarle al proveedor lo que se necesita, con el último precio conocido, sin que tenga que coincidir con lo que termine facturando) quedó anotada como pendiente tanto al cerrar Stock como durante la auditoría de Proveedores — no se confirmó todavía si existe código/tablas para esto en el repo.
- Probablemente se diseñe junto con la pregunta abierta #2 de Proveedores (catálogo proveedor↔materia prima): si ese catálogo existe, la orden de compra se arma sola desde ahí. Ver `claude/modulo-proveedores.md`, pregunta abierta #5.

## OC de clientes (`ordenes_compra`, `oc.html` / `oc_detalle.html`) — 19/09/2026

Ojo: lo que existe en el código con el nombre `ordenes_compra` es la **OC que manda el cliente** (no la OC a proveedores de arriba). Circuito: se cargan los ítems → se entrega en uno o varios remitos (`ventas`) → se factura todo junto (ver `modulo-facturacion-ventas.md`).

- Los ítems se pueden **corregir** (`PUT /api/ordenes-compra/:id/items/:itemId`, fija la cantidad) y **borrar** (`DELETE`). No se puede bajar la cantidad por debajo de lo ya entregado, ni borrar un ítem con entregas, ni tocar una OC cerrada. Para cambiar de modelo: borrar y volver a agregar.

### Listado de OC: filtros y clic en la fila (02/10/2026)

- `oc.html` oculta por defecto las OC **anuladas** y las **completas**; se ven tildando "Mostrar anuladas" / "Mostrar completas". Un aviso indica cuántas quedan ocultas. Filtrado client-side sobre `GET /api/ordenes-compra` (sin cambios de API ni migración; `correcciones.html` sigue mostrando todas).
- Estado del listado, derivado en `estadoListaOC()` (`js/oc.js`): ANULADA (`estado = 'anulada'`), COMPLETA (`estado = 'cerrada'` o `entregado >= pedido` con `pedido > 0`), PARCIAL (hay entregas pero falta) y ABIERTA (sin entregas). "Completa" es solo de entrega: una OC completa puede tener facturas o cobros pendientes.
- El detalle se abre **haciendo clic sobre la fila** (también Enter/Espacio); ya no hay botón "Ver". El link de Remitos sigue yendo a la pestaña "Facturas y pagos".

## Pedidos a proveedores (22/09/2026)

Implementado, separado de `ordenes_compra` de arriba: es la "orden de compra" que quedó pendiente en la sección anterior, con el nombre "pedido a proveedor" para no confundirla con la del cliente. Ver detalle en el CLAUDE.md raíz ("Pedidos a proveedores") y en `claude/modulo-proveedores.md` (pregunta abierta #5, ahora resuelta).

## Pendiente

Sin auditar todavía el resto de este módulo (más allá de lo de arriba).

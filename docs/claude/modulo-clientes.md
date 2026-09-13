# Módulo: Clientes

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditar.** En la cola después de Producción (orden acordado: Stock → Producción → Clientes → Ventas/Órdenes de compra → Facturación/Pagos → Login).

## Lo que ya se sabe (de pasada, sin auditoría dedicada)

- Existe un `clientes.controller.js` que quedó identificado como archivo muerto durante la limpieza de Stock (pendiente que Damian confirme el `git rm`) — no confundir con el/los archivo(s) de rutas activos de Clientes, que no se auditaron todavía. Ver `claude/modulo-stock.md`, sección "Pendientes menores".
- El sistema de pagos de clientes (`pago_items`, con detalle estructurado de cheques) aparece mencionado como referencia de "cómo se ve un sistema de pagos con más detalle" al comparar con el de pagos a proveedores, que es más pobre. Ver `claude/modulo-pagos.md` y `claude/modulo-proveedores.md` (pregunta abierta #3).

## Pendiente

Auditoría de código todavía no arrancada.

# Módulo: Facturas de compra

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: motor compartido, ya auditado indirectamente como parte de Stock y Proveedores.** No tiene un módulo/pantalla propia separada — es el mismo circuito (`facturas_compra` + `factura_items`, alimentadas por `backend/routes/facturas-compra.routes.js`) que usan tanto Stock (ingreso de materia prima) como Proveedores (deuda y pagos). La documentación original del repo (`docs/`) marca este módulo como "bien documentado", pero esa doc es la que resultó desactualizada en el esquema (ver hallazgo general #2 en el resumen).

## Lo que ya se sabe de este motor

- Es sólido en general — fue el mismo código auditado y corregido durante Stock (ver `claude/modulo-stock.md`): FK de `factura_items` corregida, trazabilidad de stock (`stock_anterior`/`stock_nuevo`) completada, comparación de precio por proveedor implementada, cotización de dólar por factura (`dolar_historial_id` → `historial_dolar`) implementada.
- `facturas_compra` tiene `saldo_pendiente`, `fecha_vencimiento`, `cae`, `dolar_historial_id` (confirmado contra la base real 13/09, la doc vieja del repo no las tenía).
- **Bug pendiente (bajo prioridad)**: `DELETE /api/facturas-compra/:id` falla si la factura generó registros en `historial_precios_materias` (no los borra/desvincula antes de borrar la factura). Ver `claude/modulo-stock.md`, sección "Bug encontrado, no corregido todavía".
- **Bug pendiente (parte del módulo Proveedores)**: `facturas-compra.routes.js` nunca inicializa `saldo_pendiente` al crear la factura, lo cual es una de las tres causas de que la deuda a proveedores no se calcule bien. Ver `claude/modulo-proveedores.md`, bug 3 y pregunta abierta #4.

## Pendiente

No se hizo una auditoría dedicada de este módulo como tal (más allá de lo que salió al auditar Stock y Proveedores) — no está en la cola como módulo separado porque se considera cubierto por esos dos. Si aparecen bugs nuevos acá que no sean de Stock ni de Proveedores específicamente, anotarlos en este doc.

# Módulo: Producción

*Última actualización: 13/09/2026 — Ver `claude/00-resumen-y-metodologia.md` para contexto general del proyecto.*

**Estado: sin auditar.** Siguiente módulo en la cola después de Proveedores (orden acordado: Stock → Producción → Clientes → Ventas/Órdenes de compra → Facturación/Pagos → Login).

## Puntos de entrada ya anotados desde otros módulos (para no perderlos al empezar la auditoría)

- **Receta / lista de materiales (BOM) por modelo de transformador**: identificada al cerrar el diseño de Stock. Hoy el consumo de materia prima para producción es manual (un operario carga cuánto se usó, sin automatizar por receta). La idea es poder definir, por modelo de transformador, qué materiales y en qué cantidad lleva, para poder proyectar necesidad de material ante un pedido de N unidades (ej. cuánto alambre/carreteles hacen falta). Ver `claude/modulo-stock.md`, sección "Salida de stock".
- **Stock de producto terminado**: no auditado todavía (a diferencia del de materia prima, que ya se cerró en Stock). Probablemente entra acá, ya que es donde se generan los transformadores terminados que pasan a ese stock. Ver `claude/modulo-stock.md`, nota final.

## Pendiente

Auditoría de código todavía no arrancada: falta comparar rutas de producción contra el esquema real de BD, entender el modelo de datos actual (si existe) y decidir si hace falta modo diseño antes de tocar código, siguiendo la metodología general (ver `claude/00-resumen-y-metodologia.md`).

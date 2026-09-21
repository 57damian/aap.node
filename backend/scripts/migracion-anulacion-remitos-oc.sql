-- =====================================================================
-- Migración: anular remitos y órdenes de compra (21/09/2026)
-- =====================================================================
-- Por qué: igual que con las facturas de venta (migracion-anulacion-facturas.sql),
-- un remito o una OC cargados por error no se podían anular desde el sistema.
--
-- Qué agrega: las columnas anulada_en / anulada_por / motivo_anulacion en
-- `ventas` (los remitos) y en `ordenes_compra`, para verlo sin abrir la
-- auditoría. El registro de cada anulación (quién, cuándo, por qué y una
-- copia de lo anulado) va en la tabla auditoria_anulaciones.
--
-- Requiere haber corrido antes migracion-anulacion-facturas.sql (crea
-- auditoria_anulaciones).
--
-- Cómo se anula:
--   * Remito: se guarda una copia de sus ítems en la auditoría y se borran de
--     venta_items (el stock y el "entregado" de la OC salen de esa tabla, así
--     que vuelven solos). La fila de ventas queda marcada como anulada.
--   * OC: pasa a estado 'anulada' (minúscula, como 'abierta' y 'cerrada').
--     Solo si no tiene remitos con entregas ni facturas vigentes.
--
-- Es idempotente.

BEGIN;

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS anulada_en       timestamptz;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS anulada_por      integer;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS motivo_anulacion text;

ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS anulada_en       timestamptz;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS anulada_por      integer;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS motivo_anulacion text;

COMMIT;

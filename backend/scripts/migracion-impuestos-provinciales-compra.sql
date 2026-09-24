-- =====================================================================
-- Migración: impuestos provinciales en facturas de compra (24/09/2026)
-- =====================================================================
-- Por qué: algunos proveedores agregan impuestos provinciales a la
-- factura, y el monto varía según el proveedor (no es un porcentaje fijo
-- del sistema). Se carga a mano por factura, igual que ya se hace con
-- `percepciones` (que también se suma al total) y `retenciones` (que se
-- resta): mismo patrón, columna nueva.
--
-- Es idempotente.

BEGIN;

ALTER TABLE facturas_compra ADD COLUMN IF NOT EXISTS impuestos_provinciales NUMERIC(15,2) DEFAULT 0;

COMMIT;

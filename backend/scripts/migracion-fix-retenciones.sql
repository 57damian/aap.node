-- =====================================================================
-- Migración: permitir RETENCION como forma de cobro (19/09/2026)
-- =====================================================================
-- Por qué: migracion-cobros.sql recreó el CHECK `pago_items_tipo_chk` con
-- el tipo RETENCION, pero dejó vivo el CHECK original `pago_items_tipo_check`
-- (auto-nombrado al crear la tabla), que solo admite
-- EFECTIVO / CHEQUE / TRANSFERENCIA / OTRO. Como una fila tiene que cumplir
-- los dos, cualquier INSERT de una retención fallaba: no se podía registrar
-- ninguna retención desde Cobros (ni en local ni en producción).
--
-- Se elimina el viejo; `pago_items_tipo_chk` (EFECTIVO, TRANSFERENCIA,
-- CHEQUE, RETENCION) queda como única regla. 'OTRO' deja de existir como
-- forma de cobro (el código de cobros.routes.js tampoco lo admite).
--
-- Es idempotente.

BEGIN;

ALTER TABLE pago_items DROP CONSTRAINT IF EXISTS pago_items_tipo_check;

COMMIT;

-- =====================================================================
-- Migración: una imputación por forma de cobro y factura (25/10/2026)
--
-- Por qué: `aplicacion_pagos` nació con UNIQUE (pago_id, factura_id) (un
-- cobro, una fila por factura). `migracion-cobros.sql` pasó la imputación a
-- nivel de forma de cobro (`pago_item_id`) pero no sacó ese UNIQUE. Resultado:
-- al registrar un cobro con 2 o más formas (p. ej. cheque + efectivo +
-- retención) imputado a una misma factura, el motor de imputación inserta una
-- fila por forma con el mismo (pago_id, factura_id) y Postgres rechaza el
-- cobro con
--   duplicate key value violates unique constraint
--   "aplicacion_pagos_pago_id_factura_id_key".
--
-- Qué hace: reemplaza ese UNIQUE por UNIQUE (pago_item_id, factura_id): una
-- forma de cobro tiene como máximo una fila por factura, que es lo que el
-- motor genera. No toca datos (el índice nuevo es más permisivo que el viejo,
-- así que no puede fallar por filas existentes).
--
-- Es idempotente: se puede correr más de una vez.
-- =====================================================================

BEGIN;

ALTER TABLE aplicacion_pagos DROP CONSTRAINT IF EXISTS aplicacion_pagos_pago_id_factura_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_aplicacion_pagos_item_factura
  ON aplicacion_pagos (pago_item_id, factura_id);

COMMIT;

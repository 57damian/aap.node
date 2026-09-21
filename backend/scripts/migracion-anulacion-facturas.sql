-- =====================================================================
-- Migración: anular facturas de venta (21/09/2026)
-- =====================================================================
-- Por qué: hasta ahora una factura de venta mal cargada (precio, fecha,
-- número) no se podía anular ni borrar desde el sistema, y borrarla a mano
-- de la base arrastra en silencio sus imputaciones de cobro
-- (aplicacion_pagos.factura_id es ON DELETE CASCADE) y no deja rastro de
-- quién lo hizo.
--
-- Qué agrega:
--   1. auditoria_anulaciones: registro de cada anulación (quién, cuándo,
--      por qué) con una copia (snapshot) de lo que se tocó, por si hay que
--      reconstruirlo. No existía ninguna tabla de auditoría.
--   2. facturas.anulada_en / anulada_por / motivo_anulacion: para verlo sin
--      abrir la auditoría.
--   3. Número de factura reusable: el UNIQUE global unique_numero_factura
--      se reemplaza por un índice único parcial que ignora las ANULADAS. El
--      número viene de ARCA y se tipea a mano: si el precio o la fecha
--      estaban mal, se anula y se vuelve a cargar con el mismo número.
--
-- Es idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS auditoria_anulaciones (
  id              serial PRIMARY KEY,
  entidad         varchar(30)  NOT NULL,            -- 'FACTURA_VENTA'
  entidad_id      integer      NOT NULL,
  numero          varchar(60),
  motivo          text         NOT NULL,
  usuario_id      integer,
  usuario_nombre  varchar(100),
  snapshot        jsonb        NOT NULL DEFAULT '{}'::jsonb,
  creado_en       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_anulaciones_entidad
  ON auditoria_anulaciones (entidad, entidad_id);

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS anulada_en       timestamptz;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS anulada_por      integer;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_anulacion text;

-- unique_numero_factura es un UNIQUE (constraint + índice del mismo nombre).
ALTER TABLE facturas DROP CONSTRAINT IF EXISTS unique_numero_factura;
DROP INDEX IF EXISTS unique_numero_factura;

CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_numero_vigente
  ON facturas (numero_factura)
  WHERE COALESCE(estado, 'EMITIDA') <> 'ANULADA';

COMMIT;

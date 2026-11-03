-- =====================================================================
-- Migración: tareas y notas informales del panel (03/11/2026)
--
-- Por qué: el administrador quiere anotar pendientes del día a día de la
-- empresa (llamar a un cliente, revisar un cheque, una nota suelta) en la
-- pantalla de inicio, tildarlos cuando se hacen y dejar fijadas las que no
-- quiere perder de vista. No mueven plata ni stock: son anotaciones.
--
-- Qué crea:
--   * tareas: un renglón por tarea. `estado` PENDIENTE | COMPLETADA (al
--     completarla queda la fecha en `completada_en`); `fijada` la deja
--     arriba de la lista; `fecha_limite` es opcional. Se eliminan de verdad
--     (no se anulan: no hace falta auditoría).
--
-- Es idempotente: se puede correr más de una vez.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tareas (
  id             SERIAL PRIMARY KEY,
  texto          VARCHAR(300) NOT NULL,
  fijada         BOOLEAN NOT NULL DEFAULT false,
  fecha_limite   DATE,
  estado         VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE',
  completada_en  TIMESTAMP,
  completada_por INTEGER,
  creado_por     INTEGER,
  creado_en      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_estado_chk') THEN
    ALTER TABLE tareas ADD CONSTRAINT tareas_estado_chk
      CHECK (estado IN ('PENDIENTE','COMPLETADA'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tareas_estado ON tareas (estado, fijada, creado_en);

COMMIT;

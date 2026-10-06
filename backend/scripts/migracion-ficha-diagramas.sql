-- =====================================================================
-- Migración: diagrama de salidas de la ficha técnica (06/10/2026)
-- =====================================================================
-- Por qué: hace falta dejar dibujado en la ficha cómo salen los transformadores:
-- en qué pines del carretel va la entrada y la salida (distinguiendo primario
-- y secundario) y, en los más grandes, con qué cables de colores sale cada
-- bobinado, con borneras si las tiene.
--
-- Qué agrega:
--   ficha_diagramas: un diagrama por ficha, en un jsonb con los elementos
--   dibujados (pines numerados, cables con color y texto, borneras y textos).
--   Va en una tabla aparte porque GET /api/ficha-transformador hace SELECT *.
--   La foto o boceto de fondo (opcional) vive en ficha_archivos con
--   tipo = 'FONDO_DIAGRAMA' (una sola por ficha: índice único parcial).
--
-- Es idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS ficha_diagramas (
  ficha_id       integer PRIMARY KEY REFERENCES ficha_transformador(id) ON DELETE CASCADE,
  datos          jsonb NOT NULL,
  actualizado_en timestamp NOT NULL DEFAULT now(),
  actualizado_por integer REFERENCES usuarios(id)
);

-- Una sola imagen de fondo por ficha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ficha_archivos_fondo
  ON ficha_archivos(ficha_id) WHERE tipo = 'FONDO_DIAGRAMA';

COMMIT;

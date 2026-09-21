-- =====================================================================
-- Migración: espiras como texto y devanados adicionales en la ficha (21/09/2026)
-- =====================================================================
-- Por qué: hay modelos cuyo secundario tiene punto medio y se anota como
-- "422 + 422" espiras, pero `espiras_primario` / `espiras_secundario` eran
-- INTEGER (y el campo del formulario type="number"), así que no se podía
-- guardar. Además hay transformadores con más de dos devanados (terciario,
-- cuarto…) y la ficha solo tenía primario y secundario.
--
-- Qué hace:
--   1. Pasa las espiras del primario y del secundario a texto (hasta 40
--      caracteres). Los valores que ya estaban se conservan ("422" sigue
--      siendo "422"). Nada más en el sistema lee esas columnas.
--   2. Crea ficha_devanados_extra: un renglón por cada devanado adicional
--      (orden 3 = terciario, 4 = cuarto, …) con alambre, diámetro, espiras
--      (texto), pines y peso. Se borra junto con la ficha si se eliminara
--      físicamente (las fichas hoy se dan de baja con deleted_at).
--
-- Es idempotente.

BEGIN;

ALTER TABLE ficha_transformador
  ALTER COLUMN espiras_primario   TYPE varchar(40) USING espiras_primario::text,
  ALTER COLUMN espiras_secundario TYPE varchar(40) USING espiras_secundario::text;

CREATE TABLE IF NOT EXISTS ficha_devanados_extra (
  id          serial PRIMARY KEY,
  ficha_id    integer      NOT NULL REFERENCES ficha_transformador(id) ON DELETE CASCADE,
  orden       integer      NOT NULL CHECK (orden >= 3),   -- 3 terciario, 4 cuarto…
  alambre     varchar(100),
  diametro_mm numeric(5,2),
  espiras     varchar(40),
  pines       varchar(50),
  peso_kg     numeric(6,3),
  CONSTRAINT uq_ficha_devanado_orden UNIQUE (ficha_id, orden)
);

COMMIT;

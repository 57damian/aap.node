-- =====================================================================
-- Migración: categorías de materia prima (05/10/2026)
-- =====================================================================
-- Damian quiere agrupar las materias primas (laminación, alambres,
-- carreteles, barniz…) para verlas mejor en Stock y en el catálogo, y poder
-- agregar categorías nuevas cuando haga falta. Por eso es una tabla propia
-- (editable desde la pantalla) y no una lista fija en el código.
--
--   categorias_materia_prima        el catálogo de categorías (nombre único,
--                                   sin distinguir mayúsculas)
--   materias_primas.categoria_id    categoría de cada materia prima; NULL =
--                                   "Sin categoría". Si se elimina una
--                                   categoría, sus materias primas quedan sin
--                                   categoría (ON DELETE SET NULL), no se borran.
--
-- Se siembran algunas categorías de arranque. NO se asigna ninguna a las
-- materias primas que ya existen: eso lo decide Damian desde el catálogo.
--
-- Es idempotente: se puede correr más de una vez.

BEGIN;

CREATE TABLE IF NOT EXISTS categorias_materia_prima (
  id         SERIAL PRIMARY KEY,
  nombre     VARCHAR(60) NOT NULL,
  creado_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_mp_nombre
  ON categorias_materia_prima (lower(nombre));

ALTER TABLE materias_primas
  ADD COLUMN IF NOT EXISTS categoria_id INTEGER
  REFERENCES categorias_materia_prima(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_materias_primas_categoria
  ON materias_primas (categoria_id);

INSERT INTO categorias_materia_prima (nombre)
SELECT v.nombre
FROM (VALUES ('Laminación'), ('Alambres'), ('Carreteles'), ('Barniz'), ('Cintas')) AS v(nombre)
WHERE NOT EXISTS (
  SELECT 1 FROM categorias_materia_prima c WHERE lower(c.nombre) = lower(v.nombre)
);

COMMIT;

-- =====================================================================
-- Migración: fotos y etiquetas de la ficha técnica guardadas en la base
-- (06/10/2026)
-- =====================================================================
-- Por qué: las fotos de los modelos y las etiquetas PDF se guardaban como
-- archivos en el disco del servidor. En Railway ese disco se vacía en cada
-- deploy o reinicio, pero la base seguía apuntando a la ruta: la ficha
-- quedaba "con foto/etiqueta" y el archivo ya no existía. Ahora el
-- contenido viaja en la propia base (Neon), así que sobrevive a los deploys
-- y se respalda junto con los datos.
--
-- Qué agrega: tabla ficha_archivos, una fila por archivo (tipo FOTO,
-- ETIQUETA o FONDO_DIAGRAMA, este último para el diagrama de salidas).
-- Una ficha tiene a lo sumo una FOTO. Va en una tabla aparte, no en
-- ficha_transformador, porque GET /api/ficha-transformador hace SELECT *
-- y arrastraría los binarios en cada listado.
--
-- Las columnas viejas (ficha_transformador.foto_modelo y la tabla
-- ficha_etiquetas) NO se tocan: el código nuevo ya no las usa. Para pasar
-- a la base los archivos que sí existan en disco:
--   node scripts/migrar-archivos-ficha-a-base.js
--
-- Es idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS ficha_archivos (
  id              serial PRIMARY KEY,
  ficha_id        integer NOT NULL REFERENCES ficha_transformador(id) ON DELETE CASCADE,
  tipo            varchar(20) NOT NULL,
  nombre_original varchar(150),
  mime            varchar(100) NOT NULL,
  tamano          integer NOT NULL,
  contenido       bytea NOT NULL,
  creado_en       timestamp NOT NULL DEFAULT now(),
  creado_por      integer REFERENCES usuarios(id),
  CONSTRAINT ficha_archivos_tipo_check CHECK (tipo IN ('FOTO', 'ETIQUETA', 'FONDO_DIAGRAMA'))
);

CREATE INDEX IF NOT EXISTS idx_ficha_archivos_ficha ON ficha_archivos(ficha_id, tipo);

-- Una sola foto por ficha.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ficha_archivos_foto
  ON ficha_archivos(ficha_id) WHERE tipo = 'FOTO';

COMMIT;

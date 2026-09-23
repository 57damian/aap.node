-- =====================================================================
-- Migración: etiquetas del transformador en PDF (22/09/2026, ampliada
-- 23/09/2026 para admitir varias por ficha)
-- =====================================================================
-- Por qué: cada transformador lleva pegada una etiqueta física, y algunos
-- modelos llevan más de una (ej.: primario y secundario por separado).
-- Se sube cada PDF a la ficha técnica y se puede volver a descargar
-- cuando haga falta reimprimir, sin pedirlo de nuevo.
--
-- Qué agrega: tabla ficha_etiquetas (una fila por PDF subido; una ficha
-- puede tener varias — tope MAX_ETIQUETAS en ficha.routes.js). Reemplaza
-- el diseño anterior de una sola columna ficha_transformador.etiqueta_pdf
-- (agregada el 22/09, nunca llegó a usarse con datos reales): si esa
-- columna existe, se elimina.
--
-- Es idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS ficha_etiquetas (
  id              serial PRIMARY KEY,
  ficha_id        integer NOT NULL REFERENCES ficha_transformador(id) ON DELETE CASCADE,
  archivo         varchar NOT NULL,
  nombre_original varchar(150),
  creado_en       timestamp NOT NULL DEFAULT now(),
  creado_por      integer REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_ficha_etiquetas_ficha ON ficha_etiquetas(ficha_id);

ALTER TABLE ficha_transformador DROP COLUMN IF EXISTS etiqueta_pdf;

COMMIT;

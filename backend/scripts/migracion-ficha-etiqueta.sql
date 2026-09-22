-- =====================================================================
-- Migración: etiqueta del transformador en PDF (22/09/2026)
-- =====================================================================
-- Por qué: cada transformador lleva pegada una etiqueta física. Antes,
-- para reimprimirla había que rehacerla de cero; ahora se sube el PDF una
-- sola vez a la ficha técnica y se puede volver a descargar cuando haga
-- falta reimprimir, sin pedirlo de nuevo.
--
-- Qué agrega: ficha_transformador.etiqueta_pdf, con el mismo criterio que
-- foto_modelo — ruta relativa dentro de uploads/, servida protegida por
-- sesión (ver middlewares/uploadEtiqueta.js y el mount de /uploads en
-- index.js).
--
-- Es idempotente.

BEGIN;

ALTER TABLE ficha_transformador
  ADD COLUMN IF NOT EXISTS etiqueta_pdf varchar;

COMMIT;

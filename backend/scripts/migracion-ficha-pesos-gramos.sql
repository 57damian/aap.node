-- =====================================================================
-- Migración: pesos de ficha técnica en gramos, no en kg (22/09/2026)
-- =====================================================================
-- Por qué: en Materiales (stock-mp.html) y en las cargas de stock, el
-- alambre de cobre se pide y se registra en gramos (ver "Pedidos a
-- proveedores" en el CLAUDE.md raíz: un rollo de 500gr, no 0.5kg). Los
-- pesos de la ficha técnica (peso_primario_kg, peso_secundario_kg,
-- peso_laminacion_kg y ficha_devanados_extra.peso_kg) seguían la misma
-- convención en kg y quedaban inconsistentes con eso; pasan a gramos
-- también (el nombre de columna con "_kg" queda, es legacy, pero ya no
-- refleja la unidad real — ver CLAUDE.md).
--
-- Qué agrega: ensancha esas 4 columnas de numeric(6,3) [máx. 999.999] a
-- numeric(9,2) [máx. 9.999.999,99] porque en gramos los valores son ~1000
-- veces más grandes y no entraban en el tipo viejo (overflow de Postgres).
-- No convierte los valores existentes — eso lo hace, en la misma
-- transacción que los demás datos relacionados (materias primas en KG),
-- scripts/convertir-pesos-kg-a-gramos.js.
--
-- ficha_devanados_extra puede no existir todavía si en esta base no corrió
-- migracion-ficha-devanados.sql (11): en ese caso esta parte se salta sola
-- y hay que volver a correr esta migración después de aplicar la 11.
--
-- Es idempotente.

BEGIN;

ALTER TABLE ficha_transformador
  ALTER COLUMN peso_primario_kg   TYPE numeric(9,2),
  ALTER COLUMN peso_secundario_kg TYPE numeric(9,2),
  ALTER COLUMN peso_laminacion_kg TYPE numeric(9,2);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'ficha_devanados_extra'
  ) THEN
    ALTER TABLE ficha_devanados_extra ALTER COLUMN peso_kg TYPE numeric(9,2);
  END IF;
END $$;

COMMIT;

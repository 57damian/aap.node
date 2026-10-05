-- =====================================================================
-- Migración: más decimales en los precios de materia prima (05/10/2026)
-- =====================================================================
-- Desde que la factura de compra convierte KG -> GR (el alambre se lleva en
-- gramos y el proveedor factura por kg), el precio de referencia, el del
-- movimiento de stock y el del historial quedan POR GRAMO. Con 2 decimales:
--
--   $34.034/kg  -> $34,034/gr  se guardaba $34,03   (-0,01 %)
--   $1.234/kg   -> $1,234/gr   se guardaba $1,23    (-0,3 %)
--   en USD: $34,03/gr con dólar 1400 = 0,0243 USD   se guardaba 0,02 (-18 %)
--
-- El último es el grave: la alerta de variación de precio se calcula en USD
-- comparando esos valores redondeados.
--
-- Cambios (solo ensancha, no toca datos):
--   materias_primas.precio_referencia            numeric(15,2) -> numeric(15,4)
--   stock_movimientos.precio_unitario             numeric(12,2) -> numeric(15,4)
--   historial_precios_materias.precio_anterior    numeric(15,2) -> numeric(15,4)
--   historial_precios_materias.precio_nuevo       numeric(15,2) -> numeric(15,4)
--   historial_precios_materias.precio_*_usd       numeric(15,2) -> numeric(15,6)
-- factura_items.precio_unitario NO cambia: es lo que dice el papel.
--
-- La vista vista_factura_items_completa (si existe) usa precio_referencia y
-- Postgres no deja cambiar el tipo de una columna usada por una vista: se
-- guarda su definición, se borra y se vuelve a crear igual.
--
-- Es idempotente: si la columna ya tiene la escala nueva, no se toca.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  def_vista text;
  cambio record;
  escala_actual int;
BEGIN
  IF to_regclass('public.vista_factura_items_completa') IS NOT NULL THEN
    def_vista := pg_get_viewdef('public.vista_factura_items_completa'::regclass);
  END IF;

  FOR cambio IN
    SELECT * FROM (VALUES
      ('materias_primas',            'precio_referencia',   'numeric(15,4)', 4),
      ('stock_movimientos',          'precio_unitario',     'numeric(15,4)', 4),
      ('historial_precios_materias', 'precio_anterior',     'numeric(15,4)', 4),
      ('historial_precios_materias', 'precio_nuevo',        'numeric(15,4)', 4),
      ('historial_precios_materias', 'precio_anterior_usd', 'numeric(15,6)', 6),
      ('historial_precios_materias', 'precio_nuevo_usd',    'numeric(15,6)', 6)
    ) AS t(tabla, columna, tipo, escala)
  LOOP
    SELECT numeric_scale INTO escala_actual
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = cambio.tabla AND column_name = cambio.columna;

    IF escala_actual IS NOT NULL AND escala_actual < cambio.escala THEN
      IF def_vista IS NOT NULL AND to_regclass('public.vista_factura_items_completa') IS NOT NULL THEN
        EXECUTE 'DROP VIEW public.vista_factura_items_completa';
      END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE %s', cambio.tabla, cambio.columna, cambio.tipo);
      RAISE NOTICE '% .% -> %', cambio.tabla, cambio.columna, cambio.tipo;
    END IF;
  END LOOP;

  IF def_vista IS NOT NULL AND to_regclass('public.vista_factura_items_completa') IS NULL THEN
    EXECUTE 'CREATE VIEW public.vista_factura_items_completa AS ' || def_vista;
  END IF;
END $$;

COMMIT;

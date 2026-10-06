-- =====================================================================
-- Migración: precios por gramo con 6 decimales (06/10/2026)
-- =====================================================================
-- El alambre se lleva en gramos pero se compra y se muestra POR KG. El precio
-- se guarda por gramo (materias_primas.precio_referencia, stock_movimientos y
-- el historial) y la pantalla lo multiplica por 1000. Con 4 decimales:
--
--   $34.033,55/kg -> $34,03355/gr  se guardaba $34,0336/gr  = $34.033,60/kg
--
-- o sea hasta $0,10 por kg de diferencia contra la factura del proveedor. Con 6
-- decimales el precio por kg queda exacto al centavo.
--
-- Cambios (solo ensancha, no toca datos):
--   materias_primas.precio_referencia            numeric(15,4) -> numeric(15,6)
--   stock_movimientos.precio_unitario            numeric(15,4) -> numeric(15,6)
--   historial_precios_materias.precio_anterior   numeric(15,4) -> numeric(15,6)
--   historial_precios_materias.precio_nuevo      numeric(15,4) -> numeric(15,6)
-- (los precio_*_usd ya tienen 6). factura_items.precio_unitario NO cambia: es
-- lo que dice el papel.
--
-- La vista vista_factura_items_completa (si existe) usa precio_referencia y
-- Postgres no deja cambiar el tipo de una columna usada por una vista: se
-- guarda su definición, se borra y se vuelve a crear igual (mismo patrón que
-- migracion-precios-decimales.sql).
--
-- Es idempotente: si la columna ya tiene 6 decimales, no se toca. El código
-- funciona igual sin esta migración (solo con la precisión de antes).
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
      ('materias_primas',            'precio_referencia'),
      ('stock_movimientos',          'precio_unitario'),
      ('historial_precios_materias', 'precio_anterior'),
      ('historial_precios_materias', 'precio_nuevo')
    ) AS t(tabla, columna)
  LOOP
    SELECT numeric_scale INTO escala_actual
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = cambio.tabla AND column_name = cambio.columna;

    IF escala_actual IS NOT NULL AND escala_actual < 6 THEN
      IF def_vista IS NOT NULL AND to_regclass('public.vista_factura_items_completa') IS NOT NULL THEN
        EXECUTE 'DROP VIEW public.vista_factura_items_completa';
      END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(15,6)', cambio.tabla, cambio.columna);
      RAISE NOTICE '% .% -> numeric(15,6)', cambio.tabla, cambio.columna;
    END IF;
  END LOOP;

  IF def_vista IS NOT NULL AND to_regclass('public.vista_factura_items_completa') IS NULL THEN
    EXECUTE 'CREATE VIEW public.vista_factura_items_completa AS ' || def_vista;
  END IF;
END $$;

COMMIT;

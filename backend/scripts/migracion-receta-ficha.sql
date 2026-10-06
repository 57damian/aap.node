-- =====================================================================
-- Migración: receta (lista de materiales) por modelo de transformador y
-- descuento de materia prima al producir (06/10/2026)
-- =====================================================================
-- Por qué: producir no descontaba materia prima y la ficha técnica no estaba
-- vinculada al catálogo de materias primas (los alambres eran texto libre).
-- Ahora cada modelo puede tener una receta y, al cargar producción, se
-- descuentan del stock las cantidades por transformador × unidades.
-- No todos los modelos tienen receta: los que no la tienen producen igual
-- y no descuentan nada.
--
-- Qué agrega:
--   1. materias_primas.metros_por_rollo: para materiales que se llevan por
--      unidad (rollo) pero se consumen por longitud (cinta de poliéster,
--      presspan). La receta se anota en cm; se convierte a rollos con esto.
--   2. Stock con 4 decimales (numeric(14,4)): consumir 30 cm de un rollo de
--      50 m son 0,006 rollos, y con 2 decimales se redondeaba a 0,01.
--      Afecta materias_primas.stock_actual/stock_minimo y
--      stock_movimientos.cantidad/stock_anterior/stock_nuevo. Solo ensancha.
--      Las vistas que usan esas columnas (stock_materias_primas y
--      vista_factura_items_completa, si existen) se guardan, se borran y se
--      vuelven a crear igual: Postgres no deja cambiar el tipo de una columna
--      usada por una vista (mismo patrón que migracion-precios-6-decimales).
--   3. Categorías nuevas: Estaño, Tornillería, Bridas y Borneras.
--   4. Material de alambre de cada devanado:
--      ficha_transformador.material_primario_id / material_secundario_id y
--      ficha_devanados_extra.material_id. El descuento sale del peso en
--      gramos que ya se anota en cada devanado.
--   5. ficha_receta_items: el resto de la receta (carretel, estaño, barniz,
--      cinta, tornillos, bridas, borneras…): material + cantidad por
--      transformador + la unidad en que se anotó.
--   6. produccion_consumos y stock_movimientos.produccion_id: qué se
--      descontó en cada carga de producción, para poder devolverlo si se
--      anula la carga.
--
-- Es idempotente.
-- =====================================================================

BEGIN;

-- 1. Metros por rollo ---------------------------------------------------
ALTER TABLE materias_primas ADD COLUMN IF NOT EXISTS metros_por_rollo numeric(10,2);

-- 2. Stock con 4 decimales ----------------------------------------------
DO $$
DECLARE
  def_mp text;
  def_items text;
  cambio record;
  escala_actual int;
BEGIN
  IF to_regclass('public.stock_materias_primas') IS NOT NULL THEN
    def_mp := pg_get_viewdef('public.stock_materias_primas'::regclass);
  END IF;
  IF to_regclass('public.vista_factura_items_completa') IS NOT NULL THEN
    def_items := pg_get_viewdef('public.vista_factura_items_completa'::regclass);
  END IF;

  FOR cambio IN
    SELECT * FROM (VALUES
      ('materias_primas',  'stock_actual'),
      ('materias_primas',  'stock_minimo'),
      ('stock_movimientos', 'cantidad'),
      ('stock_movimientos', 'stock_anterior'),
      ('stock_movimientos', 'stock_nuevo')
    ) AS t(tabla, columna)
  LOOP
    SELECT numeric_scale INTO escala_actual
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = cambio.tabla AND column_name = cambio.columna;

    IF escala_actual IS NOT NULL AND escala_actual < 4 THEN
      IF to_regclass('public.stock_materias_primas') IS NOT NULL AND def_mp IS NOT NULL THEN
        EXECUTE 'DROP VIEW public.stock_materias_primas';
      END IF;
      IF to_regclass('public.vista_factura_items_completa') IS NOT NULL AND def_items IS NOT NULL THEN
        EXECUTE 'DROP VIEW public.vista_factura_items_completa';
      END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(14,4)', cambio.tabla, cambio.columna);
      RAISE NOTICE '% .% -> numeric(14,4)', cambio.tabla, cambio.columna;
    END IF;
  END LOOP;

  IF def_mp IS NOT NULL AND to_regclass('public.stock_materias_primas') IS NULL THEN
    EXECUTE 'CREATE VIEW public.stock_materias_primas AS ' || def_mp;
  END IF;
  IF def_items IS NOT NULL AND to_regclass('public.vista_factura_items_completa') IS NULL THEN
    EXECUTE 'CREATE VIEW public.vista_factura_items_completa AS ' || def_items;
  END IF;
END $$;

-- 3. Categorías nuevas --------------------------------------------------
INSERT INTO categorias_materia_prima (nombre)
SELECT v.nombre
  FROM (VALUES ('Estaño'), ('Tornillería'), ('Bridas'), ('Borneras')) AS v(nombre)
 WHERE NOT EXISTS (
   SELECT 1 FROM categorias_materia_prima c WHERE lower(c.nombre) = lower(v.nombre)
 );

-- 4. Material de alambre por devanado -----------------------------------
ALTER TABLE ficha_transformador
  ADD COLUMN IF NOT EXISTS material_primario_id integer REFERENCES materias_primas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS material_secundario_id integer REFERENCES materias_primas(id) ON DELETE SET NULL;

-- ficha_devanados_extra la crea migracion-ficha-devanados.sql: si en esta base
-- todavía no corrió, esta parte se salta (volver a correr esta migración después).
DO $$
BEGIN
  IF to_regclass('public.ficha_devanados_extra') IS NOT NULL THEN
    ALTER TABLE ficha_devanados_extra
      ADD COLUMN IF NOT EXISTS material_id integer REFERENCES materias_primas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Receta --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ficha_receta_items (
  id               serial PRIMARY KEY,
  ficha_id         integer NOT NULL REFERENCES ficha_transformador(id) ON DELETE CASCADE,
  materia_prima_id integer NOT NULL REFERENCES materias_primas(id),
  cantidad         numeric(14,4) NOT NULL CHECK (cantidad > 0),
  unidad           varchar(10) NOT NULL,
  observaciones    varchar(200),
  orden            integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ficha_receta_items_ficha ON ficha_receta_items(ficha_id, orden);

-- 6. Consumo por carga de producción --------------------------------------
ALTER TABLE stock_movimientos
  ADD COLUMN IF NOT EXISTS produccion_id integer REFERENCES produccion(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS produccion_consumos (
  id                  serial PRIMARY KEY,
  produccion_id       integer NOT NULL REFERENCES produccion(id) ON DELETE CASCADE,
  materia_prima_id    integer NOT NULL REFERENCES materias_primas(id),
  cantidad_necesaria  numeric(14,4) NOT NULL,
  cantidad_descontada numeric(14,4) NOT NULL,
  faltante            numeric(14,4) NOT NULL DEFAULT 0,
  unidad              varchar(20),
  stock_movimiento_id integer REFERENCES stock_movimientos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_produccion_consumos_produccion ON produccion_consumos(produccion_id);

COMMIT;

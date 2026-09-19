-- =====================================================================
-- Migración: separar factura_items (compras) de factura_venta_items (ventas)
-- =====================================================================
-- Por qué: backend/routes/facturas.routes.js (facturas de VENTA) y
-- backend/routes/facturas-compra.routes.js (facturas de COMPRA) escriben
-- en la misma tabla factura_items, con columnas que no se solapan y un
-- factura_id que sólo puede tener una FK. Desde que existe este proyecto
-- la FK de factura_items.factura_id se corrigió tres veces en direcciones
-- opuestas (ver docs/SistemadeFacturaciónDeVentas.md 29/05/2026 y
-- claude/modulo-stock.md bug 7, 12/09/2026): cada vez que se arregla un
-- lado se rompe el otro. Hoy (según el último arreglo, 12/09) la FK
-- apunta a facturas_compra, así que CREAR UNA FACTURA DE VENTA ESTÁ ROTO
-- (error 23503, la misma violación de FK documentada en
-- docs/TROUBLESHOOTING_FACTURACION.md, Error 3, con los roles invertidos).
--
-- La solución de fondo (hallazgo C9 de claude/auditoria-bugs-2026-09-13.md)
-- es dejar de compartir la tabla. Este script:
--   1. Crea factura_venta_items, dedicada a facturas de venta.
--   2. Mueve a esa tabla cualquier fila de factura_items que sea de venta
--      (por si quedó algo de antes del 12/09 con venta_item_id NOT NULL).
--   3. Dev uelve factura_items a su forma exclusiva de compras (FK
--      correcta a facturas_compra, sin las columnas de venta que ya no
--      usa nadie).
--
-- Es idempotente: se puede correr más de una vez sin romper nada (usa
-- IF NOT EXISTS / IF EXISTS everywhere). Pensado para correr contra la
-- Postgres local de Damian, con backend/scripts/generar-esquema.js (o
-- backend/actualizar-documentacion-factura-items.js, que ya existe)
-- corrido ANTES y DESPUÉS para confirmar el resultado.

BEGIN;

-- 1. Tabla nueva para items de factura de venta.
CREATE TABLE IF NOT EXISTS factura_venta_items (
  id                serial PRIMARY KEY,
  factura_id        integer NOT NULL,
  venta_item_id     integer NOT NULL,
  ficha_id          integer,
  cantidad          numeric(15,2) NOT NULL,
  precio_unitario   numeric(15,2) NOT NULL,  -- precio SIN IVA (así lo calcula facturas.routes.js)
  subtotal          numeric(15,2) NOT NULL,
  iva               numeric(15,2) NOT NULL,
  total             numeric(15,2) NOT NULL,
  created_at        timestamp DEFAULT now()
);

-- 2. Mover filas de venta que hoy estén mezcladas en factura_items
--    (defensivo: no debería haber ninguna si la FK a facturas_compra
--    se validó al crearse el 12/09, pero por si quedó algo de antes).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'factura_items' AND column_name = 'venta_item_id'
  ) THEN
    INSERT INTO factura_venta_items
      (factura_id, venta_item_id, ficha_id, cantidad, precio_unitario, subtotal, iva, total, created_at)
    SELECT factura_id, venta_item_id, ficha_id, cantidad,
           COALESCE(precio_unitario, precio_unitario_sin_iva, 0),
           subtotal, iva, total, created_at
    FROM factura_items
    WHERE venta_item_id IS NOT NULL;

    DELETE FROM factura_items WHERE venta_item_id IS NOT NULL;
  END IF;
END $$;

-- 3. FKs de la tabla nueva.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fvi_factura_fk'
  ) THEN
    ALTER TABLE factura_venta_items
      ADD CONSTRAINT fvi_factura_fk FOREIGN KEY (factura_id)
      REFERENCES facturas(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fvi_venta_item_fk'
  ) THEN
    ALTER TABLE factura_venta_items
      ADD CONSTRAINT fvi_venta_item_fk FOREIGN KEY (venta_item_id)
      REFERENCES venta_items(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fvi_ficha_fk'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'ficha_transformador'
  ) THEN
    ALTER TABLE factura_venta_items
      ADD CONSTRAINT fvi_ficha_fk FOREIGN KEY (ficha_id)
      REFERENCES ficha_transformador(id);
  END IF;
END $$;

-- Un item de venta se factura una sola vez (es lo que hoy chequea a mano
-- facturas.routes.js consultando factura_items antes de insertar; con el
-- índice único, el check queda garantizado también a nivel de base).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fvi_venta_item ON factura_venta_items(venta_item_id);
CREATE INDEX IF NOT EXISTS idx_fvi_factura ON factura_venta_items(factura_id);

-- 4. factura_items vuelve a ser exclusiva de compras: FK correcta a
--    facturas_compra (por si el 12/09 quedó con otro nombre de constraint
--    o sin validar) y se sacan las columnas de venta que ya no usa nadie
--    una vez migrado el código (ver facturas.routes.js, ventas.routes.js,
--    notas_credito.routes.js en este mismo commit).
DO $$
DECLARE
  fk_actual text;
BEGIN
  SELECT con.confrelid::regclass::text INTO fk_actual
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'factura_items' AND con.contype = 'f'
    AND con.conname LIKE '%factura_id%';

  IF fk_actual IS DISTINCT FROM 'facturas_compra' THEN
    EXECUTE (
      SELECT 'ALTER TABLE factura_items DROP CONSTRAINT ' || con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'factura_items' AND con.contype = 'f'
        AND con.conname LIKE '%factura_id%'
      LIMIT 1
    );
    ALTER TABLE factura_items
      ADD CONSTRAINT factura_items_factura_id_fkey
      FOREIGN KEY (factura_id) REFERENCES facturas_compra(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE factura_items DROP COLUMN IF EXISTS venta_item_id;
ALTER TABLE factura_items DROP COLUMN IF EXISTS ficha_id;
ALTER TABLE factura_items DROP COLUMN IF EXISTS precio_unitario_sin_iva;

-- materia_prima_id vuelve a ser NOT NULL solo si YA no quedan filas nulas
-- (los ítems manuales de facturas-compra.routes.js insertan con
-- materia_prima_id NULL a propósito, así que en la práctica esto NO se
-- va a aplicar — se deja documentado y defensivo, no rompe si no aplica).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM factura_items WHERE materia_prima_id IS NULL) THEN
    -- No forzar NOT NULL: facturas-compra.routes.js depende de poder
    -- insertar ítems manuales sin materia_prima_id. Se deja nullable
    -- a propósito (es el comportamiento actual y correcto).
    NULL;
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- Notas de crédito: la tabla nota_credito_items ya la usa
-- notas_credito.routes.js pero no estaba en el esquema documentado
-- (hallazgo C3 de la auditoría). La creamos si hace falta.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS nota_credito_items (
  id                serial PRIMARY KEY,
  nota_credito_id   integer NOT NULL REFERENCES notas_credito(id) ON DELETE CASCADE,
  factura_item_id   integer NOT NULL REFERENCES factura_venta_items(id),
  cantidad          numeric(15,2) NOT NULL CHECK (cantidad > 0),
  precio_unitario   numeric(15,2) NOT NULL,
  subtotal          numeric(15,2) NOT NULL,
  iva_21            numeric(15,2) NOT NULL,
  total             numeric(15,2) NOT NULL,
  created_at        timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nc_items_nota ON nota_credito_items(nota_credito_id);

COMMIT;

-- =====================================================================
-- D10: una factura de venta anulada no debe seguir sumando deuda.
-- facturas.estado ya existe con default 'emitida' (confirmado en
-- docs/ESQUEMA_BD.md.txt); normalizamos a mayúsculas y le ponemos un
-- CHECK, siguiendo la regla general del proyecto de "un solo campo de
-- estado por entidad, en MAYÚSCULAS, con CHECK".
-- =====================================================================
BEGIN;

UPDATE facturas SET estado = upper(estado) WHERE estado IS NOT NULL AND estado <> upper(estado);
UPDATE facturas SET estado = 'EMITIDA' WHERE estado IS NULL;

-- El CHECK sólo se agrega si TODOS los valores actuales entran en la
-- lista. Si hay un estado inesperado (por ejemplo algo cargado a mano),
-- se avisa por NOTICE y se deja para decidir con Damian en vez de romper
-- la migración o forzar un mapeo que puede estar mal.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM facturas WHERE estado NOT IN ('EMITIDA','ANULADA')) THEN
    RAISE NOTICE 'facturas.estado tiene valores fuera de EMITIDA/ANULADA — no se agregó el CHECK. Revisar: SELECT DISTINCT estado FROM facturas;';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facturas_estado_chk') THEN
    ALTER TABLE facturas ADD CONSTRAINT facturas_estado_chk
      CHECK (estado IN ('EMITIDA','ANULADA'));
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- Verificación (correr después, y pegar el resultado antes de seguir)
-- =====================================================================
-- 1. Cero filas de compra sin factura de compra real:
--    SELECT COUNT(*) FROM factura_items fi
--    WHERE NOT EXISTS (SELECT 1 FROM facturas_compra fc WHERE fc.id = fi.factura_id);
--    -> debe dar 0
--
-- 2. Cero filas de venta sin factura de venta real:
--    SELECT COUNT(*) FROM factura_venta_items fvi
--    WHERE NOT EXISTS (SELECT 1 FROM facturas f WHERE f.id = fvi.factura_id);
--    -> debe dar 0
--
-- 3. factura_items ya no tiene columnas de venta:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'factura_items' ORDER BY ordinal_position;
--    -> no debe listar venta_item_id, ficha_id ni precio_unitario_sin_iva

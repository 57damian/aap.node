-- =====================================================================
-- Migración: índice único en orden_compra_items (hallazgo C4)
-- =====================================================================
-- POST /api/ordenes-compra/:id/items hace un INSERT ... ON CONFLICT
-- (orden_compra_id, ficha_id) DO UPDATE, pero la tabla nunca tuvo un
-- índice único sobre ese par de columnas: Postgres devuelve
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" (500) cada vez que se intenta agregar un item a una OC.
--
-- Es idempotente.

BEGIN;

-- Si ya hay duplicados cargados (mismo modelo repetido en la misma OC),
-- el CREATE UNIQUE INDEX de abajo fallaría. Como el proyecto no tiene
-- datos reales todavía (ver claude/00-resumen-y-metodologia.md), se
-- consolidan quedándose con la fila más vieja y sumando cantidad_pedida
-- en vez de simplemente borrar duplicados y perder cantidad cargada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM orden_compra_items
    GROUP BY orden_compra_id, ficha_id
    HAVING COUNT(*) > 1
  ) THEN
    UPDATE orden_compra_items a
    SET cantidad_pedida = a.cantidad_pedida + sub.extra
    FROM (
      SELECT orden_compra_id, ficha_id, MIN(id) AS keep_id,
             SUM(cantidad_pedida) - MIN(cantidad_pedida) AS extra
      FROM orden_compra_items
      GROUP BY orden_compra_id, ficha_id
      HAVING COUNT(*) > 1
    ) sub
    WHERE a.id = sub.keep_id;

    DELETE FROM orden_compra_items a USING orden_compra_items b
    WHERE a.id > b.id
      AND a.orden_compra_id = b.orden_compra_id
      AND a.ficha_id = b.ficha_id;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oci_orden_ficha
  ON orden_compra_items(orden_compra_id, ficha_id);

COMMIT;

-- Verificación: agregar el mismo modelo dos veces a la misma OC desde la
-- pantalla debe sumar cantidad en la misma fila, no crear una fila nueva
-- ni tirar 500.

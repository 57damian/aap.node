-- =====================================================================
-- Migración: arreglar la vista stock_produccion (06/10/2026)
-- =====================================================================
-- En Neon la vista stock_produccion tenía la definición vieja de
-- scripts/fix-stock-system.js: unía produccion y venta_items con dos LEFT JOIN
-- y un GROUP BY. Con más de una fila de producción y de entregas de un mismo
-- modelo, cada tabla multiplica a la otra (producto cartesiano):
--
--   G96-220: producido 130 (40 + 50 + 40), entregado 40 (1 remito)
--     vista vieja: entregado = 40 x 3 filas de producción = 120  ->  stock 10
--     real: 130 - 40 = 90
--
-- Pantalla "Stock de producción" mostraba 10 aunque se registraran más
-- unidades. La vista stock_actual (la que usa el trigger que valida las
-- entregas) sí estaba bien, por eso las entregas se validaban con el stock
-- real y la pantalla mostraba otro número.
--
-- La definición nueva usa subconsultas (una por tabla), igual a stock_actual y
-- a la que ya tenía la base local. Mismas columnas y tipos, así que
-- CREATE OR REPLACE VIEW alcanza (no hay que borrar nada ni toca datos).
--
-- Es idempotente. No cambia datos: solo cómo se calcula el stock que se muestra.
--
-- Definición anterior (para revertir si hiciera falta):
--   SELECT f.id AS ficha_id, f.modelo, f.cliente_id,
--          COALESCE(SUM(p.cantidad), 0) AS producido_total,
--          COALESCE(SUM(vi.cantidad), 0) AS entregado_total,
--          COALESCE(SUM(p.cantidad), 0) - COALESCE(SUM(vi.cantidad), 0) AS stock_actual
--   FROM ficha_transformador f
--   LEFT JOIN produccion p ON f.id = p.ficha_id
--   LEFT JOIN venta_items vi ON f.id = vi.ficha_id
--   GROUP BY f.id, f.modelo, f.cliente_id;

BEGIN;

CREATE OR REPLACE VIEW stock_produccion AS
SELECT
  f.id AS ficha_id,
  f.modelo,
  f.cliente_id,
  COALESCE((SELECT SUM(p.cantidad) FROM produccion p WHERE p.ficha_id = f.id), 0::bigint) AS producido_total,
  COALESCE((SELECT SUM(vi.cantidad)
              FROM venta_items vi
              JOIN ventas v ON v.id = vi.venta_id
             WHERE vi.ficha_id = f.id), 0::bigint) AS entregado_total,
  COALESCE((SELECT SUM(p.cantidad) FROM produccion p WHERE p.ficha_id = f.id), 0::bigint)
  - COALESCE((SELECT SUM(vi.cantidad)
                FROM venta_items vi
                JOIN ventas v ON v.id = vi.venta_id
               WHERE vi.ficha_id = f.id), 0::bigint) AS stock_actual
FROM ficha_transformador f;

COMMIT;

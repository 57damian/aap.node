-- =====================================================================
-- Migración: consumo de materiales por producción + anulación de producción
-- =====================================================================
-- Hasta ahora "Registrar producción" (tabla `produccion`) no tocaba stock
-- de materia prima para nada — eran dos mundos separados. Damian todavía
-- no tiene cargada la receta/lista de materiales por modelo, así que el
-- descuento de material se hace a mano, ítem por ítem, al registrar cada
-- carga de producción (ver docs/claude/modulo-produccion.md).
--
-- `stock_movimientos.produccion_id` permite decir "este movimiento de
-- SALIDA (material usado) o MERMA (material desperdiciado: se rompió un
-- carretel, se cortó un bobinado, un rollo quedó vacío) fue por esta carga
-- de producción puntual". Queda NULL para ajustes sueltos (compras,
-- correcciones generales de inventario, el botón "Vaciar" de Stock).
--
-- ON DELETE RESTRICT (no SET NULL, a diferencia de factura_id en esta
-- misma tabla): una producción con movimientos de stock asociados nunca se
-- borra directamente — se anula. Igual que se decidió para facturas,
-- remitos y OC ("anular, no borrar"), agregamos las tres columnas de
-- anulación en `produccion` para poder revertir una carga mal cargada sin
-- perder el historial ni dejar el stock inconsistente.
--
-- Es idempotente.

BEGIN;

ALTER TABLE stock_movimientos
  ADD COLUMN IF NOT EXISTS produccion_id integer REFERENCES produccion(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_stock_movimientos_produccion
  ON stock_movimientos (produccion_id);

-- Índice compuesto para el informe de consumo (GET /api/produccion/materiales-informe):
-- filtra por fecha/material, siempre acotado a movimientos ligados a una producción.
CREATE INDEX IF NOT EXISTS idx_stock_movimientos_informe
  ON stock_movimientos (fecha_movimiento, materia_prima_id, tipo_movimiento)
  WHERE produccion_id IS NOT NULL;

ALTER TABLE produccion
  ADD COLUMN IF NOT EXISTS anulada_en timestamp,
  ADD COLUMN IF NOT EXISTS anulada_por integer REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS motivo_anulacion text;

-- La vista de stock de producto terminado (scripts/fix-stock-system.js)
-- sumaba TODA `produccion.cantidad` sin excluir anuladas — sin este
-- CREATE OR REPLACE, anular una carga revierte el material pero el stock
-- de producto terminado sigue contando esas unidades como si existieran.
CREATE OR REPLACE VIEW stock_produccion AS
SELECT
  f.id as ficha_id,
  f.modelo,
  f.cliente_id,
  COALESCE(SUM(p.cantidad), 0) as producido_total,
  COALESCE(SUM(vi.cantidad), 0) as entregado_total,
  COALESCE(SUM(p.cantidad), 0) - COALESCE(SUM(vi.cantidad), 0) as stock_actual
FROM ficha_transformador f
LEFT JOIN produccion p ON f.id = p.ficha_id AND p.anulada_en IS NULL
LEFT JOIN venta_items vi ON f.id = vi.ficha_id
GROUP BY f.id, f.modelo, f.cliente_id;

COMMIT;

-- Verificación: \d stock_movimientos debe mostrar la columna produccion_id
-- con su FK; \d produccion debe mostrar anulada_en/anulada_por/motivo_anulacion.

-- =====================================================================
-- Migración: una factura de venta puede agrupar varios remitos de una OC
-- =====================================================================
-- Por qué: hasta ahora cada remito (fila de `ventas`) se facturaba por
-- separado. El circuito real es: el cliente manda una OC, se entrega en
-- varios remitos parciales y se emite UNA factura por todo lo entregado,
-- con el precio (dólar y/o precio del modelo) del día de la factura, que
-- puede no ser el de la entrega.
--
-- factura_venta_items ya permite que una factura tenga ítems de varias
-- ventas (una fila por venta_item, con índice único uq_fvi_venta_item).
-- Lo que falta es:
--   1. facturas.orden_compra_id: vínculo directo factura <-> OC. Resuelve
--      además la pregunta de diseño D1 (ver reportesOC.routes.js): el
--      resumen de la OC aproximaba "cobrado" por cliente.
--   2. facturas.tipo_cambio: cotización del dólar usada al facturar.
--   3. factura_venta_items.precio_unitario_usd: precio USD facturado
--      (el precio en pesos ya estaba en precio_unitario).
--
-- Es idempotente.

BEGIN;

ALTER TABLE facturas ADD COLUMN IF NOT EXISTS orden_compra_id integer;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS tipo_cambio numeric;
ALTER TABLE factura_venta_items ADD COLUMN IF NOT EXISTS precio_unitario_usd numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'facturas_orden_compra_fk'
  ) THEN
    ALTER TABLE facturas
      ADD CONSTRAINT facturas_orden_compra_fk FOREIGN KEY (orden_compra_id)
      REFERENCES ordenes_compra(id);
  END IF;
END $$;

-- Backfill: las facturas existentes se vinculan a la OC de sus ventas.
UPDATE facturas f
SET orden_compra_id = sub.orden_compra_id
FROM (
  SELECT fvi.factura_id, MIN(v.orden_compra_id) AS orden_compra_id
  FROM factura_venta_items fvi
  JOIN venta_items vi ON vi.id = fvi.venta_item_id
  JOIN ventas v       ON v.id = vi.venta_id
  WHERE v.orden_compra_id IS NOT NULL
  GROUP BY fvi.factura_id
) sub
WHERE f.id = sub.factura_id
  AND f.orden_compra_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_facturas_oc ON facturas(orden_compra_id);

-- migracion-facturacion-ventas.sql pasó los estados a MAYÚSCULAS y agregó
-- facturas_estado_chk (EMITIDA/ANULADA), pero dejó el DEFAULT de la
-- columna en 'emitida' (minúscula): todo INSERT que no mandaba estado
-- violaba el CHECK, o sea que no se podía crear ninguna factura de venta.
ALTER TABLE facturas ALTER COLUMN estado SET DEFAULT 'EMITIDA';

COMMIT;

-- Verificación:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'facturas' AND column_name IN ('orden_compra_id','tipo_cambio');
--   -> 2 filas
--   SELECT COUNT(*) FROM facturas f
--   WHERE f.orden_compra_id IS NULL AND EXISTS (
--     SELECT 1 FROM factura_venta_items fvi
--     JOIN venta_items vi ON vi.id = fvi.venta_item_id
--     JOIN ventas v ON v.id = vi.venta_id
--     WHERE fvi.factura_id = f.id AND v.orden_compra_id IS NOT NULL);
--   -> 0

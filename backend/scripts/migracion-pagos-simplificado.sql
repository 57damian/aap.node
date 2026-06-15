-- =====================================================
-- MIGRACIÓN: SISTEMA DE PAGOS SIMPLIFICADO
-- Ejecutar en orden. Hace DROP de tablas antiguas.
-- Solo para entorno de TESTING sin datos reales.
-- =====================================================

-- 1. Eliminar tablas redundantes
DROP TABLE IF EXISTS recibo_pagos CASCADE;
DROP TABLE IF EXISTS recibos CASCADE;
DROP TABLE IF EXISTS talonarios CASCADE;

-- 2. Limpiar tabla pagos y agregar numero_talonario
--    (eliminar estado si existe para recrearlo limpio)
ALTER TABLE pagos DROP COLUMN IF EXISTS estado;
ALTER TABLE pagos DROP COLUMN IF EXISTS numero_remito;
ALTER TABLE pagos DROP COLUMN IF EXISTS monto_total;

ALTER TABLE pagos ADD COLUMN IF NOT EXISTS numero_talonario VARCHAR(50);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS monto_total DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
  CHECK (estado IN ('pendiente', 'parcial', 'aplicado'));

-- 3. Asegurar que cheques_propios existe con estructura completa
CREATE TABLE IF NOT EXISTS cheques_propios (
  id SERIAL PRIMARY KEY,
  pago_item_id INT NOT NULL REFERENCES pago_items(id) ON DELETE CASCADE,
  numero_cheque VARCHAR(50),
  banco VARCHAR(100),
  fecha_emision DATE,
  fecha_cobro DATE,
  monto DECIMAL(12,2),
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente','depositado','acreditado','rechazado')),
  fecha_depositado DATE,
  fecha_acreditado DATE,
  fecha_rechazo DATE,
  motivo_rechazo TEXT,
  gasto_comision DECIMAL(12,2) DEFAULT 0,
  es_reemplazo BOOLEAN DEFAULT false,
  cheque_reemplazado_id INT REFERENCES cheques_propios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Asegurar columna fecha_aplicacion en aplicacion_pagos
ALTER TABLE aplicacion_pagos ADD COLUMN IF NOT EXISTS fecha_aplicacion TIMESTAMP DEFAULT NOW();

-- 5. Recalcular saldos de facturas desde aplicacion_pagos (consistencia)
WITH aplicado AS (
  SELECT factura_id, SUM(monto_aplicado) as pagado
  FROM aplicacion_pagos
  GROUP BY factura_id
)
UPDATE facturas f
SET
  saldo = f.total - COALESCE(ap.pagado, 0),
  estado = CASE
    WHEN f.total - COALESCE(ap.pagado, 0) <= 0 THEN 'pagada'
    WHEN f.total - COALESCE(ap.pagado, 0) < f.total THEN 'parcial'
    ELSE 'pendiente'
  END
FROM aplicado ap
WHERE f.id = ap.factura_id;

-- 6. Índices
CREATE INDEX IF NOT EXISTS idx_pagos_cliente_id      ON pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha            ON pagos(fecha_recepcion);
CREATE INDEX IF NOT EXISTS idx_pagos_estado           ON pagos(estado);
CREATE INDEX IF NOT EXISTS idx_pago_items_pago        ON pago_items(pago_id);
CREATE INDEX IF NOT EXISTS idx_aplicacion_pago        ON aplicacion_pagos(pago_id);
CREATE INDEX IF NOT EXISTS idx_aplicacion_factura     ON aplicacion_pagos(factura_id);
CREATE INDEX IF NOT EXISTS idx_cheques_pago_item      ON cheques_propios(pago_item_id);
CREATE INDEX IF NOT EXISTS idx_cheques_estado         ON cheques_propios(estado);
CREATE INDEX IF NOT EXISTS idx_cheques_fecha_cobro    ON cheques_propios(fecha_cobro);

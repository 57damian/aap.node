-- ============================================
-- MIGRACIÓN PARA SOPORTAR PAGOS PARCIALES REAPLICABLES
-- Sistema de Pagos de Clientes
-- Versión: 2.1
-- Fecha: 02/06/2026
-- ============================================

-- PASO 0: VERIFICACIÓN PREVIA (OBLIGATORIA)
-- ⚠️ Si esta consulta devuelve filas, DETENER y resolver manualmente antes de continuar.
-- No ejecutar los pasos siguientes hasta que esta consulta devuelva 0 filas.
SELECT pago_id, factura_id, COUNT(*) as duplicados
FROM aplicacion_pagos
GROUP BY pago_id, factura_id
HAVING COUNT(*) > 1;

-- PASO 1: Eliminar restricción UNIQUE si existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'aplicacion_pagos_pago_id_factura_id_key'
    AND table_name = 'aplicacion_pagos'
  ) THEN
    ALTER TABLE aplicacion_pagos DROP CONSTRAINT aplicacion_pagos_pago_id_factura_id_key;
  END IF;
END $$;

-- PASO 2: Crear índice regular para performance
CREATE INDEX IF NOT EXISTS idx_aplicacion_pagos_pago_factura 
ON aplicacion_pagos(pago_id, factura_id);

-- PASO 3: Actualizar estados de facturas existentes
UPDATE facturas 
SET estado = 'pagada' 
WHERE saldo = 0 AND estado != 'pagada';

UPDATE facturas 
SET estado = 'pendiente' 
WHERE saldo > 0 AND estado = 'pagada';

-- PASO 4: Actualizar estados de pagos existentes
UPDATE pagos p
SET estado = CASE
  WHEN p.monto_total <= COALESCE((
    SELECT SUM(ap.monto_aplicado) 
    FROM aplicacion_pagos ap 
    WHERE ap.pago_id = p.id
  ), 0) THEN 'aplicado'
  WHEN COALESCE((
    SELECT SUM(ap.monto_aplicado) 
    FROM aplicacion_pagos ap 
    WHERE ap.pago_id = p.id
  ), 0) > 0 THEN 'parcial'
  ELSE 'pendiente'
END;

-- PASO 5: Talonarios (asegurar que existe al menos uno)
INSERT INTO talonarios (numero_talonario)
SELECT 'A-001'
WHERE NOT EXISTS (SELECT 1 FROM talonarios);

-- ============================================
-- VERIFICACIÓN DE INTEGRIDAD POST-MIGRACIÓN
-- ============================================

-- Facturas con saldo inconsistente
SELECT f.id, f.numero_factura, f.total, f.saldo, 
       COALESCE(SUM(ap.monto_aplicado), 0) as pagado
FROM facturas f
LEFT JOIN aplicacion_pagos ap ON f.id = ap.factura_id
GROUP BY f.id
HAVING ABS(f.total - COALESCE(SUM(ap.monto_aplicado), 0) - f.saldo) > 0.01;

-- Pagos con estado incorrecto
SELECT p.id, p.monto_total, p.estado,
       COALESCE(SUM(ap.monto_aplicado), 0) as aplicado
FROM pagos p
LEFT JOIN aplicacion_pagos ap ON p.id = ap.pago_id
GROUP BY p.id
HAVING 
  (p.estado = 'aplicado' AND COALESCE(SUM(ap.monto_aplicado), 0) < p.monto_total - 0.01)
  OR (p.estado = 'pendiente' AND COALESCE(SUM(ap.monto_aplicado), 0) > 0);

-- Cheques vencidos no depositados
SELECT cp.id, cp.numero_cheque, cp.monto, cp.fecha_cobro, cp.estado
FROM cheques_propios cp
WHERE cp.fecha_cobro < CURRENT_DATE 
  AND cp.estado = 'pendiente';

-- ============================================
-- RECALCULAR SALDOS (si hay inconsistencias)
-- ============================================
-- Reconstruir saldos desde las aplicaciones de pago
-- UPDATE facturas f
-- SET saldo = f.total - COALESCE((
--   SELECT SUM(ap.monto_aplicado)
--   FROM aplicacion_pagos ap
--   WHERE ap.factura_id = f.id
-- ), 0);

-- Reconstruir estados de facturas
-- UPDATE facturas SET estado = 'pagada' WHERE saldo = 0;
-- UPDATE facturas SET estado = 'pendiente' WHERE saldo > 0;

-- Reconstruir estados de pagos
-- UPDATE pagos p
-- SET estado = CASE
--   WHEN p.monto_total <= COALESCE((
--     SELECT SUM(ap.monto_aplicado) FROM aplicacion_pagos ap WHERE ap.pago_id = p.id
--   ), 0) THEN 'aplicado'
--   WHEN COALESCE((SELECT SUM(ap.monto_aplicado) FROM aplicacion_pagos ap WHERE ap.pago_id = p.id), 0) > 0 THEN 'parcial'
--   ELSE 'pendiente'
-- END;

SELECT 'Migración completada exitosamente' as mensaje;

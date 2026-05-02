-- Script para crear tablas del sistema de pagos a proveedores
-- Ejecutar este script en la base de datos

-- Tabla de pagos a proveedores
CREATE TABLE IF NOT EXISTS pagos_proveedores (
    id SERIAL PRIMARY KEY,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    fecha_pago DATE NOT NULL,
    metodo_pago VARCHAR(50) NOT NULL CHECK (metodo_pago IN ('efectivo', 'cheque', 'transferencia', 'tarjeta')),
    numero_comprobante VARCHAR(100) UNIQUE,
    monto_total DECIMAL(15,2) NOT NULL CHECK (monto_total > 0),
    observaciones TEXT,
    estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aplicado', 'anulado')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de items de pagos (relación con facturas)
CREATE TABLE IF NOT EXISTS pagos_proveedores_items (
    id SERIAL PRIMARY KEY,
    pago_id INTEGER NOT NULL REFERENCES pagos_proveedores(id) ON DELETE CASCADE,
    factura_compra_id INTEGER NOT NULL REFERENCES facturas_compra(id),
    monto_aplicado DECIMAL(15,2) NOT NULL CHECK (monto_aplicado > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agregar campo saldo_pendiente a facturas_compra si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'facturas_compra' AND column_name = 'saldo_pendiente') THEN
        ALTER TABLE facturas_compra ADD COLUMN saldo_pendiente DECIMAL(15,2);
        
        -- Inicializar saldo_pendiente con el total de la factura
        UPDATE facturas_compra SET saldo_pendiente = total 
        WHERE saldo_pendiente IS NULL;
    END IF;
END $$;

-- Agregar campo fecha_vencimiento a facturas_compra si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'facturas_compra' AND column_name = 'fecha_vencimiento') THEN
        ALTER TABLE facturas_compra ADD COLUMN fecha_vencimiento DATE;
        
        -- Establecer fecha de vencimiento como 30 días después de la fecha de factura
        -- Primero verificar si existe la columna fecha_factura
        IF EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'facturas_compra' AND column_name = 'fecha_factura') THEN
            UPDATE facturas_compra SET fecha_vencimiento = fecha_factura + INTERVAL '30 days'
            WHERE fecha_vencimiento IS NULL;
        ELSE
            -- Si no existe fecha_factura, usar created_at o fecha actual
            UPDATE facturas_compra SET fecha_vencimiento = CURRENT_DATE + INTERVAL '30 days'
            WHERE fecha_vencimiento IS NULL;
        END IF;
    END IF;
END $$;

-- Agregar campo estado a facturas_compra si no existe
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'facturas_compra' AND column_name = 'estado') THEN
        ALTER TABLE facturas_compra ADD COLUMN estado VARCHAR(20) DEFAULT 'pendiente';
        
        -- Inicializar estado basado en saldo pendiente
        UPDATE facturas_compra SET estado = 
            CASE 
                WHEN saldo_pendiente <= 0 THEN 'pagada'
                ELSE 'pendiente'
            END;
    END IF;
END $$;

-- Crear índice para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_id ON pagos_proveedores(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos_proveedores(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_pagos_estado ON pagos_proveedores(estado);
CREATE INDEX IF NOT EXISTS idx_pagos_items_pago_id ON pagos_proveedores_items(pago_id);
CREATE INDEX IF NOT EXISTS idx_pagos_items_factura_id ON pagos_proveedores_items(factura_compra_id);
CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas_compra(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_vencimiento ON facturas_compra(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_facturas_saldo ON facturas_compra(saldo_pendiente);

-- Crear función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Crear trigger para pagos_proveedores
DROP TRIGGER IF EXISTS update_pagos_proveedores_updated_at ON pagos_proveedores;
CREATE TRIGGER update_pagos_proveedores_updated_at
    BEFORE UPDATE ON pagos_proveedores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Crear vista para reportes de pagos
CREATE OR REPLACE VIEW vista_pagos_proveedores AS
SELECT 
    p.id,
    p.proveedor_id,
    pr.nombre as proveedor_nombre,
    p.fecha_pago,
    p.metodo_pago,
    p.numero_comprobante,
    p.monto_total,
    p.observaciones,
    p.estado,
    p.created_at,
    p.updated_at,
    COUNT(pi.id) as cantidad_facturas,
    STRING_AGG(fc.numero_factura, ', ') as facturas_aplicadas
FROM pagos_proveedores p
LEFT JOIN proveedores pr ON p.proveedor_id = pr.id
LEFT JOIN pagos_proveedores_items pi ON p.id = pi.pago_id
LEFT JOIN facturas_compra fc ON pi.factura_compra_id = fc.id
GROUP BY p.id, pr.nombre;

-- Crear vista para alertas de facturas pendientes
CREATE OR REPLACE VIEW vista_alertas_facturas_pendientes AS
SELECT 
    fc.id,
    fc.numero_factura,
    fc.fecha_vencimiento,
    fc.total,
    fc.saldo_pendiente,
    fc.proveedor_id,
    pr.nombre as proveedor_nombre,
    pr.email as proveedor_email,
    pr.telefono as proveedor_telefono,
    CASE 
        WHEN fc.fecha_vencimiento < CURRENT_DATE THEN 'vencida'
        WHEN fc.fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days' THEN 'por_vencer'
        ELSE 'normal'
    END as estado_alerta,
    EXTRACT(DAY FROM fc.fecha_vencimiento - CURRENT_DATE) as dias_restantes
FROM facturas_compra fc
LEFT JOIN proveedores pr ON fc.proveedor_id = pr.id
WHERE fc.estado = 'pendiente' 
  AND fc.saldo_pendiente > 0
ORDER BY fc.fecha_vencimiento ASC;

-- Mensaje de confirmación
SELECT 'Tablas del sistema de pagos a proveedores creadas exitosamente' as mensaje;
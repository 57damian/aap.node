-- SCRIPT PARA CREAR TABLAS DEL SISTEMA DE FACTURAS DE COMPRA
-- Ejecutar en PostgreSQL

-- 1. TABLA PRINCIPAL DE FACTURAS DE COMPRA
CREATE TABLE IF NOT EXISTS facturas_compra (
    id SERIAL PRIMARY KEY,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    fecha_emision DATE NOT NULL,
    fecha_recepcion DATE,
    tipo_factura VARCHAR(1) NOT NULL CHECK (tipo_factura IN ('A', 'B', 'C', 'X')),
    punto_venta VARCHAR(4),
    numero_factura VARCHAR(20) NOT NULL,
    numero_comprobante VARCHAR(50), -- CAE
    subtotal NUMERIC(15,2) DEFAULT 0,
    iva NUMERIC(15,2) DEFAULT 0,
    percepciones NUMERIC(15,2) DEFAULT 0,
    retenciones NUMERIC(15,2) DEFAULT 0,
    total NUMERIC(15,2) NOT NULL,
    neto_pagado NUMERIC(15,2) DEFAULT 0,
    condicion_pago VARCHAR(20) DEFAULT 'CONTADO',
    observaciones TEXT,
    estado VARCHAR(20) DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PAGADA', 'ANULADA')),
    created_by INTEGER REFERENCES usuarios(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Restricción única para evitar facturas duplicadas
    UNIQUE(proveedor_id, tipo_factura, punto_venta, numero_factura)
);

-- 2. TABLA DE ITEMS DE FACTURA (CORREGIDA)
-- Primero, eliminar la tabla existente si tiene estructura incorrecta
DROP TABLE IF EXISTS factura_items CASCADE;

CREATE TABLE factura_items (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER NOT NULL REFERENCES facturas_compra(id) ON DELETE CASCADE,
    materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
    descripcion TEXT,
    cantidad NUMERIC(10,3) NOT NULL,
    precio_unitario NUMERIC(15,2) NOT NULL,
    iva_porcentaje NUMERIC(5,2) DEFAULT 21.00,
    subtotal NUMERIC(15,2) NOT NULL,
    iva NUMERIC(15,2) NOT NULL,
    total NUMERIC(15,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. TABLA DE HISTORIAL DE PRECIOS
CREATE TABLE IF NOT EXISTS historial_precios_materias (
    id SERIAL PRIMARY KEY,
    materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    precio_anterior NUMERIC(15,2),
    precio_nuevo NUMERIC(15,2) NOT NULL,
    variacion_porcentaje NUMERIC(5,2),
    factura_id INTEGER REFERENCES facturas_compra(id),
    fecha_cambio DATE NOT NULL,
    created_by INTEGER REFERENCES usuarios(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. TABLA DE PAGOS A PROVEEDORES (MEJORADA)
-- Agregar campos faltantes a la tabla existente
ALTER TABLE pagos_proveedores 
ADD COLUMN IF NOT EXISTS factura_id INTEGER REFERENCES facturas_compra(id),
ADD COLUMN IF NOT EXISTS referencia VARCHAR(100),
ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(50),
ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'CONFIRMADO',
ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES usuarios(id),
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 5. ÍNDICES PARA MEJORAR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_facturas_compra_proveedor ON facturas_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_facturas_compra_estado ON facturas_compra(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_compra_fecha ON facturas_compra(fecha_emision);
CREATE INDEX IF NOT EXISTS idx_factura_items_factura ON factura_items(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_items_materia ON factura_items(materia_prima_id);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_factura ON pagos_proveedores(factura_id);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedores_proveedor ON pagos_proveedores(proveedor_id);

-- 6. FUNCIÓN PARA ACTUALIZAR TIMESTAMP
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 7. TRIGGERS PARA ACTUALIZAR TIMESTAMP
DROP TRIGGER IF EXISTS update_facturas_compra_updated_at ON facturas_compra;
CREATE TRIGGER update_facturas_compra_updated_at
    BEFORE UPDATE ON facturas_compra
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pagos_proveedores_updated_at ON pagos_proveedores;
CREATE TRIGGER update_pagos_proveedores_updated_at
    BEFORE UPDATE ON pagos_proveedores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 8. VISTA PARA FACILITAR CONSULTAS
CREATE OR REPLACE VIEW vista_facturas_compras AS
SELECT 
    fc.id,
    fc.proveedor_id,
    p.nombre as proveedor_nombre,
    p.cuit as proveedor_cuit,
    fc.fecha_emision,
    fc.fecha_recepcion,
    fc.tipo_factura,
    fc.punto_venta,
    fc.numero_factura,
    fc.numero_comprobante,
    fc.subtotal,
    fc.iva,
    fc.percepciones,
    fc.retenciones,
    fc.total,
    fc.neto_pagado,
    fc.total - fc.neto_pagado as saldo_pendiente,
    fc.condicion_pago,
    fc.observaciones,
    fc.estado,
    fc.created_at,
    fc.updated_at,
    u.nombre_completo as creado_por
FROM facturas_compra fc
JOIN proveedores p ON fc.proveedor_id = p.id
LEFT JOIN usuarios u ON fc.created_by = u.id;

-- 9. VISTA PARA ITEMS DE FACTURA
CREATE OR REPLACE VIEW vista_factura_items AS
SELECT 
    fi.id,
    fi.factura_id,
    fi.materia_prima_id,
    mp.codigo as materia_codigo,
    mp.nombre as materia_nombre,
    mp.unidad_medida,
    fi.descripcion,
    fi.cantidad,
    fi.precio_unitario,
    fi.iva_porcentaje,
    fi.subtotal,
    fi.iva,
    fi.total,
    fi.created_at
FROM factura_items fi
JOIN materias_primas mp ON fi.materia_prima_id = mp.id;

-- 10. VISTA PARA PAGOS
CREATE OR REPLACE VIEW vista_pagos_proveedores AS
SELECT 
    pp.id,
    pp.proveedor_id,
    p.nombre as proveedor_nombre,
    pp.factura_id,
    fc.numero_factura,
    fc.tipo_factura,
    fc.punto_venta,
    pp.fecha,
    pp.monto,
    pp.metodo,
    pp.forma_pago,
    pp.referencia,
    pp.observaciones,
    pp.estado,
    pp.created_at,
    u.nombre_completo as creado_por
FROM pagos_proveedores pp
JOIN proveedores p ON pp.proveedor_id = p.id
LEFT JOIN facturas_compra fc ON pp.factura_id = fc.id
LEFT JOIN usuarios u ON pp.created_by = u.id;

-- MENSAJE DE ÉXITO
SELECT '✅ TABLAS DEL SISTEMA DE FACTURAS CREADAS CORRECTAMENTE' as mensaje;
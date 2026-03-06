-- =====================================================
-- SCRIPT SQL PARA CREAR TABLAS DE GESTIÓN DE COMPRAS
-- =====================================================
-- Ejecutar este script en PostgreSQL directamente
-- psql -U postgres -d transformadores -f create-compras-tables.sql

-- =====================================================
-- TABLA: articulos_proveedor
-- Artículos/items que se compran a proveedores
-- =====================================================
CREATE TABLE IF NOT EXISTS articulos_proveedor (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50),
    nombre VARCHAR(200) NOT NULL,
    descripcion TEXT,
    unidad_medida VARCHAR(20) DEFAULT 'UNI',
    proveedor_id INTEGER REFERENCES proveedores(id),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by INTEGER REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_articulos_proveedor 
ON articulos_proveedor(proveedor_id, activo);

CREATE INDEX IF NOT EXISTS idx_articulos_codigo 
ON articulos_proveedor(codigo);

-- =====================================================
-- TABLA: stock_articulos
-- Stock actual por artículo y proveedor
-- =====================================================
CREATE TABLE IF NOT EXISTS stock_articulos (
    id SERIAL PRIMARY KEY,
    articulo_id INTEGER REFERENCES articulos_proveedor(id) ON DELETE CASCADE,
    proveedor_id INTEGER REFERENCES proveedores(id),
    stock_actual DECIMAL(10,2) DEFAULT 0,
    stock_minimo DECIMAL(10,2) DEFAULT 0,
    ubicacion VARCHAR(100),
    ultimo_precio DECIMAL(10,2),
    fecha_ultima_compra DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(articulo_id, proveedor_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_articulos 
ON stock_articulos(proveedor_id, articulo_id);

-- =====================================================
-- TABLA: facturas_compra
-- Facturas de compra a proveedores
-- =====================================================
CREATE TABLE IF NOT EXISTS facturas_compra (
    id SERIAL PRIMARY KEY,
    proveedor_id INTEGER REFERENCES proveedores(id),
    fecha_emision DATE NOT NULL,
    fecha_recepcion DATE,
    tipo_factura VARCHAR(5) NOT NULL,
    punto_venta VARCHAR(10),
    numero_factura VARCHAR(50),
    numero_comprobante VARCHAR(100),
    subtotal DECIMAL(10,2) NOT NULL,
    iva DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    percepciones DECIMAL(10,2) DEFAULT 0,
    retenciones DECIMAL(10,2) DEFAULT 0,
    neto_pagado DECIMAL(10,2),
    condicion_pago VARCHAR(50),
    observaciones TEXT,
    estado VARCHAR(20) DEFAULT 'PENDIENTE',
    created_by INTEGER REFERENCES usuarios(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_factura_proveedor UNIQUE(proveedor_id, tipo_factura, punto_venta, numero_factura)
);

CREATE INDEX IF NOT EXISTS idx_facturas_proveedor 
ON facturas_compra(proveedor_id, fecha_emision);

CREATE INDEX IF NOT EXISTS idx_facturas_estado 
ON facturas_compra(estado);

-- =====================================================
-- TABLA: factura_items
-- Items/detalle de cada factura
-- =====================================================
CREATE TABLE IF NOT EXISTS factura_items (
    id SERIAL PRIMARY KEY,
    factura_id INTEGER REFERENCES facturas_compra(id) ON DELETE CASCADE,
    articulo_id INTEGER REFERENCES articulos_proveedor(id),
    descripcion TEXT,
    cantidad DECIMAL(10,2) NOT NULL,
    precio_unitario DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    iva DECIMAL(10,2) DEFAULT 0,
    iva_porcentaje DECIMAL(5,2) DEFAULT 21,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_factura_items_factura 
ON factura_items(factura_id);

CREATE INDEX IF NOT EXISTS idx_factura_items_articulo 
ON factura_items(articulo_id);

-- =====================================================
-- TABLA: historial_precios_articulos
-- Registro histórico de todos los cambios de precios
-- =====================================================
CREATE TABLE IF NOT EXISTS historial_precios_articulos (
    id SERIAL PRIMARY KEY,
    articulo_id INTEGER REFERENCES articulos_proveedor(id),
    proveedor_id INTEGER REFERENCES proveedores(id),
    precio_anterior DECIMAL(10,2),
    precio_nuevo DECIMAL(10,2) NOT NULL,
    variacion_porcentaje DECIMAL(5,2),
    factura_id INTEGER REFERENCES facturas_compra(id),
    fecha_cambio DATE NOT NULL,
    observacion TEXT,
    created_by INTEGER REFERENCES usuarios(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historial_precios_articulo 
ON historial_precios_articulos(articulo_id, fecha_cambio);

CREATE INDEX IF NOT EXISTS idx_historial_precios_proveedor 
ON historial_precios_articulos(proveedor_id, fecha_cambio);

-- =====================================================
-- TABLA: movimientos_stock
-- Registro de todos los movimientos de stock
-- =====================================================
CREATE TABLE IF NOT EXISTS movimientos_stock (
    id SERIAL PRIMARY KEY,
    articulo_id INTEGER REFERENCES articulos_proveedor(id),
    proveedor_id INTEGER REFERENCES proveedores(id),
    tipo_movimiento VARCHAR(20) NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    stock_anterior DECIMAL(10,2),
    stock_nuevo DECIMAL(10,2),
    factura_id INTEGER REFERENCES facturas_compra(id),
    observacion TEXT,
    created_by INTEGER REFERENCES usuarios(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movimientos_stock_articulo 
ON movimientos_stock(articulo_id, created_at);

-- =====================================================
-- MODIFICACIONES A TABLA PROVEEDORES
-- =====================================================
ALTER TABLE proveedores
ADD COLUMN IF NOT EXISTS dias_credito INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS forma_pago_habitual VARCHAR(50),
ADD COLUMN IF NOT EXISTS ultima_compra DATE,
ADD COLUMN IF NOT EXISTS total_compras DECIMAL(10,2) DEFAULT 0;

-- =====================================================
-- CONFIRMACIÓN
-- =====================================================
SELECT '✅ Todas las tablas creadas exitosamente' as resultado;

-- SCRIPT PARA CREAR TABLA DE ITEMS DE FACTURA DE COMPRA CON ÍTEMS MANUALES
-- Ejecutar en PostgreSQL

-- 1. TABLA DE ITEMS DE FACTURA DE COMPRA (MEJORADA)
-- Primero, verificar si existe la tabla factura_items y modificarla si es necesario
DO $$
BEGIN
    -- Verificar si existe la tabla factura_items
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'factura_items') THEN
        -- Agregar columnas faltantes si la tabla existe
        ALTER TABLE factura_items 
        ADD COLUMN IF NOT EXISTS codigo VARCHAR(50),
        ADD COLUMN IF NOT EXISTS nombre VARCHAR(200),
        ADD COLUMN IF NOT EXISTS unidad_medida VARCHAR(10) DEFAULT 'UNI',
        ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5,2) DEFAULT 21.00,
        ADD COLUMN IF NOT EXISTS es_item_manual BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS creado_como_materia_prima BOOLEAN DEFAULT false;
        
        -- Hacer materia_prima_id nullable para permitir ítems manuales
        ALTER TABLE factura_items ALTER COLUMN materia_prima_id DROP NOT NULL;
        
        RAISE NOTICE '✅ Tabla factura_items actualizada con columnas para ítems manuales';
    ELSE
        -- Crear tabla nueva si no existe
        CREATE TABLE factura_items (
            id SERIAL PRIMARY KEY,
            factura_id INTEGER NOT NULL REFERENCES facturas_compra(id) ON DELETE CASCADE,
            materia_prima_id INTEGER REFERENCES materias_primas(id),
            codigo VARCHAR(50),
            nombre VARCHAR(200),
            descripcion TEXT,
            cantidad NUMERIC(10,3) NOT NULL,
            unidad_medida VARCHAR(10) DEFAULT 'UNI' CHECK (unidad_medida IN ('UNI', 'KG', 'LT')),
            precio_unitario NUMERIC(15,2) NOT NULL,
            iva_porcentaje NUMERIC(5,2) DEFAULT 21.00,
            subtotal NUMERIC(15,2) NOT NULL,
            iva NUMERIC(15,2) NOT NULL,
            total NUMERIC(15,2) NOT NULL,
            es_item_manual BOOLEAN DEFAULT false,
            creado_como_materia_prima BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        RAISE NOTICE '✅ Tabla factura_items creada con soporte para ítems manuales';
    END IF;
END $$;

-- 2. AGREGAR CAMPO CAE A FACTURAS_COMPRA (si no existe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'facturas_compra' AND column_name = 'cae'
    ) THEN
        ALTER TABLE facturas_compra ADD COLUMN cae VARCHAR(100);
        RAISE NOTICE '✅ Campo CAE agregado a facturas_compra';
    END IF;
END $$;

-- 3. AGREGAR CAMPO TIPO_FACTURA CON VALORES A/B/C/X (si no existe con valores correctos)
DO $$
BEGIN
    -- Verificar si existe la columna tipo_factura
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'facturas_compra' AND column_name = 'tipo_factura'
    ) THEN
        -- Verificar si la restricción CHECK existe
        IF NOT EXISTS (
            SELECT FROM information_schema.check_constraints 
            WHERE constraint_name = 'facturas_compra_tipo_factura_check'
        ) THEN
            -- Agregar restricción CHECK para tipos válidos
            ALTER TABLE facturas_compra 
            ADD CONSTRAINT facturas_compra_tipo_factura_check 
            CHECK (tipo_factura IN ('A', 'B', 'C', 'X'));
            RAISE NOTICE '✅ Restricción CHECK agregada para tipo_factura';
        END IF;
    ELSE
        -- Crear columna si no existe
        ALTER TABLE facturas_compra 
        ADD COLUMN tipo_factura VARCHAR(1) NOT NULL DEFAULT 'A' 
        CHECK (tipo_factura IN ('A', 'B', 'C', 'X'));
        RAISE NOTICE '✅ Columna tipo_factura creada con valores A/B/C/X';
    END IF;
END $$;

-- 4. ÍNDICES PARA MEJORAR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_factura_items_factura_id ON factura_items(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_items_materia_prima_id ON factura_items(materia_prima_id);
CREATE INDEX IF NOT EXISTS idx_factura_items_es_item_manual ON factura_items(es_item_manual);
CREATE INDEX IF NOT EXISTS idx_facturas_compra_cae ON facturas_compra(cae);
CREATE INDEX IF NOT EXISTS idx_facturas_compra_tipo_factura ON facturas_compra(tipo_factura);

-- 5. VISTA MEJORADA PARA ITEMS DE FACTURA (INCLUYE ÍTEMS MANUALES)
CREATE OR REPLACE VIEW vista_factura_items_completa AS
SELECT 
    fi.id,
    fi.factura_id,
    fi.materia_prima_id,
    COALESCE(mp.codigo, fi.codigo) as codigo,
    COALESCE(mp.nombre, fi.nombre) as nombre,
    COALESCE(mp.unidad_medida, fi.unidad_medida) as unidad_medida,
    fi.descripcion,
    fi.cantidad,
    fi.precio_unitario,
    fi.iva_porcentaje,
    fi.subtotal,
    fi.iva,
    fi.total,
    fi.es_item_manual,
    fi.creado_como_materia_prima,
    fi.created_at,
    -- Información de materia prima (si existe)
    mp.stock_actual,
    mp.precio_referencia,
    mp.fecha_ultima_compra
FROM factura_items fi
LEFT JOIN materias_primas mp ON fi.materia_prima_id = mp.id;

-- 6. VISTA PARA FACTURAS DE COMPRA CON TOTALES CALCULADOS
CREATE OR REPLACE VIEW vista_facturas_compras_detallada AS
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
    fc.numero_comprobante as cae,
    fc.cae as cae_directo,
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
    u.nombre_completo as creado_por,
    -- Calcular totales desde items
    COALESCE(SUM(fi.subtotal), 0) as subtotal_items,
    COALESCE(SUM(fi.iva), 0) as iva_items,
    COALESCE(SUM(fi.total), 0) as total_items,
    COUNT(fi.id) as cantidad_items,
    SUM(CASE WHEN fi.es_item_manual THEN 1 ELSE 0 END) as items_manuales
FROM facturas_compra fc
JOIN proveedores p ON fc.proveedor_id = p.id
LEFT JOIN usuarios u ON fc.created_by = u.id
LEFT JOIN factura_items fi ON fc.id = fi.factura_id
GROUP BY fc.id, p.nombre, p.cuit, u.nombre_completo;

-- 7. FUNCIÓN PARA CREAR MATERIA PRIMA DESDE ÍTEM MANUAL
CREATE OR REPLACE FUNCTION crear_materia_prima_desde_item(
    p_codigo VARCHAR(50),
    p_nombre VARCHAR(200),
    p_unidad_medida VARCHAR(10),
    p_precio_referencia NUMERIC(15,2),
    p_usuario_id INTEGER
)
RETURNS INTEGER AS $$
DECLARE
    nueva_materia_prima_id INTEGER;
BEGIN
    -- Insertar nueva materia prima
    INSERT INTO materias_primas (
        codigo,
        nombre,
        unidad_medida,
        precio_referencia,
        stock_actual,
        fecha_ultima_compra,
        created_by,
        created_at,
        updated_at
    ) VALUES (
        p_codigo,
        p_nombre,
        p_unidad_medida,
        p_precio_referencia,
        0, -- stock inicial 0
        CURRENT_DATE,
        p_usuario_id,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ) RETURNING id INTO nueva_materia_prima_id;
    
    -- Crear registro en historial de precios
    INSERT INTO historial_precios_materias (
        materia_prima_id,
        proveedor_id,
        precio_anterior,
        precio_nuevo,
        variacion_porcentaje,
        fecha_cambio,
        created_by,
        created_at
    ) VALUES (
        nueva_materia_prima_id,
        NULL, -- proveedor desconocido
        NULL, -- no hay precio anterior
        p_precio_referencia,
        0, -- variación 0%
        CURRENT_DATE,
        p_usuario_id,
        CURRENT_TIMESTAMP
    );
    
    RETURN nueva_materia_prima_id;
END;
$$ LANGUAGE plpgsql;

-- 8. FUNCIÓN PARA ACTUALIZAR PRECIO DE REFERENCIA
CREATE OR REPLACE FUNCTION actualizar_precio_referencia(
    p_materia_prima_id INTEGER,
    p_nuevo_precio NUMERIC(15,2),
    p_proveedor_id INTEGER,
    p_factura_id INTEGER,
    p_usuario_id INTEGER
)
RETURNS VOID AS $$
DECLARE
    precio_anterior NUMERIC(15,2);
    variacion NUMERIC(5,2);
BEGIN
    -- Obtener precio anterior
    SELECT precio_referencia INTO precio_anterior
    FROM materias_primas
    WHERE id = p_materia_prima_id;
    
    -- Calcular variación porcentual
    IF precio_anterior > 0 THEN
        variacion := ((p_nuevo_precio - precio_anterior) / precio_anterior) * 100;
    ELSE
        variacion := 0;
    END IF;
    
    -- Actualizar precio en materia prima
    UPDATE materias_primas
    SET 
        precio_referencia = p_nuevo_precio,
        fecha_ultima_compra = CURRENT_DATE,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_materia_prima_id;
    
    -- Registrar en historial de precios
    INSERT INTO historial_precios_materias (
        materia_prima_id,
        proveedor_id,
        precio_anterior,
        precio_nuevo,
        variacion_porcentaje,
        factura_id,
        fecha_cambio,
        created_by,
        created_at
    ) VALUES (
        p_materia_prima_id,
        p_proveedor_id,
        precio_anterior,
        p_nuevo_precio,
        variacion,
        p_factura_id,
        CURRENT_DATE,
        p_usuario_id,
        CURRENT_TIMESTAMP
    );
END;
$$ LANGUAGE plpgsql;

-- 9. FUNCIÓN PARA ACTUALIZAR STOCK DESDE FACTURA
CREATE OR REPLACE FUNCTION actualizar_stock_desde_factura(
    p_factura_id INTEGER,
    p_usuario_id INTEGER
)
RETURNS VOID AS $$
DECLARE
    item RECORD;
    movimiento_id INTEGER;
BEGIN
    -- Recorrer todos los items de la factura que tienen materia_prima_id
    FOR item IN 
        SELECT fi.*, fc.proveedor_id
        FROM factura_items fi
        JOIN facturas_compra fc ON fi.factura_id = fc.id
        WHERE fi.factura_id = p_factura_id 
        AND fi.materia_prima_id IS NOT NULL
    LOOP
        -- Actualizar stock de materia prima
        UPDATE materias_primas
        SET 
            stock_actual = stock_actual + item.cantidad,
            fecha_ultima_compra = CURRENT_DATE,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = item.materia_prima_id;
        
        -- Crear movimiento de stock
        INSERT INTO stock_movimientos (
            materia_prima_id,
            tipo_movimiento,
            cantidad,
            precio_unitario,
            factura_id,
            proveedor_id,
            observaciones,
            created_by,
            created_at
        ) VALUES (
            item.materia_prima_id,
            'ENTRADA',
            item.cantidad,
            item.precio_unitario,
            p_factura_id,
            item.proveedor_id,
            'Compra desde factura ' || (SELECT numero_factura FROM facturas_compra WHERE id = p_factura_id),
            p_usuario_id,
            CURRENT_TIMESTAMP
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 10. TRIGGER PARA ACTUALIZAR STOCK AL CREAR FACTURA
CREATE OR REPLACE FUNCTION trigger_actualizar_stock_factura()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo actualizar stock si la factura está en estado PENDIENTE o PAGADA
    IF NEW.estado IN ('PENDIENTE', 'PAGADA') AND OLD.estado != NEW.estado THEN
        PERFORM actualizar_stock_desde_factura(NEW.id, NEW.created_by);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_stock_factura ON facturas_compra;
CREATE TRIGGER trg_actualizar_stock_factura
    AFTER UPDATE OF estado ON facturas_compra
    FOR EACH ROW
    EXECUTE FUNCTION trigger_actualizar_stock_factura();

-- MENSAJE DE ÉXITO
SELECT '✅ SISTEMA DE FACTURAS DE COMPRA CON ÍTEMS MANUALES CONFIGURADO CORRECTAMENTE' as mensaje;
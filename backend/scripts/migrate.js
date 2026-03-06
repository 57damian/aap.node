const pool = require('../db');

async function migrate() {
    try {
        console.log('🔄 Iniciando migración de la base de datos...');
        
        // Crear tabla compras si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS compras (
                id SERIAL PRIMARY KEY,
                proveedor_id INTEGER NOT NULL,
                fecha_compra DATE NOT NULL,
                numero_comprobante VARCHAR(100),
                numero_oc VARCHAR(100),
                moneda VARCHAR(10) DEFAULT 'ARS',
                condicion_pago VARCHAR(100),
                subtotal DECIMAL(12,2) DEFAULT 0,
                iva DECIMAL(12,2) DEFAULT 0,
                total DECIMAL(12,2) DEFAULT 0,
                estado VARCHAR(50) DEFAULT 'PENDIENTE',
                observaciones TEXT,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Crear tabla compra_items si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS compra_items (
                id SERIAL PRIMARY KEY,
                compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
                materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
                descripcion TEXT,
                unidad VARCHAR(20) NOT NULL,
                cantidad DECIMAL(10,2) NOT NULL,
                precio_unitario DECIMAL(12,2) NOT NULL,
                subtotal DECIMAL(12,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Crear tabla stock_movimientos si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_movimientos (
                id SERIAL PRIMARY KEY,
                materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
                fecha_movimiento DATE NOT NULL,
                tipo_movimiento VARCHAR(50) NOT NULL, -- 'COMPRA', 'VENTA', 'AJUSTE', etc.
                cantidad DECIMAL(10,2) NOT NULL,
                unidad VARCHAR(20) NOT NULL,
                compra_item_id INTEGER REFERENCES compra_items(id),
                observaciones TEXT,
                usuario_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Crear tabla precios_materia_prima si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS precios_materia_prima (
                id SERIAL PRIMARY KEY,
                materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
                fecha_desde DATE NOT NULL,
                precio_unitario DECIMAL(12,2) NOT NULL,
                proveedor_id INTEGER,
                moneda VARCHAR(10) DEFAULT 'ARS',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(materia_prima_id, fecha_desde)
            )
        `);
        
        console.log('✅ Tablas de compras creadas correctamente');
        
        // Crear tabla materias_primas si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS materias_primas (
                id SERIAL PRIMARY KEY,
                codigo VARCHAR(50) UNIQUE,
                nombre VARCHAR(200) NOT NULL,
                descripcion TEXT,
                unidad_medida VARCHAR(20) NOT NULL DEFAULT 'UNI',
                stock_actual DECIMAL(10,2) DEFAULT 0,
                stock_minimo DECIMAL(10,2) DEFAULT 0,
                ubicacion VARCHAR(100),
                activo BOOLEAN DEFAULT true,
                creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ Tabla materias_primas creada correctamente');
        
        // Crear trigger para actualizar actualizado_en
        await pool.query(`
            CREATE OR REPLACE FUNCTION actualizar_timestamp()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.actualizado_en = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `);
        
        await pool.query(`
            CREATE TRIGGER trigger_materias_primas_actualizado
                BEFORE UPDATE ON materias_primas
                FOR EACH ROW
                EXECUTE FUNCTION actualizar_timestamp();
        `);
        
        // Trigger para tabla compras
        await pool.query(`
            CREATE TRIGGER trigger_compras_actualizado
                BEFORE UPDATE ON compras
                FOR EACH ROW
                EXECUTE FUNCTION actualizar_timestamp();
        `);
        
        console.log('✅ Triggers de timestamp creados');
        console.log('🎉 Migración completada exitosamente');
        
    } catch (err) {
        console.error('❌ Error en migración:', err);
    } finally {
        pool.end();
    }
}

migrate();

const pool = require('./db');

async function checkStockMovimientos() {
    try {
        console.log('🔍 Verificando estructura de la tabla stock_movimientos...');
        
        // Verificar columnas de la tabla
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'stock_movimientos' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n📊 Columnas de stock_movimientos:');
        result.rows.forEach(col => {
            console.log(`  ${col.column_name} (${col.data_type}) - nullable: ${col.is_nullable}`);
        });
        
        // Verificar si existe la columna proveedor_id
        const hasProveedorId = result.rows.some(col => col.column_name === 'proveedor_id');
        console.log(`\n✅ ¿Tiene columna proveedor_id?: ${hasProveedorId ? 'SÍ' : 'NO'}`);
        
        // Verificar si existe la columna precio_unitario
        const hasPrecioUnitario = result.rows.some(col => col.column_name === 'precio_unitario');
        console.log(`✅ ¿Tiene columna precio_unitario?: ${hasPrecioUnitario ? 'SÍ' : 'NO'}`);
        
        // Mostrar la consulta INSERT que está fallando
        console.log('\n🔧 Consulta INSERT que está fallando:');
        console.log(`INSERT INTO stock_movimientos (
            materia_prima_id, tipo_movimiento,
            cantidad, precio_unitario,
            factura_id, proveedor_id,
            observaciones, created_by, created_at
        ) VALUES ($1, 'ENTRADA', $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`);
        
        // Si falta proveedor_id, agregarla
        if (!hasProveedorId) {
            console.log('\n⚠️  Falta la columna proveedor_id. Agregando...');
            try {
                await pool.query(`
                    ALTER TABLE stock_movimientos 
                    ADD COLUMN proveedor_id INTEGER REFERENCES proveedores(id)
                `);
                console.log('✅ Columna proveedor_id agregada exitosamente');
            } catch (err) {
                console.error('❌ Error agregando columna proveedor_id:', err.message);
            }
        }
        
        // Si falta precio_unitario, agregarla
        if (!hasPrecioUnitario) {
            console.log('\n⚠️  Falta la columna precio_unitario. Agregando...');
            try {
                await pool.query(`
                    ALTER TABLE stock_movimientos 
                    ADD COLUMN precio_unitario DECIMAL(10,2)
                `);
                console.log('✅ Columna precio_unitario agregada exitosamente');
            } catch (err) {
                console.error('❌ Error agregando columna precio_unitario:', err.message);
            }
        }
        
        // Verificar estructura final
        console.log('\n📋 Estructura final de stock_movimientos:');
        const finalResult = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'stock_movimientos' 
            ORDER BY ordinal_position
        `);
        
        finalResult.rows.forEach(col => {
            console.log(`  ${col.column_name} (${col.data_type}) - nullable: ${col.is_nullable}`);
        });
        
        console.log('\n🎉 Verificación completada');
        
    } catch (err) {
        console.error('❌ Error en la verificación:', err);
    } finally {
        pool.end();
    }
}

checkStockMovimientos();
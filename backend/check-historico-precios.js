const pool = require('./db');

async function checkHistorialPrecios() {
    try {
        console.log('🔍 Verificando estructura de la tabla historial_precios_materias...');
        
        // Verificar columnas de la tabla
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'historial_precios_materias' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n📊 Columnas de historial_precios_materias:');
        result.rows.forEach(col => {
            console.log(`  ${col.column_name} (${col.data_type}) - nullable: ${col.is_nullable}`);
        });
        
        // Verificar si existe la tabla precios_materia_prima
        const result2 = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'precios_materia_prima' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n📊 Columnas de precios_materia_prima:');
        result2.rows.forEach(col => {
            console.log(`  ${col.column_name} (${col.data_type}) - nullable: ${col.is_nullable}`);
        });
        
        // Verificar estructura de materias_primas
        const result3 = await pool.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'materias_primas' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n📊 Columnas de materias_primas:');
        result3.rows.forEach(col => {
            console.log(`  ${col.column_name} (${col.data_type}) - nullable: ${col.is_nullable}`);
        });
        
        // Verificar si existe columna precio_referencia en materias_primas
        const hasPrecioReferencia = result3.rows.some(col => col.column_name === 'precio_referencia');
        console.log(`\n✅ ¿Tiene columna precio_referencia en materias_primas?: ${hasPrecioReferencia ? 'SÍ' : 'NO'}`);
        
        console.log('\n🎉 Verificación completada');
        
    } catch (err) {
        console.error('❌ Error en la verificación:', err);
    } finally {
        pool.end();
    }
}

checkHistorialPrecios();
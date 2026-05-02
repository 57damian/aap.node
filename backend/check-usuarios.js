const pool = require('./db');

async function checkUsuariosTable() {
    try {
        console.log('✅ Conectado a PostgreSQL');
        
        // Verificar columnas de la tabla usuarios
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'usuarios' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n📋 Columnas de la tabla usuarios:');
        if (result.rows.length === 0) {
            console.log('   La tabla usuarios no existe o no tiene columnas');
        } else {
            result.rows.forEach(row => {
                console.log(`   - ${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
            });
        }
        
        // Verificar datos existentes
        const dataResult = await pool.query('SELECT * FROM usuarios LIMIT 5');
        console.log('\n📊 Datos existentes en usuarios (primeros 5):');
        if (dataResult.rows.length === 0) {
            console.log('   No hay datos en la tabla usuarios');
        } else {
            dataResult.rows.forEach((row, index) => {
                console.log(`   ${index + 1}. ${JSON.stringify(row)}`);
            });
        }
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        pool.end();
    }
}

checkUsuariosTable();
const pool = require('./db');

async function checkTable() {
    try {
        // Check if table exists
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'pagos_proveedores'
            );`
        );
        console.log('Table pagos_proveedores exists:', tableCheck.rows[0].exists);
        
        if (tableCheck.rows[0].exists) {
            // Get column info
            const columns = await pool.query(`
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_name = 'pagos_proveedores'
                ORDER BY ordinal_position;`
            );
            console.log('\nColumns in pagos_proveedores:');
            columns.rows.forEach(col => {
                console.log(`  ${col.column_name} (${col.data_type}) - nullable: ${col.is_nullable}`);
            });
            
            // Check for fecha_pago column specifically
            const fechaPagoCheck = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'pagos_proveedores' AND column_name = 'fecha_pago'
                );`
            );
            console.log('\nfecha_pago column exists:', fechaPagoCheck.rows[0].exists);
            
            // Also check what columns start with 'fecha'
            const fechaColumns = await pool.query(`
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'pagos_proveedores' AND column_name LIKE 'fecha%';`
            );
            console.log('\nColumns starting with "fecha":');
            fechaColumns.rows.forEach(col => {
                console.log(`  ${col.column_name}`);
            });
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        pool.end();
    }
}

checkTable();
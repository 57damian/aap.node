const pool = require('../db');

(async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('=== CORRIGIENDO CLAVE FORÁNEA DE stock_movimientos ===\n');
    
    // 1. Eliminar la clave foránea existente
    console.log('1. Eliminando clave foránea existente...');
    await client.query(`
      ALTER TABLE stock_movimientos 
      DROP CONSTRAINT IF EXISTS stock_movimientos_factura_id_fkey;
    `);
    console.log('   ✓ Clave foránea eliminada\n');
    
    // 2. Crear nueva clave foránea que apunte a facturas_compra
    console.log('2. Creando nueva clave foránea que apunte a facturas_compra...');
    await client.query(`
      ALTER TABLE stock_movimientos 
      ADD CONSTRAINT stock_movimientos_factura_id_fkey 
      FOREIGN KEY (factura_id) 
      REFERENCES facturas_compra(id) 
      ON DELETE SET NULL;
    `);
    console.log('   ✓ Nueva clave foránea creada\n');
    
    // 3. Verificar que la clave foránea se creó correctamente
    console.log('3. Verificando clave foránea...');
    const fkRes = await client.query(`
      SELECT
        tc.constraint_name,
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
      WHERE 
        tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_name = 'stock_movimientos'
        AND kcu.column_name = 'factura_id';
    `);
    
    console.log('   Clave foránea actual:');
    console.table(fkRes.rows);
    
    await client.query('COMMIT');
    console.log('\n=== CORRECCIÓN COMPLETADA EXITOSAMENTE ===');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error corrigiendo clave foránea:', err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
})();
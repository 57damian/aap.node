const pool = require('../db');

(async () => {
  try {
    console.log('=== ESTRUCTURA DE TABLA proveedores ===\n');
    
    // Verificar estructura de proveedores
    const res = await pool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'proveedores'
      ORDER BY ordinal_position;
    `);
    console.log('=== COLUMNAS DE proveedores ===');
    console.table(res.rows);
    
    // Verificar si existen las columnas específicas
    const columnsToCheck = ['total_compras', 'ultima_compra', 'updated_at'];
    
    console.log('\n=== VERIFICACIÓN DE COLUMNAS ESPECÍFICAS ===');
    for (const column of columnsToCheck) {
      const exists = res.rows.some(row => row.column_name === column);
      console.log(`  ${column}: ${exists ? '✅ EXISTE' : '❌ NO EXISTE'}`);
    }
    
    // Verificar restricciones de clave foránea
    const fkRes = await pool.query(`
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
        AND tc.table_name = 'proveedores';
    `);
    
    console.log('\n=== CLAVES FORÁNEAS DE proveedores ===');
    console.table(fkRes.rows);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
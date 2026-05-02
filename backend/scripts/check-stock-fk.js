const pool = require('../db');

(async () => {
  try {
    // Obtener estructura de stock_movimientos
    const res = await pool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'stock_movimientos'
      ORDER BY ordinal_position;
    `);
    console.log('=== ESTRUCTURA DE stock_movimientos ===');
    console.table(res.rows);
    
    // Obtener restricciones de clave foránea
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
        AND tc.table_name = 'stock_movimientos';
    `);
    console.log('\n=== CLAVES FORÁNEAS DE stock_movimientos ===');
    console.table(fkRes.rows);
    
    // Verificar si existe la tabla facturas_compra
    const tableRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'facturas_compra';
    `);
    console.log('\n=== ¿Existe tabla facturas_compra? ===');
    console.log(tableRes.rows.length > 0 ? 'SÍ' : 'NO');
    
    // Verificar si existe la tabla facturas_proveedor
    const tableRes2 = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'facturas_proveedor';
    `);
    console.log('\n=== ¿Existe tabla facturas_proveedor? ===');
    console.log(tableRes2.rows.length > 0 ? 'SÍ' : 'NO');
    
    // Verificar datos en facturas_compra
    if (tableRes.rows.length > 0) {
      const dataRes = await pool.query(`
        SELECT id, numero_factura, fecha_factura 
        FROM facturas_compra 
        ORDER BY id DESC 
        LIMIT 5;
      `);
      console.log('\n=== ÚLTIMAS 5 FACTURAS EN facturas_compra ===');
      console.table(dataRes.rows);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
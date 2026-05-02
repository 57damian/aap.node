const pool = require('../db');

(async () => {
  try {
    console.log('=== COMPARANDO TABLAS DE FACTURAS ===\n');
    
    // Verificar estructura de facturas_compra
    const fcRes = await pool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'facturas_compra'
      ORDER BY ordinal_position;
    `);
    console.log('=== ESTRUCTURA DE facturas_compra ===');
    console.table(fcRes.rows);
    
    // Verificar estructura de facturas_proveedor
    const fpRes = await pool.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'facturas_proveedor'
      ORDER BY ordinal_position;
    `);
    console.log('\n=== ESTRUCTURA DE facturas_proveedor ===');
    console.table(fpRes.rows);
    
    // Verificar datos en facturas_proveedor
    const fpDataRes = await pool.query(`
      SELECT id, numero_factura, fecha_emision, compra_id, proveedor_id
      FROM facturas_proveedor 
      ORDER BY id DESC 
      LIMIT 5;
    `);
    console.log('\n=== ÚLTIMAS 5 FACTURAS EN facturas_proveedor ===');
    console.table(fpDataRes.rows);
    
    // Verificar datos en facturas_compra
    const fcDataRes = await pool.query(`
      SELECT id, numero_factura, fecha_emision, proveedor_id
      FROM facturas_compra 
      ORDER BY id DESC 
      LIMIT 5;
    `);
    console.log('\n=== ÚLTIMAS 5 FACTURAS EN facturas_compra ===');
    console.table(fcDataRes.rows);
    
    // Verificar restricciones de clave foránea
    const fkRes = await pool.query(`
      SELECT
        tc.table_name,
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
        AND (tc.table_name = 'stock_movimientos' OR tc.table_name = 'facturas_compra' OR tc.table_name = 'facturas_proveedor');
    `);
    console.log('\n=== CLAVES FORÁNEAS RELEVANTES ===');
    console.table(fkRes.rows);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
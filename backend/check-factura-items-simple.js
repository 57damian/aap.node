// Script simple para verificar estructura de factura_items
// Usando las mismas credenciales que el servidor

const { Pool } = require('pg');

// Configuración directa (igual que en db.js)
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres2026',
    database: 'transformadores',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

(async () => {
  try {
    console.log('Intentando conectar a la base de datos...');
    
    // Primero probar una consulta simple
    const testRes = await pool.query('SELECT 1 as test');
    console.log('✅ Conexión exitosa');
    
    // Verificar estructura de factura_items
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'factura_items'
      ORDER BY ordinal_position
    `);
    
    console.log('\n=== COLUMNAS DE factura_items ===');
    if (res.rows.length === 0) {
      console.log('La tabla factura_items no existe o no tiene columnas');
    } else {
      console.table(res.rows);
    }
    
    // También verificar si existe la tabla
    const tableRes = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'factura_items'
      );
    `);
    console.log('\n¿Existe la tabla factura_items?', tableRes.rows[0].exists);
    
    // Verificar estructura de venta_items para comparar
    const ventaItemsRes = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'venta_items'
      ORDER BY ordinal_position
      LIMIT 10
    `);
    
    console.log('\n=== PRIMERAS 10 COLUMNAS DE venta_items ===');
    console.table(ventaItemsRes.rows);
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
// Script para actualizar documentación de factura_items
const { Pool } = require('pg');

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
    console.log('Obteniendo estructura actual de factura_items...');
    
    // Obtener estructura actual
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'factura_items'
      ORDER BY ordinal_position
    `);
    
    console.log('\n=== ESTRUCTURA ACTUAL DE factura_items ===');
    console.table(res.rows);
    
    // Generar markdown para la documentación
    console.log('\n=== MARKDOWN PARA DOCUMENTACIÓN ===');
    console.log('### factura_items');
    console.log('');
    console.log('| Columna | Tipo | Nulo | Defecto |');
    console.log('|---------|------|------|---------|');
    
    res.rows.forEach(row => {
      const colName = row.column_name;
      const dataType = row.data_type;
      const isNullable = row.is_nullable === 'YES' ? 'YES' : 'NO';
      const columnDefault = row.column_default || '';
      
      console.log(`| ${colName} | ${dataType} | ${isNullable} | ${columnDefault} |`);
    });
    
    // Verificar si hay datos de ejemplo
    console.log('\n=== DATOS DE EJEMPLO EN factura_items ===');
    const dataRes = await pool.query('SELECT * FROM factura_items LIMIT 3');
    if (dataRes.rows.length > 0) {
      console.table(dataRes.rows);
    } else {
      console.log('No hay datos en la tabla');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
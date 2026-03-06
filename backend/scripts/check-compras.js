const pool = require('../db');

async function checkComprasTable() {
  try {
    const result = await pool.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'compras\' ORDER BY ordinal_position'
    );
    
    console.log('Columnas actuales en tabla compras:');
    result.rows.forEach(row => console.log(`- ${row.column_name}: ${row.data_type}`));
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

checkComprasTable();

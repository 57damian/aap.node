require('dotenv').config();
const pool = require('./db');

(async () => {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'factura_items'
      ORDER BY ordinal_position
    `);
    console.log('Columnas de factura_items:');
    console.table(res.rows);
  } catch (err) {
    console.error('Error:', err.message);
  }
})();

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres2026',
  database: 'transformadores'
});

async function ejecutarScript() {
  const client = await pool.connect();
  try {
    const sqlPath = path.join(__dirname, 'crear-tablas-pagos.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Ejecutando script SQL para crear tablas de pagos...');
    const result = await client.query(sql);
    console.log('Script ejecutado exitosamente:', result.rows[0]?.mensaje || 'OK');
  } catch (error) {
    console.error('Error ejecutando script:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

ejecutarScript();
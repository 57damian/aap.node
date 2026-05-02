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
    
    // Dividir el script en sentencias individuales
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';
      try {
        console.log(`Ejecutando sentencia ${i + 1}/${statements.length}...`);
        await client.query(statement);
      } catch (error) {
        console.warn(`Advertencia en sentencia ${i + 1}: ${error.message}`);
        // Continuar con las siguientes sentencias
      }
    }
    
    console.log('Script ejecutado exitosamente');
    
    // Verificar que las tablas se crearon
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('pagos_proveedores', 'pagos_proveedores_items')
    `);
    
    console.log('Tablas creadas:', tables.rows.map(r => r.table_name).join(', '));
    
  } catch (error) {
    console.error('Error ejecutando script:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

ejecutarScript();
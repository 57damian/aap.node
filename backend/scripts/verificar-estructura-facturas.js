const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres2026',
  database: 'transformadores'
});

async function verificarEstructura() {
  const client = await pool.connect();
  try {
    console.log('Verificando estructura de la tabla facturas_compra...\n');
    
    // 1. Verificar restricciones CHECK
    const constraints = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conrelid = 'facturas_compra'::regclass 
      AND contype = 'c';
    `);
    
    console.log('Restricciones CHECK en facturas_compra:');
    if (constraints.rows.length === 0) {
      console.log('  No hay restricciones CHECK');
    } else {
      constraints.rows.forEach(row => {
        console.log(`  - ${row.conname}: ${row.definition}`);
      });
    }
    
    // 2. Verificar columnas existentes
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'facturas_compra'
      ORDER BY ordinal_position;
    `);
    
    console.log('\nColumnas de la tabla facturas_compra:');
    columns.rows.forEach(row => {
      console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    
    // 3. Verificar valores actuales del campo estado
    try {
      const estados = await client.query(`
        SELECT DISTINCT estado, COUNT(*) as cantidad
        FROM facturas_compra
        GROUP BY estado
        ORDER BY estado;
      `);
      
      console.log('\nValores actuales del campo estado:');
      if (estados.rows.length === 0) {
        console.log('  No hay valores en el campo estado');
      } else {
        estados.rows.forEach(row => {
          console.log(`  - ${row.estado}: ${row.cantidad} facturas`);
        });
      }
    } catch (error) {
      console.log('\nError al verificar valores de estado:', error.message);
    }
    
    // 4. Verificar si hay facturas con saldo pendiente
    try {
      const saldos = await client.query(`
        SELECT 
          COUNT(*) as total_facturas,
          COUNT(CASE WHEN saldo_pendiente > 0 THEN 1 END) as con_saldo_pendiente,
          COUNT(CASE WHEN saldo_pendiente <= 0 THEN 1 END) as sin_saldo_pendiente,
          SUM(saldo_pendiente) as total_saldo_pendiente
        FROM facturas_compra;
      `);
      
      console.log('\nResumen de saldos pendientes:');
      const row = saldos.rows[0];
      console.log(`  - Total facturas: ${row.total_facturas}`);
      console.log(`  - Con saldo pendiente: ${row.con_saldo_pendiente}`);
      console.log(`  - Sin saldo pendiente: ${row.sin_saldo_pendiente}`);
      console.log(`  - Total saldo pendiente: $${row.total_saldo_pendiente || 0}`);
    } catch (error) {
      console.log('\nError al verificar saldos:', error.message);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

verificarEstructura();
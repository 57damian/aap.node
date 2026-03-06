const pool = require('../db');

async function checkCompraItemsTable() {
  try {
    console.log('🔍 Verificando tabla compra_items...');
    
    // Verificar si la tabla existe
    const tableExists = await pool.query(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
      ['compra_items']
    );
    
    if (!tableExists.rows[0].exists) {
      console.log('❌ La tabla compra_items no existe');
      return;
    }
    
    // Mostrar columnas actuales
    const columns = await pool.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'compra_items\' ORDER BY ordinal_position'
    );
    
    console.log('📋 Columnas actuales en tabla compra_items:');
    columns.rows.forEach(row => console.log(`- ${row.column_name}: ${row.data_type}`));
    
    // Verificar qué columnas faltan
    const requiredColumns = ['compra_id', 'materia_prima_id', 'descripcion', 'unidad', 'cantidad', 'precio_unitario', 'subtotal'];
    const existingColumns = columns.rows.map(row => row.column_name);
    const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
    
    if (missingColumns.length > 0) {
      console.log('\n❌ Columnas faltantes:');
      missingColumns.forEach(col => console.log(`- ${col}`));
    } else {
      console.log('\n✅ Todas las columnas requeridas existen');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    pool.end();
  }
}

checkCompraItemsTable();

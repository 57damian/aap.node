const pool = require('../db');

async function fixComprasTable() {
  try {
    console.log('🔄 Actualizando tabla compras...');
    
    // Agregar columna numero_comprobante si no existe
    try {
      await pool.query('ALTER TABLE compras ADD COLUMN numero_comprobante VARCHAR(100)');
      console.log('✅ Columna numero_comprobante agregada');
    } catch (err) {
      if (err.message.includes('column "numero_comprobante" already exists')) {
        console.log('ℹ️ Columna numero_comprobante ya existe');
      } else {
        throw err;
      }
    }
    
    // Agregar columna moneda si no existe
    try {
      await pool.query('ALTER TABLE compras ADD COLUMN moneda VARCHAR(10) DEFAULT \'ARS\'');
      console.log('✅ Columna moneda agregada');
    } catch (err) {
      if (err.message.includes('column "moneda" already exists')) {
        console.log('ℹ️ Columna moneda ya existe');
      } else {
        throw err;
      }
    }
    
    // Renombrar fecha a fecha_compra si es necesario
    try {
      const result = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'compras' AND column_name = 'fecha'
      `);
      
      if (result.rows.length > 0) {
        await pool.query('ALTER TABLE compras RENAME COLUMN fecha TO fecha_compra_old');
        console.log('✅ Columna fecha renombrada a fecha_compra_old');
      }
    } catch (err) {
      console.log('ℹ️ No se pudo renombrar columna fecha:', err.message);
    }
    
    // Verificar estructura final
    const columns = await pool.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'compras\' ORDER BY ordinal_position'
    );
    
    console.log('\n📋 Estructura final de tabla compras:');
    columns.rows.forEach(row => console.log(`- ${row.column_name}: ${row.data_type}`));
    
    console.log('\n🎉 Actualización completada');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    pool.end();
  }
}

fixComprasTable();

const pool = require('../db');

async function fixCompraItemsTable() {
  try {
    console.log('🔄 Actualizando tabla compra_items...');
    
    // Agregar columnas faltantes
    const alteraciones = [
      'ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS materia_prima_id INTEGER',
      'ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS descripcion TEXT',
      'ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS subtotal DECIMAL(12,2)',
      'ALTER TABLE compra_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
    ];
    
    for (const sql of alteraciones) {
      try {
        await pool.query(sql);
        console.log('✅ Columna agregada correctamente');
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.log('⚠️ Error:', err.message);
        }
      }
    }
    
    // Si hay datos existentes, intentar migrarlos
    const existingData = await pool.query('SELECT COUNT(*) as count FROM compra_items');
    if (parseInt(existingData.rows[0].count) > 0) {
      console.log(`📊 Se encontraron ${existingData.rows[0].count} registros existentes`);
      
      // Actualizar subtotal si es null (cantidad * precio_unitario)
      await pool.query(`
        UPDATE compra_items 
        SET subtotal = COALESCE(subtotal, cantidad * precio_unitario)
        WHERE subtotal IS NULL
      `);
      console.log('✅ Subtotales actualizados');
      
      // Migrar datos de producto a descripcion si materia_prima_id es null
      await pool.query(`
        UPDATE compra_items 
        SET descripcion = COALESCE(descripcion, producto)
        WHERE descripcion IS NULL AND materia_prima_id IS NULL
      `);
      console.log('✅ Descripciones migradas desde producto');
    }
    
    // Verificar estructura final
    const columns = await pool.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'compra_items\' ORDER BY ordinal_position'
    );
    
    console.log('\n📋 Estructura final de tabla compra_items:');
    columns.rows.forEach(row => console.log(`- ${row.column_name}: ${row.data_type}`));
    
    // Agregar foreign key si no existe
    try {
      await pool.query(`
        ALTER TABLE compra_items 
        ADD CONSTRAINT fk_compra_items_materia_prima 
        FOREIGN KEY (materia_prima_id) REFERENCES materias_primas(id)
      `);
      console.log('✅ Foreign key agregada');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ No se pudo agregar foreign key:', err.message);
      }
    }
    
    console.log('\n🎉 Actualización de compra_items completada');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    pool.end();
  }
}

fixCompraItemsTable();

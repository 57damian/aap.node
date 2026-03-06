const pool = require('../db');

async function checkAllTables() {
  try {
    console.log('🔍 Analizando estructura de la base de datos...');
    
    const tables = [
      'compras', 'compra_items', 'materias_primas', 'proveedores', 
      'stock_movimientos', 'precios_materia_prima', 'ordenes_compra',
      'orden_compra_items', 'facturas', 'factura_items', 'ventas', 'venta_items'
    ];
    
    for (const tableName of tables) {
      console.log(`\n📋 Tabla: ${tableName}`);
      
      try {
        const columns = await pool.query(
          `SELECT column_name, data_type, is_nullable, column_default 
           FROM information_schema.columns 
           WHERE table_name = $1 
           ORDER BY ordinal_position`,
          [tableName]
        );
        
        if (columns.rows.length === 0) {
          console.log(`  ❌ Tabla no encontrada`);
          continue;
        }
        
        columns.rows.forEach(col => {
          const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
          const def = col.column_default ? ` DEFAULT ${col.column_default}` : '';
          console.log(`  - ${col.column_name}: ${col.data_type} (${nullable}${def})`);
        });
        
        // Verificar foreign keys
        const fks = await pool.query(`
          SELECT
            tc.constraint_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_name = $1
        `, [tableName]);
        
        if (fks.rows.length > 0) {
          console.log('  🔗 Foreign Keys:');
          fks.rows.forEach(fk => {
            console.log(`    - ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
          });
        }
        
      } catch (err) {
        console.log(`  ❌ Error: ${err.message}`);
      }
    }
    
  } catch (err) {
    console.error('❌ Error general:', err.message);
  } finally {
    pool.end();
  }
}

checkAllTables();

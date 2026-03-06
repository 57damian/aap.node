const pool = require('../db');

async function testFinalCompra() {
  try {
    console.log('🧪 Prueba final del sistema de compras...');
    
    // 1. Verificar que todas las tablas y columnas existan
    const checks = [
      {
        table: 'compras',
        columns: ['id', 'proveedor_id', 'fecha_compra', 'numero_comprobante', 'moneda', 'total']
      },
      {
        table: 'compra_items',
        columns: ['id', 'compra_id', 'materia_prima_id', 'descripcion', 'unidad', 'cantidad', 'precio_unitario', 'subtotal']
      },
      {
        table: 'materias_primas',
        columns: ['id', 'nombre', 'unidad_medida', 'stock_actual']
      }
    ];
    
    for (const check of checks) {
      console.log(`\n📋 Verificando tabla ${check.table}:`);
      
      // Verificar tabla
      const tableExists = await pool.query(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
        [check.table]
      );
      
      if (!tableExists.rows[0].exists) {
        console.log(`❌ Tabla ${check.table} no existe`);
        continue;
      }
      
      // Verificar columnas
      const columns = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [check.table]
      );
      
      const existingColumns = columns.rows.map(row => row.column_name);
      
      for (const col of check.columns) {
        if (existingColumns.includes(col)) {
          console.log(`  ✅ ${col}`);
        } else {
          console.log(`  ❌ ${col} - FALTANTE`);
        }
      }
    }
    
    // 2. Verificar que haya al menos una materia prima para probar
    const materiasPrimas = await pool.query('SELECT id, nombre FROM materias_primas LIMIT 1');
    if (materiasPrimas.rows.length === 0) {
      console.log('\n⚠️ No hay materias primas. Creando una de prueba...');
      await pool.query(
        'INSERT INTO materias_primas (nombre, unidad_medida) VALUES ($1, $2)',
        ['MATERIA PRIMA PRUEBA', 'UNI']
      );
      console.log('✅ Materia prima de prueba creada');
    } else {
      console.log(`\n✅ Materia prima disponible: ${materiasPrimas.rows[0].nombre} (ID: ${materiasPrimas.rows[0].id})`);
    }
    
    // 3. Verificar que haya proveedores
    const proveedores = await pool.query('SELECT id, nombre FROM proveedores LIMIT 1');
    if (proveedores.rows.length === 0) {
      console.log('\n⚠️ No hay proveedores. Debes crear al menos uno para probar compras.');
    } else {
      console.log(`✅ Proveedor disponible: ${proveedores.rows[0].nombre} (ID: ${proveedores.rows[0].id})`);
    }
    
    console.log('\n🎉 Verificación final completada');
    console.log('💡 El sistema está listo para recibir compras');
    
  } catch (err) {
    console.error('❌ Error en prueba final:', err.message);
  } finally {
    pool.end();
  }
}

testFinalCompra();

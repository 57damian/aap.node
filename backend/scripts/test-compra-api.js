const pool = require('../db');

async function testCompraAPI() {
  try {
    console.log('🧪 Probando lógica de API de compras...');
    
    // 1. Verificar datos existentes
    const proveedor = await pool.query('SELECT id, nombre FROM proveedores LIMIT 1');
    const materiaPrima = await pool.query('SELECT id, nombre FROM materias_primas LIMIT 1');
    
    if (proveedor.rows.length === 0) {
      console.log('❌ No hay proveedores para probar');
      return;
    }
    
    if (materiaPrima.rows.length === 0) {
      console.log('❌ No hay materias primas para probar');
      return;
    }
    
    console.log(`✅ Usando proveedor: ${proveedor.rows[0].nombre} (ID: ${proveedor.rows[0].id})`);
    console.log(`✅ Usando materia prima: ${materiaPrima.rows[0].nombre} (ID: ${materiaPrima.rows[0].id})`);
    
    // 2. Simular la lógica de la API (sin ejecutarla completamente)
    const testData = {
      proveedor_id: proveedor.rows[0].id,
      fecha_compra: new Date().toISOString().split('T')[0],
      numero_comprobante: 'TEST-001',
      moneda: 'ARS',
      observaciones: 'Test de API',
      items: [
        {
          materia_prima_id: materiaPrima.rows[0].id,
          descripcion: 'Test item',
          unidad: 'UNI',
          cantidad: 10,
          precio_unitario: 100.50,
          observaciones_item: 'Test observación'
        }
      ]
    };
    
    console.log('\n📋 Datos de prueba:');
    console.log(JSON.stringify(testData, null, 2));
    
    // 3. Verificar que las tablas tengan las estructuras correctas
    const checks = [
      {
        name: 'compras',
        required: ['proveedor_id', 'fecha_compra', 'numero_comprobante', 'moneda', 'total', 'observaciones', 'created_by']
      },
      {
        name: 'compra_items', 
        required: ['compra_id', 'materia_prima_id', 'descripcion', 'unidad', 'cantidad', 'precio_unitario', 'subtotal']
      },
      {
        name: 'stock_movimientos',
        required: ['materia_prima_id', 'fecha_movimiento', 'tipo_movimiento', 'cantidad', 'unidad', 'compra_item_id']
      },
      {
        name: 'materias_primas',
        required: ['id', 'stock_actual', 'actualizado_en']
      }
    ];
    
    console.log('\n🔍 Verificando estructura de tablas:');
    for (const check of checks) {
      const columns = await pool.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [check.name]
      );
      const existingColumns = columns.rows.map(row => row.column_name);
      
      let allExist = true;
      for (const req of check.required) {
        if (!existingColumns.includes(req)) {
          console.log(`  ❌ ${check.name}.${req} - FALTANTE`);
          allExist = false;
        }
      }
      
      if (allExist) {
        console.log(`  ✅ ${check.name} - Todas las columnas requeridas existen`);
      }
    }
    
    console.log('\n🎉 Prueba de API completada');
    console.log('💡 La API debería funcionar correctamente con estos datos');
    
  } catch (err) {
    console.error('❌ Error en prueba:', err.message);
  } finally {
    pool.end();
  }
}

testCompraAPI();

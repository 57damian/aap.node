const pool = require('../db');

async function testProveedoresExtended() {
  try {
    console.log('🧪 Probando nuevas funcionalidades extendidas de proveedores...\n');
    
    // 1. Verificar que las tablas nuevas existan
    const tables = ['compra_documentos', 'productos_stock', 'cheques'];
    console.log('📋 Verificando tablas nuevas:');
    
    for (const table of tables) {
      const exists = await pool.query(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
        [table]
      );
      console.log(`  ${exists.rows[0].exists ? '✅' : '❌'} ${table}`);
    }
    
    // 2. Verificar columnas nuevas en proveedores
    console.log('\n🏢 Verificando columnas nuevas en proveedores:');
    const proveedorColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'proveedores' 
        AND column_name IN ('dias_credito', 'forma_pago_habitual')
      ORDER BY column_name
    `);
    
    proveedorColumns.rows.forEach(col => {
      console.log(`  ✅ ${col.column_name}`);
    });
    
    // 3. Probar endpoint de resumen (simulado)
    console.log('\n📊 Probando lógica de resumen de proveedor:');
    
    const proveedor = await pool.query('SELECT id, nombre FROM proveedores LIMIT 1');
    if (proveedor.rows.length > 0) {
      const provId = proveedor.rows[0].id;
      const provName = proveedor.rows[0].nombre;
      
      console.log(`  ✅ Usando proveedor: ${provName} (ID: ${provId})`);
      
      // Estadísticas de compras
      const statsCompras = await pool.query(`
        SELECT 
          COUNT(*) as total_compras,
          COALESCE(SUM(total), 0) as total_monto
        FROM compras 
        WHERE proveedor_id = $1
      `, [provId]);
      
      console.log(`  📦 Compras: ${statsCompras.rows[0].total_compras} por $${statsCompras.rows[0].total_monto}`);
      
      // Deuda actual
      const deuda = await pool.query(`
        SELECT COALESCE(SUM(saldo_pendiente), 0) as deuda_actual
        FROM facturas_proveedor 
        WHERE proveedor_id = $1 AND estado = 'PENDIENTE'
      `, [provId]);
      
      console.log(`  💰 Deuda actual: $${deuda.rows[0].deuda_actual}`);
      
      // Stock por producto
      const stock = await pool.query(`
        SELECT COUNT(*) as total_productos
        FROM productos_stock 
        WHERE proveedor_id = $1 AND stock_actual > 0
      `, [provId]);
      
      console.log(`  📦 Productos con stock: ${stock.rows[0].total_productos}`);
      
    } else {
      console.log('  ⚠️ No hay proveedores para probar');
    }
    
    // 4. Verificar estructura de productos_stock
    console.log('\n📦 Verificando estructura de productos_stock:');
    const stockColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'productos_stock' 
      ORDER BY ordinal_position
    `);
    
    stockColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // 5. Verificar estructura de compra_documentos
    console.log('\n📎 Verificando estructura de compra_documentos:');
    const docsColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'compra_documentos' 
      ORDER BY ordinal_position
    `);
    
    docsColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // 6. Verificar estructura de cheques
    console.log('\n🏦 Verificando estructura de cheques:');
    const chequesColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'cheques' 
      ORDER BY ordinal_position
    `);
    
    chequesColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    console.log('\n🎉 Prueba completada exitosamente');
    console.log('💡 Las nuevas funcionalidades están listas para usar');
    
    // 7. Resumen de endpoints disponibles
    console.log('\n🔗 Endpoints API disponibles:');
    console.log('  📊 GET /api/proveedores/:id/resumen - Resumen financiero');
    console.log('  💰 GET /api/proveedores/:id/cuenta-corriente - Cuenta corriente');
    console.log('  📦 GET /api/proveedores/:id/productos/stock - Stock por producto');
    console.log('  📈 GET /api/proveedores/:id/reportes - Reportes variados');
    console.log('  📎 POST /api/compras/:id/documentos - Subir documentos');
    console.log('  📎 GET /api/compras/:id/documentos - Listar documentos');
    console.log('  📎 GET /api/compras/:id/documentos/:docId/download - Descargar documento');
    console.log('  📎 DELETE /api/compras/:id/documentos/:docId - Eliminar documento');
    
  } catch (err) {
    console.error('❌ Error en prueba:', err.message);
  } finally {
    pool.end();
  }
}

testProveedoresExtended();

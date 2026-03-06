const pool = require('../db');

async function analyzeCurrentStructure() {
  try {
    console.log('🔍 Analizando estructura actual vs especificación requerida...\n');
    
    // Verificar tablas que existen en tu BD vs las requeridas
    const requiredTables = [
      'proveedores', 'compras', 'compra_items', 'materias_primas',
      'stock_movimientos', 'precios_materia_prima', 'facturas_proveedor',
      'pagos_proveedores', 'cheques', 'endosos_cheques'
    ];
    
    const newTablesNeeded = [
      'compra_documentos', 'productos_stock'
    ];
    
    console.log('📋 Tablas existentes vs requeridas:');
    
    for (const table of requiredTables) {
      const exists = await pool.query(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
        [table]
      );
      console.log(`  ${exists.rows[0].exists ? '✅' : '❌'} ${table}`);
    }
    
    console.log('\n🆕 Tablas nuevas necesarias:');
    for (const table of newTablesNeeded) {
      const exists = await pool.query(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
        [table]
      );
      console.log(`  ${exists.rows[0].exists ? '✅' : '🆕'} ${table}`);
    }
    
    // Analizar estructura de proveedores
    console.log('\n🏢 Estructura actual tabla proveedores:');
    const proveedoresColumns = await pool.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'proveedores\' ORDER BY ordinal_position'
    );
    
    proveedoresColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Verificar si hay facturas_proveedor
    console.log('\n🧾 Verificando facturas_proveedor:');
    const facturasProvExists = await pool.query(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = \'facturas_proveedor\')'
    );
    
    if (facturasProvExists.rows[0].exists) {
      const factProvColumns = await pool.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'facturas_proveedor\' ORDER BY ordinal_position'
      );
      
      console.log('  ✅ Tabla facturas_proveedor existe:');
      factProvColumns.rows.forEach(col => {
        console.log(`    - ${col.column_name}: ${col.data_type}`);
      });
    } else {
      console.log('  ❌ Tabla facturas_proveedor NO existe (se necesita crear)');
    }
    
    // Verificar pagos_proveedores
    console.log('\n💰 Verificando pagos_proveedores:');
    const pagosProvExists = await pool.query(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = \'pagos_proveedores\')'
    );
    
    if (pagosProvExists.rows[0].exists) {
      console.log('  ✅ Tabla pagos_proveedores existe');
    } else {
      console.log('  ❌ Tabla pagos_proveedores NO existe (se necesita crear)');
    }
    
    // Verificar cheques y endosos
    console.log('\n🏦 Verificando gestión de cheques:');
    const chequesExists = await pool.query(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = \'cheques\')'
    );
    const endososExists = await pool.query(
      'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = \'endosos_cheques\')'
    );
    
    console.log(`  ${chequesExists.rows[0].exists ? '✅' : '❌'} cheques`);
    console.log(`  ${endososExists.rows[0].exists ? '✅' : '❌'} endosos_cheques`);
    
    console.log('\n🎯 Análisis completado');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    pool.end();
  }
}

analyzeCurrentStructure();

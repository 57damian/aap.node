const pool = require('../db');

async function diagnosticarFacturas() {
  console.log('🔍 DIAGNÓSTICO DEL SISTEMA DE FACTURAS DE COMPRA\n');
  
  try {
    // 1. Verificar tablas relacionadas con facturas
    console.log('📋 1. TABLAS RELACIONADAS CON FACTURAS:');
    
    const tablasRelevantes = [
      'facturas_compra',
      'factura_items',
      'materias_primas',
      'stock_movimientos',
      'proveedores',
      'usuarios',
      'pagos_proveedores',
      'historial_precios_articulos'
    ];
    
    for (const tabla of tablasRelevantes) {
      try {
        const result = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = '${tabla}'
          ) as existe
        `);
        
        console.log(`   ${tabla}: ${result.rows[0].existe ? '✅ EXISTE' : '❌ NO EXISTE'}`);
        
        if (result.rows[0].existe) {
          const columns = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = '${tabla}'
            ORDER BY ordinal_position
          `);
          
          console.log(`     Columnas (${columns.rows.length}):`);
          columns.rows.forEach(col => {
            console.log(`       - ${col.column_name} (${col.data_type})`);
          });
        }
      } catch (err) {
        console.log(`   ${tabla}: ❌ ERROR: ${err.message}`);
      }
    }
    
    console.log('\n📊 2. ESTADÍSTICAS DE DATOS:');
    
    // Contar facturas por estado
    try {
      const facturasCount = await pool.query(`
        SELECT estado, COUNT(*) as cantidad
        FROM facturas_compra
        GROUP BY estado
      `);
      
      console.log('   Facturas por estado:');
      facturasCount.rows.forEach(row => {
        console.log(`     ${row.estado || 'SIN ESTADO'}: ${row.cantidad}`);
      });
    } catch (err) {
      console.log(`   ❌ No se pudo contar facturas: ${err.message}`);
    }
    
    // Contar materias primas
    try {
      const mpCount = await pool.query(`
        SELECT COUNT(*) as total, 
               COUNT(CASE WHEN activo = true THEN 1 END) as activas
        FROM materias_primas
      `);
      
      console.log(`   Materias primas: ${mpCount.rows[0].total} total, ${mpCount.rows[0].activas} activas`);
    } catch (err) {
      console.log(`   ❌ No se pudo contar materias primas: ${err.message}`);
    }
    
    // Verificar proveedores
    try {
      const proveedoresCount = await pool.query(`
        SELECT COUNT(*) as total FROM proveedores
      `);
      
      console.log(`   Proveedores: ${proveedoresCount.rows[0].total}`);
    } catch (err) {
      console.log(`   ❌ No se pudo contar proveedores: ${err.message}`);
    }
    
    console.log('\n🔗 3. VERIFICAR RELACIONES:');
    
    // Verificar si hay facturas sin proveedor
    try {
      const facturasSinProveedor = await pool.query(`
        SELECT COUNT(*) as cantidad
        FROM facturas_compra fc
        LEFT JOIN proveedores p ON fc.proveedor_id = p.id
        WHERE p.id IS NULL
      `);
      
      console.log(`   Facturas sin proveedor válido: ${facturasSinProveedor.rows[0].cantidad}`);
    } catch (err) {
      console.log(`   ❌ No se pudo verificar relaciones: ${err.message}`);
    }
    
    // Verificar si hay items sin materia prima
    try {
      const itemsSinMP = await pool.query(`
        SELECT COUNT(*) as cantidad
        FROM factura_items fi
        LEFT JOIN materias_primas mp ON fi.articulo_id = mp.id
        WHERE mp.id IS NULL
      `);
      
      console.log(`   Items de factura sin materia prima válida: ${itemsSinMP.rows[0].cantidad}`);
    } catch (err) {
      console.log(`   ❌ No se pudo verificar items: ${err.message}`);
    }
    
    console.log('\n⚠️  4. PROBLEMAS IDENTIFICADOS:');
    
    // Verificar campos faltantes en frontend
    const camposFrontend = ['pagado', 'saldo', 'cae'];
    const camposBackend = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'facturas_compra'
    `);
    
    const camposBackendList = camposBackend.rows.map(r => r.column_name);
    
    console.log('   Campos esperados por frontend vs backend:');
    camposFrontend.forEach(campo => {
      const existe = camposBackendList.includes(campo);
      console.log(`     ${campo}: ${existe ? '✅ EN BACKEND' : '❌ FALTANTE'}`);
    });
    
    console.log('\n✅ DIAGNÓSTICO COMPLETADO');
    
  } catch (error) {
    console.error('❌ ERROR EN DIAGNÓSTICO:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticarFacturas().catch(console.error);
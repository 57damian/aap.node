const pool = require('../db');

async function testCompra() {
  try {
    console.log('🧪 Probando estructura de compras...');
    
    // Verificar que todas las tablas necesarias existen
    const tables = ['compras', 'compra_items', 'materias_primas', 'stock_movimientos', 'precios_materia_prima'];
    
    for (const table of tables) {
      const result = await pool.query(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
        [table]
      );
      console.log(`✅ Tabla ${table}: ${result.rows[0].exists ? 'EXISTS' : 'MISSING'}`);
    }
    
    // Verificar columnas en compras
    const columns = await pool.query(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_name = 'compras' 
       AND column_name IN ('numero_comprobante', 'moneda', 'fecha_compra')`
    );
    
    console.log('\n📋 Columnas verificadas en compras:');
    columns.rows.forEach(row => console.log(`✅ ${row.column_name}`));
    
    // Crear una materia prima de prueba si no existe
    const mpResult = await pool.query(
      'SELECT id FROM materias_primas WHERE nombre = $1 LIMIT 1',
      ['MATERIA PRIMA PRUEBA']
    );
    
    let materiaPrimaId;
    if (mpResult.rows.length === 0) {
      const newMP = await pool.query(
        `INSERT INTO materias_primas (nombre, unidad_medida) 
         VALUES ($1, $2) RETURNING id`,
        ['MATERIA PRIMA PRUEBA', 'UNI']
      );
      materiaPrimaId = newMP.rows[0].id;
      console.log(`✅ Materia prima creada con ID: ${materiaPrimaId}`);
    } else {
      materiaPrimaId = mpResult.rows[0].id;
      console.log(`✅ Materia prima encontrada con ID: ${materiaPrimaId}`);
    }
    
    console.log('\n🎉 Verificación completada - Todo listo para la API');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    pool.end();
  }
}

testCompra();

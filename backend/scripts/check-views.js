const pool = require('../db');

async function checkViews() {
  try {
    console.log('🔍 Verificando vistas en la base de datos...\n');
    
    // Verificar vistas existentes
    const viewsRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('📊 Vistas existentes:');
    if (viewsRes.rows.length === 0) {
      console.log('   No hay vistas en la base de datos');
    } else {
      viewsRes.rows.forEach(row => console.log(`   - ${row.table_name}`));
    }
    
    // Verificar si existe la vista stock_actual
    console.log('\n🔎 Buscando vista stock_actual...');
    try {
      const stockViewRes = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'stock_actual' 
        ORDER BY ordinal_position
      `);
      
      if (stockViewRes.rows.length > 0) {
        console.log('✅ Vista stock_actual encontrada con columnas:');
        stockViewRes.rows.forEach(col => console.log(`   - ${col.column_name} (${col.data_type})`));
      } else {
        console.log('❌ Vista stock_actual NO existe');
      }
    } catch (err) {
      console.log('❌ Vista stock_actual NO existe (error al consultar):', err.message);
    }
    
    // Verificar tablas relacionadas con stock
    console.log('\n📋 Tablas relacionadas con stock:');
    const tablesRes = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name LIKE '%stock%'
      ORDER BY table_name
    `);
    
    tablesRes.rows.forEach(row => console.log(`   - ${row.table_name}`));
    
    // Verificar estructura de tabla materias_primas
    console.log('\n📦 Estructura de tabla materias_primas:');
    const mpColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'materias_primas' 
      ORDER BY ordinal_position
    `);
    
    mpColumns.rows.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'YES' ? '(nullable)' : ''}`);
    });
    
    // Verificar si existe tabla stock_articulos
    console.log('\n📦 Verificando tabla stock_articulos...');
    try {
      const saRes = await pool.query(`
        SELECT COUNT(*) as count FROM stock_articulos
      `);
      console.log(`   ✅ Tabla stock_articulos existe con ${saRes.rows[0].count} registros`);
    } catch (err) {
      console.log('   ❌ Tabla stock_articulos NO existe o tiene error:', err.message);
    }
    
  } catch (err) {
    console.error('❌ Error general:', err);
  } finally {
    await pool.end();
  }
}

checkViews();
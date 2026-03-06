const pool = require('../db');

async function checkExistingTables() {
  try {
    console.log('🔍 Verificando tablas existentes...');
    
    // Obtener todas las tablas
    const result = await pool.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('usuarios', 'clientes')
      ORDER BY table_name, ordinal_position
    `);
    
    const tablas = {};
    result.rows.forEach(row => {
      if (!tablas[row.table_name]) {
        tablas[row.table_name] = [];
      }
      tablas[row.table_name].push({
        columna: row.column_name,
        tipo: row.data_type
      });
    });
    
    console.log('\n📋 Estructura de tablas existentes:');
    
    Object.keys(tablas).forEach(tabla => {
      console.log(`\n🏢 Tabla: ${tabla}`);
      tablas[tabla].forEach(col => {
        console.log(`  - ${col.columna}: ${col.tipo}`);
      });
    });
    
    // Verificar si hay conflicto con la columna email
    const usuariosColumns = tablas['usuarios'] || [];
    const clientesColumns = tablas['clientes'] || [];
    
    console.log('\n🔍 Verificando conflicto de columnas:');
    console.log(`Columnas en usuarios: ${usuariosColumns.map(c => c.columna).join(', ')}`);
    console.log(`Columnas en clientes: ${clientesColumns.map(c => c.columna).join(', ')}`);
    
    const emailConflict = usuariosColumns.some(col => col.columna === 'email') && 
                         clientesColumns.some(col => col.columna === 'email');
    
    if (emailConflict) {
      console.log('⚠️ Conflicto detectado: La columna email ya existe en otra tabla');
      console.log('💡 Solución: Renombrar columna a email_usuario en la tabla usuarios');
    }
    
  } catch (err) {
    console.error('❌ Error verificando tablas:', err);
  } finally {
    pool.end();
  }
}

checkExistingTables();

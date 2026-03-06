const pool = require('./db');

async function testUserCreation() {
  try {
    console.log('🔍 Verificando usuarios en la base de datos...');
    
    // Obtener todos los usuarios
    const result = await pool.query('SELECT id, nombre_usuario, email, rol, activo, password_hash IS NOT NULL as has_password FROM usuarios ORDER BY id DESC LIMIT 5');
    
    console.log('Usuarios recientes:');
    console.table(result.rows);
    
    // Verificar si hay usuarios sin contraseña
    const sinPassword = await pool.query('SELECT id, nombre_usuario FROM usuarios WHERE password_hash IS NULL OR password_hash = \'\'');
    
    if (sinPassword.rows.length > 0) {
      console.log('❌ USUARIOS SIN CONTRASEÑA:');
      console.table(sinPassword.rows);
    } else {
      console.log('✅ Todos los usuarios tienen contraseña');
    }
    
    // Probar login con un usuario reciente
    if (result.rows.length > 0) {
      const testUser = result.rows[0];
      console.log(`🧪 Probando login con usuario: ${testUser.nombre_usuario}`);
      
      if (testUser.has_password) {
        console.log('✅ Usuario tiene contraseña en la base de datos');
      } else {
        console.log('❌ Usuario NO tiene contraseña en la base de datos');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

testUserCreation();

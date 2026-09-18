const pool = require('../db');

async function createUsuariosTable() {
  try {
    console.log('🔄 Creando tabla de usuarios...');
    
    // Crear tabla de usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre_usuario VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        rol VARCHAR(20) NOT NULL DEFAULT 'operario',
        activo BOOLEAN DEFAULT true,
        nombre_completo VARCHAR(200),
        telefono VARCHAR(50),
        observaciones TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Tabla usuarios creada');
    
    // Crear índices para mejor rendimiento
    await pool.query('CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_usuarios_usuario ON usuarios(nombre_usuario)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios(rol)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON usuarios(activo)');
    
    console.log('✅ Índices creados');
    
    // Insertar usuario administrador por defecto si no existe
    const adminExistente = await pool.query(
      'SELECT id FROM usuarios WHERE rol = $1',
      ['admin']
    );
    
    if (adminExistente.rows.length === 0) {
      // Antes este script sembraba un admin con la contraseña fija 'admin123'
      // y la imprimía. Una instalación quedaba con una clave conocida y
      // publicada en el repositorio. Ahora el admin se crea aparte, con una
      // contraseña aleatoria y de un solo uso.
      console.log('ℹ️ No hay ningún administrador. Creá el primero con:');
      console.log('   node scripts/create-admin.js <nombre_usuario> [email]');
    } else {
      console.log('ℹ️ Ya existe un usuario administrador');
    }
    
    console.log('🎉 Migración de usuarios completada');
    
  } catch (err) {
    console.error('❌ Error creando tabla de usuarios:', err);
  } finally {
    pool.end();
  }
}

createUsuariosTable();

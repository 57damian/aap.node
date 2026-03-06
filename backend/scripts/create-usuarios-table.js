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
      const bcrypt = require('bcryptjs');
      const password = 'admin123';
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);
      
      await pool.query(`
        INSERT INTO usuarios (
          nombre_usuario, email, password_hash, rol, activo, nombre_completo
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, ['admin', 'admin@transformadores.com', passwordHash, 'admin', true, 'Administrador del Sistema']);
      
      console.log('✅ Usuario administrador creado:');
      console.log('   Usuario: admin');
      console.log('   Email: admin@transformadores.com');
      console.log('   Contraseña: admin123');
      console.log('   ⚠️ Recuerda cambiar la contraseña en el primer inicio de sesión');
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

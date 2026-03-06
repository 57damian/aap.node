const pool = require('../db');

async function updateUsuariosTable() {
  try {
    console.log('🔄 Actualizando tabla de usuarios...');
    
    // Verificar estructura actual
    const currentColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'usuarios'
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Columnas actuales en usuarios:');
    currentColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // Columnas que necesitamos
    const requiredColumns = ['id', 'nombre_usuario', 'email', 'password_hash', 'rol', 'activo', 'nombre_completo', 'telefono', 'observaciones', 'created_at', 'updated_at'];
    const existingColumns = currentColumns.rows.map(row => row.column_name);
    
    // Agregar columnas faltantes
    const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
    
    if (missingColumns.length > 0) {
      console.log('\n➕ Agregando columnas faltantes...');
      
      // Renombrar usuario a nombre_usuario si no existe
      if (!existingColumns.includes('nombre_usuario') && existingColumns.includes('usuario')) {
        await pool.query('ALTER TABLE usuarios RENAME COLUMN usuario TO nombre_usuario');
        console.log('✅ Columna usuario renombrada a nombre_usuario');
      }
      
      // Agregar columnas faltantes
      for (const column of missingColumns) {
        try {
          let query = '';
          switch (column) {
            case 'email':
              query = 'ALTER TABLE usuarios ADD COLUMN email VARCHAR(255) UNIQUE';
              break;
            case 'nombre_completo':
              query = 'ALTER TABLE usuarios ADD COLUMN nombre_completo VARCHAR(200)';
              break;
            case 'telefono':
              query = 'ALTER TABLE usuarios ADD COLUMN telefono VARCHAR(50)';
              break;
            case 'observaciones':
              query = 'ALTER TABLE usuarios ADD COLUMN observaciones TEXT';
              break;
            case 'updated_at':
              query = 'ALTER TABLE usuarios ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP';
              break;
            case 'activo':
              query = 'ALTER TABLE usuarios ADD COLUMN activo BOOLEAN DEFAULT true';
              break;
          }
          
          if (query) {
            await pool.query(query);
            console.log(`✅ Columna ${column} agregada`);
          }
        } catch (err) {
          if (!err.message.includes('already exists')) {
            console.log(`⚠️ No se pudo agregar ${column}: ${err.message}`);
          }
        }
      }
    }
    
    // Crear índices si no existen
    console.log('\n🔍 Verificando índices...');
    
    const indices = [
      { name: 'idx_usuarios_email', column: 'email' },
      { name: 'idx_usuarios_usuario', column: 'nombre_usuario' },
      { name: 'idx_usuarios_rol', column: 'rol' },
      { name: 'idx_usuarios_activo', column: 'activo' }
    ];
    
    for (const index of indices) {
      try {
        await pool.query(`CREATE INDEX IF NOT EXISTS ${index.name} ON usuarios(${index.column})`);
        console.log(`✅ Índice ${index.name} creado`);
      } catch (err) {
        console.log(`⚠️ No se pudo crear índice ${index.name}: ${err.message}`);
      }
    }
    
    // Verificar si hay usuario administrador
    const adminExistente = await pool.query(
      "SELECT id FROM usuarios WHERE rol = 'admin'"
    );
    
    if (adminExistente.rows.length === 0) {
      console.log('\n➕ Creando usuario administrador por defecto...');
      
      const bcrypt = require('bcryptjs');
      const password = 'admin123';
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);
      
      // Verificar si ya existe un usuario con nombre_usuario 'admin'
      const usuarioExistente = await pool.query(
        "SELECT id FROM usuarios WHERE nombre_usuario = 'admin'"
      );
      
      if (usuarioExistente.rows.length === 0) {
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
        console.log('ℹ️ Ya existe un usuario con nombre_usuario "admin"');
      }
    } else {
      console.log('ℹ️ Ya existe un usuario con rol "admin"');
    }
    
    // Verificar estructura final
    const finalColumns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'usuarios'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📋 Estructura final de usuarios:');
    finalColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    console.log('\n🎉 Actualización de tabla usuarios completada');
    
  } catch (err) {
    console.error('❌ Error actualizando tabla de usuarios:', err);
  } finally {
    pool.end();
  }
}

updateUsuariosTable();

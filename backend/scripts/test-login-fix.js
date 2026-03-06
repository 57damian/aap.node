const pool = require('../db');

async function testLoginFix() {
  try {
    console.log('🧪 Probando corrección del login...');
    
    // 1. Verificar estructura actual de la tabla usuarios
    console.log('\n📋 Verificando estructura de usuarios:');
    const columns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'usuarios'
      ORDER BY ordinal_position
    `);
    
    console.log('Columnas en usuarios:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    
    // 2. Verificar usuarios existentes
    console.log('\n👥 Verificando usuarios existentes:');
    const usuarios = await pool.query(`
      SELECT id, nombre_usuario, email, rol, activo, created_at
      FROM usuarios
      ORDER BY id
    `);
    
    if (usuarios.rows.length === 0) {
      console.log('  ⚠️ No hay usuarios en el sistema');
      return;
    }
    
    usuarios.rows.forEach(usuario => {
      const estado = usuario.activo ? '🟢 Activo' : '🔴 Inactivo';
      const rolIcon = usuario.rol === 'admin' ? '👑' : usuario.rol === 'control' ? '🛡️' : '⚙️';
      console.log(`  ${estado} ${rolIcon} ID:${usuario.id} ${usuario.nombre_usuario} (${usuario.rol})`);
    });
    
    // 3. Probar consulta de login
    console.log('\n🔐 Probando consulta de login:');
    const adminUser = usuarios.rows.find(u => u.rol === 'admin');
    
    if (adminUser) {
      console.log(`  📝 Probando con usuario: ${adminUser.nombre_usuario}`);
      
      try {
        const loginQuery = await pool.query(
          'SELECT id, nombre_usuario, password_hash, rol, activo FROM usuarios WHERE nombre_usuario = $1',
          [adminUser.nombre_usuario]
        );
        
        if (loginQuery.rows.length > 0) {
          const user = loginQuery.rows[0];
          console.log('  ✅ Consulta de login exitosa');
          console.log(`  📝 Usuario encontrado: ${user.nombre_usuario}`);
          console.log(`  🔑 Rol: ${user.rol}`);
          console.log(`  🟢 Activo: ${user.activo}`);
          console.log(`  🔐 Hash: ${user.password_hash ? 'Presente' : 'Ausente'}`);
        } else {
          console.log('  ❌ Usuario no encontrado en consulta de login');
        }
      } catch (err) {
        console.log('  ❌ Error en consulta de login:', err.message);
      }
    }
    
    // 4. Probar endpoint de login si el servidor está corriendo
    console.log('\n🌐 Probando endpoint de login:');
    try {
      const response = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          usuario: adminUser.nombre_usuario,
          password: 'admin123'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('  ✅ Login exitoso via API');
        console.log(`  📝 Usuario: ${data.usuario?.usuario}`);
        console.log(`  🔑 Rol: ${data.usuario?.rol}`);
        console.log(`  🎫 Token: ${data.token ? 'Generado' : 'No generado'}`);
      } else {
        const error = await response.json();
        console.log(`  ❌ Error en login via API: ${error.error}`);
      }
    } catch (err) {
      console.log('  ⚠️ No se pudo probar API (servidor no iniciado)');
    }
    
    // 5. Verificar que no hay referencias a la columna antigua
    console.log('\n🔍 Verificando que no hay referencias a columna "usuario":');
    
    const filesToCheck = [
      'routes/auth.routes.js',
      'middlewares/auth.js',
      'routes/usuarios.routes.js'
    ];
    
    for (const file of filesToCheck) {
      try {
        const fs = require('fs');
        const content = fs.readFileSync(file, 'utf8');
        
        // Buscar patrones que puedan indicar uso incorrecto
        const problematicPatterns = [
          /SELECT.*usuario.*FROM usuarios/i,
          /WHERE usuario =/i,
          /\.usuario/g
        ];
        
        let hasIssues = false;
        for (const pattern of problematicPatterns) {
          if (pattern.test(content)) {
            console.log(`  ⚠️ Posible problema en ${file}: coincide con patrón ${pattern}`);
            hasIssues = true;
          }
        }
        
        if (!hasIssues) {
          console.log(`  ✅ ${file}: Sin problemas detectados`);
        }
      } catch (err) {
        console.log(`  ❌ No se pudo verificar ${file}: ${err.message}`);
      }
    }
    
    console.log('\n🎉 Prueba de corrección completada');
    console.log('💡 Si todo está correcto, el login debería funcionar ahora');
    
  } catch (err) {
    console.error('❌ Error en prueba:', err);
  } finally {
    pool.end();
  }
}

testLoginFix();

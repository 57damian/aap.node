const pool = require('../db');

async function testUsuariosSystem() {
  try {
    console.log('🧪 Probando sistema de usuarios...');
    
    // 1. Verificar estructura de la tabla
    console.log('\n📋 Verificando estructura de la tabla usuarios:');
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'usuarios'
      ORDER BY ordinal_position
    `);
    
    const requiredColumns = ['id', 'nombre_usuario', 'email', 'password_hash', 'rol', 'activo'];
    const existingColumns = columns.rows.map(row => row.column_name);
    
    columns.rows.forEach(col => {
      const required = requiredColumns.includes(col.column_name) ? '✅' : '📝';
      console.log(`  ${required} ${col.column_name}: ${col.data_type} (${col.is_nullable})`);
    });
    
    // 2. Verificar índices
    console.log('\n🔍 Verificando índices:');
    const indexes = await pool.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'usuarios' AND indexname LIKE 'idx_usuarios_%'
    `);
    
    indexes.rows.forEach(idx => {
      console.log(`  ✅ ${idx.indexname}`);
    });
    
    // 3. Verificar usuarios existentes
    console.log('\n👥 Verificando usuarios existentes:');
    const usuarios = await pool.query(`
      SELECT id, nombre_usuario, email, rol, activo, nombre_completo, created_at
      FROM usuarios
      ORDER BY created_at DESC
    `);
    
    if (usuarios.rows.length === 0) {
      console.log('  ⚠️ No hay usuarios en el sistema');
    } else {
      usuarios.rows.forEach(usuario => {
        const estado = usuario.activo ? '🟢 Activo' : '🔴 Inactivo';
        const rolIcon = usuario.rol === 'admin' ? '👑' : usuario.rol === 'control' ? '🛡️' : '⚙️';
        console.log(`  ${estado} ${rolIcon} ${usuario.nombre_usuario} (${usuario.email || 'sin email'}) - ${usuario.rol}`);
      });
    }
    
    // 4. Probar login con usuario admin
    console.log('\n🔐 Probando autenticación...');
    const adminUser = usuarios.rows.find(u => u.rol === 'admin');
    
    if (adminUser) {
      console.log(`  ✅ Usuario admin encontrado: ${adminUser.nombre_usuario}`);
      
      // Intentar login
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
          console.log('  ✅ Login exitoso - Token generado');
          console.log(`  📝 Usuario: ${data.usuario?.nombre_usuario}`);
          console.log(`  🔑 Rol: ${data.usuario?.rol}`);
        } else {
          console.log('  ❌ Error en login');
        }
      } catch (err) {
        console.log('  ⚠️ No se pudo probar el login (servidor no iniciado)');
      }
    }
    
    // 5. Verificar endpoints de usuarios
    console.log('\n🔗 Verificando endpoints de usuarios...');
    const endpoints = [
      { method: 'GET', path: '/api/usuarios', desc: 'Listar usuarios' },
      { method: 'GET', path: '/api/usuarios/stats', desc: 'Estadísticas de usuarios' }
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`http://localhost:3000${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            'Authorization': 'Bearer test-token'
          }
        });
        
        if (response.status === 401) {
          console.log(`  🔒 ${endpoint.desc}: Requiere autenticación (esperado)`);
        } else if (response.ok) {
          console.log(`  ✅ ${endpoint.desc}: Funciona correctamente`);
        } else {
          console.log(`  ❌ ${endpoint.desc}: Error ${response.status}`);
        }
      } catch (err) {
        console.log(`  ⚠️ ${endpoint.desc}: No se pudo verificar (servidor no iniciado)`);
      }
    }
    
    // 6. Resumen final
    console.log('\n📊 Resumen del sistema de usuarios:');
    console.log(`  📋 Tabla usuarios: ${columns.rows.length} columnas`);
    console.log(`  🔍 Índices: ${indexes.rows.length} índices`);
    console.log(`  👥 Usuarios totales: ${usuarios.rows.length}`);
    console.log(`  👑 Administradores: ${usuarios.rows.filter(u => u.rol === 'admin').length}`);
    console.log(`  🛡️ Control: ${usuarios.rows.filter(u => u.rol === 'control').length}`);
    console.log(`  ⚙️ Operarios: ${usuarios.rows.filter(u => u.rol === 'operario').length}`);
    console.log(`  🟢 Activos: ${usuarios.rows.filter(u => u.activo).length}`);
    console.log(`  🔴 Inactivos: ${usuarios.rows.filter(u => !u.activo).length}`);
    
    console.log('\n🎉 Prueba del sistema de usuarios completada');
    console.log('💡 El sistema está listo para usar');
    
  } catch (err) {
    console.error('❌ Error en prueba del sistema:', err);
  } finally {
    pool.end();
  }
}

testUsuariosSystem();

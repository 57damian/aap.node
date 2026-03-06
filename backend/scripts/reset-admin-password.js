const pool = require('../db');
const bcrypt = require('bcryptjs');

async function resetAdminPassword() {
  try {
    console.log('🔄 Reseteando contraseña del usuario admin...');
    
    // Buscar usuario admin
    const adminResult = await pool.query(
      'SELECT id, nombre_usuario, email, rol FROM usuarios WHERE rol = $1',
      ['admin']
    );
    
    if (adminResult.rows.length === 0) {
      console.log('❌ No se encontró usuario admin');
      return;
    }
    
    const admin = adminResult.rows[0];
    console.log(`📝 Usuario admin encontrado: ${admin.nombre_usuario} (ID: ${admin.id})`);
    
    // Generar nueva contraseña
    const newPassword = 'admin123';
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    
    // Actualizar contraseña
    await pool.query(
      'UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, admin.id]
    );
    
    console.log('✅ Contraseña actualizada exitosamente');
    console.log(`📝 Usuario: ${admin.nombre_usuario}`);
    console.log(`🔑 Nueva contraseña: ${newPassword}`);
    console.log(`📧 Email: ${admin.email || 'No configurado'}`);
    console.log('⚠️ Recuerda cambiar esta contraseña en el primer inicio de sesión');
    
    // Probar login con la nueva contraseña
    console.log('\n🧪 Probando login con nueva contraseña...');
    
    try {
      const loginResult = await pool.query(
        'SELECT id, nombre_usuario, password_hash, rol, activo FROM usuarios WHERE nombre_usuario = $1',
        [admin.nombre_usuario]
      );
      
      if (loginResult.rows.length > 0) {
        const user = loginResult.rows[0];
        const isValid = await bcrypt.compare(newPassword, user.password_hash);
        
        if (isValid) {
          console.log('✅ Contraseña verificada correctamente');
        } else {
          console.log('❌ Error en verificación de contraseña');
        }
      }
    } catch (err) {
      console.log('❌ Error verificando contraseña:', err.message);
    }
    
    // Probar endpoint de login si el servidor está corriendo
    console.log('\n🌐 Probando endpoint de login...');
    
    try {
      const response = await fetch('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          usuario: admin.nombre_usuario,
          password: newPassword
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Login exitoso via API');
        console.log(`📝 Usuario: ${data.usuario?.usuario}`);
        console.log(`🔑 Rol: ${data.usuario?.rol}`);
        console.log('🎫 Token generado correctamente');
      } else {
        const error = await response.json();
        console.log(`❌ Error en login via API: ${error.error}`);
      }
    } catch (err) {
      console.log('⚠️ No se pudo probar API (servidor no iniciado)');
    }
    
    console.log('\n🎉 Reset de contraseña completado');
    
  } catch (err) {
    console.error('❌ Error reseteando contraseña:', err);
  } finally {
    pool.end();
  }
}

resetAdminPassword();

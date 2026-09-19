// ============================================================================
// Rescate: restablecer la contraseña de un usuario desde la consola del server.
//
// Es la única forma de volver a entrar si el administrador perdió su
// contraseña (o si quedó bloqueado por intentos fallidos), porque el reset
// desde la pantalla de Usuarios necesita una sesión de admin.
//
// Uso:
//   cd backend
//   node scripts/reset-admin-password.js <nombre_usuario>
//   node scripts/reset-admin-password.js --listar
//
// La contraseña generada es aleatoria, se muestra UNA vez y queda marcada
// como temporal: al entrar, el sistema obliga a cambiarla.
//
// Antes este script fijaba la contraseña en la constante 'admin123' para el
// primer usuario con rol admin que encontrara, la imprimía y además hacía un
// login real contra la API. Una contraseña conocida y publicada en el código
// es lo mismo que no tener contraseña.
// ============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');

async function listarAdmins() {
  const { rows } = await pool.query(
    `SELECT id, nombre_usuario, rol, activo, ultimo_acceso
       FROM usuarios
      WHERE rol = 'admin'
      ORDER BY id`
  );

  if (rows.length === 0) {
    console.log('⚠️  No hay ningún usuario con rol admin en la base.');
    return;
  }

  console.log('\nAdministradores:');
  for (const u of rows) {
    const estado = u.activo ? 'activo' : 'INACTIVO';
    const acceso = u.ultimo_acceso
      ? new Date(u.ultimo_acceso).toLocaleString('es-AR')
      : 'nunca entró';
    console.log(`  [${u.id}] ${u.nombre_usuario} — ${estado} — último acceso: ${acceso}`);
  }
  console.log('');
}

async function resetear(nombreUsuario) {
  const { rows } = await pool.query(
    `SELECT id, nombre_usuario, rol, activo
       FROM usuarios
      WHERE lower(nombre_usuario) = lower($1)`,
    [nombreUsuario]
  );

  if (rows.length === 0) {
    console.error(`❌ No existe el usuario "${nombreUsuario}".`);
    console.error('   Para ver los administradores: node scripts/reset-admin-password.js --listar');
    process.exitCode = 1;
    return;
  }

  const usuario = rows[0];
  const passwordTemporal = crypto.randomBytes(9).toString('base64url'); // 12 caracteres
  const passwordHash = await bcrypt.hash(passwordTemporal, 12);

  await pool.query(
    `UPDATE usuarios
        SET password_hash = $1,
            debe_cambiar_password = true,
            password_actualizado_en = now(),
            intentos_fallidos = 0,
            bloqueado_hasta = NULL,
            activo = true,
            updated_at = now()
      WHERE id = $2`,
    [passwordHash, usuario.id]
  );

  console.log('');
  console.log('✅ Contraseña restablecida');
  console.log(`   Usuario:    ${usuario.nombre_usuario} (rol: ${usuario.rol})`);
  console.log(`   Temporal:   ${passwordTemporal}`);
  console.log('');
  console.log('   Entrá con esa contraseña: el sistema te va a pedir que la');
  console.log('   cambies antes de dejarte hacer cualquier otra cosa.');
  console.log('   No queda guardada en ningún lado: si la perdés, corré esto de nuevo.');
  console.log('');

  if (!usuario.activo) {
    console.log('   ℹ️  El usuario estaba desactivado y se reactivó.');
    console.log('');
  }
}

(async () => {
  const argumento = process.argv[2];

  try {
    if (!argumento || argumento === '--listar' || argumento === '-l') {
      if (!argumento) {
        console.log('Uso: node scripts/reset-admin-password.js <nombre_usuario>');
      }
      await listarAdmins();
      return;
    }

    await resetear(argumento);
  } catch (err) {
    console.error('❌ Error restableciendo la contraseña:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

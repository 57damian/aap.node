// ============================================================================
// Crear el primer usuario administrador (instalación nueva).
//
// Uso:
//   cd backend
//   node scripts/create-admin.js <nombre_usuario> [email]
//
// La contraseña es aleatoria, se muestra UNA vez y queda marcada como
// temporal: al entrar hay que cambiarla.
//
// La versión anterior estaba rota y era peligrosa: escribía en la columna
// `usuario` (que hoy se llama `nombre_usuario`, así que fallaba siempre),
// BORRABA el admin existente antes de crear el nuevo, y usaba la contraseña
// fija 'cambiar123', que además imprimía junto con el hash.
// ============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');

(async () => {
  const nombreUsuario = process.argv[2];
  const email = process.argv[3] || null;

  try {
    if (!nombreUsuario) {
      console.error('Uso: node scripts/create-admin.js <nombre_usuario> [email]');
      process.exitCode = 1;
      return;
    }

    const existente = await pool.query(
      'SELECT id, rol FROM usuarios WHERE lower(nombre_usuario) = lower($1)',
      [nombreUsuario]
    );

    if (existente.rows.length > 0) {
      console.error(`❌ Ya existe el usuario "${nombreUsuario}".`);
      console.error('   Para restablecerle la contraseña:');
      console.error(`   node scripts/reset-admin-password.js ${nombreUsuario}`);
      process.exitCode = 1;
      return;
    }

    const passwordTemporal = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await bcrypt.hash(passwordTemporal, 12);

    const result = await pool.query(
      `INSERT INTO usuarios (nombre_usuario, email, password_hash, rol, activo, debe_cambiar_password)
       VALUES ($1, $2, $3, 'admin', true, true)
       RETURNING id, nombre_usuario`,
      [nombreUsuario, email, passwordHash]
    );

    console.log('');
    console.log('✅ Administrador creado');
    console.log(`   Usuario:  ${result.rows[0].nombre_usuario} (id ${result.rows[0].id})`);
    console.log(`   Temporal: ${passwordTemporal}`);
    console.log('');
    console.log('   Al entrar, el sistema va a pedir que la cambies.');
    console.log('');

  } catch (err) {
    console.error('❌ Error creando el administrador:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

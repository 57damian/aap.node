require('dotenv').config();

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL no está definida en el entorno');
}

// Los primeros 40 caracteres de DATABASE_URL se imprimían en cada arranque
// "para no exponer credenciales completas", pero una cadena de Postgres
// empieza justamente por postgresql://usuario:contraseña@host — o sea que lo
// que se logueaba era exactamente la parte secreta. No se loguea más.
console.log('🔍 [db.js] Inicializando conexión a la base...');

// rejectUnauthorized: false acepta cualquier certificado, así que la conexión
// se cifra pero no se verifica contra quién. En producción se valida, salvo
// que el proveedor use un certificado propio y se pida lo contrario a mano
// con DB_SSL_NO_VERIFY=true.
const verificarCertificado =
  process.env.NODE_ENV === 'production' && process.env.DB_SSL_NO_VERIFY !== 'true';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: verificarCertificado } : false
});

pool.on('connect', () => {
  console.log('✅ Pool conectado a la base de datos');
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de BD:', err);
});

module.exports = pool;

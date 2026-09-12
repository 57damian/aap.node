require('dotenv').config();

const { Pool } = require('pg');

console.log('🔍 [db.js] Inicializando conexión...');
console.log('🔍 DATABASE_URL existe?', !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
  // Mostrar solo los primeros 40 caracteres para no exponer credenciales completas
  console.log('🔍 DATABASE_URL (inicio):', process.env.DATABASE_URL.substring(0, 40) + '...');
  console.log('🔍 ¿Incluye sslmode=require?', process.env.DATABASE_URL.includes('sslmode=require'));
} else {
  console.error('❌ DATABASE_URL no está definida en el entorno');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('✅ Pool conectado a la base de datos');
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en el pool de BD:', err);
});

module.exports = pool;

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

console.log('DATABASE_URL existe?', !!process.env.DATABASE_URL);
console.log('DATABASE_URL (primeros 30 caracteres):', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 30) : 'NO DEFINIDA');

// Verificar conexión al iniciar
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err.stack);
    } else {
        console.log('✅ Conectado a PostgreSQL');
        release();
    }
});

module.exports = pool;

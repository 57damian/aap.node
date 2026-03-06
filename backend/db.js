const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'transformadores',
    max: 20, // máximo de conexiones en el pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

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
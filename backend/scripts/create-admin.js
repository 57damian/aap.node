const bcrypt = require('bcryptjs');
const pool = require('../db');

async function createAdmin() {
    try {
        const password = 'cambiar123';
        const hash = await bcrypt.hash(password, 12);
        
        // Eliminar admin existente si hay problemas
        await pool.query('DELETE FROM usuarios WHERE usuario = $1', ['admin']);
        
        // Crear nuevo admin
        const result = await pool.query(
            'INSERT INTO usuarios (usuario, password_hash, rol) VALUES ($1, $2, $3) RETURNING id, usuario, rol',
            ['admin', hash, 'admin']
        );
        
        console.log('✅ Admin creado correctamente:');
        console.log('   Usuario: admin');
        console.log('   Password: cambiar123');
        console.log('   Hash:', hash);
        
    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        pool.end();
    }
}

createAdmin();
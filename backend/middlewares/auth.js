const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'una_frase_muy_larga_y_compleja_con_numeros_123!@#_cambiar_en_produccion';

const verificarToken = async (req, res, next) => {
    let token;
    try {
        // Obtener token del header
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res.status(401).json({ error: 'Token no proporcionado' });
        }

        token = authHeader.replace('Bearer ', '');
        
        // Verificar token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Verificar que el usuario aún existe y está activo
        const result = await pool.query(
            'SELECT id, nombre_usuario, rol FROM usuarios WHERE id = $1 AND activo = true',
            [decoded.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no válido o inactivo' });
        }

        // Adjuntar usuario a la request
        req.usuario = result.rows[0];
        next();
        
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado' });
        }
        if (error.name === 'JsonWebTokenError') {
            console.error('Error JWT:', error.message, 'token:', token);
            return res.status(401).json({ error: 'Token inválido' });
        }
        console.error('Error en verificación de token:', error);
        return res.status(500).json({ error: 'Error en autenticación' });
    }
};

const authorize = (rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        
        if (!rolesPermitidos.includes(req.usuario.rol)) {
            return res.status(403).json({ 
                error: 'Acceso denegado',
                message: `Se requiere uno de estos roles: ${rolesPermitidos.join(', ')}`
            });
        }
        
        next();
    };
};

module.exports = { verificarToken, authorize };
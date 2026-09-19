const jwt = require('jsonwebtoken');
const pool = require('../db');
const { JWT_SECRET } = require('../config/jwt');
const { ADMIN, OPERARIO } = require('../config/roles');

// Rutas que un usuario obligado a cambiar su contraseña SÍ puede usar.
// Sin esto quedaría encerrado: no podría ni cambiarla ni verificar su sesión.
const RUTAS_PERMITIDAS_SIN_PASSWORD_AL_DIA = [
    { metodo: 'PUT', path: '/usuarios/cambiar-password' },
    { metodo: 'GET', path: '/auth/verificar' }
];

const verificarToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token no proporcionado' });
        }

        const token = authHeader.slice('Bearer '.length).trim();
        if (!token) {
            return res.status(401).json({ error: 'Token no proporcionado' });
        }

        // algorithms explícito: sin esto, jwt.verify acepta cualquier algoritmo
        // que venga en el header del token.
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

        const result = await pool.query(
            `SELECT id, nombre_usuario, rol, debe_cambiar_password, password_actualizado_en
               FROM usuarios
              WHERE id = $1 AND activo = true`,
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no válido o inactivo' });
        }

        const usuario = result.rows[0];

        // Invalidación de sesiones: el token lleva, en el claim `pwd`, la marca
        // de cuándo se fijó la contraseña con la que se emitió. Si en la base
        // hay otra marca, es que la contraseña cambió después: ese token murió.
        // Así, resetear una clave expulsa de verdad a quien tuviera la sesión
        // abierta (o el token robado) en vez de esperar a que expire sola.
        //
        // Se compara por igualdad exacta y no "iat anterior al cambio" porque
        // iat solo tiene precisión de segundos: un token emitido en el mismo
        // segundo del cambio se colaba.
        const cambiadaEn = new Date(usuario.password_actualizado_en).getTime();
        if (decoded.pwd !== cambiadaEn) {
            return res.status(401).json({
                error: 'Tu sesión terminó porque cambió la contraseña. Volvé a entrar.'
            });
        }

        req.usuario = {
            id: usuario.id,
            nombre_usuario: usuario.nombre_usuario,
            rol: usuario.rol,
            debe_cambiar_password: usuario.debe_cambiar_password
        };
        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado' });
        }
        if (error.name === 'JsonWebTokenError') {
            // Antes acá se logueaba el token completo: un token válido en el
            // log del server es una sesión regalada a quien lea los logs.
            console.warn('Token inválido rechazado:', error.message);
            return res.status(401).json({ error: 'Token inválido' });
        }
        console.error('Error en verificación de token:', error);
        return res.status(500).json({ error: 'Error en autenticación' });
    }
};

// Corta el paso a todo el sistema mientras la contraseña sea temporal.
// Va montado después de verificarToken, así que req.usuario ya está cargado.
const exigirPasswordAlDia = (req, res, next) => {
    if (!req.usuario || !req.usuario.debe_cambiar_password) {
        return next();
    }

    const permitida = RUTAS_PERMITIDAS_SIN_PASSWORD_AL_DIA.some(
        (r) => r.metodo === req.method && req.path === r.path
    );
    if (permitida) {
        return next();
    }

    // El frontend reconoce este code y abre el modal de cambio obligatorio.
    return res.status(403).json({
        code: 'PASSWORD_CHANGE_REQUIRED',
        error: 'Tenés que cambiar tu contraseña antes de seguir usando el sistema.'
    });
};

const authorize = (rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ error: 'No autenticado' });
        }

        if (!rolesPermitidos.includes(req.usuario.rol)) {
            // No se devuelve qué roles hacen falta: es información sobre cómo
            // está organizado el sistema que no le sirve a quien no tiene acceso.
            return res.status(403).json({ error: 'Acceso denegado' });
        }

        next();
    };
};

// Los dos únicos permisos que usa el sistema. Tenerlos acá, con nombre, evita
// que cada router vuelva a escribir su propia lista de roles (que es como se
// coló 'operario' en la lectura de cobros y pagos, y un rol 'compras' que no
// existe).
const soloAdmin = authorize([ADMIN]);
const adminYOperario = authorize([ADMIN, OPERARIO]);

module.exports = {
    verificarToken,
    authorize,
    exigirPasswordAlDia,
    soloAdmin,
    adminYOperario
};

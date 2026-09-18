// ============================================================================
// /api/auth — SOLO sesión: entrar y verificar.
//
// Todo el ABM de usuarios (listar, crear, editar, borrar, resetear contraseña)
// y el cambio de contraseña propia vivían TAMBIÉN acá, duplicados contra
// /api/usuarios con contratos y guardas distintas: este router prohibía la
// auto-edición y el auto-reset, el otro no, así que la misma operación era
// segura o insegura según a qué URL le pegaras. El frontend nunca usó estas
// rutas (verificado con grep sobre backend/public). Quedaron en /api/usuarios,
// que es el que usa la pantalla.
// ============================================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { verificarToken } = require('../middlewares/auth');
const { JWT_SECRET, JWT_EXPIRES_IN, JWT_ALGORITHM } = require('../config/jwt');

// Política de bloqueo por cuenta. El límite por IP (index.js) no alcanza:
// no hace nada contra un ataque repartido entre varias IP, que es el caso
// normal hoy. Esto cuenta intentos por usuario, no por origen.
const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;

// Mensaje único para usuario inexistente, usuario inactivo y contraseña
// incorrecta. Antes el inactivo respondía 'Usuario inactivo', que le confirma
// a cualquiera que ese nombre de usuario existe.
const CREDENCIALES_INVALIDAS = 'Usuario o contraseña incorrectos';

// Hash de descarte para gastar el mismo tiempo cuando el usuario no existe.
// Sin esto, la respuesta instantánea del caso "no existe" contra el ~100ms de
// bcrypt del caso "existe" permite enumerar usuarios midiendo el tiempo.
// Se genera al arrancar, con el mismo costo 12 que los hashes reales, sobre
// un valor aleatorio que nadie conoce.
const HASH_SEÑUELO = bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 12);

// `pwd` es la marca de cuándo se fijó la contraseña con la que se emite este
// token. El middleware la compara contra la base: si no coinciden, la
// contraseña cambió después y el token deja de valer. Ver middlewares/auth.js.
function firmarToken(usuario) {
    return jwt.sign(
        {
            id: usuario.id,
            rol: usuario.rol,
            pwd: new Date(usuario.password_actualizado_en).getTime()
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM }
    );
}

// ============================================================================
// POST /api/auth/login
// ============================================================================
router.post('/login', [
    // hallazgo S9: .escape() convierte '&' en '&amp;' etc. en el valor que
    // llega — un usuario 'a&b' se guardó tal cual pero se buscaba como
    // 'a&amp;b' y nunca podía loguearse. .escape() protege contra XSS en la
    // SALIDA, no tiene nada que hacer acá adentro.
    body('usuario').notEmpty().trim(),
    body('password').notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Faltan el usuario o la contraseña' });
    }

    const { usuario, password } = req.body;

    try {
        // lower(nombre_usuario): la migración de seguridad garantiza que no
        // hay dos usuarios que difieran solo en mayúsculas, así que escribir
        // el nombre con otra capitalización ya no deja a nadie afuera.
        const result = await pool.query(
            `SELECT id, nombre_usuario, password_hash, rol, activo,
                    debe_cambiar_password, intentos_fallidos, bloqueado_hasta,
                    password_actualizado_en
               FROM usuarios
              WHERE lower(nombre_usuario) = lower($1)`,
            [usuario]
        );

        const user = result.rows[0];

        if (!user) {
            // Se compara igual contra un hash de descarte para que el tiempo
            // de respuesta no delate que el usuario no existe.
            await bcrypt.compare(password, HASH_SEÑUELO);
            console.warn('Login fallido: credenciales inválidas');
            return res.status(401).json({ error: CREDENCIALES_INVALIDAS });
        }

        // Cuenta bloqueada por intentos fallidos: se corta acá, sin siquiera
        // mirar la contraseña, y el mensaje sí es específico porque a esta
        // altura quien está del otro lado ya demostró conocer el usuario.
        if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
            const minutosRestantes = Math.ceil(
                (new Date(user.bloqueado_hasta) - new Date()) / 60000
            );
            console.warn(`Login rechazado: cuenta bloqueada (id ${user.id})`);
            return res.status(429).json({
                error: `Cuenta bloqueada por intentos fallidos. Probá de nuevo en ${minutosRestantes} minuto(s), o pedile al administrador que te restablezca la contraseña.`
            });
        }

        let passwordOk;
        if (user.activo) {
            passwordOk = await bcrypt.compare(password, user.password_hash);
        } else {
            // Usuario desactivado: se gasta el mismo tiempo que en el camino
            // normal y se responde exactamente igual que con una clave mala.
            await bcrypt.compare(password, HASH_SEÑUELO);
            passwordOk = false;
        }

        if (!passwordOk) {
            // Solo se cuentan los fallos de cuentas activas: no tiene sentido
            // bloquear una cuenta que ya está deshabilitada.
            if (user.activo) {
                const intentos = user.intentos_fallidos + 1;
                if (intentos >= MAX_INTENTOS) {
                    await pool.query(
                        `UPDATE usuarios
                            SET intentos_fallidos = $1,
                                bloqueado_hasta = now() + make_interval(mins => $2)
                          WHERE id = $3`,
                        [intentos, MINUTOS_BLOQUEO, user.id]
                    );
                } else {
                    await pool.query(
                        'UPDATE usuarios SET intentos_fallidos = $1 WHERE id = $2',
                        [intentos, user.id]
                    );
                }
            }
            console.warn('Login fallido: credenciales inválidas');
            return res.status(401).json({ error: CREDENCIALES_INVALIDAS });
        }

        // Login correcto: se limpia el contador y se registra el acceso.
        await pool.query(
            `UPDATE usuarios
                SET ultimo_acceso = now(), intentos_fallidos = 0, bloqueado_hasta = NULL
              WHERE id = $1`,
            [user.id]
        );

        res.json({
            ok: true,
            token: firmarToken(user),
            // debe_cambiar_password le dice al frontend que abra el modal de
            // cambio obligatorio: la persona entró con una clave temporal que
            // le dio el administrador.
            debe_cambiar_password: user.debe_cambiar_password,
            usuario: {
                id: user.id,
                usuario: user.nombre_usuario,
                rol: user.rol
            }
        });

    } catch (error) {
        // hallazgo S6: no devolver error.message al cliente (filtra detalles
        // internos); el detalle completo queda solo en el log del server.
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ============================================================================
// GET /api/auth/verificar
// ============================================================================
router.get('/verificar', verificarToken, (req, res) => {
    res.json({
        ok: true,
        usuario: {
            id: req.usuario.id,
            usuario: req.usuario.nombre_usuario,
            rol: req.usuario.rol
        },
        debe_cambiar_password: req.usuario.debe_cambiar_password
    });
});

module.exports = router;

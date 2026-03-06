const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

// Configuración JWT (debería estar en variables de entorno)
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_super_seguro_cambiar_en_produccion';
const JWT_EXPIRES_IN = '8h';

// LOGIN
router.post('/login', [
    body('usuario').notEmpty().trim().escape(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        // Validar inputs
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { usuario, password } = req.body;

        // Buscar usuario en la base de datos
        const result = await pool.query(
            'SELECT id, nombre_usuario, password_hash, rol, activo FROM usuarios WHERE nombre_usuario = $1',
            [usuario]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const user = result.rows[0];

        // Verificar si el usuario está activo
        if (!user.activo) {
            return res.status(401).json({ error: 'Usuario inactivo' });
        }

        // Verificar contraseña
        const passwordValida = await bcrypt.compare(password, user.password_hash);
        if (!passwordValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Actualizar último acceso
        await pool.query(
            'UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = $1',
            [user.id]
        );

        // Generar token JWT
        const token = jwt.sign(
            { 
                id: user.id, 
                usuario: user.nombre_usuario, 
                rol: user.rol 
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        // Responder con token y datos del usuario (sin hash)
        res.json({
            ok: true,
            token,
            usuario: {
                id: user.id,
                usuario: user.nombre_usuario,
                rol: user.rol
            }
        });

    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// VERIFICAR TOKEN
router.get('/verificar', verificarToken, (req, res) => {
    res.json({ 
        ok: true, 
        usuario: {
            id: req.usuario.id,
            usuario: req.usuario.nombre_usuario,
            rol: req.usuario.rol
        }
    });
});

// CAMBIAR CONTRASEÑA (usuario logueado)
router.post('/cambiar-password', [
    verificarToken,
    body('password_actual').notEmpty(),
    body('password_nueva').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { password_actual, password_nueva } = req.body;
        const usuarioId = req.usuario.id;

        // Obtener usuario con su hash actual
        const result = await pool.query(
            'SELECT password_hash FROM usuarios WHERE id = $1',
            [usuarioId]
        );

        const hashActual = result.rows[0].password_hash;

        // Verificar contraseña actual
        const valida = await bcrypt.compare(password_actual, hashActual);
        if (!valida) {
            return res.status(400).json({ error: 'Contraseña actual incorrecta' });
        }

        // Hashear nueva contraseña
        const nuevoHash = await bcrypt.hash(password_nueva, 12);

        // Actualizar
        await pool.query(
            'UPDATE usuarios SET password_hash = $1 WHERE id = $2',
            [nuevoHash, usuarioId]
        );

        res.json({ ok: true, message: 'Contraseña actualizada correctamente' });

    } catch (error) {
        console.error('Error cambiando password:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// SOLO ADMIN: Listar usuarios
router.get('/usuarios', verificarToken, authorize(['admin']), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, nombre_usuario, rol, activo, ultimo_acceso, 
                    TO_CHAR(created_at, 'DD/MM/YYYY') as fecha_creacion
             FROM usuarios 
             ORDER BY id`
        );
        res.json({ ok: true, usuarios: result.rows });
    } catch (error) {
        console.error('Error listando usuarios:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// SOLO ADMIN: Crear usuario
router.post('/usuarios', [
    verificarToken,
    authorize(['admin']),
    body('usuario').notEmpty().trim().escape(),
    body('password').isLength({ min: 6 }),
    body('rol').isIn(['admin', 'control', 'operario', 'empleado'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { usuario, password, rol } = req.body;

        // Verificar si ya existe
        const existe = await pool.query(
            'SELECT id FROM usuarios WHERE nombre_usuario = $1',
            [usuario]
        );

        if (existe.rows.length > 0) {
            return res.status(400).json({ error: 'El nombre de usuario ya existe' });
        }

        // Hashear contraseña
        const hash = await bcrypt.hash(password, 12);

        // Crear usuario
        const result = await pool.query(
            `INSERT INTO usuarios (nombre_usuario, password_hash, rol) 
             VALUES ($1, $2, $3) 
             RETURNING id, nombre_usuario, rol, activo, created_at`,
            [usuario, hash, rol]
        );

        res.status(201).json({
            ok: true,
            usuario: result.rows[0]
        });

    } catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// SOLO ADMIN: Actualizar usuario (activar/desactivar, cambiar rol)
router.put('/usuarios/:id', [
    verificarToken,
    authorize(['admin']),
    body('activo').optional().isBoolean(),
    body('rol').optional().isIn(['admin', 'control', 'operario', 'empleado'])
], async (req, res) => {
    try {
        const { id } = req.params;
        const { activo, rol } = req.body;
        
        // No permitir modificar al propio admin (para evitar bloqueos)
        if (req.usuario.id === parseInt(id)) {
            return res.status(400).json({ error: 'No puedes modificar tu propio usuario' });
        }

        const updates = [];
        const values = [];
        let contador = 1;

        if (activo !== undefined) {
            updates.push(`activo = $${contador++}`);
            values.push(activo);
        }
        if (rol !== undefined) {
            updates.push(`rol = $${contador++}`);
            values.push(rol);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(id);
        const query = `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${contador} RETURNING id, nombre_usuario, rol, activo`;

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ ok: true, usuario: result.rows[0] });

    } catch (error) {
        console.error('Error actualizando usuario:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// SOLO ADMIN: Resetear contraseña de usuario
router.post('/usuarios/:id/reset-password', [
    verificarToken,
    authorize(['admin'])
], async (req, res) => {
    try {
        const { id } = req.params;
        
        // No permitir resetear la propia contraseña del admin (debe usar cambiar-password)
        if (req.usuario.id === parseInt(id)) {
            return res.status(400).json({ error: 'Usa "cambiar contraseña" para tu propio usuario' });
        }

        // Contraseña temporal: 'Temp123456'
        const passwordTemporal = 'Temp123456';
        const hash = await bcrypt.hash(passwordTemporal, 12);

        const result = await pool.query(
            'UPDATE usuarios SET password_hash = $1 WHERE id = $2 RETURNING id, nombre_usuario',
            [hash, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ 
            ok: true, 
            message: 'Contraseña reseteada',
            password_temporal: passwordTemporal // En producción, esto debería ir por email
        });

    } catch (error) {
        console.error('Error reseteando password:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

// SOLO ADMIN: Eliminar usuario
router.delete('/usuarios/:id', [
    verificarToken,
    authorize(['admin'])
], async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir eliminar al propio admin
        if (req.usuario.id === parseInt(id)) {
            return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
        }

        // No permitir eliminar el admin principal (id 1)
        if (parseInt(id) === 1) {
            return res.status(400).json({ error: 'No se puede eliminar el usuario admin principal' });
        }

        const result = await pool.query(
            'DELETE FROM usuarios WHERE id = $1 RETURNING id, nombre_usuario',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ ok: true, message: 'Usuario eliminado correctamente' });

    } catch (error) {
        console.error('Error eliminando usuario:', error);
        res.status(500).json({ error: 'Error en el servidor' });
    }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');
const ROLES_VALIDOS = ['admin', 'control', 'operario', 'empleado'];

router.use(verificarToken);

// =============================
// LISTAR USUARIOS
// GET /api/usuarios
// =============================
router.get('/', authorize(['admin']), async (req, res) => {
  try {
    const { search, rol, activo, page = 1, limit = 50 } = req.query;
    
    let query = `
      SELECT id, nombre_usuario, email, rol, activo, nombre_completo, 
             telefono, observaciones, created_at, updated_at
      FROM usuarios
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    // Filtros
    if (search) {
      query += ` AND (
        nombre_usuario ILIKE $${paramIndex} OR 
        email ILIKE $${paramIndex} OR 
        nombre_completo ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (rol) {
      query += ` AND rol = $${paramIndex}`;
      params.push(rol);
      paramIndex++;
    }
    
    if (activo !== undefined) {
      query += ` AND activo = $${paramIndex}`;
      params.push(activo === 'true');
      paramIndex++;
    }
    
    // Ordenamiento y paginación
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);
    
    const result = await pool.query(query, params);
    
    // Obtener total para paginación
    const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').replace(/ORDER BY.*$/, '');
    const countResult = await pool.query(countQuery, params.slice(0, -2));
    
    res.json({
      usuarios: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });
    
  } catch (err) {
    console.error('Error listando usuarios:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// OBTENER USUARIO POR ID
// GET /api/usuarios/:id
// =============================
router.get('/:id', authorize(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre_usuario, email, rol, activo, nombre_completo, 
              telefono, observaciones, created_at, updated_at
       FROM usuarios WHERE id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json(result.rows[0]);
    
  } catch (err) {
    console.error('Error obteniendo usuario:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// CREAR USUARIO
// POST /api/usuarios
// =============================
router.post('/', authorize(['admin']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const {
      nombre_usuario,
      email,
      password,
      rol,
      activo = true,
      nombre_completo,
      telefono,
      observaciones
    } = req.body;
    
    // Validaciones básicas
    if (!nombre_usuario || !email || !password || !rol) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    if (!ROLES_VALIDOS.includes(rol)) {
      return res.status(400).json({ error: `Rol invalido. Permitidos: ${ROLES_VALIDOS.join(', ')}` });
    }
    
    // Verificar si el nombre de usuario ya existe
    const usuarioExistente = await client.query(
      'SELECT id FROM usuarios WHERE nombre_usuario = $1',
      [nombre_usuario]
    );
    
    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }
    
    // Verificar si el email ya existe
    const emailExistente = await client.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email]
    );
    
    if (emailExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }
    
    // Encriptar contraseña
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Insertar usuario
    const result = await client.query(
      `INSERT INTO usuarios 
        (nombre_usuario, email, password_hash, rol, activo, nombre_completo, telefono, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, nombre_usuario, email, rol, activo, nombre_completo, telefono, observaciones, created_at`,
      [nombre_usuario, email, passwordHash, rol, activo, nombre_completo, telefono, observaciones]
    );
    
    await client.query('COMMIT');
    
    res.status(201).json({
      message: 'Usuario creado exitosamente',
      usuario: result.rows[0]
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando usuario:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// ALTA SIMPLE DE USUARIO (ADMIN | EMPLEADO)
// POST /api/usuarios/alta
// =============================
router.post('/alta', authorize(['admin']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { nombre_usuario, email, password, perfil } = req.body;
    const rol = perfil === 'empleado' ? 'empleado' : perfil === 'admin' ? 'admin' : null;

    if (!nombre_usuario || !email || !password || !rol) {
      return res.status(400).json({
        error: 'Campos obligatorios: nombre_usuario, email, password y perfil (admin|empleado)'
      });
    }

    const usuarioExistente = await client.query(
      'SELECT id FROM usuarios WHERE nombre_usuario = $1',
      [nombre_usuario]
    );

    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }

    const emailExistente = await client.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email]
    );

    if (emailExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya esta registrado' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await client.query(
      `INSERT INTO usuarios
        (nombre_usuario, email, password_hash, rol, activo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, nombre_usuario, email, rol, activo, created_at`,
      [nombre_usuario, email, passwordHash, rol]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Usuario dado de alta exitosamente',
      usuario: result.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error dando de alta usuario:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// ACTUALIZAR USUARIO
// PUT /api/usuarios/:id
// =============================
router.put('/:id', authorize(['admin']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const {
      nombre_usuario,
      email,
      password,
      rol,
      activo,
      nombre_completo,
      telefono,
      observaciones
    } = req.body;
    
    // Verificar que el usuario existe
    const usuarioExistente = await client.query(
      'SELECT id FROM usuarios WHERE id = $1',
      [req.params.id]
    );
    
    if (usuarioExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Construir query dinámica
    let query = `UPDATE usuarios SET `;
    const params = [];
    let paramIndex = 1;
    
    if (nombre_usuario !== undefined) {
      query += `nombre_usuario = $${paramIndex}, `;
      params.push(nombre_usuario);
      paramIndex++;
    }
    
    if (email !== undefined) {
      query += `email = $${paramIndex}, `;
      params.push(email);
      paramIndex++;
    }
    
    if (password && password.length > 0) {
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(password, salt);
      query += `password_hash = $${paramIndex}, `;
      params.push(passwordHash);
      paramIndex++;
    }
    
    if (rol !== undefined) {
      if (!ROLES_VALIDOS.includes(rol)) {
        return res.status(400).json({ error: `Rol invalido. Permitidos: ${ROLES_VALIDOS.join(', ')}` });
      }
      query += `rol = $${paramIndex}, `;
      params.push(rol);
      paramIndex++;
    }
    
    if (activo !== undefined) {
      query += `activo = $${paramIndex}, `;
      params.push(activo);
      paramIndex++;
    }
    
    if (nombre_completo !== undefined) {
      query += `nombre_completo = $${paramIndex}, `;
      params.push(nombre_completo);
      paramIndex++;
    }
    
    if (telefono !== undefined) {
      query += `telefono = $${paramIndex}, `;
      params.push(telefono);
      paramIndex++;
    }
    
    if (observaciones !== undefined) {
      query += `observaciones = $${paramIndex}, `;
      params.push(observaciones);
      paramIndex++;
    }
    
    query += `updated_at = NOW() WHERE id = $${paramIndex}`;
    params.push(req.params.id);
    
    // Verificar duplicados (excluyendo el usuario actual)
    if (nombre_usuario) {
      const duplicadoUsuario = await client.query(
        'SELECT id FROM usuarios WHERE nombre_usuario = $1 AND id != $2',
        [nombre_usuario, req.params.id]
      );
      
      if (duplicadoUsuario.rows.length > 0) {
        return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });
      }
    }
    
    if (email) {
      const duplicadoEmail = await client.query(
        'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
        [email, req.params.id]
      );
      
      if (duplicadoEmail.rows.length > 0) {
        return res.status(400).json({ error: 'El email ya está en uso' });
      }
    }
    
    await client.query(query, params);
    await client.query('COMMIT');
    
    // Obtener usuario actualizado
    const result = await client.query(
      `SELECT id, nombre_usuario, email, rol, activo, nombre_completo, telefono, observaciones, updated_at
       FROM usuarios WHERE id = $1`,
      [req.params.id]
    );
    
    res.json({
      message: 'Usuario actualizado exitosamente',
      usuario: result.rows[0]
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error actualizando usuario:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// ELIMINAR USUARIO
// DELETE /api/usuarios/:id
// =============================
router.delete('/:id', authorize(['admin']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Verificar que el usuario existe
    const usuarioExistente = await client.query(
      'SELECT id, nombre_usuario FROM usuarios WHERE id = $1',
      [req.params.id]
    );
    
    if (usuarioExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // No permitir eliminar al último administrador
    const adminCount = await client.query(
      "SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = true"
    );
    
    const usuarioActual = usuarioExistente.rows[0];
    if (usuarioActual.rol === 'admin' && adminCount.rows[0].count <= 1) {
      return res.status(400).json({ 
        error: 'No se puede eliminar al último administrador activo' 
      });
    }
    
    await client.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    
    res.json({
      message: 'Usuario eliminado exitosamente',
      usuario: {
        id: usuarioActual.id,
        nombre_usuario: usuarioActual.nombre_usuario
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error eliminando usuario:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// RESET PASSWORD
// POST /api/usuarios/:id/reset-password
// =============================
router.post('/:id/reset-password', authorize(['admin']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Verificar que el usuario existe
    const usuarioExistente = await client.query(
      'SELECT id, nombre_usuario, email FROM usuarios WHERE id = $1',
      [req.params.id]
    );
    
    if (usuarioExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Generar nueva contraseña temporal
    const newPassword = Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    
    await client.query(
      'UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, req.params.id]
    );
    
    await client.query('COMMIT');
    
    const usuario = usuarioExistente.rows[0];
    
    res.json({
      message: 'Contraseña reseteada exitosamente',
      nueva_password: newPassword,
      usuario: {
        id: usuario.id,
        nombre_usuario: usuario.nombre_usuario,
        email: usuario.email
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error reseteando contraseña:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// CAMBIAR PROPIO PASSWORD
// PUT /api/usuarios/cambiar-password
// =============================
router.put('/cambiar-password', authorize(['admin', 'control', 'operario', 'empleado']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { password_actual, password_nueva, password_confirmacion } = req.body;
    const usuarioId = req.usuario.id;
    
    // Validaciones
    if (!password_actual || !password_nueva || !password_confirmacion) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    
    if (password_nueva.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }
    
    if (password_nueva !== password_confirmacion) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }
    
    // Obtener contraseña actual del usuario
    const usuarioActual = await client.query(
      'SELECT password_hash FROM usuarios WHERE id = $1',
      [usuarioId]
    );
    
    if (usuarioActual.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Verificar contraseña actual
    const passwordValida = await bcrypt.compare(password_actual, usuarioActual.rows[0].password_hash);
    
    if (!passwordValida) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    }
    
    // Encriptar nueva contraseña
    const salt = await bcrypt.genSalt(12, null, null, 'b');
    const passwordHash = await bcrypt.hash(password_nueva, salt);
    
    await client.query(
      'UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, usuarioId]
    );
    
    await client.query('COMMIT');
    
    res.json({
      message: 'Contraseña actualizada exitosamente'
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error cambiando contraseña:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// ESTADÍSTICAS DE USUARIOS
// GET /api/usuarios/stats
// =============================
router.get('/stats', authorize(['admin']), async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_usuarios,
        COUNT(CASE WHEN activo = true THEN 1 END) as usuarios_activos,
        COUNT(CASE WHEN activo = false THEN 1 END) as usuarios_inactivos,
        COUNT(CASE WHEN rol = 'admin' THEN 1 END) as administradores,
        COUNT(CASE WHEN rol = 'control' THEN 1 END) as control,
        COUNT(CASE WHEN rol = 'operario' THEN 1 END) as operarios,
        COUNT(CASE WHEN rol = 'empleado' THEN 1 END) as empleados,
        MAX(created_at) as ultimo_registro
      FROM usuarios
    `);
    
    // Últimos usuarios registrados
    const ultimosUsuarios = await pool.query(`
      SELECT nombre_usuario, email, rol, created_at
      FROM usuarios
      ORDER BY created_at DESC
      LIMIT 5
    `);
    
    res.json({
      stats: stats.rows[0],
      ultimos_registrados: ultimosUsuarios.rows
    });
    
  } catch (err) {
    console.error('Error obteniendo estadísticas:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { soloAdmin } = require('../middlewares/auth');
const { JWT_SECRET, JWT_EXPIRES_IN, JWT_ALGORITHM } = require('../config/jwt');
const { ROLES_VALIDOS } = require('../config/roles');

// Largo mínimo de contraseña. Diez caracteres sin exigir símbolos ni mayúsculas:
// una frase larga y memorable resiste mucho más que un 'Abc123!' que termina
// anotado en un papel. Antes el mínimo era 6, con una regla de complejidad
// distinta en cada endpoint.
const LARGO_MINIMO_PASSWORD = 10;

// verificarToken ya lo aplica index.js para todo /api (salvo /api/auth), así
// que tenerlo acá otra vez hacía dos SELECT a usuarios por cada request.

// Devuelve el motivo del rechazo, o null si la contraseña sirve.
// Una sola función para los tres lugares donde se fija una contraseña: antes
// cada endpoint tenía su propia regla (o ninguna).
function validarPassword(password, nombreUsuario) {
  if (typeof password !== 'string' || password.length < LARGO_MINIMO_PASSWORD) {
    return `La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres`;
  }
  if (nombreUsuario && password.toLowerCase().includes(String(nombreUsuario).toLowerCase())) {
    return 'La contraseña no puede contener el nombre de usuario';
  }
  return null;
}

// Contraseña temporal para los resets: aleatoria de verdad (crypto, no
// Math.random) y legible para dictarla por teléfono.
function generarPasswordTemporal() {
  return crypto.randomBytes(9).toString('base64url'); // 12 caracteres
}

// =============================
// LISTAR USUARIOS
// GET /api/usuarios
// =============================
router.get('/', soloAdmin, async (req, res) => {
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
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================
// CAMBIAR PROPIO PASSWORD
// PUT /api/usuarios/cambiar-password
//
// Movido acá arriba de /:id (hallazgo C2 de la auditoría): Express matchea
// rutas en el orden en que se declaran, y GET/PUT /:id venían antes, así
// que se comían /cambiar-password (quedaba como si :id === "cambiar-password")
// y todo el mundo, sin importar el rol, recibía "Acceso denegado" o un 500
// de tipo inválido.
// =============================
router.put('/cambiar-password', async (req, res) => {
  try {
    const { password_actual, password_nueva, password_confirmacion } = req.body;
    const usuarioId = req.usuario.id;

    if (!password_actual || !password_nueva || !password_confirmacion) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    if (password_nueva !== password_confirmacion) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }

    const usuarioActual = await pool.query(
      'SELECT nombre_usuario, password_hash FROM usuarios WHERE id = $1',
      [usuarioId]
    );

    if (usuarioActual.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const usuario = usuarioActual.rows[0];

    const problema = validarPassword(password_nueva, usuario.nombre_usuario);
    if (problema) {
      return res.status(400).json({ error: problema });
    }

    const passwordValida = await bcrypt.compare(password_actual, usuario.password_hash);
    if (!passwordValida) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    }

    if (password_nueva === password_actual) {
      return res.status(400).json({ error: 'La contraseña nueva tiene que ser distinta de la actual' });
    }

    const passwordHash = await bcrypt.hash(password_nueva, 12);

    // password_actualizado_en invalida todos los tokens emitidos antes de
    // ahora (ver middlewares/auth.js): cambiar la contraseña cierra las otras
    // sesiones. debe_cambiar_password se apaga acá, que es lo que libera a
    // quien entró con una clave temporal.
    const actualizado = await pool.query(
      `UPDATE usuarios
          SET password_hash = $1,
              password_actualizado_en = now(),
              debe_cambiar_password = false,
              updated_at = now()
        WHERE id = $2
    RETURNING password_actualizado_en`,
      [passwordHash, usuarioId]
    );

    // Token nuevo: el que trae la request quedó invalidado por la línea de
    // arriba. Sin esto, quien cambia su contraseña se autoexpulsa y tiene que
    // volver a loguearse enseguida. `pwd` tiene que ser la marca recién
    // escrita, que es contra la que compara el middleware.
    const token = jwt.sign(
      {
        id: usuarioId,
        rol: req.usuario.rol,
        pwd: new Date(actualizado.rows[0].password_actualizado_en).getTime()
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM }
    );

    res.json({
      message: 'Contraseña actualizada exitosamente',
      token,
      sesiones_cerradas: true
    });

  } catch (err) {
    console.error('Error cambiando contraseña:', err);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña' });
  }
});

// =============================
// ESTADÍSTICAS DE USUARIOS
// GET /api/usuarios/stats
//
// Movido acá arriba de /:id por el mismo motivo que /cambiar-password:
// GET /:id se comía /stats y devolvía 500 (invalid input syntax for type
// integer: "stats").
// =============================
router.get('/stats', soloAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_usuarios,
        COUNT(CASE WHEN activo = true THEN 1 END) as usuarios_activos,
        COUNT(CASE WHEN activo = false THEN 1 END) as usuarios_inactivos,
        COUNT(CASE WHEN rol = 'admin' THEN 1 END) as administradores,
        COUNT(CASE WHEN rol = 'operario' THEN 1 END) as operarios,
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
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// A partir de acá, todas las rutas son por :id. La guarda numérica evita
// que un segmento no numérico (por si en el futuro se agrega otra ruta
// literal y alguien se olvida de ponerla arriba) caiga en un 500 críptico
// de Postgres en vez de un 404 prolijo.
router.param('id', (req, res, next, valor) => {
  if (!/^\d+$/.test(valor)) return res.status(404).json({ error: 'Ruta no encontrada' });
  next();
});

// =============================
// OBTENER USUARIO POR ID
// GET /api/usuarios/:id
// =============================
router.get('/:id', soloAdmin, async (req, res) => {
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
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================
// CREAR USUARIO
// POST /api/usuarios
// =============================
router.post('/', soloAdmin, async (req, res) => {
  // Una sola escritura: no hace falta transacción. Antes este handler pedía
  // un client del pool y hacía COMMIT/ROLLBACK sin haber abierto nunca un
  // BEGIN, con lo cual el ROLLBACK del catch no revertía nada.
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

    // Antes se creaba el usuario con cualquier contraseña, incluso de un
    // caracter: el alta no validaba nada.
    const problemaPassword = validarPassword(password, nombre_usuario);
    if (problemaPassword) {
      return res.status(400).json({ error: problemaPassword });
    }

    // lower(): el índice único uq_usuarios_nombre_lower no permite dos
    // usuarios que difieran solo en mayúsculas, así que la comprobación
    // previa tiene que mirar lo mismo para dar un error claro.
    const usuarioExistente = await pool.query(
      'SELECT id FROM usuarios WHERE lower(nombre_usuario) = lower($1)',
      [nombre_usuario]
    );

    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }

    // Verificar si el email ya existe
    const emailExistente = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email]
    );

    if (emailExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Encriptar contraseña
    const passwordHash = await bcrypt.hash(password, 12);

    // Insertar usuario
    const result = await pool.query(
      `INSERT INTO usuarios
        (nombre_usuario, email, password_hash, rol, activo, nombre_completo, telefono, observaciones)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, nombre_usuario, email, rol, activo, nombre_completo, telefono, observaciones, created_at`,
      [nombre_usuario, email, passwordHash, rol, activo, nombre_completo, telefono, observaciones]
    );

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      usuario: result.rows[0]
    });

  } catch (err) {
    console.error('Error creando usuario:', err);
    // El índice único lower(nombre_usuario) o el de email pueden saltar acá
    // si dos altas entran a la vez.
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un usuario con ese nombre o email' });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================
// ALTA SIMPLE DE USUARIO (ADMIN | EMPLEADO)
// POST /api/usuarios/alta
// =============================
router.post('/alta', soloAdmin, async (req, res) => {
  // Una sola escritura: sin transacción (ver la nota en POST /).
  try {
    const { nombre_usuario, email, password, perfil } = req.body;
    const rol = perfil === 'empleado' ? 'empleado' : perfil === 'admin' ? 'admin' : null;

    if (!nombre_usuario || !email || !password || !rol) {
      return res.status(400).json({
        error: 'Campos obligatorios: nombre_usuario, email, password y perfil (admin|empleado)'
      });
    }

    const problemaPassword = validarPassword(password, nombre_usuario);
    if (problemaPassword) {
      return res.status(400).json({ error: problemaPassword });
    }

    const usuarioExistente = await pool.query(
      'SELECT id FROM usuarios WHERE lower(nombre_usuario) = lower($1)',
      [nombre_usuario]
    );

    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }

    const emailExistente = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1',
      [email]
    );

    if (emailExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya esta registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO usuarios
        (nombre_usuario, email, password_hash, rol, activo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, nombre_usuario, email, rol, activo, created_at`,
      [nombre_usuario, email, passwordHash, rol]
    );

    res.status(201).json({
      message: 'Usuario dado de alta exitosamente',
      usuario: result.rows[0]
    });
  } catch (err) {
    console.error('Error dando de alta usuario:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un usuario con ese nombre o email' });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================
// ACTUALIZAR USUARIO
// PUT /api/usuarios/:id
// =============================
router.put('/:id', soloAdmin, async (req, res) => {
  // Una sola escritura: sin transacción (ver la nota en POST /).
  try {
    // `password` se ignora a propósito: este endpoint era una tercera vía
    // para fijar la contraseña de cualquiera (incluida la propia) sin pedir
    // la actual y sin validar nada. Las contraseñas se cambian por
    // PUT /cambiar-password o se restablecen por POST /:id/reset-password.
    const {
      nombre_usuario,
      email,
      rol,
      activo,
      nombre_completo,
      telefono,
      observaciones
    } = req.body;

    // Verificar que el usuario existe
    const usuarioExistente = await pool.query(
      'SELECT id, rol, activo FROM usuarios WHERE id = $1',
      [req.params.id]
    );

    if (usuarioExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const objetivo = usuarioExistente.rows[0];

    // Nadie se desactiva ni se cambia el rol a sí mismo: es la forma más
    // fácil de quedarse afuera del sistema sin querer.
    if (objetivo.id === req.usuario.id && (activo === false || (rol !== undefined && rol !== objetivo.rol))) {
      return res.status(400).json({
        error: 'No podés cambiarte el rol ni desactivarte a vos mismo'
      });
    }

    // Y no se puede dejar al sistema sin ningún administrador activo.
    const dejaDeSerAdmin = objetivo.rol === 'admin' && ((rol !== undefined && rol !== 'admin') || activo === false);
    if (dejaDeSerAdmin) {
      const otrosAdmins = await pool.query(
        `SELECT count(*)::int AS n FROM usuarios
          WHERE rol = 'admin' AND activo = true AND id <> $1`,
        [objetivo.id]
      );
      if (otrosAdmins.rows[0].n === 0) {
        return res.status(400).json({
          error: 'Es el único administrador activo: primero designá otro'
        });
      }
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
      const duplicadoUsuario = await pool.query(
        'SELECT id FROM usuarios WHERE lower(nombre_usuario) = lower($1) AND id != $2',
        [nombre_usuario, req.params.id]
      );
      
      if (duplicadoUsuario.rows.length > 0) {
        return res.status(400).json({ error: 'El nombre de usuario ya está en uso' });
      }
    }
    
    if (email) {
      const duplicadoEmail = await pool.query(
        'SELECT id FROM usuarios WHERE email = $1 AND id != $2',
        [email, req.params.id]
      );
      
      if (duplicadoEmail.rows.length > 0) {
        return res.status(400).json({ error: 'El email ya está en uso' });
      }
    }
    
    await pool.query(query, params);
    await pool.query('COMMIT');
    
    // Obtener usuario actualizado
    const result = await pool.query(
      `SELECT id, nombre_usuario, email, rol, activo, nombre_completo, telefono, observaciones, updated_at
       FROM usuarios WHERE id = $1`,
      [req.params.id]
    );
    
    res.json({
      message: 'Usuario actualizado exitosamente',
      usuario: result.rows[0]
    });
    
  } catch (err) {
    console.error('Error actualizando usuario:', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un usuario con ese nombre o email' });
    }
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =============================
// ELIMINAR USUARIO
// DELETE /api/usuarios/:id
// =============================
router.delete('/:id', soloAdmin, async (req, res) => {
  try {
    // El SELECT anterior traía solo id y nombre_usuario, pero la guarda de
    // abajo preguntaba por usuarioActual.rol: siempre era undefined, así que
    // la protección del último administrador NUNCA se disparaba y el sistema
    // se podía quedar sin ningún admin.
    const usuarioExistente = await pool.query(
      'SELECT id, nombre_usuario, rol, activo FROM usuarios WHERE id = $1',
      [req.params.id]
    );

    if (usuarioExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const usuarioActual = usuarioExistente.rows[0];

    if (usuarioActual.id === req.usuario.id) {
      return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
    }

    if (usuarioActual.rol === 'admin' && usuarioActual.activo) {
      const otrosAdmins = await pool.query(
        `SELECT count(*)::int AS n FROM usuarios
          WHERE rol = 'admin' AND activo = true AND id <> $1`,
        [usuarioActual.id]
      );
      if (otrosAdmins.rows[0].n === 0) {
        return res.status(400).json({
          error: 'No se puede eliminar al último administrador activo'
        });
      }
    }

    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);

    res.json({
      message: 'Usuario eliminado exitosamente',
      usuario: {
        id: usuarioActual.id,
        nombre_usuario: usuarioActual.nombre_usuario
      }
    });

  } catch (err) {
    console.error('Error eliminando usuario:', err);
    // Un usuario referenciado desde otra tabla no se puede borrar: se
    // explica en vez de devolver el error crudo de Postgres.
    if (err.code === '23503') {
      return res.status(400).json({
        error: 'El usuario tiene movimientos registrados: desactivalo en vez de eliminarlo'
      });
    }
    res.status(500).json({ error: 'No se pudo eliminar el usuario' });
  }
});

// =============================
// RESETEAR LA CONTRASEÑA DE OTRO USUARIO
// POST /api/usuarios/:id/reset-password
//
// El administrador genera una contraseña temporal y se la pasa a la persona
// (en mano, por teléfono, como sea). La persona entra con esa clave y el
// sistema no la deja hacer nada más hasta que la cambie: eso lo garantiza
// debe_cambiar_password + el middleware exigirPasswordAlDia.
//
// Cambios respecto de la versión anterior:
//  - el admin ya NO puede elegir la contraseña. Cuando podía, terminaba
//    poniéndole la misma a todos, y encima quedaba escrita en el body de la
//    request. Ahora siempre es aleatoria y de un solo uso.
//  - la aleatoria se genera con crypto, no con Math.random(), que es
//    predecible y no sirve para nada que tenga que ser secreto.
//  - resetear cierra las sesiones abiertas de esa persona
//    (password_actualizado_en).
// =============================
router.post('/:id/reset-password', soloAdmin, async (req, res) => {
  try {
    const usuarioId = req.params.id;

    // Para la propia contraseña se usa cambiar-password, que pide la actual.
    // Si el admin perdió la suya, el rescate es scripts/reset-admin-password.js.
    if (Number(usuarioId) === req.usuario.id) {
      return res.status(400).json({
        error: 'Para tu propia contraseña usá "Cambiar mi contraseña"'
      });
    }

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await bcrypt.hash(passwordTemporal, 12);

    const result = await pool.query(
      `UPDATE usuarios
          SET password_hash = $1,
              debe_cambiar_password = true,
              password_actualizado_en = now(),
              intentos_fallidos = 0,
              bloqueado_hasta = NULL,
              updated_at = now()
        WHERE id = $2
    RETURNING id, nombre_usuario, email`,
      [passwordHash, usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const usuario = result.rows[0];
    // La temporal viaja solo en esta respuesta y no se loguea en ningún lado.
    // La pantalla la muestra una única vez.
    res.json({
      message: 'Contraseña temporal generada',
      password_temporal: passwordTemporal,
      usuario: {
        id: usuario.id,
        nombre_usuario: usuario.nombre_usuario,
        email: usuario.email
      }
    });

  } catch (err) {
    console.error('Error reseteando contraseña:', err);
    res.status(500).json({ error: 'No se pudo restablecer la contraseña' });
  }
});

module.exports = router;

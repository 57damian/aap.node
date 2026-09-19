// ============================================================================
// Verificación del circuito de autenticación.
//
// Prueba contra la API local que cada arreglo de seguridad está activo:
// enumeración de usuarios, bloqueo por intentos, reset con cambio obligatorio,
// invalidación de sesiones y endpoints eliminados.
//
// Requisitos:
//   - el server corriendo (npm start en otra terminal)
//   - la migración backend/scripts/migracion-seguridad.sql aplicada
//   - un usuario admin cuya contraseña conozcas
//
// Uso:
//   cd backend
//   node scripts/verificar-seguridad.js <usuario_admin> <password_admin>
//
// Crea un usuario de prueba (verificacion_seguridad_tmp) y lo borra al final.
// ============================================================================

require('dotenv').config();
const pool = require('../db');

const BASE = process.env.VERIFICAR_URL || `http://localhost:${process.env.PORT || 3000}`;

let ok = 0;
let fallas = 0;

function chequear(nombre, condicion, detalle) {
  if (condicion) {
    ok++;
    console.log(`  ✅ ${nombre}`);
  } else {
    fallas++;
    console.log(`  ❌ ${nombre}${detalle ? ' — ' + detalle : ''}`);
  }
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(BASE + ruta, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(opciones.token ? { Authorization: 'Bearer ' + opciones.token } : {}),
      ...(opciones.headers || {})
    }
  });
  let cuerpo = null;
  try { cuerpo = await res.json(); } catch (_) { /* puede no ser JSON */ }
  return { status: res.status, cuerpo };
}

const login = (usuario, password) =>
  pedir('/api/auth/login', { method: 'POST', body: JSON.stringify({ usuario, password }) });

(async () => {
  const usuarioAdmin = process.argv[2];
  const passwordAdmin = process.argv[3];

  if (!usuarioAdmin || !passwordAdmin) {
    console.error('Uso: node scripts/verificar-seguridad.js <usuario_admin> <password_admin>');
    process.exit(1);
  }

  const NOMBRE_PRUEBA = 'verificacion_seguridad_tmp';
  let idPrueba = null;
  let tokenAdmin = null;

  try {
    // ------------------------------------------------------------------
    console.log('\n1. El server responde y el admin puede entrar');
    // ------------------------------------------------------------------
    const salud = await pedir('/health');
    chequear('GET /health responde 200', salud.status === 200);

    const entrada = await login(usuarioAdmin, passwordAdmin);
    chequear('El admin entra con su contraseña', entrada.status === 200 && !!entrada.cuerpo.token,
      `status ${entrada.status}: ${entrada.cuerpo && entrada.cuerpo.error}`);
    if (!entrada.cuerpo || !entrada.cuerpo.token) {
      console.log('\n   Sin sesión de admin no se puede seguir.');
      process.exit(1);
    }
    tokenAdmin = entrada.cuerpo.token;

    // ------------------------------------------------------------------
    console.log('\n2. El login no delata qué usuarios existen');
    // ------------------------------------------------------------------
    const inexistente = await login('no_existe_este_usuario_xyz', 'loquesea12345');
    const claveMala = await login(usuarioAdmin, 'contraseña-incorrecta-a-proposito');

    chequear('Usuario inexistente y clave incorrecta dan el mismo mensaje',
      inexistente.cuerpo && claveMala.cuerpo &&
      inexistente.cuerpo.error === claveMala.cuerpo.error,
      `"${inexistente.cuerpo && inexistente.cuerpo.error}" vs "${claveMala.cuerpo && claveMala.cuerpo.error}"`);

    chequear('El mensaje no menciona el usuario ni su estado',
      inexistente.cuerpo && !/inactiv|no existe|no encontrado/i.test(inexistente.cuerpo.error || ''),
      inexistente.cuerpo && inexistente.cuerpo.error);

    // Tiempos: el caso "no existe" también tiene que pagar el costo de bcrypt.
    const t0 = Date.now(); await login('otro_inexistente_abc', 'loquesea12345');
    const tInexistente = Date.now() - t0;
    const t1 = Date.now(); await login(usuarioAdmin, 'otra-mala-a-proposito');
    const tExistente = Date.now() - t1;
    const proporcion = tInexistente / Math.max(tExistente, 1);
    chequear('Los tiempos de respuesta son comparables (no se enumera por timing)',
      proporcion > 0.4,
      `inexistente ${tInexistente}ms vs existente ${tExistente}ms`);

    // ------------------------------------------------------------------
    console.log('\n3. Endpoints eliminados');
    // ------------------------------------------------------------------
    for (const [metodo, ruta] of [
      ['POST', '/reset-password-admin'],
      ['POST', '/test-login'],
      ['GET', '/api/auth/usuarios'],
      ['POST', '/api/auth/cambiar-password']
    ]) {
      const r = await pedir(ruta, { method: metodo, token: tokenAdmin, body: metodo === 'POST' ? '{}' : undefined });
      chequear(`${metodo} ${ruta} ya no existe`, r.status === 404, `devolvió ${r.status}`);
    }

    // /debug-paths listaba el contenido del directorio del server. La ruta se
    // borró, pero como no empieza con /api cae en el comodín que sirve el
    // frontend: responde 200 con HTML. Lo que importa es que ya no devuelva
    // datos del filesystem.
    const debug = await fetch(BASE + '/debug-paths');
    const cuerpoDebug = await debug.text();
    chequear('GET /debug-paths ya no expone el filesystem',
      !/"(files|directorio|path|__dirname)"/i.test(cuerpoDebug) && !cuerpoDebug.includes('node_modules'),
      'todavía devuelve datos del server');

    // ------------------------------------------------------------------
    console.log('\n4. Reset por admin y cambio obligatorio');
    // ------------------------------------------------------------------
    // Limpieza por si quedó de una corrida anterior.
    const listado = await pedir('/api/usuarios?limit=200', { token: tokenAdmin });
    const previo = listado.cuerpo && (listado.cuerpo.usuarios || []).find(u => u.nombre_usuario === NOMBRE_PRUEBA);
    if (previo) await pedir(`/api/usuarios/${previo.id}`, { method: 'DELETE', token: tokenAdmin });

    const passwordInicial = 'prueba-segura-inicial-2026';
    const creado = await pedir('/api/usuarios', {
      method: 'POST',
      token: tokenAdmin,
      body: JSON.stringify({
        nombre_usuario: NOMBRE_PRUEBA,
        email: `${NOMBRE_PRUEBA}@ejemplo.local`,
        password: passwordInicial,
        rol: 'operario'
      })
    });
    chequear('Se crea el usuario de prueba', creado.status === 201,
      `status ${creado.status}: ${creado.cuerpo && creado.cuerpo.error}`);
    if (creado.status !== 201) throw new Error('No se pudo crear el usuario de prueba');
    idPrueba = creado.cuerpo.usuario.id;

    const corta = await pedir('/api/usuarios', {
      method: 'POST',
      token: tokenAdmin,
      body: JSON.stringify({
        nombre_usuario: NOMBRE_PRUEBA + '2',
        email: `${NOMBRE_PRUEBA}2@ejemplo.local`,
        password: 'corta1',
        rol: 'operario'
      })
    });
    chequear('Se rechaza una contraseña corta al crear', corta.status === 400,
      `status ${corta.status}`);

    const sesionPrevia = await login(NOMBRE_PRUEBA, passwordInicial);
    chequear('El usuario de prueba entra con su contraseña', sesionPrevia.status === 200);
    const tokenPrevio = sesionPrevia.cuerpo && sesionPrevia.cuerpo.token;

    const reset = await pedir(`/api/usuarios/${idPrueba}/reset-password`, {
      method: 'POST', token: tokenAdmin, body: '{}'
    });
    chequear('El admin genera una contraseña temporal',
      reset.status === 200 && !!(reset.cuerpo && reset.cuerpo.password_temporal),
      `status ${reset.status}`);
    const temporal = reset.cuerpo && reset.cuerpo.password_temporal;

    chequear('La temporal es larga y aleatoria (no un valor fijo)',
      typeof temporal === 'string' && temporal.length >= 12 && temporal !== 'admin123',
      temporal);

    const previoTrasReset = await pedir('/api/usuarios/stats', { token: tokenPrevio });
    chequear('El reset cierra la sesión que el usuario tenía abierta',
      previoTrasReset.status === 401, `devolvió ${previoTrasReset.status}`);

    const conTemporal = await login(NOMBRE_PRUEBA, temporal);
    chequear('Entra con la temporal', conTemporal.status === 200);
    chequear('El login avisa que hay que cambiar la contraseña',
      conTemporal.cuerpo && conTemporal.cuerpo.debe_cambiar_password === true);
    const tokenTemporal = conTemporal.cuerpo && conTemporal.cuerpo.token;

    // Se prueba contra un endpoint que el rol del usuario SÍ tiene permitido
    // (es operario): así, un 403 solo puede venir del cambio obligatorio de
    // contraseña y no de una falta de permisos, que sería otra cosa.
    const bloqueado = await pedir('/api/produccion', { token: tokenTemporal });
    chequear('Con la temporal, el resto del sistema responde PASSWORD_CHANGE_REQUIRED',
      bloqueado.status === 403 && bloqueado.cuerpo && bloqueado.cuerpo.code === 'PASSWORD_CHANGE_REQUIRED',
      `status ${bloqueado.status}`);

    const passwordFinal = 'la-nueva-de-verdad-2026';
    const cambio = await pedir('/api/usuarios/cambiar-password', {
      method: 'PUT',
      token: tokenTemporal,
      body: JSON.stringify({
        password_actual: temporal,
        password_nueva: passwordFinal,
        password_confirmacion: passwordFinal
      })
    });
    chequear('Puede cambiar su contraseña', cambio.status === 200,
      `status ${cambio.status}: ${cambio.cuerpo && cambio.cuerpo.error}`);
    chequear('El cambio devuelve un token nuevo', !!(cambio.cuerpo && cambio.cuerpo.token));

    const conNuevoToken = await pedir('/api/produccion', { token: cambio.cuerpo && cambio.cuerpo.token });
    chequear('Con el token nuevo ya puede trabajar', conNuevoToken.status === 200,
      `status ${conNuevoToken.status}`);

    const tokenViejo = await pedir('/api/produccion', { token: tokenTemporal });
    chequear('El token anterior al cambio quedó invalidado', tokenViejo.status === 401,
      `devolvió ${tokenViejo.status}`);

    // ------------------------------------------------------------------
    console.log('\n5. Bloqueo por intentos fallidos');
    // ------------------------------------------------------------------
    for (let i = 0; i < 5; i++) await login(NOMBRE_PRUEBA, 'clave-incorrecta-' + i);
    const trasFallos = await login(NOMBRE_PRUEBA, passwordFinal);

    // Ojo: hay DOS cosas que devuelven 429. El límite por IP de
    // express-rate-limit ("Demasiados intentos de login") y el bloqueo de la
    // cuenta, que es el que se está probando acá. Se distinguen por el
    // mensaje, si no el chequeo pasaría por el motivo equivocado.
    const mensajeBloqueo = (trasFallos.cuerpo && trasFallos.cuerpo.error) || '';
    chequear('Tras 5 intentos fallidos la cuenta queda bloqueada aunque la clave sea correcta',
      trasFallos.status === 429 && /Cuenta bloqueada/i.test(mensajeBloqueo),
      `status ${trasFallos.status}: "${mensajeBloqueo}"`);

    const reactivado = await pedir(`/api/usuarios/${idPrueba}/reset-password`, {
      method: 'POST', token: tokenAdmin, body: '{}'
    });
    // El desbloqueo se comprueba contra la base y no con otro login: a esta
    // altura el límite POR IP ya se agotó por los intentos de arriba, así que
    // un login devolvería 429 aunque la cuenta esté perfectamente desbloqueada.
    const estado = await pool.query(
      'SELECT intentos_fallidos, bloqueado_hasta, debe_cambiar_password FROM usuarios WHERE id = $1',
      [idPrueba]
    );
    const fila = estado.rows[0] || {};
    chequear('El reset del admin desbloquea la cuenta',
      reactivado.status === 200 && fila.intentos_fallidos === 0 && fila.bloqueado_hasta === null,
      `intentos=${fila.intentos_fallidos}, bloqueado_hasta=${fila.bloqueado_hasta}`);
    chequear('Y la deja marcada para cambio obligatorio',
      fila.debe_cambiar_password === true);

    // ------------------------------------------------------------------
    console.log('\n6. Protecciones de administración');
    // ------------------------------------------------------------------
    const autoReset = await pedir('/api/usuarios/me/reset-password'.replace('me', String(entrada.cuerpo.usuario.id)), {
      method: 'POST', token: tokenAdmin, body: '{}'
    });
    chequear('El admin no puede resetear su propia contraseña por esta vía',
      autoReset.status === 400, `devolvió ${autoReset.status}`);

    const sinToken = await pedir('/api/usuarios');
    chequear('Sin token, /api/usuarios responde 401', sinToken.status === 401);

    const tokenInventado = await pedir('/api/usuarios', { token: 'esto.no.es.un.token' });
    chequear('Con un token inventado responde 401', tokenInventado.status === 401);

  } catch (err) {
    fallas++;
    console.log(`\n❌ La verificación se cortó: ${err.message}`);
  } finally {
    // Limpieza del usuario de prueba.
    if (idPrueba && tokenAdmin) {
      const borrado = await pedir(`/api/usuarios/${idPrueba}`, { method: 'DELETE', token: tokenAdmin });
      console.log(`\n(limpieza: usuario de prueba ${borrado.status === 200 ? 'eliminado' : 'NO eliminado, borralo a mano'})`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${ok} chequeos OK · ${fallas} fallas`);
    console.log(`${'='.repeat(60)}\n`);
    process.exit(fallas > 0 ? 1 : 0);
  }
})();

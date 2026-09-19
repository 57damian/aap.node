// ============================================================================
// Verifica qué puede hacer realmente cada rol, pegándole a la API.
//
// El menú y las guardias de pantalla son del navegador: solo evitan que
// alguien aterrice donde no le corresponde. Lo que de verdad protege es el
// backend, y eso es lo que mide este script.
//
// Crea un usuario por rol, prueba una lista de endpoints y los borra.
//
// Uso:
//   cd backend
//   node scripts/verificar-roles.js <usuario_admin> <password_admin>
// ============================================================================

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { ROLES_VALIDOS } = require('../config/roles');

const BASE = process.env.VERIFICAR_URL || `http://localhost:${process.env.PORT || 3000}`;

// [método, ruta, etiqueta, quién DEBERÍA poder]
const CASOS = [
  ['GET', '/api/produccion', 'Producción: ver lo cargado', ['admin', 'operario']],
  ['GET', '/api/produccion/stock', 'Stock de transformadores', ['admin', 'operario']],
  ['GET', '/api/stock-produccion', 'Stock de producto terminado', ['admin', 'operario']],
  ['GET', '/api/ficha-transformador', 'Fichas técnicas (elegir modelo)', ['admin', 'operario']],
  ['GET', '/api/stock', 'Stock de materia prima', ['admin', 'operario']],
  ['GET', '/api/produccion/reporte', 'Reporte de producción', ['admin']],
  ['GET', '/api/stock/resumen', 'Stock valorizado', ['admin']],
  ['POST', '/api/stock/ajuste', 'Ajustar stock de materia prima', ['admin']],
  ['GET', '/api/cobros/deuda', 'Cobros: quién nos debe', ['admin']],
  ['GET', '/api/cobros/resumen', 'Cobros: resumen', ['admin']],
  ['GET', '/api/pagos-proveedores/deuda', 'Pagos: a quién le debemos', ['admin']],
  ['GET', '/api/pagos-proveedores/cheques', 'Cheques', ['admin']],
  ['GET', '/api/clientes', 'Clientes', ['admin']],
  ['GET', '/api/proveedores', 'Proveedores', ['admin']],
  ['GET', '/api/ventas', 'Ventas', ['admin']],
  ['GET', '/api/facturas-compra', 'Facturas de compra', ['admin']],
  ['GET', '/api/ordenes-compra', 'Órdenes de compra', ['admin']],
  ['GET', '/api/precios/parametros/dolar', 'Cotización del dólar', ['admin']],
  ['GET', '/api/materias-primas', 'ABM de materias primas', ['admin']],
  ['GET', '/api/reportes/saldo/cliente/1', 'Reporte de saldo', ['admin']],
  ['GET', '/api/usuarios', 'Usuarios', ['admin']]
];

// Campos que nunca tienen que llegarle a un operario.
const CAMPOS_PROHIBIDOS = [
  'ultimo_precio', 'precio_referencia', 'variacion_precio', 'valor_total',
  'proveedor_nombre', 'proveedor_id', 'fecha_ultima_compra'
];

let ok = 0, fallas = 0;

function chequear(texto, condicion, detalle) {
  if (condicion) { ok++; console.log(`  ✅ ${texto}`); }
  else { fallas++; console.log(`  ❌ ${texto}${detalle ? ' — ' + detalle : ''}`); }
}

async function usuarioDePrueba(rol) {
  const nombre = `verif_rol_${rol}`;
  const password = 'verificacion-de-roles-2026';
  await pool.query('DELETE FROM usuarios WHERE nombre_usuario = $1', [nombre]);
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO usuarios (nombre_usuario, email, password_hash, rol, activo, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, true, false)`,
    [nombre, `${nombre}@local`, hash, rol]
  );
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: nombre, password })
  });
  const d = await r.json();
  if (!d.token) throw new Error(`no se pudo entrar como ${rol}: ${JSON.stringify(d)}`);
  return { nombre, token: d.token };
}

(async () => {
  const creados = [];
  try {
    console.log(`\nRoles declarados en config/roles.js: ${ROLES_VALIDOS.join(', ')}\n`);

    const sesiones = {};
    for (const rol of ROLES_VALIDOS) {
      const s = await usuarioDePrueba(rol);
      creados.push(s.nombre);
      sesiones[rol] = s.token;
    }

    console.log('1. Cada rol accede a lo suyo y solo a lo suyo');
    for (const [metodo, ruta, etiqueta, permitidos] of CASOS) {
      for (const rol of ROLES_VALIDOS) {
        const r = await fetch(BASE + ruta, {
          method: metodo,
          headers: {
            Authorization: 'Bearer ' + sesiones[rol],
            'Content-Type': 'application/json'
          },
          body: metodo === 'POST' ? '{}' : undefined
        });
        const deberia = permitidos.includes(rol);
        // 400 en un POST con body vacío significa que pasó el control de rol.
        const accedio = r.status !== 403;
        chequear(
          `${etiqueta} — ${rol} ${deberia ? 'puede' : 'NO puede'}`,
          accedio === deberia,
          `devolvió ${r.status}`
        );
      }
    }

    console.log('\n2. Al operario no le llegan datos contables');
    const r = await fetch(`${BASE}/api/stock`, {
      headers: { Authorization: 'Bearer ' + sesiones.operario }
    });
    const filas = await r.json();
    const fila = Array.isArray(filas) ? filas[0] : null;

    if (!fila) {
      console.log('  ⚠️  No hay materias primas cargadas: no se pudo comprobar el filtrado.');
    } else {
      const filtrados = CAMPOS_PROHIBIDOS.filter((c) => c in fila);
      chequear('El listado de stock llega sin precios ni proveedor',
        filtrados.length === 0,
        'todavía vienen: ' + filtrados.join(', '));
      chequear('Pero sí llega la cantidad', 'stock_actual' in fila,
        'campos: ' + Object.keys(fila).join(', '));
    }

    // El admin sí tiene que verlos: si no, se rompió su pantalla.
    const rAdmin = await fetch(`${BASE}/api/stock`, {
      headers: { Authorization: 'Bearer ' + sesiones.admin }
    });
    const filasAdmin = await rAdmin.json();
    const filaAdmin = Array.isArray(filasAdmin) ? filasAdmin[0] : null;
    if (filaAdmin) {
      chequear('El admin sigue viendo el precio', 'ultimo_precio' in filaAdmin,
        'campos: ' + Object.keys(filaAdmin).join(', '));
    }

  } catch (err) {
    fallas++;
    console.log(`\n❌ La verificación se cortó: ${err.message}`);
  } finally {
    for (const nombre of creados) {
      await pool.query('DELETE FROM usuarios WHERE nombre_usuario = $1', [nombre]);
    }
    console.log(`\n(limpieza: ${creados.length} usuarios de prueba eliminados)`);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${ok} chequeos OK · ${fallas} fallas`);
    console.log(`${'='.repeat(60)}\n`);
    await pool.end();
    process.exit(fallas > 0 ? 1 : 0);
  }
})();

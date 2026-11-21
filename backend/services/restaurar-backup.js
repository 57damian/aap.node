// backend/services/restaurar-backup.js
//
// Restaura un archivo generado por services/backup-base.js (.sql.gz, o el .sql
// ya descomprimido) sobre la base a la que apunta el pool. REEMPLAZA TODO el
// contenido del esquema "public": borra las tablas, vistas, secuencias y
// funciones actuales y las vuelve a crear desde el archivo.
//
// Es todo o nada: corre en UNA transacción (en Postgres el DDL también es
// transaccional). Si el archivo está cortado, no es de esta app, o cualquier
// sentencia falla, se hace ROLLBACK y la base queda exactamente como estaba.
//
// No usa psql (en Railway no existe) ni dependencias nuevas: como el formato
// lo definimos nosotros, se lee sentencia por sentencia (las separa la línea
// `-- @@`) y los bloques `COPY ... FROM stdin` se cargan con INSERT por lotes.

const fs = require('fs');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { StringDecoder } = require('string_decoder');
const { MARCA_FIN_SENTENCIA, ENCABEZADO } = require('./backup-base');

const FILAS_X_PARAMETROS = 30000; // Postgres admite 65535 parámetros por consulta
const BYTES_X_LOTE = 4 * 1024 * 1024;

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

const RE_COPY = /^COPY ("(?:[^"]|"")*") \((.*)\) FROM stdin;$/;
const RE_IDENT = /"((?:[^"]|"")*)"/g;

function desescapar(campo) {
  if (campo === '\\N') return null;
  if (!campo.includes('\\')) return campo;
  return campo.replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c));
}

const esComentarioOVacia = (l) => l.trim() === '' || l.startsWith('--');

/** Abre el archivo como texto, descomprimiendo si hace falta. */
function abrirComoTexto(ruta) {
  const fd = fs.openSync(ruta, 'r');
  const cab = Buffer.alloc(2);
  fs.readSync(fd, cab, 0, 2, 0);
  fs.closeSync(fd);
  const crudo = fs.createReadStream(ruta);
  if (cab[0] === 0x1f && cab[1] === 0x8b) return pipeline(crudo, zlib.createGunzip(), () => {});
  return crudo;
}

/** Itera el archivo línea por línea con control de flujo (no carga todo en memoria). */
async function* lineas(entrada) {
  const dec = new StringDecoder('utf8');
  let resto = '';
  for await (const trozo of entrada) {
    resto += typeof trozo === 'string' ? trozo : dec.write(trozo);
    let i;
    let desde = 0;
    while ((i = resto.indexOf('\n', desde)) !== -1) {
      yield resto.slice(desde, i);
      desde = i + 1;
    }
    resto = resto.slice(desde);
  }
  resto += dec.end();
  if (resto) yield resto;
}

async function vaciarEsquema(client) {
  const q = async (sql) => (await client.query(sql)).rows;
  const vistas = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'public' AND c.relkind = 'v'`);
  for (const v of vistas) await client.query(`DROP VIEW IF EXISTS "${v.relname.replace(/"/g, '""')}" CASCADE`);
  const tablas = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'public' AND c.relkind IN ('r','p','f','m')`);
  for (const t of tablas) await client.query(`DROP TABLE IF EXISTS "${t.relname.replace(/"/g, '""')}" CASCADE`);
  const secuencias = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                              WHERE n.nspname = 'public' AND c.relkind = 'S'`);
  for (const s of secuencias) await client.query(`DROP SEQUENCE IF EXISTS "${s.relname.replace(/"/g, '""')}" CASCADE`);
  const funciones = await q(`SELECT p.oid::regprocedure::text AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.prokind = 'f'
                               AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`);
  for (const f of funciones) await client.query(`DROP FUNCTION IF EXISTS ${f.firma} CASCADE`);
}

/**
 * Restaura `archivo` sobre la base. Devuelve { tablas, filas }.
 * Lanza un Error con `.status` 400 si el archivo no sirve (la base no se toca).
 */
async function restaurarBackup({ pool, archivo, log = () => {} }) {
  const client = await pool.connect();
  let tablasCargadas = 0;
  let filasCargadas = 0;
  let vistoCommit = false;
  let primeraLinea = true;

  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query('SET LOCAL check_function_bodies = false');
    await client.query('SET LOCAL search_path = public');
    await vaciarEsquema(client);

    let acum = [];
    let acumTieneSql = false;
    let copia = null; // { tabla, columnas, n, filas: [], bytes }

    const volcar = async () => {
      if (!copia || !copia.filas.length) return;
      const nc = copia.n;
      const marcas = copia.filas.map((_, i) => '(' + Array.from({ length: nc }, (__, j) => `$${i * nc + j + 1}`).join(',') + ')');
      await client.query(`INSERT INTO ${copia.tabla} (${copia.columnas}) VALUES ${marcas.join(',')}`, copia.filas.flat());
      filasCargadas += copia.filas.length;
      copia.filas = [];
      copia.bytes = 0;
    };

    const ejecutar = async () => {
      const tieneSql = acumTieneSql;
      // Se sacan solo los comentarios del principio (los de sección del backup);
      // los de adentro de una función se dejan tal cual.
      let desde = 0;
      while (desde < acum.length && esComentarioOVacia(acum[desde])) desde++;
      const texto = acum.slice(desde).join('\n').trim();
      acum = [];
      acumTieneSql = false;
      if (!tieneSql) return;
      if (/^COMMIT\b/i.test(texto)) { vistoCommit = true; return; }
      if (/^(BEGIN|SET)\b/i.test(texto)) return; // la transacción y los SET los maneja este servicio
      await client.query(texto);
    };

    let entrada;
    try {
      entrada = abrirComoTexto(archivo);
    } catch (e) {
      throw fallo(400, 'No se pudo leer el archivo subido');
    }

    try {
      for await (const linea of lineas(entrada)) {
        if (primeraLinea) {
          primeraLinea = false;
          if (!linea.startsWith(ENCABEZADO)) {
            throw fallo(400, 'El archivo no es un backup generado por este sistema (copias de seguridad .sql.gz).');
          }
        }

        if (copia) {
          if (linea === '\\.') {
            await volcar();
            tablasCargadas++;
            copia = null;
          } else {
            const campos = linea.split('\t').map(desescapar);
            if (campos.length !== copia.n) throw fallo(400, `Backup dañado: fila con ${campos.length} columnas en ${copia.tabla} (se esperaban ${copia.n})`);
            copia.filas.push(campos);
            copia.bytes += linea.length;
            if (copia.filas.length * copia.n >= FILAS_X_PARAMETROS || copia.bytes >= BYTES_X_LOTE) await volcar();
          }
          continue;
        }

        if (linea === MARCA_FIN_SENTENCIA) { await ejecutar(); continue; }

        const m = !acumTieneSql && RE_COPY.exec(linea);
        if (m) {
          acum = [];
          const columnas = [...m[2].matchAll(RE_IDENT)].map((x) => `"${x[1]}"`);
          copia = { tabla: m[1], columnas: columnas.join(', '), n: columnas.length, filas: [], bytes: 0 };
          continue;
        }

        acum.push(linea);
        if (!esComentarioOVacia(linea)) acumTieneSql = true;
      }
    } catch (err) {
      // Un .gz cortado o que no es gzip: el error viene de zlib.
      if (err && typeof err.code === 'string' && err.code.startsWith('Z_')) {
        throw fallo(400, 'El archivo está dañado o incompleto (no se pudo descomprimir).');
      }
      throw err;
    }

    if (primeraLinea) throw fallo(400, 'El archivo está vacío');
    if (copia) throw fallo(400, 'El archivo está incompleto: termina en medio de una tabla.');
    if (!vistoCommit) throw fallo(400, 'El archivo está incompleto: no tiene el cierre del backup.');

    await client.query('COMMIT');
    log(`Restauración lista: ${tablasCargadas} tablas, ${filasCargadas} filas.`);
    return { tablas: tablasCargadas, filas: filasCargadas };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ya cerrada */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { restaurarBackup };

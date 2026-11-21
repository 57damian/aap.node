// backend/services/backup-base.js
//
// Backup lógico completo de la base (esquema + datos) en UN archivo .sql.gz.
// Lo usan el script `scripts/backup-base.js` (línea de comandos) y la pantalla
// "Copias de seguridad" (`routes/backup.routes.js`). Para volver atrás está
// `services/restaurar-backup.js`, que lee exactamente este formato.
//
// El pg_dump local es 16 y Neon corre Postgres 17, así que pg_dump se niega;
// esto solo necesita la librería `pg` que ya usa la app.
//
// SOLO LEE: todo corre dentro de una transacción READ ONLY con snapshot
// REPEATABLE READ, o sea que (1) no puede modificar la base y (2) el archivo es
// una foto consistente aunque alguien esté usando el sistema mientras corre.
//
// Qué incluye: secuencias, tablas (con columnas generadas), funciones, datos
// (también los binarios: fotos y etiquetas de las fichas viven en la base),
// PK/UNIQUE/CHECK, índices, claves foráneas, vistas y triggers. No incluye
// dueños ni permisos ni las fotos de OC que están en disco (`UPLOAD_PATH`).
//
// FORMATO: SQL válido para psql, pero además cada sentencia termina con una
// línea `-- @@` (marca que usa el restaurador para separar sentencias sin
// tener que entender SQL) y los datos van en bloques `COPY ... FROM stdin`.
// Si se cambia este formato, hay que cambiar también `restaurar-backup.js`.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MARCA_FIN_SENTENCIA = '-- @@';
const ENCABEZADO = '-- Backup lógico de ';

const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';

const ESCAPES_COPY = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const escaparCopy = (s) => s.replace(/[\\\n\r\t]/g, (m) => ESCAPES_COPY[m]);

const dos = (n) => String(n).padStart(2, '0');
function marcaDeTiempo(d = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}_${dos(d.getHours())}${dos(d.getMinutes())}`;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

// Orden topológico de vistas: una vista que usa a otra va después.
function ordenarVistas(vistas, dependencias) {
  const porOid = new Map(vistas.map((v) => [v.oid, v]));
  const deps = new Map(vistas.map((v) => [v.oid, new Set()]));
  for (const d of dependencias) {
    if (porOid.has(d.vista) && porOid.has(d.depende)) deps.get(d.vista).add(d.depende);
  }
  const hechas = new Set();
  const resultado = [];
  const visitando = new Set();
  const visitar = (oid) => {
    if (hechas.has(oid)) return;
    if (visitando.has(oid)) throw new Error('Dependencia circular entre vistas');
    visitando.add(oid);
    for (const dep of deps.get(oid)) visitar(dep);
    visitando.delete(oid);
    hechas.add(oid);
    resultado.push(porOid.get(oid));
  };
  vistas.forEach((v) => visitar(v.oid));
  return resultado;
}

/** De qué base se trata, sin exponer la contraseña. */
function describirBase(url) {
  const u = new URL(url);
  const host = u.hostname;
  const nombreBase = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'base';
  const etiqueta = host.includes('neon.tech')
    ? 'neon'
    : (['localhost', '127.0.0.1', '::1'].includes(host) ? 'local' : host.split('.')[0]);
  return { host, nombreBase, etiqueta };
}

/**
 * Genera el backup en `carpeta`. Devuelve { archivoSql, archivoResumen, resumen }.
 * Si algo falla borra el archivo a medias y relanza el error.
 */
async function crearBackup({ pool, carpeta, url = process.env.DATABASE_URL, log = () => {} }) {
  const { host, nombreBase, etiqueta } = describirBase(url);

  fs.mkdirSync(carpeta, { recursive: true });
  const base = `${etiqueta}-${nombreBase}-${marcaDeTiempo()}`;
  const archivoSql = path.join(carpeta, `${base}.sql.gz`);
  const archivoResumen = path.join(carpeta, `${base}.resumen.json`);

  const client = await pool.connect();
  const gz = zlib.createGzip({ level: 6 });
  const archivo = fs.createWriteStream(archivoSql);
  const terminado = new Promise((res, rej) => { archivo.on('finish', res); archivo.on('error', rej); gz.on('error', rej); });
  gz.pipe(archivo);

  let bytesSql = 0;
  const escribir = (texto) => {
    bytesSql += Buffer.byteLength(texto);
    return gz.write(texto) ? Promise.resolve() : new Promise((r) => gz.once('drain', r));
  };
  // Una sentencia SQL completa, con la marca que la cierra para el restaurador.
  const sentencia = (sql) => escribir(`${sql.replace(/[;\s]+$/, '')};\n${MARCA_FIN_SENTENCIA}\n\n`);

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL statement_timeout = 0');

    const q = async (sql, params) => (await client.query(sql, params)).rows;
    const version = (await q('SHOW server_version'))[0].server_version;

    // --- catálogo ---
    const esquemasAjenos = await q(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg\\_%'`
    );
    if (esquemasAjenos.length) {
      log(`⚠️  Hay otros esquemas (${esquemasAjenos.map((e) => e.nspname).join(', ')}): solo se respalda "public".`);
    }

    const relaciones = await q(
      `SELECT c.oid, c.relname, c.relkind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','m','f','v')
       ORDER BY c.relname`
    );
    const raras = relaciones.filter((r) => ['p', 'm', 'f'].includes(r.relkind));
    if (raras.length) {
      throw new Error(`Tipos de objeto no soportados por este backup: ${raras.map((r) => `${r.relname} (${r.relkind})`).join(', ')}. Usar pg_dump 17.`);
    }
    const tablas = relaciones.filter((r) => r.relkind === 'r');
    const vistas = relaciones.filter((r) => r.relkind === 'v');

    const columnas = await q(
      `SELECT a.attrelid AS oid, a.attname, format_type(a.atttypid, a.atttypmod) AS tipo,
              a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) AS def
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attrelid, a.attnum`,
      [tablas.map((t) => t.oid)]
    );
    const columnasDe = new Map(tablas.map((t) => [t.oid, []]));
    for (const c of columnas) {
      if (c.attidentity) throw new Error(`Columna identity (${c.attname}) no soportada por este backup. Usar pg_dump 17.`);
      columnasDe.get(c.oid).push(c);
    }

    const secuencias = await q(
      `SELECT sequencename, data_type::text AS tipo, start_value, min_value, max_value,
              increment_by, cycle, cache_size, last_value
       FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`
    );
    const duenosSecuencia = await q(
      `SELECT seq.relname AS secuencia, t.relname AS tabla, a.attname AS columna
       FROM pg_depend d
       JOIN pg_class seq ON seq.oid = d.objid AND seq.relkind = 'S'
       JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
       JOIN pg_namespace n ON n.oid = seq.relnamespace
       WHERE d.classid = 'pg_class'::regclass AND d.deptype = 'a' AND n.nspname = 'public'
       ORDER BY seq.relname`
    );

    const funciones = await q(
      `SELECT p.proname, p.prokind, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       ORDER BY p.proname, p.oid`
    );
    const noFunciones = funciones.filter((f) => f.prokind !== 'f');
    if (noFunciones.length) {
      throw new Error(`Procedimientos/agregados no soportados: ${noFunciones.map((f) => f.proname).join(', ')}. Usar pg_dump 17.`);
    }

    const restricciones = await q(
      `SELECT t.relname AS tabla, con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class t ON t.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND con.contype IN ('p','u','c','f','x')
       ORDER BY t.relname, con.conname`
    );
    const indices = await q(
      `SELECT pg_get_indexdef(i.indexrelid) AS def
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid AND c.contype IN ('p','u','x'))
       ORDER BY ic.relname`
    );
    const vistasDef = await q(
      `SELECT c.oid, c.relname, pg_get_viewdef(c.oid, true) AS def FROM pg_class c WHERE c.oid = ANY($1::oid[])`,
      [vistas.map((v) => v.oid)]
    );
    const depVistas = await q(
      `SELECT DISTINCT v.oid AS vista, ref.oid AS depende
       FROM pg_rewrite r
       JOIN pg_class v ON v.oid = r.ev_class
       JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
       JOIN pg_class ref ON ref.oid = d.refobjid
       WHERE v.oid = ANY($1::oid[]) AND ref.oid <> v.oid AND ref.relkind = 'v'`,
      [vistas.map((v) => v.oid)]
    );
    const triggers = await q(
      `SELECT pg_get_triggerdef(t.oid) AS def
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal
       ORDER BY c.relname, t.tgname`
    );

    // --- encabezado ---
    await escribir(
      `${ENCABEZADO}"${nombreBase}" (${etiqueta}, Postgres ${version})\n` +
      `-- Generado por la app (services/backup-base.js) el ${new Date().toISOString()}\n` +
      `-- Restaurar: desde la pantalla "Copias de seguridad", o sobre una base VACÍA con\n` +
      `--   gunzip -c <archivo>.sql.gz | psql -d <connection string> -v ON_ERROR_STOP=1\n` +
      `-- Todo corre en una sola transacción: si algo falla, no queda nada a medias.\n\n`
    );
    await sentencia('BEGIN');
    await sentencia(`SET client_encoding = 'UTF8'`);
    await sentencia('SET standard_conforming_strings = on');
    await sentencia('SET check_function_bodies = false');
    await sentencia('SET search_path = public');

    // --- secuencias ---
    await escribir('-- Secuencias\n');
    for (const s of secuencias) {
      await sentencia(
        `CREATE SEQUENCE ${ident(s.sequencename)} AS ${s.tipo} INCREMENT BY ${s.increment_by} ` +
        `MINVALUE ${s.min_value} MAXVALUE ${s.max_value} START WITH ${s.start_value} CACHE ${s.cache_size}` +
        `${s.cycle ? ' CYCLE' : ''}`
      );
    }

    // --- tablas ---
    await escribir('-- Tablas\n');
    for (const t of tablas) {
      const defs = columnasDe.get(t.oid).map((c) => {
        let linea = `  ${ident(c.attname)} ${c.tipo}`;
        if (c.attgenerated === 's') linea += ` GENERATED ALWAYS AS (${c.def}) STORED`;
        else {
          if (c.def !== null) linea += ` DEFAULT ${c.def}`;
          if (c.attnotnull) linea += ' NOT NULL';
        }
        return linea;
      });
      await sentencia(`CREATE TABLE ${ident(t.relname)} (\n${defs.join(',\n')}\n)`);
    }
    for (const d of duenosSecuencia) {
      await sentencia(`ALTER SEQUENCE ${ident(d.secuencia)} OWNED BY ${ident(d.tabla)}.${ident(d.columna)}`);
    }

    // --- funciones (antes que los datos; los triggers que las usan van al final) ---
    await escribir('-- Funciones\n');
    for (const f of funciones) await sentencia(f.def);

    // --- datos ---
    await escribir('-- Datos\n');
    const resumenTablas = {};
    for (const t of tablas) {
      const cols = columnasDe.get(t.oid).filter((c) => c.attgenerated !== 's');
      const lista = cols.map((c) => ident(c.attname)).join(', ');
      // Todo se pide como texto (::text): así no se pierde precisión (timestamps en
      // microsegundos, numeric) y el valor sirve tal cual como entrada de COPY.
      const selectLista = cols.map((c) => `${ident(c.attname)}::text`).join(', ');
      const conBinarios = cols.some((c) => c.tipo === 'bytea');
      const lote = conBinarios ? 10 : 1000; // un bytea de 5 MB pesa 10 MB como texto

      await escribir(`COPY ${ident(t.relname)} (${lista}) FROM stdin;\n`);
      await client.query(`DECLARE bk NO SCROLL CURSOR FOR SELECT ${selectLista} FROM ${ident(t.relname)}`);
      let filas = 0;
      for (;;) {
        const r = await client.query({ text: `FETCH FORWARD ${lote} FROM bk`, rowMode: 'array' });
        if (!r.rows.length) break;
        let bloque = '';
        for (const fila of r.rows) {
          bloque += fila.map((v) => (v === null ? '\\N' : escaparCopy(v))).join('\t') + '\n';
        }
        filas += r.rows.length;
        await escribir(bloque);
      }
      await client.query('CLOSE bk');
      await escribir('\\.\n\n');

      const esperado = Number((await q(`SELECT count(*) AS n FROM ${ident(t.relname)}`))[0].n);
      if (esperado !== filas) throw new Error(`${t.relname}: se leyeron ${filas} filas pero la tabla tiene ${esperado}`);
      resumenTablas[t.relname] = filas;
      log(`  ${t.relname.padEnd(38)} ${String(filas).padStart(8)} filas`);
    }

    // --- restricciones, índices, claves foráneas ---
    await escribir('-- Claves primarias y únicas\n');
    for (const r of restricciones.filter((r) => ['p', 'u', 'x'].includes(r.contype))) {
      await sentencia(`ALTER TABLE ONLY ${ident(r.tabla)} ADD CONSTRAINT ${ident(r.conname)} ${r.def}`);
    }
    await escribir('-- Restricciones CHECK\n');
    for (const r of restricciones.filter((r) => r.contype === 'c')) {
      await sentencia(`ALTER TABLE ONLY ${ident(r.tabla)} ADD CONSTRAINT ${ident(r.conname)} ${r.def}`);
    }
    await escribir('-- Índices\n');
    for (const i of indices) await sentencia(i.def);
    await escribir('-- Claves foráneas\n');
    for (const r of restricciones.filter((r) => r.contype === 'f')) {
      await sentencia(`ALTER TABLE ONLY ${ident(r.tabla)} ADD CONSTRAINT ${ident(r.conname)} ${r.def}`);
    }

    // --- vistas, triggers, secuencias ---
    await escribir('-- Vistas\n');
    for (const v of ordenarVistas(vistasDef, depVistas)) {
      await sentencia(`CREATE VIEW ${ident(v.relname)} AS\n${v.def.replace(/[;\s]+$/, '')}`);
    }
    await escribir('-- Triggers (después de los datos, para que no se disparen al cargar)\n');
    for (const tr of triggers) await sentencia(tr.def);

    await escribir('-- Valor actual de las secuencias\n');
    for (const s of secuencias) {
      if (s.last_value !== null) await sentencia(`SELECT pg_catalog.setval('${ident(s.sequencename)}', ${s.last_value}, true)`);
    }
    await sentencia('COMMIT');
    await escribir(`-- Fin del backup: ${tablas.length} tablas, ${vistas.length} vistas, ${funciones.length} funciones, ${triggers.length} triggers.\n`);

    await client.query('ROLLBACK'); // era solo lectura; se cierra el snapshot
    gz.end();
    await terminado;

    // --- verificación del archivo ---
    const hash = crypto.createHash('sha256');
    let descomprimido = 0;
    await new Promise((res, rej) => {
      const rs = fs.createReadStream(archivoSql);
      const gun = zlib.createGunzip();
      rs.on('data', (c) => hash.update(c));
      gun.on('data', (c) => { descomprimido += c.length; });
      gun.on('end', res);
      gun.on('error', rej);
      rs.on('error', rej);
      rs.pipe(gun);
    });
    if (descomprimido !== bytesSql) throw new Error('El archivo comprimido no coincide con lo escrito: backup inválido');

    const totalFilas = Object.values(resumenTablas).reduce((a, b) => a + b, 0);
    const resumen = {
      fecha: new Date().toISOString(),
      base: nombreBase,
      host,
      version_postgres: version,
      archivo: path.basename(archivoSql),
      tamano_comprimido_bytes: fs.statSync(archivoSql).size,
      tamano_sql_bytes: bytesSql,
      sha256: hash.digest('hex'),
      tablas: resumenTablas,
      total_filas: totalFilas,
      vistas: vistas.length,
      funciones: funciones.length,
      triggers: triggers.length
    };
    fs.writeFileSync(archivoResumen, JSON.stringify(resumen, null, 2));
    return { archivoSql, archivoResumen, resumen };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ya cerrado */ }
    gz.destroy();
    archivo.destroy();
    fs.rmSync(archivoSql, { force: true }); // un backup a medias es peor que ninguno
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { crearBackup, describirBase, mb, MARCA_FIN_SENTENCIA, ENCABEZADO };

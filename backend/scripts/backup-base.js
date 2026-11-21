// backend/scripts/backup-base.js
//
// Backup lógico completo de la base (esquema + datos) a UN archivo .sql.gz,
// desde la línea de comandos. La lógica está en services/backup-base.js (la
// misma que usa el botón "Descargar backup" de la pantalla Copias de
// seguridad). SOLO LEE: no modifica la base.
//
// Uso (desde backend/):
//   node scripts/backup-base.js                          # la base de DATABASE_URL (.env: local)
//   node scripts/backup-base.js --url-file .env.neon.txt # Neon (archivo con la URL, ignorado por git)
//   node scripts/backup-base.js --url-file .env.neon.txt --copiar-a "G:\Mi unidad\Backups ERP"
//
// Opciones:
//   --url-file <ruta>     archivo cuyo contenido es la connection string (acepta "DATABASE_URL=...")
//   --salida <carpeta>    dónde guardar (default: docs/_backup/ del repo, ignorada por git)
//   --copiar-a <carpeta>  copia además el resultado ahí (ej. la carpeta sincronizada de Drive)
//
// Restaurar: pantalla "Copias de seguridad", o ver "Backup de la base" en CLAUDE.md.

const fs = require('fs');
const path = require('path');

function leerArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ayuda' || a === '-h') out.ayuda = true;
    else if (a === '--url-file') out.urlFile = argv[++i];
    else if (a === '--salida') out.salida = argv[++i];
    else if (a === '--copiar-a') out.copiarA = argv[++i];
    else throw new Error(`Opción desconocida: ${a} (usar --ayuda)`);
  }
  return out;
}

const args = leerArgs(process.argv.slice(2));
if (args.ayuda) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

if (args.urlFile) {
  let txt = fs.readFileSync(path.resolve(args.urlFile), 'utf8').trim();
  txt = txt.replace(/^DATABASE_URL\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();
  if (!/^postgres(ql)?:\/\//.test(txt)) throw new Error(`${args.urlFile} no tiene una connection string de Postgres`);
  process.env.DATABASE_URL = txt;
}

require('dotenv').config(); // no pisa DATABASE_URL si ya vino de --url-file
const pool = require('../db');
const { crearBackup, describirBase, mb } = require('../services/backup-base');

(async () => {
  try {
    const { host, nombreBase, etiqueta } = describirBase(process.env.DATABASE_URL);
    const carpeta = path.resolve(args.salida || path.join(__dirname, '..', '..', 'docs', '_backup'));
    console.log(`Base: ${nombreBase} en ${host}  (${etiqueta})`);
    console.log(`Salida: ${carpeta}\n`);

    const { archivoSql, archivoResumen, resumen } = await crearBackup({ pool, carpeta, log: console.log });

    console.log(`\n✅ Backup listo: ${Object.keys(resumen.tablas).length} tablas, ${resumen.total_filas} filas, ` +
      `${mb(resumen.tamano_comprimido_bytes)} comprimido (${mb(resumen.tamano_sql_bytes)} de SQL).`);
    console.log(`   ${archivoSql}`);
    console.log(`   ${archivoResumen}`);

    if (args.copiarA) {
      const destino = path.resolve(args.copiarA);
      fs.mkdirSync(destino, { recursive: true });
      for (const f of [archivoSql, archivoResumen]) fs.copyFileSync(f, path.join(destino, path.basename(f)));
      console.log(`   Copiado también a: ${destino}`);
    }
  } catch (err) {
    console.error('\n❌ El backup falló:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

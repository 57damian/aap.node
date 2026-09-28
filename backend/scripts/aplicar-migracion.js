// backend/scripts/aplicar-migracion.js
//
// Corre un archivo SQL de backend/scripts/ contra la base a la que apunte
// DATABASE_URL, usando el mismo pool (con la config de SSL) que ya usa el
// resto de la app. Reemplaza a psql para las migraciones que no usan
// `\set` (todas menos migracion-roles.sql y migracion-seguridad.sql, que
// sí lo necesitan y siguen yendo por psql): en esta máquina, psql -f rompe
// el parseo de argumentos con la connection string de Neon (hallazgo
// 27/09/2026 — "se ignoró argumento extra" y se queda esperando en la
// consola interactiva en vez de correr el archivo).
//
// Uso:
//   cd backend
//   $env:DATABASE_URL = Get-Content .env.neon.txt -Raw   (o la del .env local)
//   node scripts/aplicar-migracion.js scripts/<archivo>.sql

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node scripts/aplicar-migracion.js scripts/<archivo>.sql');
  process.exitCode = 1;
} else {
  (async () => {
    const ruta = path.resolve(__dirname, '..', archivo);
    const sql = fs.readFileSync(ruta, 'utf8');
    try {
      await pool.query(sql);
      console.log(`✅ Migración aplicada: ${archivo}`);
    } catch (err) {
      console.error(`❌ Error aplicando ${archivo}:`, err.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

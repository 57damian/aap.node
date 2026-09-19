// backend/scripts/generar-esquema.js
require('dotenv').config();
const pool = require('../db');

(async () => {
  const out = [];
  const hoy = new Date().toISOString().slice(0, 10);
  out.push(`# Esquema real de la base — generado ${hoy}\n`);

  const tablas = await pool.query(`
    SELECT c.relname AS nombre,
           CASE c.relkind WHEN 'r' THEN 'TABLA' WHEN 'v' THEN 'VISTA'
                          WHEN 'm' THEN 'VISTA MATERIALIZADA' ELSE c.relkind::text END AS tipo
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
    ORDER BY c.relkind, c.relname`);

  for (const t of tablas.rows) {
    out.push(`\n## ${t.nombre}  _(${t.tipo})_\n`);
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [t.nombre]);
    out.push('| Columna | Tipo | Nulo | Defecto |');
    out.push('|---|---|---|---|');
    for (const c of cols.rows) {
      out.push(`| ${c.column_name} | ${c.data_type} | ${c.is_nullable} | ${c.column_default || ''} |`);
    }
    if (t.tipo === 'TABLA') {
      const cons = await pool.query(`
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype, conname`, [t.nombre]);
      if (cons.rows.length) {
        out.push('\n**Constraints:**\n');
        cons.rows.forEach(c => out.push(`- \`${c.conname}\`: ${c.def}`));
      }
      const idx = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1`, [t.nombre]);
      if (idx.rows.length) {
        out.push('\n**Índices:**\n');
        idx.rows.forEach(i => out.push(`- ${i.indexdef}`));
      }
    } else {
      const def = await pool.query(`SELECT pg_get_viewdef($1::regclass, true) AS d`, [t.nombre]);
      out.push('\n```sql\n' + def.rows[0].d + '\n```');
    }
  }
  console.log(out.join('\n'));
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

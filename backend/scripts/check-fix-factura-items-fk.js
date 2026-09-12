// check-fix-factura-items-fk.js
//
// Diagnostica (y si hace falta, corrige) la foreign key de
// factura_items.factura_id. Se detectó que cargar una factura de compra
// nueva falla con:
//   "inserción o actualización en la tabla «factura_items» viola la
//    llave foránea «factura_items_factura_id_fkey»"
// aun cuando la factura de compra sí se crea correctamente en la misma
// transacción. Esto es consistente con el patrón de bugs ya anotado en el
// documento del proyecto ("FK de factura_items apuntando a la tabla
// equivocada"): lo más probable es que esta FK esté referenciando la tabla
// `facturas` (ventas) en lugar de `facturas_compra` (compras).
//
// Este script:
//   1. Muestra a qué tabla apunta HOY la FK factura_items_factura_id_fkey.
//   2. Si no apunta a facturas_compra, la borra y la vuelve a crear apuntando
//      a facturas_compra(id).
//
// Correr con: node scripts/check-fix-factura-items-fk.js

const pool = require('../db');

async function main() {
  const client = await pool.connect();
  try {
    const constraintRes = await client.query(`
      SELECT
        con.conname AS constraint_name,
        con.confrelid::regclass AS referenced_table,
        pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'factura_items'
        AND con.contype = 'f'
        AND con.conname = 'factura_items_factura_id_fkey'
    `);

    if (constraintRes.rows.length === 0) {
      console.log('⚠️  No se encontró la constraint factura_items_factura_id_fkey. Puede tener otro nombre — revisar manualmente.');
      const allFks = await client.query(`
        SELECT con.conname, con.confrelid::regclass AS referenced_table, pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'factura_items' AND con.contype = 'f'
      `);
      console.log('FKs encontradas en factura_items:', allFks.rows);
      return;
    }

    const row = constraintRes.rows[0];
    console.log('🔍 Constraint actual:', row.constraint_name);
    console.log('🔍 Tabla referenciada actualmente:', row.referenced_table);
    console.log('🔍 Definición:', row.definition);

    if (row.referenced_table === 'facturas_compra') {
      console.log('✅ La FK ya apunta correctamente a facturas_compra. No hace falta corregir nada.');
      console.log('   (Si el error persiste, el problema es otro — avisar a Claude con este output.)');
      return;
    }

    console.log(`\n❌ La FK apunta a "${row.referenced_table}" en vez de "facturas_compra". Corrigiendo...\n`);

    await client.query('BEGIN');

    await client.query(`ALTER TABLE factura_items DROP CONSTRAINT factura_items_factura_id_fkey`);
    console.log('🗑️  Constraint vieja eliminada.');

    await client.query(`
      ALTER TABLE factura_items
      ADD CONSTRAINT factura_items_factura_id_fkey
      FOREIGN KEY (factura_id) REFERENCES facturas_compra(id)
    `);
    console.log('✅ Constraint nueva creada, apuntando a facturas_compra(id).');

    await client.query('COMMIT');
    console.log('\n✅ Listo. Volvé a probar cargar una factura de compra.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

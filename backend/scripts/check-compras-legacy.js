const pool = require('../db');

(async () => {
  try {
    const tablas = ['compras', 'compra_items', 'precios_materia_prima', 'stock_produccion', 'stock_materias_primas'];

    console.log('=== ¿EXISTEN ESTAS TABLAS/VISTAS? ===');
    for (const tabla of tablas) {
      const existe = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        ) as existe
      `, [tabla]);

      if (existe.rows[0].existe) {
        try {
          const count = await pool.query(`SELECT COUNT(*) as total FROM ${tabla}`);
          console.log(`  ${tabla}: SÍ EXISTE — ${count.rows[0].total} filas`);
        } catch (e) {
          console.log(`  ${tabla}: SÍ EXISTE — error contando filas: ${e.message}`);
        }
      } else {
        console.log(`  ${tabla}: NO EXISTE`);
      }
    }

    console.log('\n=== ¿stock_movimientos.compra_item_id tiene algún valor no nulo? ===');
    const r1 = await pool.query(`SELECT COUNT(*) as con_valor FROM stock_movimientos WHERE compra_item_id IS NOT NULL`);
    console.log(`  Filas con compra_item_id seteado: ${r1.rows[0].con_valor}`);

    console.log('\n=== materias_primas: precio_referencia y fecha_ultima_compra ===');
    const r2 = await pool.query(`SELECT id, codigo, nombre, precio_referencia, fecha_ultima_compra FROM materias_primas ORDER BY id`);
    console.table(r2.rows);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();

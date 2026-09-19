const pool = require('../db');

(async () => {
  try {
    const existe = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'productos_stock'
      ) as existe
    `);

    if (existe.rows[0].existe) {
      const count = await pool.query(`SELECT COUNT(*) as total FROM productos_stock`);
      console.log(`productos_stock: SÍ EXISTE — ${count.rows[0].total} filas`);
    } else {
      console.log('productos_stock: NO EXISTE');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();

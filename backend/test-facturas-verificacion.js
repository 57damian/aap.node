const pool = require('./db');

(async () => {
  try {
    console.log('Verificando tabla facturas_compra...');
    const res = await pool.query('SELECT COUNT(*) as total FROM facturas_compra');
    console.log('Total facturas_compra:', res.rows[0].total);

    console.log('\nVerificando estructura de facturas_compra...');
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'facturas_compra' 
      ORDER BY ordinal_position
    `);
    console.log('Columnas:');
    cols.rows.forEach(col => {
      console.log(`  ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });

    console.log('\nVerificando proveedores con facturas...');
    const prov = await pool.query(`
      SELECT p.id, p.nombre, COUNT(fc.id) as total_facturas
      FROM proveedores p
      LEFT JOIN facturas_compra fc ON fc.proveedor_id = p.id
      GROUP BY p.id, p.nombre
      HAVING COUNT(fc.id) > 0
      ORDER BY total_facturas DESC
      LIMIT 5
    `);
    console.log('Proveedores con facturas:');
    prov.rows.forEach(p => {
      console.log(`  ${p.nombre} (ID: ${p.id}): ${p.total_facturas} facturas`);
    });

    console.log('\nVerificando endpoint de facturas por proveedor...');
    const testProv = await pool.query(`
      SELECT fc.*, c.numero_oc, c.fecha_compra
      FROM facturas_compra fc
      LEFT JOIN compras c ON c.id = fc.compra_id
      WHERE fc.proveedor_id = 1
      LIMIT 3
    `);
    console.log('Primeras 3 facturas del proveedor 1:');
    testProv.rows.forEach(f => {
      console.log(`  Factura ${f.tipo_factura} ${f.punto_venta}-${f.numero_factura}: ${f.total}`);
    });

    console.log('\nVerificando tabla facturas_proveedor (vieja)...');
    const resVieja = await pool.query('SELECT COUNT(*) as total FROM facturas_proveedor');
    console.log('Total facturas_proveedor:', resVieja.rows[0].total);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit();
  }
})();
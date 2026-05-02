// Script para probar la consulta de ventas
const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres2026',
    database: 'transformadores',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

(async () => {
  try {
    console.log('Probando consulta de ventas...');
    
    // Primero, probar la subconsulta por separado
    console.log('\n=== PROBANDO SUBCONSULTA ===');
    try {
      const subqueryRes = await pool.query(`
        SELECT f.numero_factura
        FROM factura_items fi
        JOIN facturas f ON f.id = fi.factura_id
        JOIN venta_items vi ON vi.id = fi.venta_item_id
        WHERE vi.venta_id = 1
        LIMIT 1
      `);
      console.log('✅ Subconsulta funciona:', subqueryRes.rows);
    } catch (subqueryErr) {
      console.error('❌ Error en subconsulta:', subqueryErr.message);
    }
    
    // Probar la consulta completa
    console.log('\n=== PROBANDO CONSULTA COMPLETA ===');
    try {
      const fullQuery = `
        SELECT 
          v.id,
          v.fecha,
          v.tipo_cambio,
          v.remito_numero,
          v.remito_fecha,
          v.remito_observaciones,
          c.nombre AS cliente,
          oc.numero_oc,
          (
            SELECT f.numero_factura
            FROM factura_items fi
            JOIN facturas f ON f.id = fi.factura_id
            JOIN venta_items vi ON vi.id = fi.venta_item_id
            WHERE vi.venta_id = v.id
            LIMIT 1
          ) AS numero_factura
        FROM ventas v
        JOIN clientes c ON c.id = v.cliente_id
        JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
        ORDER BY v.id DESC
        LIMIT 5
      `;
      
      const result = await pool.query(fullQuery);
      console.log('✅ Consulta completa funciona');
      console.log('Resultados:', result.rows);
    } catch (fullErr) {
      console.error('❌ Error en consulta completa:', fullErr.message);
    }
    
    // Verificar si hay datos en las tablas
    console.log('\n=== VERIFICANDO DATOS ===');
    const ventasCount = await pool.query('SELECT COUNT(*) FROM ventas');
    const facturaItemsCount = await pool.query('SELECT COUNT(*) FROM factura_items');
    const ventaItemsCount = await pool.query('SELECT COUNT(*) FROM venta_items');
    
    console.log(`Ventas: ${ventasCount.rows[0].count}`);
    console.log(`Factura items: ${facturaItemsCount.rows[0].count}`);
    console.log(`Venta items: ${ventaItemsCount.rows[0].count}`);
    
    // Verificar si hay relaciones entre factura_items y venta_items
    console.log('\n=== VERIFICANDO RELACIONES ===');
    const relationsRes = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(fi.venta_item_id) as con_venta_item_id,
        COUNT(CASE WHEN fi.venta_item_id IS NOT NULL THEN 1 END) as no_nulos
      FROM factura_items fi
    `);
    console.log('Relaciones factura_items -> venta_items:', relationsRes.rows[0]);
    
    process.exit(0);
  } catch (err) {
    console.error('Error general:', err.message);
    process.exit(1);
  }
})();
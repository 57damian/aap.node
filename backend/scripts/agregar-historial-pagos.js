const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres2026',
  database: 'transformadores'
});

async function agregarHistorialPagos() {
  const client = await pool.connect();
  try {
    console.log('Agregando historial de pagos a facturas...\n');
    
    // 1. Verificar si existe la tabla pagos_proveedores
    const existeTabla = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'pagos_proveedores'
      );
    `);
    
    if (!existeTabla.rows[0].exists) {
      console.log('❌ La tabla pagos_proveedores no existe. Ejecuta primero el script de creación de tablas.');
      return;
    }
    
    // 2. Verificar pagos existentes
    const pagosExistentes = await client.query(`
      SELECT COUNT(*) as cantidad FROM pagos_proveedores;
    `);
    
    console.log(`✓ Pagos registrados: ${pagosExistentes.rows[0].cantidad}`);
    
    // 3. Obtener facturas con pagos aplicados
    const facturasConPagos = await client.query(`
      SELECT 
        fc.id as factura_id,
        fc.numero_factura,
        fc.total,
        fc.saldo_pendiente,
        fc.estado,
        COUNT(pp.id) as pagos_count,
        SUM(pp.monto) as total_pagado
      FROM facturas_compra fc
      LEFT JOIN pagos_proveedores pp ON fc.id = pp.factura_id
      GROUP BY fc.id, fc.numero_factura, fc.total, fc.saldo_pendiente, fc.estado
      HAVING COUNT(pp.id) > 0
      ORDER BY fc.id;
    `);
    
    console.log(`\nFacturas con pagos aplicados: ${facturasConPagos.rows.length}`);
    
    // 4. Mostrar detalles de pagos por factura
    const detallesPagos = await client.query(`
      SELECT 
        fc.id as factura_id,
        fc.numero_factura,
        fc.proveedor_id,
        p.nombre as proveedor_nombre,
        pp.id as pago_id,
        pp.fecha_pago,
        pp.metodo_pago,
        pp.numero_comprobante,
        pp.monto,
        pp.observaciones
      FROM facturas_compra fc
      JOIN proveedores p ON fc.proveedor_id = p.id
      LEFT JOIN pagos_proveedores pp ON fc.id = pp.factura_id
      WHERE pp.id IS NOT NULL
      ORDER BY fc.id, pp.fecha_pago;
    `);
    
    console.log('\nDetalles de pagos por factura:');
    console.log('=' .repeat(100));
    
    let facturaActual = null;
    detallesPagos.rows.forEach(row => {
      if (facturaActual !== row.factura_id) {
        facturaActual = row.factura_id;
        console.log(`\nFactura: ${row.numero_factura} - Proveedor: ${row.proveedor_nombre}`);
        console.log('-'.repeat(100));
      }
      
      console.log(`  Pago ID: ${row.pago_id}`);
      console.log(`  Fecha: ${new Date(row.fecha_pago).toLocaleDateString('es-AR')}`);
      console.log(`  Método: ${row.metodo_pago}`);
      console.log(`  Comprobante: ${row.numero_comprobante || 'N/A'}`);
      console.log(`  Monto: $${parseFloat(row.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
      if (row.observaciones) {
        console.log(`  Observaciones: ${row.observaciones}`);
      }
      console.log();
    });
    
    // 5. Verificar consistencia de saldos
    console.log('\nVerificación de consistencia de saldos:');
    console.log('=' .repeat(100));
    
    const inconsistencias = await client.query(`
      SELECT 
        fc.id,
        fc.numero_factura,
        fc.total,
        fc.saldo_pendiente,
        COALESCE(SUM(pp.monto), 0) as total_pagado,
        (fc.total - COALESCE(SUM(pp.monto), 0)) as saldo_calculado,
        CASE 
          WHEN fc.saldo_pendiente != (fc.total - COALESCE(SUM(pp.monto), 0)) THEN 'INCONSISTENTE'
          ELSE 'OK'
        END as estado
      FROM facturas_compra fc
      LEFT JOIN pagos_proveedores pp ON fc.id = pp.factura_id
      GROUP BY fc.id, fc.numero_factura, fc.total, fc.saldo_pendiente
      HAVING fc.saldo_pendiente != (fc.total - COALESCE(SUM(pp.monto), 0))
      ORDER BY fc.id;
    `);
    
    if (inconsistencias.rows.length > 0) {
      console.log('⚠️  Se encontraron inconsistencias en los saldos:');
      inconsistencias.rows.forEach(row => {
        console.log(`  Factura ${row.numero_factura}:`);
        console.log(`    Total: $${parseFloat(row.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
        console.log(`    Pagado: $${parseFloat(row.total_pagado).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
        console.log(`    Saldo actual: $${parseFloat(row.saldo_pendiente).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
        console.log(`    Saldo calculado: $${parseFloat(row.saldo_calculado).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
        console.log();
      });
      
      console.log('\n¿Deseas corregir las inconsistencias? (s/n)');
      // En una implementación real, aquí se pediría confirmación al usuario
      // Por ahora solo mostramos la información
    } else {
      console.log('✅ Todos los saldos son consistentes');
    }
    
    // 6. Resumen general
    const resumen = await client.query(`
      SELECT 
        COUNT(DISTINCT fc.id) as total_facturas,
        COUNT(DISTINCT pp.factura_id) as facturas_con_pagos,
        COUNT(pp.id) as total_pagos,
        SUM(pp.monto) as monto_total_pagado,
        AVG(pp.monto) as promedio_pago
      FROM facturas_compra fc
      LEFT JOIN pagos_proveedores pp ON fc.id = pp.factura_id;
    `);
    
    const res = resumen.rows[0];
    console.log('\nResumen general del sistema de pagos:');
    console.log('=' .repeat(100));
    console.log(`  Total facturas: ${res.total_facturas}`);
    console.log(`  Facturas con pagos: ${res.facturas_con_pagos}`);
    console.log(`  Total pagos registrados: ${res.total_pagos}`);
    console.log(`  Monto total pagado: $${parseFloat(res.monto_total_pagado || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    console.log(`  Promedio por pago: $${parseFloat(res.promedio_pago || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`);
    
    // 7. Métodos de pago utilizados
    const metodosPago = await client.query(`
      SELECT 
        metodo_pago,
        COUNT(*) as cantidad,
        SUM(monto) as total_monto
      FROM pagos_proveedores
      GROUP BY metodo_pago
      ORDER BY total_monto DESC;
    `);
    
    console.log('\nDistribución por método de pago:');
    console.log('=' .repeat(100));
    metodosPago.rows.forEach(row => {
      console.log(`  ${row.metodo_pago}: ${row.cantidad} pagos ($${parseFloat(row.total_monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })})`);
    });
    
    console.log('\n✅ Historial de pagos generado exitosamente');
    
  } catch (error) {
    console.error('Error generando historial de pagos:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

agregarHistorialPagos();
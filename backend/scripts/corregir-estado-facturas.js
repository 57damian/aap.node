const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres2026',
  database: 'transformadores'
});

async function corregirEstadoFacturas() {
  const client = await pool.connect();
  try {
    console.log('Corrigiendo estado de facturas según restricción CHECK...\n');
    
    // 1. Primero, actualizar el estado basado en saldo_pendiente usando los valores permitidos
    await client.query(`
      UPDATE facturas_compra 
      SET estado = 
        CASE 
          WHEN saldo_pendiente <= 0 THEN 'PAGADA'
          ELSE 'PENDIENTE'
        END
      WHERE estado IS NULL OR estado NOT IN ('PENDIENTE', 'PAGADA', 'ANULADA');
    `);
    
    console.log('✓ Estado de facturas actualizado según saldo pendiente');
    
    // 2. Verificar que todos los estados sean válidos
    const estadosInvalidos = await client.query(`
      SELECT COUNT(*) as cantidad
      FROM facturas_compra
      WHERE estado NOT IN ('PENDIENTE', 'PAGADA', 'ANULADA');
    `);
    
    console.log(`✓ Facturas con estado inválido: ${estadosInvalidos.rows[0].cantidad}`);
    
    // 3. Verificar resumen
    const resumen = await client.query(`
      SELECT 
        estado,
        COUNT(*) as cantidad,
        SUM(total) as total_monto,
        SUM(saldo_pendiente) as total_saldo_pendiente
      FROM facturas_compra
      GROUP BY estado
      ORDER BY estado;
    `);
    
    console.log('\nResumen actualizado:');
    resumen.rows.forEach(row => {
      console.log(`  - ${row.estado}: ${row.cantidad} facturas, Total: $${row.total_monto}, Saldo: $${row.total_saldo_pendiente}`);
    });
    
    // 4. Verificar fechas de vencimiento
    const vencimientos = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN fecha_vencimiento IS NULL THEN 1 END) as sin_fecha,
        COUNT(CASE WHEN fecha_vencimiento < CURRENT_DATE THEN 1 END) as vencidas,
        COUNT(CASE WHEN fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days' AND fecha_vencimiento >= CURRENT_DATE THEN 1 END) as por_vencer
      FROM facturas_compra
      WHERE estado = 'PENDIENTE';
    `);
    
    const venc = vencimientos.rows[0];
    console.log('\nEstado de vencimientos (facturas PENDIENTES):');
    console.log(`  - Total facturas pendientes: ${venc.total}`);
    console.log(`  - Sin fecha de vencimiento: ${venc.sin_fecha}`);
    console.log(`  - Vencidas: ${venc.vencidas}`);
    console.log(`  - Por vencer (≤ 7 días): ${venc.por_vencer}`);
    
    console.log('\n✅ Estado de facturas corregido exitosamente');
    
  } catch (error) {
    console.error('Error corrigiendo estado:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

corregirEstadoFacturas();
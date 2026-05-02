const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres2026',
  database: 'transformadores'
});

async function agregarCampos() {
  const client = await pool.connect();
  try {
    console.log('Agregando campos a la tabla facturas_compra...');
    
    // 1. Agregar campo saldo_pendiente
    try {
      await client.query(`
        ALTER TABLE facturas_compra 
        ADD COLUMN IF NOT EXISTS saldo_pendiente DECIMAL(15,2);
      `);
      console.log('✓ Campo saldo_pendiente agregado');
      
      // Inicializar saldo_pendiente con el total de la factura
      await client.query(`
        UPDATE facturas_compra 
        SET saldo_pendiente = total 
        WHERE saldo_pendiente IS NULL;
      `);
      console.log('✓ Saldo pendiente inicializado');
    } catch (error) {
      console.warn(`Advertencia con saldo_pendiente: ${error.message}`);
    }
    
    // 2. Agregar campo fecha_vencimiento
    try {
      await client.query(`
        ALTER TABLE facturas_compra 
        ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;
      `);
      console.log('✓ Campo fecha_vencimiento agregado');
      
      // Establecer fecha de vencimiento como 30 días después de la fecha de factura
      // Primero verificar si existe la columna fecha_factura
      const checkResult = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'facturas_compra' 
        AND column_name = 'fecha_factura';
      `);
      
      if (checkResult.rows.length > 0) {
        await client.query(`
          UPDATE facturas_compra 
          SET fecha_vencimiento = fecha_factura + INTERVAL '30 days'
          WHERE fecha_vencimiento IS NULL;
        `);
        console.log('✓ Fecha de vencimiento establecida desde fecha_factura');
      } else {
        // Si no existe fecha_factura, usar created_at o fecha actual
        await client.query(`
          UPDATE facturas_compra 
          SET fecha_vencimiento = CURRENT_DATE + INTERVAL '30 days'
          WHERE fecha_vencimiento IS NULL;
        `);
        console.log('✓ Fecha de vencimiento establecida desde fecha actual');
      }
    } catch (error) {
      console.warn(`Advertencia con fecha_vencimiento: ${error.message}`);
    }
    
    // 3. Agregar campo estado
    try {
      await client.query(`
        ALTER TABLE facturas_compra 
        ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'pendiente';
      `);
      console.log('✓ Campo estado agregado');
      
      // Inicializar estado basado en saldo pendiente
      await client.query(`
        UPDATE facturas_compra 
        SET estado = 
          CASE 
            WHEN saldo_pendiente <= 0 THEN 'pagada'
            ELSE 'pendiente'
          END;
      `);
      console.log('✓ Estado inicializado');
    } catch (error) {
      console.warn(`Advertencia con estado: ${error.message}`);
    }
    
    // 4. Crear índices
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_facturas_estado ON facturas_compra(estado);
      `);
      console.log('✓ Índice idx_facturas_estado creado');
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_facturas_vencimiento ON facturas_compra(fecha_vencimiento);
      `);
      console.log('✓ Índice idx_facturas_vencimiento creado');
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_facturas_saldo ON facturas_compra(saldo_pendiente);
      `);
      console.log('✓ Índice idx_facturas_saldo creado');
    } catch (error) {
      console.warn(`Advertencia con índices: ${error.message}`);
    }
    
    console.log('\n✅ Campos agregados exitosamente a facturas_compra');
    
  } catch (error) {
    console.error('Error agregando campos:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

agregarCampos();
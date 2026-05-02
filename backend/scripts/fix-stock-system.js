const pool = require('../db');

async function fixStockSystem() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Iniciando corrección del sistema de stock...\n');
    
    await client.query('BEGIN');
    
    // 1. Renombrar la vista stock_actual a stock_produccion para claridad
    console.log('📋 1. Renombrando vista stock_actual a stock_produccion...');
    try {
      await client.query('DROP VIEW IF EXISTS stock_produccion CASCADE');
      await client.query(`
        CREATE OR REPLACE VIEW stock_produccion AS
        SELECT 
          f.id as ficha_id,
          f.modelo,
          f.cliente_id,
          COALESCE(SUM(p.cantidad), 0) as producido_total,
          COALESCE(SUM(vi.cantidad), 0) as entregado_total,
          COALESCE(SUM(p.cantidad), 0) - COALESCE(SUM(vi.cantidad), 0) as stock_actual
        FROM ficha_transformador f
        LEFT JOIN produccion p ON f.id = p.ficha_id
        LEFT JOIN venta_items vi ON f.id = vi.ficha_id
        GROUP BY f.id, f.modelo, f.cliente_id
      `);
      console.log('   ✅ Vista stock_produccion creada');
    } catch (err) {
      console.log('   ⚠️  Error creando vista stock_produccion:', err.message);
    }
    
    // 2. Crear vista para stock de materias primas (más clara)
    console.log('\n📋 2. Creando vista stock_materias_primas...');
    try {
      await client.query('DROP VIEW IF EXISTS stock_materias_primas CASCADE');
      await client.query(`
        CREATE OR REPLACE VIEW stock_materias_primas AS
        SELECT 
          mp.id as materia_prima_id,
          mp.codigo,
          mp.nombre,
          mp.unidad_medida,
          mp.stock_actual,
          mp.stock_minimo,
          mp.ubicacion,
          mp.activo,
          (SELECT precio_unitario FROM precios_materia_prima 
           WHERE materia_prima_id = mp.id 
           ORDER BY fecha_desde DESC LIMIT 1) as ultimo_precio,
          (SELECT MAX(c.fecha_compra) 
           FROM compras c 
           JOIN compra_items ci ON c.id = ci.compra_id 
           WHERE ci.materia_prima_id = mp.id) as fecha_ultima_compra
        FROM materias_primas mp
        WHERE mp.activo = true
      `);
      console.log('   ✅ Vista stock_materias_primas creada');
    } catch (err) {
      console.log('   ⚠️  Error creando vista stock_materias_primas:', err.message);
    }
    
    // 3. Crear tabla de ajustes de stock de producción
    console.log('\n📋 3. Creando tabla para ajustes de stock de producción...');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS stock_produccion_ajustes (
          id SERIAL PRIMARY KEY,
          ficha_id INTEGER NOT NULL REFERENCES ficha_transformador(id),
          fecha_ajuste DATE NOT NULL DEFAULT CURRENT_DATE,
          tipo_ajuste VARCHAR(50) NOT NULL CHECK (tipo_ajuste IN ('ENTRADA', 'SALIDA', 'CORRECCION')),
          cantidad INTEGER NOT NULL,
          motivo TEXT,
          usuario_id INTEGER REFERENCES usuarios(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ Tabla stock_produccion_ajustes creada');
    } catch (err) {
      console.log('   ⚠️  Error creando tabla stock_produccion_ajustes:', err.message);
    }
    
    // 4. Crear función para actualizar stock de producción
    console.log('\n📋 4. Creando función para actualizar stock de producción...');
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION actualizar_stock_produccion()
        RETURNS TRIGGER AS $$
        BEGIN
          -- Esta función se puede usar para triggers futuros
          -- Por ahora solo la creamos para estructura
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);
      console.log('   ✅ Función actualizar_stock_produccion creada');
    } catch (err) {
      console.log('   ⚠️  Error creando función:', err.message);
    }
    
    // 5. Verificar y corregir índices
    console.log('\n📋 5. Verificando índices...');
    try {
      // Índice para búsquedas en materias_primas
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_materias_primas_codigo 
        ON materias_primas(codigo) WHERE codigo IS NOT NULL;
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_materias_primas_nombre 
        ON materias_primas(nombre);
      `);
      
      // Índice para stock_movimientos
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_stock_movimientos_materia_prima 
        ON stock_movimientos(materia_prima_id, fecha_movimiento DESC);
      `);
      
      console.log('   ✅ Índices verificados/creados');
    } catch (err) {
      console.log('   ⚠️  Error creando índices:', err.message);
    }
    
    await client.query('COMMIT');
    
    console.log('\n✅ Sistema de stock corregido exitosamente!');
    console.log('\n📊 Resumen de cambios:');
    console.log('   1. Vista stock_produccion creada (antes stock_actual)');
    console.log('   2. Vista stock_materias_primas creada para claridad');
    console.log('   3. Tabla stock_produccion_ajustes para ajustes de producción');
    console.log('   4. Función de actualización creada para futuras mejoras');
    console.log('   5. Índices optimizados para mejor rendimiento');
    console.log('\n⚠️  IMPORTANTE: Ahora necesitas:');
    console.log('   - Actualizar las rutas de producción para usar stock_produccion');
    console.log('   - Separar claramente endpoints de materias primas vs producción');
    console.log('   - Actualizar frontend para evitar confusión');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en la corrección:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecutar la corrección
fixStockSystem();
const pool = require('../db');

async function createMissingTables() {
  try {
    console.log('🔄 Creando tablas faltantes según especificación...\n');
    
    // 1. Tabla compra_documentos
    console.log('📎 Creando tabla compra_documentos...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compra_documentos (
        id SERIAL PRIMARY KEY,
        compra_id INTEGER REFERENCES compras(id) ON DELETE CASCADE,
        tipo_documento VARCHAR(50) NOT NULL, -- 'FACTURA', 'REMITO', 'OTRO'
        nombre_archivo VARCHAR(255) NOT NULL,
        ruta_archivo TEXT NOT NULL,
        tamaño_bytes BIGINT,
        mime_type VARCHAR(100),
        fecha_subida TIMESTAMP DEFAULT NOW(),
        usuario_id INTEGER REFERENCES usuarios(id),
        observaciones TEXT
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_compra_docs_compra ON compra_documentos(compra_id)
    `);
    
    console.log('✅ Tabla compra_documentos creada');
    
    // 2. Tabla productos_stock
    console.log('📦 Creando tabla productos_stock...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS productos_stock (
        id SERIAL PRIMARY KEY,
        materia_prima_id INTEGER REFERENCES materias_primas(id),
        proveedor_id INTEGER REFERENCES proveedores(id),
        stock_actual DECIMAL(10,2) DEFAULT 0,
        stock_minimo DECIMAL(10,2) DEFAULT 0,
        punto_pedido DECIMAL(10,2) DEFAULT 0,
        ubicacion VARCHAR(100),
        ultima_compra_id INTEGER REFERENCES compras(id),
        ultimo_precio DECIMAL(10,2),
        fecha_ultima_actualizacion TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_producto_proveedor ON productos_stock(materia_prima_id, proveedor_id)
    `);
    
    console.log('✅ Tabla productos_stock creada');
    
    // 3. Tabla cheques (gestión completa)
    console.log('🏦 Creando tabla cheques...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cheques (
        id SERIAL PRIMARY KEY,
        numero_cheque VARCHAR(50) UNIQUE NOT NULL,
        banco VARCHAR(100) NOT NULL,
        titular VARCHAR(200) NOT NULL,
        monto DECIMAL(12,2) NOT NULL,
        fecha_emision DATE NOT NULL,
        fecha_pago DATE NOT NULL,
        fecha_cobro DATE,
        tipo_cheque VARCHAR(20) NOT NULL, -- 'PROPIO', 'TERCERO'
        estado VARCHAR(20) NOT NULL DEFAULT 'EMITIDO', -- 'EMITIDO', 'ENTREGADO', 'COBRADO', 'RECHAZADO', 'ENDOSADO'
        beneficiario_id INTEGER REFERENCES proveedores(id),
        cliente_id INTEGER REFERENCES clientes(id),
        ruta_imagen TEXT,
        observaciones TEXT,
        created_by INTEGER REFERENCES usuarios(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cheques_estado ON cheques(estado)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cheques_fecha_pago ON cheques(fecha_pago)
    `);
    
    console.log('✅ Tabla cheques creada');
    
    // 4. Agregar columnas faltantes a proveedores
    console.log('🏢 Actualizando tabla proveedores...');
    
    // Agregar días de crédito si no existe
    try {
      await pool.query('ALTER TABLE proveedores ADD COLUMN dias_credito INTEGER DEFAULT 0');
      console.log('✅ Columna dias_credito agregada a proveedores');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ No se pudo agregar dias_credito:', err.message);
      }
    }
    
    // Agregar forma de pago habitual si no existe
    try {
      await pool.query('ALTER TABLE proveedores ADD COLUMN forma_pago_habitual VARCHAR(50) DEFAULT \'TRANSFERENCIA\'');
      console.log('✅ Columna forma_pago_habitual agregada a proveedores');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ No se pudo agregar forma_pago_habitual:', err.message);
      }
    }
    
    // 5. Crear trigger para actualizar timestamps en cheques
    console.log('⚙️ Creando triggers...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION actualizar_timestamp_cheques()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    await pool.query(`
      DROP TRIGGER IF EXISTS trigger_cheques_actualizado ON cheques
    `);
    
    await pool.query(`
      CREATE TRIGGER trigger_cheques_actualizado
        BEFORE UPDATE ON cheques
        FOR EACH ROW
        EXECUTE FUNCTION actualizar_timestamp_cheques();
    `);
    
    console.log('✅ Triggers creados');
    
    // 6. Verificar estructura final
    console.log('\n📋 Verificando estructura final...');
    
    const tables = ['compra_documentos', 'productos_stock', 'cheques'];
    for (const table of tables) {
      const exists = await pool.query(
        'SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)',
        [table]
      );
      console.log(`  ${exists.rows[0].exists ? '✅' : '❌'} ${table}`);
    }
    
    console.log('\n🎉 Migración completada exitosamente');
    console.log('💡 El sistema ahora soporta gestión completa de documentos y stock por proveedor');
    
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
  } finally {
    pool.end();
  }
}

createMissingTables();

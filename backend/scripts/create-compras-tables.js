const pool = require('../db');

async function crearTablasCompras() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Creando tablas para gestión de compras...\n');

    // =====================================================
    // TABLA: articulos_proveedor
    // =====================================================
    console.log('📋 Creando tabla articulos_proveedor...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS articulos_proveedor (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(50),
        nombre VARCHAR(200) NOT NULL,
        descripcion TEXT,
        unidad_medida VARCHAR(20) DEFAULT 'UNI',
        proveedor_id INTEGER REFERENCES proveedores(id),
        activo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        created_by INTEGER REFERENCES usuarios(id)
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_articulos_proveedor 
      ON articulos_proveedor(proveedor_id, activo);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_articulos_codigo 
      ON articulos_proveedor(codigo);
    `);
    console.log('✅ Tabla articulos_proveedor creada\n');

    // =====================================================
    // TABLA: stock_articulos
    // =====================================================
    console.log('📋 Creando tabla stock_articulos...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_articulos (
        id SERIAL PRIMARY KEY,
        articulo_id INTEGER REFERENCES articulos_proveedor(id) ON DELETE CASCADE,
        proveedor_id INTEGER REFERENCES proveedores(id),
        stock_actual DECIMAL(10,2) DEFAULT 0,
        stock_minimo DECIMAL(10,2) DEFAULT 0,
        ubicacion VARCHAR(100),
        ultimo_precio DECIMAL(10,2),
        fecha_ultima_compra DATE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(articulo_id, proveedor_id)
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_articulos 
      ON stock_articulos(proveedor_id, articulo_id);
    `);
    console.log('✅ Tabla stock_articulos creada\n');

    // =====================================================
    // TABLA: facturas_compra
    // =====================================================
    console.log('📋 Creando tabla facturas_compra...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS facturas_compra (
        id SERIAL PRIMARY KEY,
        proveedor_id INTEGER REFERENCES proveedores(id),
        fecha_emision DATE NOT NULL,
        fecha_recepcion DATE,
        tipo_factura VARCHAR(5) NOT NULL,
        punto_venta VARCHAR(10),
        numero_factura VARCHAR(50),
        numero_comprobante VARCHAR(100),
        subtotal DECIMAL(10,2) NOT NULL,
        iva DECIMAL(10,2) NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        percepciones DECIMAL(10,2) DEFAULT 0,
        retenciones DECIMAL(10,2) DEFAULT 0,
        neto_pagado DECIMAL(10,2),
        condicion_pago VARCHAR(50),
        observaciones TEXT,
        estado VARCHAR(20) DEFAULT 'PENDIENTE',
        created_by INTEGER REFERENCES usuarios(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT unique_factura_proveedor UNIQUE(proveedor_id, tipo_factura, punto_venta, numero_factura)
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_facturas_proveedor 
      ON facturas_compra(proveedor_id, fecha_emision);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_facturas_estado 
      ON facturas_compra(estado);
    `);
    console.log('✅ Tabla facturas_compra creada\n');

    // =====================================================
    // TABLA: factura_items
    // =====================================================
    console.log('📋 Creando tabla factura_items...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS factura_items (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER REFERENCES facturas_compra(id) ON DELETE CASCADE,
        articulo_id INTEGER REFERENCES articulos_proveedor(id),
        descripcion TEXT,
        cantidad DECIMAL(10,2) NOT NULL,
        precio_unitario DECIMAL(10,2) NOT NULL,
        subtotal DECIMAL(10,2) NOT NULL,
        iva DECIMAL(10,2) DEFAULT 0,
        iva_porcentaje DECIMAL(5,2) DEFAULT 21,
        total DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_factura_items_factura 
      ON factura_items(factura_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_factura_items_articulo 
      ON factura_items(articulo_id);
    `);
    console.log('✅ Tabla factura_items creada\n');

    // =====================================================
    // TABLA: historial_precios_articulos
    // =====================================================
    console.log('📋 Creando tabla historial_precios_articulos...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS historial_precios_articulos (
        id SERIAL PRIMARY KEY,
        articulo_id INTEGER REFERENCES articulos_proveedor(id),
        proveedor_id INTEGER REFERENCES proveedores(id),
        precio_anterior DECIMAL(10,2),
        precio_nuevo DECIMAL(10,2) NOT NULL,
        variacion_porcentaje DECIMAL(5,2),
        factura_id INTEGER REFERENCES facturas_compra(id),
        fecha_cambio DATE NOT NULL,
        observacion TEXT,
        created_by INTEGER REFERENCES usuarios(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_historial_precios_articulo 
      ON historial_precios_articulos(articulo_id, fecha_cambio);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_historial_precios_proveedor 
      ON historial_precios_articulos(proveedor_id, fecha_cambio);
    `);
    console.log('✅ Tabla historial_precios_articulos creada\n');

    // =====================================================
    // TABLA: movimientos_stock
    // =====================================================
    console.log('📋 Creando tabla movimientos_stock...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS movimientos_stock (
        id SERIAL PRIMARY KEY,
        articulo_id INTEGER REFERENCES articulos_proveedor(id),
        proveedor_id INTEGER REFERENCES proveedores(id),
        tipo_movimiento VARCHAR(20) NOT NULL,
        cantidad DECIMAL(10,2) NOT NULL,
        stock_anterior DECIMAL(10,2),
        stock_nuevo DECIMAL(10,2),
        factura_id INTEGER REFERENCES facturas_compra(id),
        observacion TEXT,
        created_by INTEGER REFERENCES usuarios(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_movimientos_stock_articulo 
      ON movimientos_stock(articulo_id, created_at);
    `);
    console.log('✅ Tabla movimientos_stock creada\n');

    // =====================================================
    // MODIFICACIONES A TABLA PROVEEDORES
    // =====================================================
    console.log('📋 Modificando tabla proveedores...');
    await client.query(`
      ALTER TABLE proveedores
      ADD COLUMN IF NOT EXISTS dias_credito INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS forma_pago_habitual VARCHAR(50),
      ADD COLUMN IF NOT EXISTS ultima_compra DATE,
      ADD COLUMN IF NOT EXISTS total_compras DECIMAL(10,2) DEFAULT 0;
    `);
    console.log('✅ Tabla proveedores modificada\n');

    console.log('✅ ¡TODAS LAS TABLAS CREADAS EXITOSAMENTE!');
    console.log('\n📊 Resumen de tablas creadas:');
    console.log('  • articulos_proveedor');
    console.log('  • stock_articulos');
    console.log('  • facturas_compra');
    console.log('  • factura_items');
    console.log('  • historial_precios_articulos');
    console.log('  • movimientos_stock');
    console.log('  • proveedores (modificada)');

  } catch (err) {
    console.error('❌ Error creando tablas:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  crearTablasCompras()
    .then(() => {
      console.log('\n✅ Script completado');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ Error:', err);
      process.exit(1);
    });
}

module.exports = crearTablasCompras;

const pool = require('../db');

async function crearTablas() {
  console.log('🚀 CREANDO TABLAS DEL SISTEMA DE FACTURAS...\n');
  
  try {
    // 1. CREAR TABLA PRINCIPAL DE FACTURAS DE COMPRA
    console.log('1. Creando tabla facturas_compra...');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS facturas_compra (
          id SERIAL PRIMARY KEY,
          proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
          fecha_emision DATE NOT NULL,
          fecha_recepcion DATE,
          tipo_factura VARCHAR(1) NOT NULL CHECK (tipo_factura IN ('A', 'B', 'C', 'X')),
          punto_venta VARCHAR(4),
          numero_factura VARCHAR(20) NOT NULL,
          numero_comprobante VARCHAR(50),
          subtotal NUMERIC(15,2) DEFAULT 0,
          iva NUMERIC(15,2) DEFAULT 0,
          percepciones NUMERIC(15,2) DEFAULT 0,
          retenciones NUMERIC(15,2) DEFAULT 0,
          total NUMERIC(15,2) NOT NULL,
          neto_pagado NUMERIC(15,2) DEFAULT 0,
          condicion_pago VARCHAR(20) DEFAULT 'CONTADO',
          observaciones TEXT,
          estado VARCHAR(20) DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'PAGADA', 'ANULADA')),
          created_by INTEGER REFERENCES usuarios(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(proveedor_id, tipo_factura, punto_venta, numero_factura)
        )
      `);
      console.log('   ✅ Tabla facturas_compra creada');
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 2. CREAR TABLA DE ITEMS DE FACTURA (CORREGIDA)
    console.log('\n2. Corrigiendo tabla factura_items...');
    try {
      // Primero verificar si la tabla existe y tiene estructura incorrecta
      const existeTabla = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'factura_items'
        ) as existe
      `);
      
      if (existeTabla.rows[0].existe) {
        // Verificar si tiene columnas incorrectas
        const columnas = await pool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'factura_items'
        `);
        
        const columnasExistentes = columnas.rows.map(r => r.column_name);
        
        // Si tiene venta_item_id o ficha_id, es la tabla incorrecta
        if (columnasExistentes.includes('venta_item_id') || columnasExistentes.includes('ficha_id')) {
          console.log('   ⚠️  Tabla tiene estructura incorrecta, creando nueva...');
          
          // Crear tabla temporal
          await pool.query(`
            CREATE TABLE IF NOT EXISTS factura_items_nueva (
              id SERIAL PRIMARY KEY,
              factura_id INTEGER NOT NULL REFERENCES facturas_compra(id) ON DELETE CASCADE,
              materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
              descripcion TEXT,
              cantidad NUMERIC(10,3) NOT NULL,
              precio_unitario NUMERIC(15,2) NOT NULL,
              iva_porcentaje NUMERIC(5,2) DEFAULT 21.00,
              subtotal NUMERIC(15,2) NOT NULL,
              iva NUMERIC(15,2) NOT NULL,
              total NUMERIC(15,2) NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `);
          
          console.log('   ✅ Tabla factura_items_nueva creada');
        } else {
          console.log('   ✅ Tabla factura_items ya tiene estructura correcta');
        }
      } else {
        // Crear tabla nueva
        await pool.query(`
          CREATE TABLE factura_items (
            id SERIAL PRIMARY KEY,
            factura_id INTEGER NOT NULL REFERENCES facturas_compra(id) ON DELETE CASCADE,
            materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
            descripcion TEXT,
            cantidad NUMERIC(10,3) NOT NULL,
            precio_unitario NUMERIC(15,2) NOT NULL,
            iva_porcentaje NUMERIC(5,2) DEFAULT 21.00,
            subtotal NUMERIC(15,2) NOT NULL,
            iva NUMERIC(15,2) NOT NULL,
            total NUMERIC(15,2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('   ✅ Tabla factura_items creada');
      }
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 3. CREAR TABLA DE HISTORIAL DE PRECIOS
    console.log('\n3. Creando tabla historial_precios_materias...');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS historial_precios_materias (
          id SERIAL PRIMARY KEY,
          materia_prima_id INTEGER NOT NULL REFERENCES materias_primas(id),
          proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
          precio_anterior NUMERIC(15,2),
          precio_nuevo NUMERIC(15,2) NOT NULL,
          variacion_porcentaje NUMERIC(5,2),
          factura_id INTEGER REFERENCES facturas_compra(id),
          fecha_cambio DATE NOT NULL,
          created_by INTEGER REFERENCES usuarios(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ Tabla historial_precios_materias creada');
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 4. AGREGAR COLUMNAS A PAGOS_PROVEEDORES
    console.log('\n4. Agregando columnas a pagos_proveedores...');
    const columnasAgregar = [
      { nombre: 'factura_id', tipo: 'INTEGER REFERENCES facturas_compra(id)' },
      { nombre: 'referencia', tipo: 'VARCHAR(100)' },
      { nombre: 'forma_pago', tipo: 'VARCHAR(50)' },
      { nombre: 'estado', tipo: 'VARCHAR(20) DEFAULT \'CONFIRMADO\'' },
      { nombre: 'created_by', tipo: 'INTEGER REFERENCES usuarios(id)' },
      { nombre: 'created_at', tipo: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
      { nombre: 'updated_at', tipo: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
    ];
    
    for (const columna of columnasAgregar) {
      try {
        await pool.query(`
          ALTER TABLE pagos_proveedores 
          ADD COLUMN IF NOT EXISTS ${columna.nombre} ${columna.tipo}
        `);
        console.log(`   ✅ Columna ${columna.nombre} agregada`);
      } catch (err) {
        console.log(`   ⚠️  ${columna.nombre}: ${err.message}`);
      }
    }
    
    // 5. CREAR ÍNDICES
    console.log('\n5. Creando índices...');
    const indices = [
      { nombre: 'idx_facturas_compra_proveedor', tabla: 'facturas_compra', columna: 'proveedor_id' },
      { nombre: 'idx_facturas_compra_estado', tabla: 'facturas_compra', columna: 'estado' },
      { nombre: 'idx_facturas_compra_fecha', tabla: 'facturas_compra', columna: 'fecha_emision' },
      { nombre: 'idx_factura_items_factura', tabla: 'factura_items', columna: 'factura_id' },
      { nombre: 'idx_factura_items_materia', tabla: 'factura_items', columna: 'materia_prima_id' },
      { nombre: 'idx_pagos_proveedores_factura', tabla: 'pagos_proveedores', columna: 'factura_id' },
      { nombre: 'idx_pagos_proveedores_proveedor', tabla: 'pagos_proveedores', columna: 'proveedor_id' }
    ];
    
    for (const indice of indices) {
      try {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS ${indice.nombre} 
          ON ${indice.tabla}(${indice.columna})
        `);
        console.log(`   ✅ Índice ${indice.nombre} creado`);
      } catch (err) {
        console.log(`   ⚠️  ${indice.nombre}: ${err.message}`);
      }
    }
    
    // 6. VERIFICAR TABLAS CREADAS
    console.log('\n🔍 VERIFICANDO TABLAS CREADAS:');
    const tablasVerificar = ['facturas_compra', 'factura_items', 'historial_precios_materias'];
    
    for (const tabla of tablasVerificar) {
      try {
        const result = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          ) as existe
        `, [tabla]);
        
        console.log(`   ${tabla}: ${result.rows[0].existe ? '✅ EXISTE' : '❌ NO EXISTE'}`);
        
        if (result.rows[0].existe) {
          const count = await pool.query(`SELECT COUNT(*) as total FROM ${tabla}`);
          console.log(`     Registros: ${count.rows[0].total}`);
        }
      } catch (err) {
        console.log(`   ${tabla}: ❌ ERROR: ${err.message}`);
      }
    }
    
    console.log('\n🎉 PROCESO COMPLETADO!');
    
  } catch (error) {
    console.error('❌ ERROR GENERAL:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar el script
crearTablas().catch(console.error);
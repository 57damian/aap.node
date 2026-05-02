const pool = require('../db');

async function corregirTablas() {
  console.log('🔧 CORRIGIENDO TABLAS DEL SISTEMA DE FACTURAS...\n');
  
  try {
    // 1. RENOMBRAR TABLA factura_items_nueva A factura_items
    console.log('1. Renombrando tabla factura_items_nueva...');
    try {
      // Verificar si existe factura_items_nueva
      const existeNueva = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'factura_items_nueva'
        ) as existe
      `);
      
      if (existeNueva.rows[0].existe) {
        // Eliminar la tabla vieja factura_items si existe
        await pool.query('DROP TABLE IF EXISTS factura_items CASCADE');
        
        // Renombrar factura_items_nueva a factura_items
        await pool.query('ALTER TABLE factura_items_nueva RENAME TO factura_items');
        console.log('   ✅ Tabla renombrada correctamente');
      } else {
        console.log('   ⚠️  Tabla factura_items_nueva no existe');
      }
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 2. VERIFICAR COLUMNAS DE factura_items
    console.log('\n2. Verificando columnas de factura_items...');
    try {
      const columnas = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'factura_items'
        ORDER BY ordinal_position
      `);
      
      console.log(`   Columnas (${columnas.rows.length}):`);
      columnas.rows.forEach(col => {
        console.log(`     - ${col.column_name} (${col.data_type})`);
      });
      
      // Verificar si falta materia_prima_id
      const columnasExistentes = columnas.rows.map(r => r.column_name);
      if (!columnasExistentes.includes('materia_prima_id')) {
        console.log('   ❌ Falta columna materia_prima_id');
        
        // Agregar columna si falta
        await pool.query(`
          ALTER TABLE factura_items 
          ADD COLUMN IF NOT EXISTS materia_prima_id INTEGER REFERENCES materias_primas(id)
        `);
        console.log('   ✅ Columna materia_prima_id agregada');
      }
      
      // Verificar si existe articulo_id (incorrecto)
      if (columnasExistentes.includes('articulo_id')) {
        console.log('   ⚠️  Columna articulo_id existe (incorrecta)');
        
        // Si hay datos, migrar de articulo_id a materia_prima_id
        const tieneDatos = await pool.query('SELECT COUNT(*) as total FROM factura_items');
        if (parseInt(tieneDatos.rows[0].total) > 0) {
          console.log('   ⚠️  La tabla tiene datos, no se puede eliminar articulo_id automáticamente');
        } else {
          // Si no hay datos, eliminar columna
          await pool.query('ALTER TABLE factura_items DROP COLUMN IF EXISTS articulo_id');
          console.log('   ✅ Columna articulo_id eliminada');
        }
      }
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 3. CREAR ÍNDICES FALTANTES
    console.log('\n3. Creando índices faltantes...');
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_factura_items_materia 
        ON factura_items(materia_prima_id)
      `);
      console.log('   ✅ Índice idx_factura_items_materia creado');
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 4. VERIFICAR TABLA stock_movimientos
    console.log('\n4. Verificando tabla stock_movimientos...');
    try {
      const columnasStock = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'stock_movimientos'
        ORDER BY ordinal_position
      `);
      
      console.log(`   Columnas (${columnasStock.rows.length}):`);
      columnasStock.rows.forEach(col => {
        console.log(`     - ${col.column_name} (${col.data_type})`);
      });
      
      // Verificar si falta articulo_id (incorrecto) o tiene materia_prima_id (correcto)
      const columnasStockExistentes = columnasStock.rows.map(r => r.column_name);
      
      if (columnasStockExistentes.includes('articulo_id') && !columnasStockExistentes.includes('materia_prima_id')) {
        console.log('   ⚠️  Tabla usa articulo_id en lugar de materia_prima_id');
        
        // Agregar columna materia_prima_id
        await pool.query(`
          ALTER TABLE stock_movimientos 
          ADD COLUMN IF NOT EXISTS materia_prima_id INTEGER REFERENCES materias_primas(id)
        `);
        console.log('   ✅ Columna materia_prima_id agregada');
        
        // Si hay datos, migrar
        const tieneDatos = await pool.query('SELECT COUNT(*) as total FROM stock_movimientos');
        if (parseInt(tieneDatos.rows[0].total) > 0) {
          console.log('   ⚠️  La tabla tiene datos, se necesita migración manual');
        }
      }
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 5. VERIFICAR TABLA historial_precios_materias
    console.log('\n5. Verificando tabla historial_precios_materias...');
    try {
      const existe = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'historial_precios_materias'
        ) as existe
      `);
      
      if (existe.rows[0].existe) {
        const columnas = await pool.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns 
          WHERE table_name = 'historial_precios_materias'
          ORDER BY ordinal_position
        `);
        
        console.log(`   Columnas (${columnas.rows.length}):`);
        columnas.rows.forEach(col => {
          console.log(`     - ${col.column_name} (${col.data_type})`);
        });
      } else {
        console.log('   ❌ Tabla historial_precios_materias no existe');
      }
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 6. VERIFICAR TABLA articulos_proveedor (INCORRECTA)
    console.log('\n6. Verificando tabla articulos_proveedor (incorrecta)...');
    try {
      const existe = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'articulos_proveedor'
        ) as existe
      `);
      
      if (existe.rows[0].existe) {
        console.log('   ⚠️  Tabla articulos_proveedor existe (debería usar materias_primas)');
        
        // Verificar si tiene datos
        const tieneDatos = await pool.query('SELECT COUNT(*) as total FROM articulos_proveedor');
        console.log(`     Registros: ${tieneDatos.rows[0].total}`);
        
        if (parseInt(tieneDatos.rows[0].total) === 0) {
          console.log('   ✅ Tabla vacía, se puede eliminar');
          await pool.query('DROP TABLE IF EXISTS articulos_proveedor CASCADE');
          console.log('   ✅ Tabla articulos_proveedor eliminada');
        } else {
          console.log('   ⚠️  Tabla tiene datos, no se puede eliminar automáticamente');
        }
      } else {
        console.log('   ✅ Tabla articulos_proveedor no existe (correcto)');
      }
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    // 7. VERIFICAR TABLA stock_articulos (INCORRECTA)
    console.log('\n7. Verificando tabla stock_articulos (incorrecta)...');
    try {
      const existe = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'stock_articulos'
        ) as existe
      `);
      
      if (existe.rows[0].existe) {
        console.log('   ⚠️  Tabla stock_articulos existe (debería usar materias_primas)');
        
        // Verificar si tiene datos
        const tieneDatos = await pool.query('SELECT COUNT(*) as total FROM stock_articulos');
        console.log(`     Registros: ${tieneDatos.rows[0].total}`);
        
        if (parseInt(tieneDatos.rows[0].total) === 0) {
          console.log('   ✅ Tabla vacía, se puede eliminar');
          await pool.query('DROP TABLE IF EXISTS stock_articulos CASCADE');
          console.log('   ✅ Tabla stock_articulos eliminada');
        } else {
          console.log('   ⚠️  Tabla tiene datos, no se puede eliminar automáticamente');
        }
      } else {
        console.log('   ✅ Tabla stock_articulos no existe (correcto)');
      }
    } catch (err) {
      console.log(`   ⚠️  ${err.message}`);
    }
    
    console.log('\n🎉 VERIFICACIÓN COMPLETADA!');
    
    // 8. RESUMEN DE ACCIONES NECESARIAS
    console.log('\n📋 RESUMEN DE ACCIONES NECESARIAS:');
    console.log('   1. Actualizar archivo backend/routes/facturas-compra.routes.js:');
    console.log('      - Cambiar articulos_proveedor → materias_primas');
    console.log('      - Cambiar stock_articulos → materias_primas');
    console.log('      - Cambiar movimientos_stock → stock_movimientos');
    console.log('      - Cambiar historial_precios_articulos → historial_precios_materias');
    console.log('      - Cambiar articulo_id → materia_prima_id');
    console.log('   2. Verificar si hay datos en articulos_proveedor y stock_articulos');
    console.log('   3. Si hay datos, migrar a materias_primas');
    
  } catch (error) {
    console.error('❌ ERROR GENERAL:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar el script
corregirTablas().catch(console.error);
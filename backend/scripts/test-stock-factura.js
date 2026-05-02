// Script de prueba para verificar el flujo de stock desde facturas
const pool = require('../db');

async function testStockFactura() {
  console.log('🧪 TEST DE SISTEMA DE STOCK DESDE FACTURAS');
  console.log('===========================================\n');

  try {
    // 1. Verificar conexión a la base de datos
    console.log('1. VERIFICANDO CONEXIÓN A LA BASE DE DATOS');
    console.log('===========================================\n');
    
    const testConnection = await pool.query('SELECT NOW() as hora_actual');
    console.log(`✅ Conectado a PostgreSQL - Hora actual: ${testConnection.rows[0].hora_actual}`);
    
    // 2. Verificar estructura de tablas
    console.log('\n2. VERIFICANDO ESTRUCTURA DE TABLAS');
    console.log('===================================\n');
    
    const tablas = ['materias_primas', 'facturas_compra', 'factura_items', 'stock_movimientos'];
    
    for (const tabla of tablas) {
      const existe = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `, [tabla]);
      
      if (existe.rows[0].exists) {
        console.log(`✅ Tabla "${tabla}" existe`);
      } else {
        console.log(`❌ Tabla "${tabla}" NO EXISTE`);
      }
    }
    
    // 3. Verificar datos de ejemplo
    console.log('\n3. VERIFICANDO DATOS DE EJEMPLO');
    console.log('================================\n');
    
    // Verificar materias primas
    const materias = await pool.query('SELECT id, codigo, nombre, stock_actual FROM materias_primas LIMIT 5');
    console.log(`📋 Materias primas (primeras 5):`);
    materias.rows.forEach(mp => {
      console.log(`   - ${mp.id}: ${mp.nombre} (${mp.codigo}) - Stock: ${mp.stock_actual}`);
    });
    
    if (materias.rows.length === 0) {
      console.log('⚠️  No hay materias primas en el sistema');
      console.log('   Creando una materia prima de prueba...');
      
      await pool.query(`
        INSERT INTO materias_primas (codigo, nombre, unidad_medida, precio_referencia, stock_actual)
        VALUES ('TEST001', 'Material de Prueba', 'UNI', 100.00, 0)
        RETURNING id
      `);
      
      console.log('✅ Materia prima de prueba creada');
    }
    
    // Verificar proveedores
    const proveedores = await pool.query('SELECT id, nombre FROM proveedores LIMIT 3');
    console.log(`\n📋 Proveedores (primeros 3):`);
    proveedores.rows.forEach(p => {
      console.log(`   - ${p.id}: ${p.nombre}`);
    });
    
    if (proveedores.rows.length === 0) {
      console.log('⚠️  No hay proveedores en el sistema');
      console.log('   Creando un proveedor de prueba...');
      
      await pool.query(`
        INSERT INTO proveedores (nombre, cuit, direccion, telefono, email)
        VALUES ('Proveedor de Prueba', '30-12345678-9', 'Calle Falsa 123', '123456789', 'test@proveedor.com')
        RETURNING id
      `);
      
      console.log('✅ Proveedor de prueba creado');
    }
    
    // 4. Crear una factura de prueba
    console.log('\n4. CREANDO FACTURA DE PRUEBA');
    console.log('============================\n');
    
    // Obtener IDs de prueba
    const materiaPrima = await pool.query('SELECT id FROM materias_primas LIMIT 1');
    const proveedor = await pool.query('SELECT id FROM proveedores LIMIT 1');
    
    if (materiaPrima.rows.length === 0 || proveedor.rows.length === 0) {
      console.log('❌ No hay datos suficientes para crear factura de prueba');
      return;
    }
    
    const materiaPrimaId = materiaPrima.rows[0].id;
    const proveedorId = proveedor.rows[0].id;
    
    console.log(`📝 Datos de prueba:`);
    console.log(`   - Materia prima ID: ${materiaPrimaId}`);
    console.log(`   - Proveedor ID: ${proveedorId}`);
    
    // Verificar stock actual antes de la factura
    const stockAntes = await pool.query('SELECT stock_actual FROM materias_primas WHERE id = $1', [materiaPrimaId]);
    console.log(`   - Stock actual antes: ${stockAntes.rows[0].stock_actual}`);
    
    // Crear factura de prueba usando la misma lógica que el backend
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      console.log('\n📋 Simulando creación de factura...');
      
      // Insertar cabecera de factura - usar usuario existente (admin con id=5)
      const facturaResult = await client.query(`
        INSERT INTO facturas_compra (
          proveedor_id, fecha_emision, tipo_factura, 
          punto_venta, numero_factura, subtotal, iva, total,
          condicion_pago, estado, created_by, created_at, updated_at
        ) VALUES ($1, CURRENT_DATE, 'A', '0001', '00000001', 1210, 210, 1210, 'CONTADO', 'PENDIENTE', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id, numero_factura
      `, [proveedorId]);
      
      const factura = facturaResult.rows[0];
      console.log(`✅ Factura creada: ${factura.id} - ${factura.numero_factura}`);
      
      // Insertar item de factura
      await client.query(`
        INSERT INTO factura_items (
          factura_id, materia_prima_id, nombre, cantidad, unidad_medida,
          precio_unitario, iva_porcentaje, subtotal, iva, total, created_at
        ) VALUES ($1, $2, 'Material de Prueba', 10, 'UNI', 100, 21, 1000, 210, 1210, CURRENT_TIMESTAMP)
      `, [factura.id, materiaPrimaId]);
      
      console.log(`✅ Item de factura creado: 10 unidades`);
      
      // ACTUALIZAR STOCK (esta es la parte crítica)
      console.log('\n🔧 EJECUTANDO ACTUALIZACIÓN DE STOCK...');
      
      // Verificar condición: materia_prima_id && (estado === 'PENDIENTE' || estado === 'PAGADA')
      const estadoFactura = 'PENDIENTE';
      const tieneMateriaPrimaId = materiaPrimaId !== null && materiaPrimaId !== undefined;
      const estadoValido = estadoFactura === 'PENDIENTE' || estadoFactura === 'PAGADA';
      
      console.log(`   - Condición de stock:`);
      console.log(`     • materia_prima_id existe: ${tieneMateriaPrimaId} (${materiaPrimaId})`);
      console.log(`     • estado válido: ${estadoValido} (${estadoFactura})`);
      console.log(`     • Condición completa: ${tieneMateriaPrimaId && estadoValido}`);
      
      if (tieneMateriaPrimaId && estadoValido) {
        // Actualizar stock
        await client.query(`
          UPDATE materias_primas 
          SET stock_actual = stock_actual + $1, 
              fecha_ultima_compra = CURRENT_DATE,
              actualizado_en = CURRENT_TIMESTAMP
          WHERE id = $2
        `, [10, materiaPrimaId]);
        
        console.log(`✅ Stock actualizado: +10 unidades`);
        
        // Crear movimiento de stock
        await client.query(`
          INSERT INTO stock_movimientos (
            materia_prima_id, tipo_movimiento, cantidad, precio_unitario,
            factura_id, proveedor_id, observaciones, usuario_id, 
            created_at, fecha_movimiento, unidad
          ) VALUES ($1, 'ENTRADA', $2, $3, $4, $5, $6, 1, CURRENT_TIMESTAMP, CURRENT_DATE, 'UNI')
        `, [materiaPrimaId, 10, 100, factura.id, proveedorId, `Compra desde factura ${factura.numero_factura}`]);
        
        console.log(`✅ Movimiento de stock creado`);
      } else {
        console.log(`❌ NO se actualizó el stock porque:`);
        if (!tieneMateriaPrimaId) console.log(`   - materia_prima_id es null o undefined`);
        if (!estadoValido) console.log(`   - estado "${estadoFactura}" no es PENDIENTE o PAGADA`);
      }
      
      await client.query('COMMIT');
      console.log('\n✅ Transacción completada exitosamente');
      
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Error en transacción:', err.message);
      throw err;
    } finally {
      client.release();
    }
    
    // 5. Verificar resultados
    console.log('\n5. VERIFICANDO RESULTADOS');
    console.log('=========================\n');
    
    // Verificar stock después
    const stockDespues = await pool.query('SELECT stock_actual FROM materias_primas WHERE id = $1', [materiaPrimaId]);
    console.log(`📊 Stock después de la factura: ${stockDespues.rows[0].stock_actual}`);
    
    // Verificar movimiento de stock
    const movimientos = await pool.query(`
      SELECT id, tipo_movimiento, cantidad, factura_id 
      FROM stock_movimientos 
      WHERE materia_prima_id = $1 
      ORDER BY id DESC 
      LIMIT 1
    `, [materiaPrimaId]);
    
    if (movimientos.rows.length > 0) {
      console.log(`📊 Último movimiento de stock:`);
      console.log(`   - ID: ${movimientos.rows[0].id}`);
      console.log(`   - Tipo: ${movimientos.rows[0].tipo_movimiento}`);
      console.log(`   - Cantidad: ${movimientos.rows[0].cantidad}`);
      console.log(`   - Factura ID: ${movimientos.rows[0].factura_id}`);
    } else {
      console.log(`❌ No se encontraron movimientos de stock`);
    }
    
    // 6. Diagnóstico del problema
    console.log('\n6. DIAGNÓSTICO DEL PROBLEMA');
    console.log('============================\n');
    
    console.log('🔍 Posibles causas del problema:');
    console.log('   1. materia_prima_id es null en los items');
    console.log('   2. Estado de factura no es PENDIENTE o PAGADA');
    console.log('   3. Error en la transacción (rollback silencioso)');
    console.log('   4. El frontend no envía materia_prima_id');
    console.log('   5. El código de actualización de stock no se ejecuta');
    
    // Verificar items sin materia_prima_id
    const itemsSinMateria = await pool.query(`
      SELECT COUNT(*) as total 
      FROM factura_items 
      WHERE materia_prima_id IS NULL
    `);
    
    console.log(`\n📊 Items sin materia_prima_id: ${itemsSinMateria.rows[0].total}`);
    
    // Verificar facturas con estado incorrecto
    const facturasEstadoIncorrecto = await pool.query(`
      SELECT COUNT(*) as total 
      FROM facturas_compra 
      WHERE estado NOT IN ('PENDIENTE', 'PAGADA')
    `);
    
    console.log(`📊 Facturas con estado no válido para stock: ${facturasEstadoIncorrecto.rows[0].total}`);
    
    // 7. Recomendaciones
    console.log('\n7. RECOMENDACIONES');
    console.log('==================\n');
    
    console.log('✅ Para solucionar el problema:');
    console.log('   1. Verificar que el frontend envíe materia_prima_id en cada item');
    console.log('   2. Asegurar que el estado de la factura sea PENDIENTE o PAGADA');
    console.log('   3. Agregar logging en el backend para ver cada paso');
    console.log('   4. Verificar que no haya errores silenciosos en las transacciones');
    
    console.log('\n🧪 TEST COMPLETADO');
    console.log('==================');
    
  } catch (err) {
    console.error('❌ ERROR en el test:', err);
  } finally {
    process.exit(0);
  }
}

// Ejecutar test
testStockFactura();
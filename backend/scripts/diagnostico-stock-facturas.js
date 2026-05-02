// Script de diagnóstico para verificar por qué no se suma el stock desde facturas
const pool = require('../db');

async function diagnosticoStockFacturas() {
  console.log('🔍 DIAGNÓSTICO SISTEMA STOCK DESDE FACTURAS');
  console.log('===========================================\n');

  try {
    console.log('1. VERIFICANDO ESTRUCTURA DE TABLAS');
    console.log('===================================\n');

    // Verificar estructura de tablas clave
    const tablas = [
      'materias_primas',
      'facturas_compra', 
      'factura_items',
      'stock_movimientos',
      'historial_precios_materias'
    ];

    for (const tabla of tablas) {
      try {
        // Verificar si la tabla existe
        const existe = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [tabla]);

        if (existe.rows[0].exists) {
          // Verificar columnas clave
          const columnas = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = $1
            ORDER BY ordinal_position
          `, [tabla]);

          console.log(`   ✅ ${tabla}: ${columnas.rows.length} columnas`);
          
          // Verificar columnas críticas
          const columnasCriticas = {
            'materias_primas': ['id', 'stock_actual', 'precio_referencia'],
            'facturas_compra': ['id', 'estado', 'proveedor_id'],
            'factura_items': ['id', 'factura_id', 'materia_prima_id', 'cantidad', 'precio_unitario'],
            'stock_movimientos': ['id', 'materia_prima_id', 'cantidad', 'tipo_movimiento', 'factura_id'],
            'historial_precios_materias': ['id', 'materia_prima_id', 'precio_nuevo', 'factura_id']
          };

          if (columnasCriticas[tabla]) {
            const columnasFaltantes = [];
            for (const columna of columnasCriticas[tabla]) {
              const existeColumna = columnas.rows.find(c => c.column_name === columna);
              if (!existeColumna) {
                columnasFaltantes.push(columna);
              }
            }
            
            if (columnasFaltantes.length > 0) {
              console.log(`      ⚠️  Columnas faltantes: ${columnasFaltantes.join(', ')}`);
            } else {
              console.log(`      ✅ Todas las columnas críticas presentes`);
            }
          }
        } else {
          console.log(`   ❌ ${tabla}: TABLA NO EXISTE`);
        }
      } catch (err) {
        console.log(`   ❌ ${tabla}: ERROR - ${err.message}`);
      }
    }

    console.log('\n2. VERIFICANDO DATOS DE EJEMPLO');
    console.log('================================\n');

    // Verificar datos de ejemplo en el sistema
    console.log('   a) Materias primas registradas:');
    const materias = await pool.query('SELECT id, codigo, nombre, stock_actual, precio_referencia FROM materias_primas ORDER BY id');
    console.log(`      Total: ${materias.rows.length} materias`);
    materias.rows.forEach(mp => {
      console.log(`      - ${mp.id}: ${mp.nombre} (${mp.codigo}) - Stock: ${mp.stock_actual} - Precio: $${mp.precio_referencia || 'N/A'}`);
    });

    console.log('\n   b) Facturas registradas:');
    const facturas = await pool.query(`
      SELECT fc.id, fc.numero_factura, fc.estado, fc.fecha_emision, 
             p.nombre as proveedor, COUNT(fi.id) as items_count
      FROM facturas_compra fc
      JOIN proveedores p ON fc.proveedor_id = p.id
      LEFT JOIN factura_items fi ON fc.id = fi.factura_id
      GROUP BY fc.id, fc.numero_factura, fc.estado, fc.fecha_emision, p.nombre
      ORDER BY fc.fecha_emision DESC
    `);
    console.log(`      Total: ${facturas.rows.length} facturas`);
    facturas.rows.forEach(fc => {
      console.log(`      - ${fc.id}: ${fc.numero_factura} (${fc.fecha_emision}) - ${fc.proveedor} - Estado: ${fc.estado} - Items: ${fc.items_count}`);
    });

    console.log('\n   c) Items de factura:');
    const itemsFactura = await pool.query(`
      SELECT fi.id, fi.factura_id, fi.materia_prima_id, fi.cantidad, fi.precio_unitario,
             mp.nombre as materia_nombre, fc.numero_factura, fc.estado as factura_estado
      FROM factura_items fi
      JOIN facturas_compra fc ON fi.factura_id = fc.id
      LEFT JOIN materias_primas mp ON fi.materia_prima_id = mp.id
      ORDER BY fi.factura_id, fi.id
    `);
    console.log(`      Total: ${itemsFactura.rows.length} items`);
    
    // Agrupar por factura
    const itemsPorFactura = {};
    itemsFactura.rows.forEach(item => {
      if (!itemsPorFactura[item.factura_id]) {
        itemsPorFactura[item.factura_id] = [];
      }
      itemsPorFactura[item.factura_id].push(item);
    });

    for (const [facturaId, items] of Object.entries(itemsPorFactura)) {
      console.log(`      Factura ${facturaId} (${items[0].numero_factura} - ${items[0].factura_estado}):`);
      items.forEach(item => {
        const tieneMateria = item.materia_prima_id ? '✅' : '❌';
        console.log(`        ${tieneMateria} Item ${item.id}: ${item.cantidad} x $${item.precio_unitario} - ${item.materia_nombre || 'Sin materia prima'}`);
      });
    }

    console.log('\n   d) Movimientos de stock:');
    const movimientos = await pool.query(`
      SELECT sm.id, sm.materia_prima_id, sm.tipo_movimiento, sm.cantidad, 
             sm.fecha_movimiento, sm.factura_id, mp.nombre as materia_nombre,
             fc.numero_factura
      FROM stock_movimientos sm
      LEFT JOIN materias_primas mp ON sm.materia_prima_id = mp.id
      LEFT JOIN facturas_compra fc ON sm.factura_id = fc.id
      ORDER BY sm.fecha_movimiento DESC, sm.id DESC
    `);
    console.log(`      Total: ${movimientos.rows.length} movimientos`);
    movimientos.rows.forEach(mov => {
      console.log(`      - ${mov.id}: ${mov.tipo_movimiento} - ${mov.cantidad} - ${mov.materia_nombre || 'N/A'} - Factura: ${mov.numero_factura || 'N/A'} (${mov.fecha_movimiento})`);
    });

    console.log('\n3. ANALIZANDO PROBLEMAS POTENCIALES');
    console.log('===================================\n');

    // Problema 1: Items sin materia_prima_id
    const itemsSinMateria = await pool.query(`
      SELECT COUNT(*) as total
      FROM factura_items
      WHERE materia_prima_id IS NULL
    `);
    console.log(`   a) Items sin materia_prima_id: ${itemsSinMateria.rows[0].total}`);
    if (itemsSinMateria.rows[0].total > 0) {
      console.log(`      ⚠️  Estos items NO actualizarán el stock`);
      
      const ejemplos = await pool.query(`
        SELECT fi.id, fi.factura_id, fi.cantidad, fi.nombre, fc.numero_factura
        FROM factura_items fi
        JOIN facturas_compra fc ON fi.factura_id = fc.id
        WHERE fi.materia_prima_id IS NULL
        LIMIT 5
      `);
      ejemplos.rows.forEach(ej => {
        console.log(`        - Item ${ej.id} (Factura ${ej.numero_factura}): ${ej.cantidad} x ${ej.nombre || 'Sin nombre'}`);
      });
    }

    // Problema 2: Facturas con estado incorrecto
    const facturasEstadoNoValido = await pool.query(`
      SELECT fc.id, fc.numero_factura, fc.estado, COUNT(fi.id) as items_count
      FROM facturas_compra fc
      JOIN factura_items fi ON fc.id = fi.factura_id
      WHERE fc.estado NOT IN ('PENDIENTE', 'PAGADA')
      AND fi.materia_prima_id IS NOT NULL
      GROUP BY fc.id, fc.numero_factura, fc.estado
    `);
    console.log(`\n   b) Facturas con estado no válido para stock: ${facturasEstadoNoValido.rows.length}`);
    if (facturasEstadoNoValido.rows.length > 0) {
      console.log(`      ⚠️  Estas facturas NO actualizarán el stock automáticamente`);
      facturasEstadoNoValido.rows.forEach(fc => {
        console.log(`        - ${fc.numero_factura}: Estado "${fc.estado}" - ${fc.items_count} items`);
      });
    }

    // Problema 3: Inconsistencia entre stock y movimientos
    console.log('\n   c) Verificando consistencia stock vs movimientos:');
    
    const inconsistencias = await pool.query(`
      SELECT 
        mp.id,
        mp.codigo,
        mp.nombre,
        mp.stock_actual as stock_actual_materia,
        COALESCE(SUM(
          CASE 
            WHEN sm.tipo_movimiento = 'ENTRADA' THEN sm.cantidad
            WHEN sm.tipo_movimiento = 'SALIDA' THEN -sm.cantidad
            ELSE 0
          END
        ), 0) as stock_calculado_movimientos
      FROM materias_primas mp
      LEFT JOIN stock_movimientos sm ON mp.id = sm.materia_prima_id
      GROUP BY mp.id, mp.codigo, mp.nombre, mp.stock_actual
      HAVING ABS(mp.stock_actual - COALESCE(SUM(
        CASE 
          WHEN sm.tipo_movimiento = 'ENTRADA' THEN sm.cantidad
          WHEN sm.tipo_movimiento = 'SALIDA' THEN -sm.cantidad
          ELSE 0
        END
      ), 0)) > 0.01
    `);

    console.log(`      Inconsistencias encontradas: ${inconsistencias.rows.length}`);
    inconsistencias.rows.forEach(inc => {
      console.log(`        - ${inc.nombre} (${inc.codigo}):`);
      console.log(`          Stock en materia: ${inc.stock_actual_materia}`);
      console.log(`          Stock calculado: ${inc.stock_calculado_movimientos}`);
      console.log(`          Diferencia: ${inc.stock_actual_materia - inc.stock_calculado_movimientos}`);
    });

    console.log('\n4. RECOMENDACIONES');
    console.log('=================\n');

    const recomendaciones = [];

    if (itemsSinMateria.rows[0].total > 0) {
      recomendaciones.push('🔴 CORREGIR: Items sin materia_prima_id no actualizan stock');
      recomendaciones.push('   Solución: Asegurar que todos los items tengan materia_prima_id o crear materias automáticamente');
    }

    if (facturasEstadoNoValido.rows.length > 0) {
      recomendaciones.push('🔴 CORREGIR: Facturas con estado no válido (debe ser PENDIENTE o PAGADA)');
      recomendaciones.push('   Solución: Cambiar estado de facturas o modificar lógica para aceptar otros estados');
    }

    if (inconsistencias.rows.length > 0) {
      recomendaciones.push('🔴 CORREGIR: Inconsistencias entre stock y movimientos');
      recomendaciones.push('   Solución: Ejecutar script de reconciliación de stock');
    }

    if (recomendaciones.length === 0) {
      console.log('   ✅ No se encontraron problemas críticos');
      console.log('   ℹ️  El problema podría estar en:');
      console.log('      - Errores en la ejecución del código (revisar logs del backend)');
      console.log('      - Transacciones que fallan silenciosamente');
      console.log('      - Frontend no enviando datos correctamente');
    } else {
      recomendaciones.forEach(rec => console.log(`   ${rec}`));
    }

    console.log('\n5. PRUEBA DE CONCEPTO');
    console.log('====================\n');

    console.log('   Para probar el sistema:');
    console.log('   1. Crear una nueva factura con estado "PENDIENTE"');
    console.log('   2. Agregar items vinculados a materias primas existentes');
    console.log('   3. Verificar en consola del backend los mensajes:');
    console.log('      - "✅ Precio actualizado para materia prima..."');
    console.log('      - Movimientos de stock creados');
    console.log('   4. Revisar stock actualizado en tabla materias_primas');

    console.log('\n6. PASOS PARA SOLUCIÓN');
    console.log('======================\n');

    console.log('   1. Revisar logs del backend al crear factura');
    console.log('   2. Verificar que el frontend envíe materia_prima_id');
    console.log('   3. Asegurar estado de factura sea PENDIENTE o PAGADA');
    console.log('   4. Agregar más logging en el código para depuración');
    console.log('   5. Crear script de reconciliación si hay inconsistencias');

    console.log('\n🔍 DIAGNÓSTICO COMPLETADO');
    console.log('==========================');

  } catch (err) {
    console.error('❌ ERROR en diagnóstico:', err);
  } finally {
    process.exit(0);
  }
}

// Ejecutar diagnóstico
diagnosticoStockFacturas();
// Script para actualizar precios de materias primas desde facturas
const pool = require('../db');

async function actualizarPreciosDesdeFacturas() {
  console.log('🔄 ACTUALIZANDO PRECIOS DESDE FACTURAS');
  console.log('======================================\n');

  try {
    // 1. Identificar materias primas sin precio o con precio 0
    console.log('1. Identificando materias primas sin precio...');
    
    const materiasSinPrecio = await pool.query(`
      SELECT 
        mp.id,
        mp.codigo,
        mp.nombre,
        mp.precio_referencia,
        mp.fecha_ultima_compra
      FROM materias_primas mp
      WHERE mp.precio_referencia IS NULL OR mp.precio_referencia = 0
      ORDER BY mp.nombre
    `);
    
    console.log(`   Encontradas ${materiasSinPrecio.rows.length} materias primas sin precio definido\n`);
    
    if (materiasSinPrecio.rows.length === 0) {
      console.log('✅ Todas las materias primas tienen precio definido');
      return;
    }
    
    // 2. Para cada materia prima, buscar el último precio en facturas
    let actualizadas = 0;
    let sinFacturas = 0;
    
    for (const materia of materiasSinPrecio.rows) {
      console.log(`   🔍 Buscando precio para: ${materia.nombre} (${materia.codigo || 'sin código'})`);
      
      // Buscar el último precio en facturas
      const ultimoPrecioResult = await pool.query(`
        SELECT 
          fi.precio_unitario,
          fc.fecha_emision,
          fc.numero_factura,
          p.nombre as proveedor_nombre
        FROM factura_items fi
        JOIN facturas_compra fc ON fi.factura_id = fc.id
        JOIN proveedores p ON fc.proveedor_id = p.id
        WHERE fi.materia_prima_id = $1
        ORDER BY fc.fecha_emision DESC, fi.created_at DESC
        LIMIT 1
      `, [materia.id]);
      
      if (ultimoPrecioResult.rows.length === 0) {
        console.log(`      ❌ No se encontraron facturas para esta materia prima`);
        sinFacturas++;
        continue;
      }
      
      const ultimoPrecio = ultimoPrecioResult.rows[0];
      const nuevoPrecio = ultimoPrecio.precio_unitario;
      
      console.log(`      ✅ Último precio encontrado: $${nuevoPrecio}`);
      console.log(`         Factura: ${ultimoPrecio.numero_factura} (${ultimoPrecio.fecha_emision})`);
      console.log(`         Proveedor: ${ultimoPrecio.proveedor_nombre}`);
      
      // 3. Actualizar el precio en la materia prima
      await pool.query(`
        UPDATE materias_primas 
        SET precio_referencia = $1,
            fecha_ultima_compra = $2,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [nuevoPrecio, ultimoPrecio.fecha_emision, materia.id]);
      
      console.log(`      ✅ Precio actualizado a $${nuevoPrecio}\n`);
      actualizadas++;
    }
    
    // 4. Verificar materias con múltiples precios en facturas
    console.log('\n2. Verificando materias con múltiples precios en facturas...');
    
    const materiasConMultiplesPrecios = await pool.query(`
      SELECT 
        mp.id,
        mp.codigo,
        mp.nombre,
        mp.precio_referencia as precio_actual,
        COUNT(DISTINCT fi.precio_unitario) as precios_diferentes,
        MIN(fi.precio_unitario) as precio_minimo,
        MAX(fi.precio_unitario) as precio_maximo,
        AVG(fi.precio_unitario) as precio_promedio
      FROM materias_primas mp
      JOIN factura_items fi ON mp.id = fi.materia_prima_id
      GROUP BY mp.id, mp.codigo, mp.nombre, mp.precio_referencia
      HAVING COUNT(DISTINCT fi.precio_unitario) > 1
      ORDER BY precios_diferentes DESC
    `);
    
    console.log(`   Encontradas ${materiasConMultiplesPrecios.rows.length} materias con múltiples precios\n`);
    
    for (const materia of materiasConMultiplesPrecios.rows) {
      console.log(`   📊 ${materia.nombre} (${materia.codigo || 'sin código'})`);
      console.log(`      Precio actual: $${materia.precio_actual || 'N/A'}`);
      console.log(`      Precios diferentes: ${materia.precios_diferentes}`);
      console.log(`      Rango: $${materia.precio_minimo} - $${materia.precio_maximo}`);
      console.log(`      Promedio: $${parseFloat(materia.precio_promedio).toFixed(2)}`);
      
      // Mostrar historial detallado
      const historialDetallado = await pool.query(`
        SELECT 
          fi.precio_unitario,
          fc.fecha_emision,
          fc.numero_factura,
          p.nombre as proveedor_nombre,
          fi.cantidad
        FROM factura_items fi
        JOIN facturas_compra fc ON fi.factura_id = fc.id
        JOIN proveedores p ON fc.proveedor_id = p.id
        WHERE fi.materia_prima_id = $1
        ORDER BY fc.fecha_emision DESC
      `, [materia.id]);
      
      console.log(`      Historial (${historialDetallado.rows.length} facturas):`);
      historialDetallado.rows.forEach((factura, i) => {
        console.log(`        ${i+1}. $${factura.precio_unitario} - ${factura.numero_factura} (${factura.fecha_emision}) - ${factura.proveedor_nombre}`);
      });
      console.log('');
    }
    
    // 5. Resumen final
    console.log('📊 RESUMEN FINAL');
    console.log('================');
    console.log(`✅ Materias primas actualizadas: ${actualizadas}`);
    console.log(`❌ Materias sin facturas encontradas: ${sinFacturas}`);
    console.log(`📈 Materias con múltiples precios: ${materiasConMultiplesPrecios.rows.length}`);
    
    if (actualizadas > 0) {
      console.log('\n🎉 ¡Precios actualizados exitosamente!');
      console.log('Los precios se han sincronizado con las últimas facturas de compra.');
    }
    
    // 6. Verificar estado final
    console.log('\n🔍 VERIFICACIÓN FINAL');
    
    const estadoFinal = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN precio_referencia IS NULL OR precio_referencia = 0 THEN 1 END) as sin_precio,
        COUNT(CASE WHEN precio_referencia > 0 THEN 1 END) as con_precio
      FROM materias_primas
    `);
    
    const stats = estadoFinal.rows[0];
    console.log(`   Total materias primas: ${stats.total}`);
    console.log(`   Con precio definido: ${stats.con_precio}`);
    console.log(`   Sin precio: ${stats.sin_precio}`);
    
    if (stats.sin_precio > 0) {
      console.log(`\n⚠️  Aún hay ${stats.sin_precio} materias primas sin precio.`);
      console.log('   Estas materias no tienen facturas registradas.');
      console.log('   Recomendación: Registrar una factura de compra o asignar precio manualmente.');
    } else {
      console.log('\n✅ ¡Todas las materias primas tienen precio definido!');
    }
    
  } catch (err) {
    console.error('❌ ERROR en la actualización:', err);
  } finally {
    process.exit(0);
  }
}

// Ejecutar actualización
actualizarPreciosDesdeFacturas();
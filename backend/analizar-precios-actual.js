const pool = require('./db');

async function analizarPreciosActual() {
    try {
        console.log('🔍 Analizando estado actual de precios en el sistema...\n');
        
        // 1. Verificar datos en historial_precios_materias
        console.log('📊 1. DATOS EN historial_precios_materias:');
        const historialResult = await pool.query(`
            SELECT 
                COUNT(*) as total_registros,
                COUNT(DISTINCT materia_prima_id) as materias_con_historial,
                MIN(fecha_cambio) as fecha_mas_antigua,
                MAX(fecha_cambio) as fecha_mas_reciente
            FROM historial_precios_materias
        `);
        
        const historial = historialResult.rows[0];
        console.log(`   Total registros: ${historial.total_registros}`);
        console.log(`   Materias con historial: ${historial.materias_con_historial}`);
        console.log(`   Fecha más antigua: ${historial.fecha_mas_antigua}`);
        console.log(`   Fecha más reciente: ${historial.fecha_mas_reciente}`);
        
        // 2. Verificar datos en precios_materia_prima
        console.log('\n📊 2. DATOS EN precios_materia_prima:');
        const preciosResult = await pool.query(`
            SELECT 
                COUNT(*) as total_registros,
                COUNT(DISTINCT materia_prima_id) as materias_con_precios,
                MIN(fecha_desde) as fecha_mas_antigua,
                MAX(fecha_desde) as fecha_mas_reciente
            FROM precios_materia_prima
        `);
        
        const precios = preciosResult.rows[0];
        console.log(`   Total registros: ${precios.total_registros}`);
        console.log(`   Materias con precios: ${precios.materias_con_precios}`);
        console.log(`   Fecha más antigua: ${precios.fecha_mas_antigua}`);
        console.log(`   Fecha más reciente: ${precios.fecha_mas_reciente}`);
        
        // 3. Verificar materias primas con precio_referencia
        console.log('\n📊 3. MATERIAS PRIMAS CON precio_referencia:');
        const materiasResult = await pool.query(`
            SELECT 
                COUNT(*) as total_materias,
                COUNT(CASE WHEN precio_referencia IS NOT NULL AND precio_referencia > 0 THEN 1 END) as con_precio_referencia,
                COUNT(CASE WHEN ultimo_precio IS NOT NULL AND ultimo_precio > 0 THEN 1 END) as con_ultimo_precio,
                AVG(precio_referencia) as promedio_precio_referencia,
                AVG(ultimo_precio) as promedio_ultimo_precio
            FROM materias_primas
            WHERE activo = true
        `);
        
        const materias = materiasResult.rows[0];
        console.log(`   Total materias activas: ${materias.total_materias}`);
        console.log(`   Con precio_referencia: ${materias.con_precio_referencia}`);
        console.log(`   Con ultimo_precio: ${materias.con_ultimo_precio}`);
        console.log(`   Promedio precio_referencia: $${parseFloat(materias.promedio_precio_referencia || 0).toFixed(2)}`);
        console.log(`   Promedio ultimo_precio: $${parseFloat(materias.promedio_ultimo_precio || 0).toFixed(2)}`);
        
        // 4. Verificar relación con facturas
        console.log('\n📊 4. RELACIÓN CON FACTURAS:');
        const facturasResult = await pool.query(`
            SELECT 
                COUNT(DISTINCT factura_id) as facturas_con_historial_precios
            FROM historial_precios_materias
            WHERE factura_id IS NOT NULL
        `);
        
        console.log(`   Facturas vinculadas a historial de precios: ${facturasResult.rows[0].facturas_con_historial_precios}`);
        
        // 5. Ejemplo de datos recientes
        console.log('\n📊 5. EJEMPLO DE DATOS RECIENTES (últimos 5 registros):');
        const ejemplosResult = await pool.query(`
            SELECT 
                hpm.materia_prima_id,
                mp.nombre as materia_nombre,
                hpm.precio_anterior,
                hpm.precio_nuevo,
                hpm.variacion_porcentaje,
                hpm.fecha_cambio,
                fc.numero_factura,
                p.nombre as proveedor_nombre
            FROM historial_precios_materias hpm
            LEFT JOIN materias_primas mp ON hpm.materia_prima_id = mp.id
            LEFT JOIN facturas_compra fc ON hpm.factura_id = fc.id
            LEFT JOIN proveedores p ON hpm.proveedor_id = p.id
            ORDER BY hpm.fecha_cambio DESC, hpm.created_at DESC
            LIMIT 5
        `);
        
        if (ejemplosResult.rows.length > 0) {
            ejemplosResult.rows.forEach((row, index) => {
                console.log(`   ${index + 1}. ${row.materia_nombre}`);
                console.log(`      Precio anterior: $${parseFloat(row.precio_anterior || 0).toFixed(2)}`);
                console.log(`      Precio nuevo: $${parseFloat(row.precio_nuevo || 0).toFixed(2)}`);
                console.log(`      Variación: ${parseFloat(row.variacion_porcentaje || 0).toFixed(2)}%`);
                console.log(`      Fecha: ${row.fecha_cambio}`);
                console.log(`      Factura: ${row.numero_factura || 'N/A'}`);
                console.log(`      Proveedor: ${row.proveedor_nombre || 'N/A'}`);
            });
        } else {
            console.log('   No hay registros recientes');
        }
        
        // 6. Verificar inconsistencias
        console.log('\n📊 6. INCONSISTENCIAS DETECTADAS:');
        
        // Materias con historial pero sin precio_referencia
        const inconsistenciasResult = await pool.query(`
            SELECT 
                COUNT(DISTINCT mp.id) as materias_con_historial_sin_precio
            FROM materias_primas mp
            INNER JOIN historial_precios_materias hpm ON mp.id = hpm.materia_prima_id
            WHERE (mp.precio_referencia IS NULL OR mp.precio_referencia = 0)
            AND mp.activo = true
        `);
        
        console.log(`   Materias con historial pero sin precio_referencia: ${inconsistenciasResult.rows[0].materias_con_historial_sin_precio}`);
        
        // Diferencia entre precio_referencia y último precio en historial
        const diferenciaResult = await pool.query(`
            SELECT 
                mp.id,
                mp.nombre,
                mp.precio_referencia,
                hpm.precio_nuevo as ultimo_precio_historial,
                ROUND(ABS(COALESCE(mp.precio_referencia, 0) - COALESCE(hpm.precio_nuevo, 0))::numeric, 2) as diferencia
            FROM materias_primas mp
            LEFT JOIN (
                SELECT DISTINCT ON (materia_prima_id) 
                    materia_prima_id, 
                    precio_nuevo
                FROM historial_precios_materias
                ORDER BY materia_prima_id, fecha_cambio DESC, created_at DESC
            ) hpm ON mp.id = hpm.materia_prima_id
            WHERE mp.activo = true
            AND mp.precio_referencia IS NOT NULL
            AND hpm.precio_nuevo IS NOT NULL
            AND ABS(COALESCE(mp.precio_referencia, 0) - COALESCE(hpm.precio_nuevo, 0)) > 0.01
            LIMIT 5
        `);
        
        if (diferenciaResult.rows.length > 0) {
            console.log(`   Materias con diferencia entre precio_referencia y último historial:`);
            diferenciaResult.rows.forEach(row => {
                console.log(`      ${row.nombre}: $${row.precio_referencia} vs $${row.ultimo_precio_historial} (diferencia: $${row.diferencia})`);
            });
        } else {
            console.log(`   No hay diferencias significativas entre precio_referencia y último historial`);
        }
        
        console.log('\n🎉 Análisis completado');
        
    } catch (err) {
        console.error('❌ Error en el análisis:', err);
    } finally {
        pool.end();
    }
}

analizarPreciosActual();
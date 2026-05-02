const fs = require('fs');
const path = require('path');
const pool = require('../db');

async function ejecutarScriptSQL() {
  console.log('🚀 EJECUTANDO SCRIPT PARA CREAR TABLAS DE FACTURAS...\n');
  
  try {
    // Leer el archivo SQL
    const sqlPath = path.join(__dirname, 'crear-tablas-facturas.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Separar las sentencias SQL (por punto y coma)
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    
    console.log(`📋 Encontradas ${statements.length} sentencias SQL\n`);
    
    let executedCount = 0;
    let errorCount = 0;
    
    // Ejecutar cada sentencia
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      
      // Saltar comentarios largos
      if (stmt.startsWith('--') || stmt.length < 10) {
        console.log(`   ⏭️  Saltando comentario/instrucción corta`);
        continue;
      }
      
      try {
        console.log(`   🔧 Ejecutando sentencia ${i + 1}/${statements.length}...`);
        
        // Para SELECT statements, mostrar resultados
        if (stmt.trim().toUpperCase().startsWith('SELECT')) {
          const result = await pool.query(stmt);
          if (result.rows && result.rows.length > 0) {
            console.log(`     ✅ Resultado: ${result.rows[0].mensaje || 'Completado'}`);
          }
        } else {
          // Para DDL/DML statements
          await pool.query(stmt);
          console.log(`     ✅ Completado`);
        }
        
        executedCount++;
        
      } catch (err) {
        errorCount++;
        console.log(`     ❌ Error en sentencia ${i + 1}: ${err.message}`);
        
        // Si es un error de "tabla ya existe", continuar
        if (err.message.includes('already exists') || err.message.includes('ya existe')) {
          console.log(`     ⚠️  Tabla ya existe, continuando...`);
        } else {
          console.log(`     📝 Sentencia problemática: ${stmt.substring(0, 100)}...`);
        }
      }
    }
    
    console.log('\n📊 RESUMEN DE EJECUCIÓN:');
    console.log(`   ✅ Sentencias ejecutadas exitosamente: ${executedCount}`);
    console.log(`   ❌ Sentencias con error: ${errorCount}`);
    console.log(`   📋 Total procesadas: ${executedCount + errorCount}`);
    
    // Verificar que las tablas se crearon correctamente
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
    
    // Verificar columnas agregadas a pagos_proveedores
    console.log('\n🔍 VERIFICANDO COLUMNAS EN PAGOS_PROVEEDORES:');
    const columnasEsperadas = ['factura_id', 'referencia', 'forma_pago', 'estado', 'created_by', 'created_at', 'updated_at'];
    
    try {
      const columnas = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'pagos_proveedores'
      `);
      
      const columnasExistentes = columnas.rows.map(r => r.column_name);
      
      columnasEsperadas.forEach(col => {
        const existe = columnasExistentes.includes(col);
        console.log(`   ${col}: ${existe ? '✅ EXISTE' : '❌ FALTANTE'}`);
      });
    } catch (err) {
      console.log(`   ❌ Error verificando columnas: ${err.message}`);
    }
    
    console.log('\n🎉 PROCESO COMPLETADO!');
    
  } catch (error) {
    console.error('❌ ERROR GENERAL:', error);
  } finally {
    await pool.end();
  }
}

// Ejecutar el script
ejecutarScriptSQL().catch(console.error);
const fs = require('fs');
const path = require('path');

// Analizar el código de compras.routes.js para verificar consistencia con el esquema
function validateComprasCode() {
  const filePath = path.join(__dirname, '../routes/compras.routes.js');
  const content = fs.readFileSync(filePath, 'utf8');
  
  console.log('🔍 Validando código de compras.routes.js contra esquema de BD...\n');
  
  // Verificar nombres de columnas usados en el código
  const columnMatches = content.match(/\b[a-z_]+\b/gi) || [];
  const importantColumns = [
    'materias_primas', 'compra_items', 'compras', 'stock_movimientos', 'precios_materia_prima',
    'actualizado_en', 'updated_at', 'created_at', 'creado_en',
    'fecha_compra', 'numero_comprobante', 'proveedor_id', 'materia_prima_id'
  ];
  
  console.log('📋 Columnas/Tablas referenciadas en el código:');
  importantColumns.forEach(col => {
    if (content.includes(col)) {
      console.log(`  ✅ ${col}`);
    } else {
      console.log(`  ❌ ${col} - NO ENCONTRADA`);
    }
  });
  
  // Verificar consultas SQL específicas
  console.log('\n🔍 Análisis de consultas SQL:');
  
  const sqlQueries = content.match(/```[\s\S]*?```/g) || [];
  sqlQueries.forEach((query, index) => {
    console.log(`\n  Query ${index + 1}:`);
    console.log(`  ${query.substring(0, 100)}...`);
  });
  
  // Buscar problemas conocidos
  console.log('\n⚠️ Posibles problemas detectados:');
  
  if (content.includes('updated_at') && content.includes('materias_primas')) {
    console.log('  - Posible inconsistencia: materias_primas usa "actualizado_en" pero el código usa "updated_at"');
  }
  
  if (content.includes('INSERT INTO compras') && content.includes('created_at')) {
    console.log('  - La tabla compras usa "created_at" pero debería ser consistente con el esquema');
  }
  
  console.log('\n✅ Validación completada');
}

validateComprasCode();

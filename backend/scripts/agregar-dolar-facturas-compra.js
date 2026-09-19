// agregar-dolar-facturas-compra.js
//
// Migración para "Cotización del dólar por factura de compra" (diseño
// acordado 12/09/2026, ver doc del proyecto):
//   - facturas_compra.dolar_historial_id: liga cada factura a la fila de
//     historial_dolar con la cotización usada. Nullable: las facturas viejas
//     quedan sin este dato, no se reconstruye retroactivamente.
//   - historial_precios_materias.precio_anterior_usd / precio_nuevo_usd:
//     mismos precios que ya se guardaban en pesos, convertidos a USD con el
//     dólar de la factura correspondiente. También nullable para filas viejas.
const pool = require('../db');

async function migrar() {
  try {
    console.log('Agregando dolar_historial_id a facturas_compra...');
    await pool.query(`
      ALTER TABLE facturas_compra
      ADD COLUMN IF NOT EXISTS dolar_historial_id INTEGER REFERENCES historial_dolar(id);
    `);
    console.log('✓ facturas_compra.dolar_historial_id agregado');

    console.log('Agregando precio_anterior_usd / precio_nuevo_usd a historial_precios_materias...');
    await pool.query(`
      ALTER TABLE historial_precios_materias
      ADD COLUMN IF NOT EXISTS precio_anterior_usd NUMERIC(15,2),
      ADD COLUMN IF NOT EXISTS precio_nuevo_usd NUMERIC(15,2);
    `);
    console.log('✓ historial_precios_materias.precio_anterior_usd / precio_nuevo_usd agregados');

    console.log('\n✅ Migración completada');
  } catch (error) {
    console.error('❌ Error en la migración:', error.message);
  } finally {
    await pool.end();
  }
}

migrar();

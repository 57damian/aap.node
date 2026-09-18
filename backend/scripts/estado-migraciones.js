// backend/scripts/estado-migraciones.js
//
// Chequea contra la base real si cada una de las 4 migraciones pendientes
// (backend/scripts/migracion-*.sql) ya fue aplicada. Solo lectura
// (information_schema y pg_indexes) — no modifica nada.
//
// Uso:
//   cd backend
//   node scripts/estado-migraciones.js
//
// Paso 1 del plan de rediseño (claude/estado-y-pasos-2026-09-15.md).

require('dotenv').config();
const pool = require('../db');

async function existeTabla(nombre) {
  const r = await pool.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     )`,
    [nombre]
  );
  return r.rows[0].exists;
}

async function existeColumna(tabla, columna) {
  const r = await pool.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     )`,
    [tabla, columna]
  );
  return r.rows[0].exists;
}

async function existeIndice(nombre) {
  const r = await pool.query(
    `SELECT EXISTS (
       SELECT FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = $1
     )`,
    [nombre]
  );
  return r.rows[0].exists;
}

(async () => {
  const resultados = [];

  // migracion-cobros.sql (13/09): renombra pago_items.cheque_estado -> estado.
  // Aplicada solo si la columna nueva existe Y la vieja ya no.
  {
    const tieneEstado = await existeColumna('pago_items', 'estado');
    const tieneChequeEstado = await existeColumna('pago_items', 'cheque_estado');
    const falta = [];
    if (!tieneEstado) falta.push('falta la columna pago_items.estado');
    if (tieneChequeEstado) falta.push('todavía existe pago_items.cheque_estado (debería haber sido reemplazada)');
    resultados.push({
      migracion: 'migracion-cobros.sql',
      aplicada: tieneEstado && !tieneChequeEstado,
      falta: falta.join('; ')
    });
  }

  // migracion-pagos-proveedores.sql (14/09): crea pago_proveedor_items
  // y agrega facturas_compra.fecha_vencimiento.
  {
    const tieneTabla = await existeTabla('pago_proveedor_items');
    const tieneColumna = await existeColumna('facturas_compra', 'fecha_vencimiento');
    const falta = [];
    if (!tieneTabla) falta.push('falta la tabla pago_proveedor_items');
    if (!tieneColumna) falta.push('falta la columna facturas_compra.fecha_vencimiento');
    resultados.push({
      migracion: 'migracion-pagos-proveedores.sql',
      aplicada: tieneTabla && tieneColumna,
      falta: falta.join('; ')
    });
  }

  // migracion-ordenes-compra.sql (14/09): crea el índice único
  // uq_oci_orden_ficha (evita el ON CONFLICT sin índice del hallazgo C4).
  {
    const tieneIndice = await existeIndice('uq_oci_orden_ficha');
    resultados.push({
      migracion: 'migracion-ordenes-compra.sql',
      aplicada: tieneIndice,
      falta: tieneIndice ? '' : 'falta el índice uq_oci_orden_ficha'
    });
  }

  // migracion-facturacion-ventas.sql (14/09): crea factura_venta_items
  // y nota_credito_items.
  {
    const tieneFacturaVentaItems = await existeTabla('factura_venta_items');
    const tieneNotaCreditoItems = await existeTabla('nota_credito_items');
    const falta = [];
    if (!tieneFacturaVentaItems) falta.push('falta la tabla factura_venta_items');
    if (!tieneNotaCreditoItems) falta.push('falta la tabla nota_credito_items');
    resultados.push({
      migracion: 'migracion-facturacion-ventas.sql',
      aplicada: tieneFacturaVentaItems && tieneNotaCreditoItems,
      falta: falta.join('; ')
    });
  }

  // ---------------- imprimir tabla ----------------
  const colMigracion = Math.max('MIGRACIÓN'.length, ...resultados.map(r => r.migracion.length));
  const colAplicada = 'APLICADA'.length;

  const fila = (a, b, c) => `${a.padEnd(colMigracion)} | ${b.padEnd(colAplicada)} | ${c}`;

  console.log(fila('MIGRACIÓN', 'APLICADA', 'QUÉ FALTA'));
  console.log('-'.repeat(colMigracion + colAplicada + 45));
  resultados.forEach(r => {
    console.log(fila(r.migracion, r.aplicada ? 'sí' : 'no', r.falta || '—'));
  });

  const pendientes = resultados.filter(r => !r.aplicada);
  console.log('');
  if (pendientes.length === 0) {
    console.log('Las 4 migraciones están aplicadas. Se puede seguir con el Paso 2.');
  } else {
    console.log(
      `Faltan ${pendientes.length} de 4: ${pendientes.map(r => r.migracion).join(', ')}.\n` +
      'Correrlas (con el backup ya hecho) antes de seguir al Paso 2.'
    );
  }

  await pool.end();
})().catch(e => {
  console.error('Error al chequear el estado de las migraciones:', e.message);
  process.exit(1);
});

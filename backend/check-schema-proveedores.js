// Diagnóstico de esquema real para la auditoría del módulo Proveedores (13/09/2026)
// Solo lectura (information_schema) — no modifica nada.
// Uso: node backend/check-schema-proveedores.js

const pool = require('./db');

async function existeTabla(nombre) {
  const r = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [nombre]
  );
  return r.rows[0].exists;
}

async function columnasDe(nombre) {
  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = $1 ORDER BY ordinal_position`,
    [nombre]
  );
  return r.rows;
}

async function existeColumna(tabla, columna) {
  const r = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = $1 AND column_name = $2)`,
    [tabla, columna]
  );
  return r.rows[0].exists;
}

async function fkDe(tabla, columna) {
  // A qué tabla/columna apunta una FK de `tabla.columna`, si existe
  const r = await pool.query(
    `SELECT
       ccu.table_name AS tabla_referenciada,
       ccu.column_name AS columna_referenciada
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_name = $1
       AND kcu.column_name = $2`,
    [tabla, columna]
  );
  return r.rows;
}

async function main() {
  try {
    console.log('=== 1) Tablas que el código activo usa y que podrían no existir ===');
    for (const t of ['entidades', 'pagos_proveedores_items', 'ordenes_pago_proveedores', 'pago_items', 'pagos_proveedores', 'facturas_compra']) {
      console.log(`  ${t}: ${(await existeTabla(t)) ? 'existe' : 'NO EXISTE'}`);
    }

    console.log('\n=== 2) Columnas de facturas_compra (buscamos saldo_pendiente, fecha_vencimiento, compra_id, neto_pagado) ===');
    console.log((await columnasDe('facturas_compra')).map(c => `${c.column_name} (${c.data_type})`).join('\n'));

    console.log('\n=== 3) Columnas de pagos_proveedores (buscamos estado, forma_pago/metodo, factura_id) ===');
    console.log((await columnasDe('pagos_proveedores')).map(c => `${c.column_name} (${c.data_type})`).join('\n'));

    if (await existeTabla('pagos_proveedores_items')) {
      console.log('\n=== 4) Columnas de pagos_proveedores_items ===');
      console.log((await columnasDe('pagos_proveedores_items')).map(c => `${c.column_name} (${c.data_type})`).join('\n'));
    }

    if (await existeTabla('pago_items')) {
      console.log('\n=== 5) pago_items.pago_id → ¿a qué tabla apunta? ===');
      console.log(JSON.stringify(await fkDe('pago_items', 'pago_id'), null, 2));
    }

    console.log('\n=== 6) Columnas _usd en historial_precios_materias ===');
    console.log(`  precio_anterior_usd: ${(await existeColumna('historial_precios_materias', 'precio_anterior_usd')) ? 'existe' : 'NO EXISTE'}`);
    console.log(`  precio_nuevo_usd: ${(await existeColumna('historial_precios_materias', 'precio_nuevo_usd')) ? 'existe' : 'NO EXISTE'}`);

    console.log('\n=== 7) Valores reales de pagos_proveedores.estado hoy (para ver el desfasaje CONFIRMADO vs pendiente/aplicado) ===');
    const estados = await pool.query(`SELECT estado, COUNT(*) FROM pagos_proveedores GROUP BY estado`);
    console.log(estados.rows);

    console.log('\n=== 8) ¿La FK de facturas_compra.proveedor_id impediría borrar un proveedor con facturas? ===');
    console.log(JSON.stringify(await fkDe('facturas_compra', 'proveedor_id'), null, 2));

    console.log('\n=== 9) Filas en tablas legacy que ya sabemos casi vacías (compras, compra_items, productos_stock, precios_materia_prima) ===');
    for (const t of ['compras', 'compra_items', 'productos_stock', 'precios_materia_prima']) {
      if (await existeTabla(t)) {
        const r = await pool.query(`SELECT COUNT(*) FROM ${t}`);
        console.log(`  ${t}: ${r.rows[0].count} filas`);
      } else {
        console.log(`  ${t}: NO EXISTE`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    pool.end();
  }
}

main();

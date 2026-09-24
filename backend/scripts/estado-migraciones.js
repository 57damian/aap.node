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

  // migracion-factura-multi-remito.sql (19/09): facturas.orden_compra_id,
  // facturas.tipo_cambio y factura_venta_items.precio_unitario_usd.
  {
    const columnas = [
      ['facturas', 'orden_compra_id'],
      ['facturas', 'tipo_cambio'],
      ['factura_venta_items', 'precio_unitario_usd']
    ];
    const falta = [];
    for (const [tabla, columna] of columnas) {
      if (!(await existeColumna(tabla, columna))) falta.push(`falta la columna ${tabla}.${columna}`);
    }
    resultados.push({
      migracion: 'migracion-factura-multi-remito.sql',
      aplicada: falta.length === 0,
      falta: falta.join('; ')
    });
  }

  // migracion-fix-retenciones.sql (19/09): elimina el CHECK viejo
  // pago_items_tipo_check, que no admitía RETENCION.
  {
    const r = await pool.query(
      `SELECT EXISTS (
         SELECT FROM pg_constraint
         WHERE conrelid = 'pago_items'::regclass AND conname = 'pago_items_tipo_check'
       )`
    );
    const sigueViejo = r.rows[0].exists;
    resultados.push({
      migracion: 'migracion-fix-retenciones.sql',
      aplicada: !sigueViejo,
      falta: sigueViejo ? 'todavía existe el CHECK pago_items_tipo_check (bloquea las retenciones)' : ''
    });
  }

  // migracion-anulacion-facturas.sql (21/09): tabla auditoria_anulaciones,
  // columnas de anulación en facturas e índice único parcial del número.
  {
    const falta = [];
    if (!(await existeTabla('auditoria_anulaciones'))) falta.push('falta la tabla auditoria_anulaciones');
    if (!(await existeColumna('facturas', 'anulada_en'))) falta.push('falta la columna facturas.anulada_en');
    if (!(await existeIndice('uq_facturas_numero_vigente'))) falta.push('falta el índice uq_facturas_numero_vigente');
    if (await existeIndice('unique_numero_factura')) falta.push('todavía existe el UNIQUE viejo unique_numero_factura');
    resultados.push({
      migracion: 'migracion-anulacion-facturas.sql',
      aplicada: falta.length === 0,
      falta: falta.join('; ')
    });
  }

  // migracion-anulacion-remitos-oc.sql (21/09): columnas de anulación en
  // ventas (remitos) y ordenes_compra.
  {
    const columnas = [['ventas', 'anulada_en'], ['ordenes_compra', 'anulada_en']];
    const falta = [];
    for (const [tabla, columna] of columnas) {
      if (!(await existeColumna(tabla, columna))) falta.push(`falta la columna ${tabla}.${columna}`);
    }
    resultados.push({
      migracion: 'migracion-anulacion-remitos-oc.sql',
      aplicada: falta.length === 0,
      falta: falta.join('; ')
    });
  }

  // migracion-ficha-devanados.sql (21/09): espiras del primario/secundario
  // como texto ("422 + 422") y tabla ficha_devanados_extra.
  {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ficha_transformador'
         AND column_name = 'espiras_secundario'`
    );
    const falta = [];
    if (!r.rows.length || r.rows[0].data_type !== 'character varying') {
      falta.push('ficha_transformador.espiras_secundario todavía no es texto');
    }
    if (!(await existeTabla('ficha_devanados_extra'))) falta.push('falta la tabla ficha_devanados_extra');
    resultados.push({
      migracion: 'migracion-ficha-devanados.sql',
      aplicada: falta.length === 0,
      falta: falta.join('; ')
    });
  }

  // migracion-pedidos-proveedor.sql (22/09): tablas pedidos_proveedor y
  // pedido_proveedor_items.
  {
    const falta = [];
    if (!(await existeTabla('pedidos_proveedor'))) falta.push('falta la tabla pedidos_proveedor');
    if (!(await existeTabla('pedido_proveedor_items'))) falta.push('falta la tabla pedido_proveedor_items');
    resultados.push({
      migracion: 'migracion-pedidos-proveedor.sql',
      aplicada: falta.length === 0,
      falta: falta.join('; ')
    });
  }

  // migracion-ficha-pesos-gramos.sql (22/09): ensancha peso_primario_kg /
  // peso_secundario_kg / peso_laminacion_kg (y ficha_devanados_extra.peso_kg
  // si existe) a numeric(9,2) para que entren valores en gramos.
  {
    const r = await pool.query(
      `SELECT numeric_scale FROM information_schema.columns
       WHERE table_name = 'ficha_transformador' AND column_name = 'peso_primario_kg'`
    );
    const falta = [];
    if (!r.rows.length || Number(r.rows[0].numeric_scale) !== 2) {
      falta.push('ficha_transformador.peso_primario_kg todavía no es numeric(9,2)');
    }
    if (await existeTabla('ficha_devanados_extra')) {
      const r2 = await pool.query(
        `SELECT numeric_scale FROM information_schema.columns
         WHERE table_name = 'ficha_devanados_extra' AND column_name = 'peso_kg'`
      );
      if (!r2.rows.length || Number(r2.rows[0].numeric_scale) !== 2) {
        falta.push('ficha_devanados_extra.peso_kg todavía no es numeric(9,2)');
      }
    }
    resultados.push({
      migracion: 'migracion-ficha-pesos-gramos.sql',
      aplicada: falta.length === 0,
      falta: falta.join('; ')
    });
  }

  // migracion-ficha-etiqueta.sql (22/09, ampliada 23/09): tabla
  // ficha_etiquetas (una ficha puede tener varias etiquetas en PDF) y ya
  // no la columna vieja ficha_transformador.etiqueta_pdf.
  {
    const tieneTabla = await existeTabla('ficha_etiquetas');
    const tieneColumnaVieja = await existeColumna('ficha_transformador', 'etiqueta_pdf');
    const falta = [];
    if (!tieneTabla) falta.push('falta la tabla ficha_etiquetas');
    if (tieneColumnaVieja) falta.push('todavía existe la columna vieja ficha_transformador.etiqueta_pdf');
    resultados.push({
      migracion: 'migracion-ficha-etiqueta.sql',
      aplicada: falta.length === 0,
      falta: falta.join('; ')
    });
  }

  // migracion-impuestos-provinciales-compra.sql (24/09): columna
  // facturas_compra.impuestos_provinciales.
  {
    const tieneColumna = await existeColumna('facturas_compra', 'impuestos_provinciales');
    resultados.push({
      migracion: 'migracion-impuestos-provinciales-compra.sql',
      aplicada: tieneColumna,
      falta: tieneColumna ? '' : 'falta la columna facturas_compra.impuestos_provinciales'
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
    console.log(`Las ${resultados.length} migraciones están aplicadas.`);
  } else {
    console.log(
      `Faltan ${pendientes.length} de ${resultados.length}: ${pendientes.map(r => r.migracion).join(', ')}.\n` +
      'Correrlas (con el backup ya hecho) antes de seguir al Paso 2.'
    );
  }

  await pool.end();
})().catch(e => {
  console.error('Error al chequear el estado de las migraciones:', e.message);
  process.exit(1);
});

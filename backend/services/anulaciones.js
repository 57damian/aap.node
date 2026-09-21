/* =====================================================================
 * ANULACIONES — cobros, facturas de venta, remitos y OC de cliente
 * ---------------------------------------------------------------------
 * Anular no borra el registro: queda marcado como anulado (con quién,
 * cuándo y por qué) y se guarda una copia de lo que se tocó en
 * auditoria_anulaciones.
 *
 * Todas las funciones reciben un `client` que YA está dentro de una
 * transacción (el router hace BEGIN/COMMIT/ROLLBACK). Los errores de
 * negocio llevan `.status` para que el router responda con el código
 * correcto (400 datos inválidos, 404 no existe, 409 estado que no lo permite).
 * ===================================================================== */

const MOTIVO_MIN = 10;

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

const hoyAR = () => new Date().toLocaleDateString('es-AR');

/* ---------------------------------------------------------------------
 * COBROS
 * ------------------------------------------------------------------- */

/** Anula un cobro entero (se cargó mal): suelta sus imputaciones y deja
 * sus formas de pago en ANULADO. Antes vivía dentro de la ruta y no
 * controlaba que ya estuviera anulado ni que un cheque estuviera endosado. */
async function anularCobro(client, pagoId, motivo) {
  const pago = await client.query('SELECT * FROM pagos WHERE id = $1 FOR UPDATE', [pagoId]);
  if (!pago.rows.length) throw fallo(404, 'Cobro no encontrado');
  if (pago.rows[0].anulado) throw fallo(409, 'El cobro ya estaba anulado');
  if (pago.rows[0].recibo_id) {
    throw fallo(409, 'El cobro ya tiene un recibo emitido: anulá primero el recibo');
  }

  const endosados = await client.query(
    `SELECT cheque_numero, cheque_banco FROM pago_items WHERE pago_id = $1 AND endosado = true`,
    [pagoId]
  );
  if (endosados.rows.length) {
    const e = endosados.rows[0];
    const cheque = [e.cheque_numero, e.cheque_banco].filter(Boolean).join(' ');
    throw fallo(409,
      `El cheque ${cheque} de este cobro fue endosado a un proveedor: primero hay que anular ese pago al proveedor`);
  }

  await client.query('DELETE FROM aplicacion_pagos WHERE pago_id = $1', [pagoId]);
  await client.query(`UPDATE pago_items SET estado = 'ANULADO', updated_at = now() WHERE pago_id = $1`, [pagoId]);
  await client.query(`
    UPDATE pagos SET anulado = true, updated_at = now(),
      observaciones = COALESCE(observaciones, '') || ' [ANULADO: ' || $2 || ']'
    WHERE id = $1
  `, [pagoId, motivo || 'sin motivo']);
}

/* ---------------------------------------------------------------------
 * FACTURAS DE VENTA
 * ------------------------------------------------------------------- */

/** Todo lo que pasaría al anular una factura. La usan tanto la vista previa
 * del diálogo como la anulación real, para que lo que se muestra sea
 * exactamente lo que se hace. Con `bloquear` toma FOR UPDATE de la factura. */
async function vistaPreviaAnulacion(client, facturaId, { bloquear = false } = {}) {
  const fac = await client.query(`
    SELECT f.*, c.nombre AS cliente_nombre
    FROM facturas f
    JOIN clientes c ON c.id = f.cliente_id
    WHERE f.id = $1
    ${bloquear ? 'FOR UPDATE OF f' : ''}
  `, [facturaId]);
  if (!fac.rows.length) throw fallo(404, 'Factura no encontrada');
  const factura = fac.rows[0];
  factura.estado = String(factura.estado || 'EMITIDA').toUpperCase();

  const renglones = (await client.query(`
    SELECT fvi.id, fvi.venta_item_id, fvi.ficha_id, ft.modelo, fvi.cantidad,
           fvi.precio_unitario, fvi.precio_unitario_usd, fvi.subtotal, fvi.iva, fvi.total
    FROM factura_venta_items fvi
    LEFT JOIN ficha_transformador ft ON ft.id = fvi.ficha_id
    WHERE fvi.factura_id = $1
    ORDER BY fvi.id
  `, [facturaId])).rows;

  const remitos = (await client.query(`
    SELECT v.id AS venta_id, v.remito_numero, v.remito_fecha, SUM(vi.cantidad)::int AS unidades
    FROM factura_venta_items fvi
    JOIN venta_items vi ON vi.id = fvi.venta_item_id
    JOIN ventas v ON v.id = vi.venta_id
    WHERE fvi.factura_id = $1
    GROUP BY v.id
    ORDER BY v.id
  `, [facturaId])).rows;

  const imputaciones = (await client.query(`
    SELECT ap.id AS aplicacion_id, ap.pago_id, ap.pago_item_id, ap.monto_aplicado,
           pi.tipo, pi.estado, pi.monto AS monto_item, pi.cheque_numero, pi.cheque_banco,
           pi.cheque_fecha_cobro, pi.retencion_tipo, COALESCE(pi.endosado, false) AS endosado,
           p.fecha_recepcion, p.recibo_id, p.anulado
    FROM aplicacion_pagos ap
    JOIN pago_items pi ON pi.id = ap.pago_item_id
    JOIN pagos p ON p.id = ap.pago_id
    WHERE ap.factura_id = $1
    ORDER BY ap.pago_id, ap.id
  `, [facturaId])).rows;

  // Si al anular el cobro entero éste estaba imputado también a otras
  // facturas, esas imputaciones se sueltan igual: hay que avisarlo.
  const pagoIds = [...new Set(imputaciones.map(i => i.pago_id))];
  const otras = pagoIds.length ? (await client.query(`
    SELECT ap.pago_id, f.numero_factura, ap.monto_aplicado
    FROM aplicacion_pagos ap
    JOIN facturas f ON f.id = ap.factura_id
    WHERE ap.pago_id = ANY($1) AND ap.factura_id <> $2
    ORDER BY ap.pago_id, f.numero_factura
  `, [pagoIds, facturaId])).rows : [];

  // Un renglón por cobro (no por forma de pago): la acción es sobre el cobro.
  const cobros = pagoIds.map(pagoId => {
    const items = imputaciones.filter(i => i.pago_id === pagoId);
    const primero = items[0];
    const bloqueoAnular =
      primero.recibo_id ? 'Tiene un recibo emitido' :
      items.some(i => i.endosado) ? 'Tiene un cheque endosado a un proveedor' : null;
    return {
      pago_id: pagoId,
      fecha_recepcion: primero.fecha_recepcion,
      monto_imputado_a_esta_factura: Math.round(items.reduce((a, i) => a + parseFloat(i.monto_aplicado), 0) * 100) / 100,
      formas: items.map(i => ({
        pago_item_id: i.pago_item_id, tipo: i.tipo, estado: i.estado, monto: i.monto_item,
        cheque_numero: i.cheque_numero, cheque_banco: i.cheque_banco,
        cheque_fecha_cobro: i.cheque_fecha_cobro, retencion_tipo: i.retencion_tipo
      })),
      tambien_imputado_en: otras.filter(o => o.pago_id === pagoId)
        .map(o => ({ numero_factura: o.numero_factura, monto: o.monto_aplicado })),
      puede_anularse: !bloqueoAnular,
      motivo_no_anulable: bloqueoAnular
    };
  });

  const notasCredito = (await client.query(
    'SELECT id, numero_nota, fecha, total FROM notas_credito WHERE factura_id = $1 ORDER BY id', [facturaId]
  )).rows;

  const bloqueos = [];
  if (factura.estado === 'ANULADA') bloqueos.push('La factura ya está anulada.');
  if (notasCredito.length) {
    bloqueos.push(
      `La factura tiene ${notasCredito.length} nota(s) de crédito. Todavía no se pueden anular notas de crédito, ` +
      'así que esta factura no se puede anular desde acá.');
  }

  return { factura, renglones, remitos, cobros, imputaciones, notas_credito: notasCredito, bloqueos };
}

/** Anula una factura de venta. Ver plan: una sola transacción, con
 * confirmación por número, motivo obligatorio y registro de auditoría. */
async function anularFactura(client, facturaId, { motivo, confirmar_numero, acciones_cobros, usuario }) {
  const motivoLimpio = String(motivo || '').trim();
  if (motivoLimpio.length < MOTIVO_MIN) {
    throw fallo(400, `Escribí el motivo de la anulación (al menos ${MOTIVO_MIN} caracteres)`);
  }

  const prev = await vistaPreviaAnulacion(client, facturaId, { bloquear: true });
  const { factura } = prev;

  if (factura.estado === 'ANULADA') throw fallo(409, 'La factura ya estaba anulada');
  if (prev.notas_credito.length) throw fallo(409, prev.bloqueos[0]);

  if (String(confirmar_numero || '').trim() !== String(factura.numero_factura).trim()) {
    throw fallo(400, 'El número escrito no coincide con el de la factura. No se anuló nada.');
  }

  // Acción por cobro. Por defecto queda a cuenta.
  const acciones = new Map();
  for (const a of (Array.isArray(acciones_cobros) ? acciones_cobros : [])) {
    const pagoId = parseInt(a.pago_id, 10);
    const accion = String(a.accion || '').toUpperCase();
    if (!prev.cobros.some(c => c.pago_id === pagoId)) {
      throw fallo(400, `El cobro ${a.pago_id} no está imputado a esta factura`);
    }
    if (!['A_CUENTA', 'ANULAR_COBRO'].includes(accion)) {
      throw fallo(400, `Acción inválida para el cobro ${pagoId}: "${a.accion}"`);
    }
    acciones.set(pagoId, accion);
  }

  const quien = usuario?.nombre_usuario || 'desconocido';
  const nota = ` [Liberado de la factura N° ${factura.numero_factura} anulada el ${hoyAR()} por ${quien}: ${motivoLimpio}]`;
  const resultadoCobros = [];

  for (const cobro of prev.cobros) {
    const accion = acciones.get(cobro.pago_id) || 'A_CUENTA';
    if (accion === 'ANULAR_COBRO') {
      if (!cobro.puede_anularse) {
        throw fallo(409, `No se puede anular el cobro ${cobro.pago_id}: ${cobro.motivo_no_anulable}. Elegí dejarlo a cuenta.`);
      }
      await anularCobro(client, cobro.pago_id, `Factura ${factura.numero_factura} anulada: ${motivoLimpio}`);
    } else {
      await client.query('DELETE FROM aplicacion_pagos WHERE pago_id = $1 AND factura_id = $2', [cobro.pago_id, facturaId]);
      await client.query(
        `UPDATE pagos SET observaciones = COALESCE(observaciones, '') || $2, updated_at = now() WHERE id = $1`,
        [cobro.pago_id, nota]
      );
    }
    resultadoCobros.push({ pago_id: cobro.pago_id, accion });
  }

  // Los remitos vuelven a estar pendientes de facturar.
  await client.query('DELETE FROM factura_venta_items WHERE factura_id = $1', [facturaId]);

  await client.query(`
    UPDATE facturas
       SET estado = 'ANULADA', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3
     WHERE id = $1
  `, [facturaId, usuario?.id || null, motivoLimpio]);

  await client.query(`
    INSERT INTO auditoria_anulaciones (entidad, entidad_id, numero, motivo, usuario_id, usuario_nombre, snapshot)
    VALUES ('FACTURA_VENTA', $1, $2, $3, $4, $5, $6::jsonb)
  `, [
    facturaId, factura.numero_factura, motivoLimpio, usuario?.id || null, quien,
    JSON.stringify({
      factura, renglones: prev.renglones, remitos: prev.remitos,
      cobros: prev.cobros, imputaciones: prev.imputaciones, acciones: resultadoCobros
    })
  ]);

  return {
    factura_id: facturaId,
    numero_factura: factura.numero_factura,
    remitos_liberados: prev.remitos.length,
    cobros: resultadoCobros
  };
}

/* ---------------------------------------------------------------------
 * COMÚN A REMITOS Y OC
 * ------------------------------------------------------------------- */

/** Valida motivo y confirmación por número, igual que en las facturas. */
function validarConfirmacion(motivo, confirmar, identificador) {
  const motivoLimpio = String(motivo || '').trim();
  if (motivoLimpio.length < MOTIVO_MIN) {
    throw fallo(400, `Escribí el motivo de la anulación (al menos ${MOTIVO_MIN} caracteres)`);
  }
  if (String(confirmar || '').trim() !== String(identificador).trim()) {
    throw fallo(400, 'El número escrito no coincide. No se anuló nada.');
  }
  return motivoLimpio;
}

async function registrarAuditoria(client, entidad, entidadId, numero, motivo, usuario, snapshot) {
  await client.query(`
    INSERT INTO auditoria_anulaciones (entidad, entidad_id, numero, motivo, usuario_id, usuario_nombre, snapshot)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
  `, [entidad, entidadId, numero, motivo, usuario?.id || null, usuario?.nombre_usuario || 'desconocido', JSON.stringify(snapshot)]);
}

/* ---------------------------------------------------------------------
 * REMITOS (filas de `ventas`)
 * ------------------------------------------------------------------- */

/** Qué pasaría al anular un remito. Con `bloquear`, FOR UPDATE del remito. */
async function vistaPreviaAnulacionRemito(client, ventaId, { bloquear = false } = {}) {
  const r = await client.query(`
    SELECT v.*, c.nombre AS cliente_nombre, oc.numero_oc
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
    WHERE v.id = $1
    ${bloquear ? 'FOR UPDATE OF v' : ''}
  `, [ventaId]);
  if (!r.rows.length) throw fallo(404, 'Remito no encontrado');
  const venta = r.rows[0];
  venta.identificador = venta.remito_numero || `venta #${venta.id}`;

  const items = (await client.query(`
    SELECT vi.id, vi.ficha_id, ft.modelo, vi.cantidad, vi.precio_unitario_usd, vi.precio_unitario_pesos
    FROM venta_items vi
    LEFT JOIN ficha_transformador ft ON ft.id = vi.ficha_id
    WHERE vi.venta_id = $1
    ORDER BY vi.id
  `, [ventaId])).rows;

  // Solo hay filas en factura_venta_items de facturas vigentes: al anular una
  // factura se borran (ver anularFactura).
  const facturas = (await client.query(`
    SELECT DISTINCT f.id, f.numero_factura
    FROM factura_venta_items fvi
    JOIN venta_items vi ON vi.id = fvi.venta_item_id
    JOIN facturas f ON f.id = fvi.factura_id
    WHERE vi.venta_id = $1
    ORDER BY f.numero_factura
  `, [ventaId])).rows;

  const bloqueos = [];
  if (venta.anulada_en) bloqueos.push('El remito ya está anulado.');
  if (facturas.length) {
    bloqueos.push(
      `El remito está facturado en la factura ${facturas.map(f => f.numero_factura).join(', ')}. ` +
      'Anulá primero la factura (en la solapa Facturas de venta) y después el remito.');
  }
  return { venta, items, facturas, bloqueos };
}

async function anularRemito(client, ventaId, { motivo, confirmar_numero, usuario }) {
  const prev = await vistaPreviaAnulacionRemito(client, ventaId, { bloquear: true });
  const { venta } = prev;
  if (venta.anulada_en) throw fallo(409, 'El remito ya estaba anulado');
  if (prev.facturas.length) throw fallo(409, prev.bloqueos[0]);
  const motivoLimpio = validarConfirmacion(motivo, confirmar_numero, venta.identificador);

  // Las unidades vuelven al stock al borrar los ítems: stock_actual y el
  // "entregado" de la OC se calculan sumando venta_items.
  await client.query('DELETE FROM venta_items WHERE venta_id = $1', [ventaId]);
  await client.query(`
    UPDATE ventas SET anulada_en = now(), anulada_por = $2, motivo_anulacion = $3 WHERE id = $1
  `, [ventaId, usuario?.id || null, motivoLimpio]);

  await registrarAuditoria(client, 'REMITO', ventaId, venta.identificador, motivoLimpio, usuario,
    { venta, items: prev.items });

  return {
    venta_id: ventaId,
    identificador: venta.identificador,
    unidades_devueltas_al_stock: prev.items.reduce((a, i) => a + Number(i.cantidad), 0)
  };
}

/* ---------------------------------------------------------------------
 * ÓRDENES DE COMPRA DE CLIENTE
 * ------------------------------------------------------------------- */

async function vistaPreviaAnulacionOC(client, ocId, { bloquear = false } = {}) {
  const r = await client.query(`
    SELECT oc.*, c.nombre AS cliente_nombre
    FROM ordenes_compra oc
    JOIN clientes c ON c.id = oc.cliente_id
    WHERE oc.id = $1
    ${bloquear ? 'FOR UPDATE OF oc' : ''}
  `, [ocId]);
  if (!r.rows.length) throw fallo(404, 'Orden de compra no encontrada');
  const oc = r.rows[0];
  oc.identificador = oc.numero_oc;

  const items = (await client.query(`
    SELECT oci.ficha_id, ft.modelo, oci.cantidad_pedida
    FROM orden_compra_items oci
    LEFT JOIN ficha_transformador ft ON ft.id = oci.ficha_id
    WHERE oci.orden_compra_id = $1
    ORDER BY oci.id
  `, [ocId])).rows;

  // Remitos con entregas (los anulados ya no tienen ítems).
  const remitos = (await client.query(`
    SELECT v.id, v.remito_numero, SUM(vi.cantidad)::int AS unidades
    FROM ventas v
    JOIN venta_items vi ON vi.venta_id = v.id
    WHERE v.orden_compra_id = $1
    GROUP BY v.id
    ORDER BY v.id
  `, [ocId])).rows;

  const facturas = (await client.query(`
    SELECT id, numero_factura
    FROM facturas
    WHERE orden_compra_id = $1 AND COALESCE(upper(estado), 'EMITIDA') <> 'ANULADA'
    ORDER BY numero_factura
  `, [ocId])).rows;

  const bloqueos = [];
  if (oc.estado === 'anulada') bloqueos.push('La orden de compra ya está anulada.');
  if (facturas.length) {
    bloqueos.push(
      `Tiene facturas vigentes (${facturas.map(f => f.numero_factura).join(', ')}). ` +
      'Anulalas primero en la solapa Facturas de venta.');
  }
  if (remitos.length) {
    bloqueos.push(
      `Tiene remitos con entregas (${remitos.map(v => v.remito_numero || `venta #${v.id}`).join(', ')}). ` +
      'Anulalos primero en la solapa Remitos.');
  }
  return { oc, items, remitos, facturas, bloqueos };
}

async function anularOC(client, ocId, { motivo, confirmar_numero, usuario }) {
  const prev = await vistaPreviaAnulacionOC(client, ocId, { bloquear: true });
  const { oc } = prev;
  if (oc.estado === 'anulada') throw fallo(409, 'La orden de compra ya estaba anulada');
  if (prev.bloqueos.length) throw fallo(409, prev.bloqueos[0]);
  const motivoLimpio = validarConfirmacion(motivo, confirmar_numero, oc.identificador);

  await client.query(`
    UPDATE ordenes_compra
       SET estado = 'anulada', anulada_en = now(), anulada_por = $2, motivo_anulacion = $3
     WHERE id = $1
  `, [ocId, usuario?.id || null, motivoLimpio]);

  await registrarAuditoria(client, 'ORDEN_COMPRA', ocId, oc.identificador, motivoLimpio, usuario,
    { oc, items: prev.items });

  return { oc_id: ocId, identificador: oc.identificador };
}

module.exports = {
  anularCobro,
  vistaPreviaAnulacion, anularFactura,
  vistaPreviaAnulacionRemito, anularRemito,
  vistaPreviaAnulacionOC, anularOC,
  MOTIVO_MIN
};

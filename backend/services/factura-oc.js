/* =====================================================================
 * Relación factura de venta ↔ orden de compra (21/11/2026)
 *
 * La OC, el remito y la entrega son un control interno; lo que vale es la
 * factura real que se le hace al cliente, y una factura puede juntar remitos
 * de varias OC. Por eso la OC de una factura no se lee de una sola columna:
 * se deriva de lo que la factura cubre (factura_venta_items → venta_items →
 * ventas → ordenes_compra).
 *
 * `facturas.orden_compra_id` queda como atajo: vale la OC cuando todos los
 * remitos de la factura son de una sola, y NULL cuando junta varias (o es una
 * factura vieja sin ítems). Esta consulta cubre los dos casos.
 * ===================================================================== */

/**
 * Subconsulta (factura_id, oc_id, parte): qué parte del total de cada factura
 * corresponde a cada OC. Una factura de una sola OC aporta 1; una que junta
 * varias reparte su total según lo que cubre de cada una.
 * Se usa como tabla derivada: `JOIN (${FACTURA_OC_PARTE}) fop ON ...`.
 */
const FACTURA_OC_PARTE = `
  SELECT fa.id AS factura_id, fa.orden_compra_id AS oc_id, 1::numeric AS parte
  FROM facturas fa
  WHERE fa.orden_compra_id IS NOT NULL
  UNION ALL
  SELECT fvi.factura_id, v.orden_compra_id, SUM(fvi.total) / NULLIF(fa.total, 0)
  FROM factura_venta_items fvi
  JOIN facturas fa    ON fa.id = fvi.factura_id AND fa.orden_compra_id IS NULL
  JOIN venta_items vi ON vi.id = fvi.venta_item_id
  JOIN ventas v       ON v.id = vi.venta_id
  WHERE v.orden_compra_id IS NOT NULL
  GROUP BY fvi.factura_id, v.orden_compra_id, fa.total
`;

/** Números de OC que cubre una factura, separados por coma (expresión SQL; `alias` = alias de facturas). */
const numerosOcDeFactura = (alias = 'f') => `
  (SELECT string_agg(DISTINCT oc2.numero_oc, ', ')
     FROM (${FACTURA_OC_PARTE}) fop2
     JOIN ordenes_compra oc2 ON oc2.id = fop2.oc_id
    WHERE fop2.factura_id = ${alias}.id)`;

module.exports = { FACTURA_OC_PARTE, numerosOcDeFactura };

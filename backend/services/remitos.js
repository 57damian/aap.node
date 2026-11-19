/* =====================================================================
 * Listado de remitos (19/11/2026).
 *
 * En la base cada fila de `ventas` es el tramo de un remito que se imputa a
 * UNA orden de compra; un remito que lleva material de varias OC son varias
 * filas con el mismo número. Para la gente es un solo remito, así que acá se
 * agrupa por (cliente, N° de remito): una fila por remito, con las OC
 * involucradas, los modelos sumados y su estado de facturación.
 *
 * Con filtro por OC no se agrupa: se ve solo el tramo de esa OC (es lo que
 * necesita la pestaña "Remitos" del detalle de la OC y el wizard de facturar).
 * ===================================================================== */

const pool = require('../db');

/** Filas de `ventas` (una por tramo) con lo necesario para agrupar. */
async function filasDeVentas({ cliente_id, orden_compra_id, desde, hasta }) {
  let query = `
    SELECT
      v.id, v.fecha, v.tipo_cambio, v.cliente_id, v.orden_compra_id,
      v.remito_numero, v.remito_fecha, v.remito_observaciones,
      c.nombre AS cliente,
      oc.numero_oc,
      (
        SELECT string_agg(DISTINCT f.numero_factura, ', ')
        FROM factura_venta_items fi
        JOIN facturas f ON f.id = fi.factura_id
        JOIN venta_items vi ON vi.id = fi.venta_item_id
        WHERE vi.venta_id = v.id
      ) AS numero_factura,
      (SELECT COUNT(*)::int FROM venta_items vi WHERE vi.venta_id = v.id) AS items_total,
      (SELECT COUNT(*)::int FROM venta_items vi WHERE vi.venta_id = v.id
         AND NOT EXISTS (SELECT 1 FROM factura_venta_items fi WHERE fi.venta_item_id = vi.id)) AS items_sin_facturar,
      (SELECT COALESCE(SUM(vi.cantidad), 0)::int FROM venta_items vi WHERE vi.venta_id = v.id) AS unidades,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'modelo', ft.modelo, 'cantidad', vi.cantidad,
          'precio_unitario_usd', vi.precio_unitario_usd,
          'precio_unitario_pesos', vi.precio_unitario_pesos
        ) ORDER BY ft.modelo), '[]'::json)
        FROM venta_items vi
        JOIN ficha_transformador ft ON ft.id = vi.ficha_id
        WHERE vi.venta_id = v.id
      ) AS items
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
    WHERE v.anulada_en IS NULL
  `;
  const params = [];
  if (cliente_id) { params.push(cliente_id); query += ` AND v.cliente_id = $${params.length}`; }
  if (orden_compra_id) { params.push(orden_compra_id); query += ` AND v.orden_compra_id = $${params.length}`; }
  if (desde) { params.push(desde); query += ` AND v.fecha >= $${params.length}`; }
  if (hasta) { params.push(hasta); query += ` AND v.fecha <= $${params.length}`; }
  // Sin paginación real: el filtro por fecha acota el volumen en el uso
  // normal. LIMIT es solo una salvaguarda, no un mecanismo de recorte.
  query += ' ORDER BY v.id DESC LIMIT 5000';
  return (await pool.query(query, params)).rows;
}

/** Qué hace falta saber de cada tramo (una OC) para facturarlo. */
function tramoResumen(t) {
  return { id: t.id, orden_compra_id: t.orden_compra_id, numero_oc: t.numero_oc, items_sin_facturar: t.items_sin_facturar };
}

/** Une los tramos de un mismo remito en una sola fila. */
function agruparTramos(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const clave = f.remito_numero ? `${f.cliente_id}|${f.remito_numero}` : `venta|${f.id}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(f);
  }

  return [...grupos.values()].map((tramos) => {
    // El más nuevo es el "principal" (las filas vienen ordenadas por id DESC):
    // anular o descargar el PDF desde su id alcanza a todo el remito.
    const base = tramos[0];
    const numerosOC = [...new Set(tramos.map(t => t.numero_oc).filter(Boolean))];
    const facturas = [...new Set(tramos.flatMap(t => (t.numero_factura ? t.numero_factura.split(', ') : [])))];
    const itemsTotal = tramos.reduce((a, t) => a + t.items_total, 0);
    const sinFacturar = tramos.reduce((a, t) => a + t.items_sin_facturar, 0);

    // Mismo modelo y mismo precio de varias OC → una sola línea.
    const items = new Map();
    for (const t of tramos) {
      for (const it of t.items) {
        const k = `${it.modelo}|${it.precio_unitario_usd}|${it.precio_unitario_pesos}`;
        const previo = items.get(k);
        if (previo) previo.cantidad += Number(it.cantidad);
        else items.set(k, { ...it, cantidad: Number(it.cantidad) });
      }
    }

    let estado = 'SIN_FACTURAR';
    if (itemsTotal > 0 && sinFacturar === 0) estado = 'FACTURADA';
    else if (sinFacturar < itemsTotal) estado = 'PARCIAL';

    return {
      ...base,
      ids: tramos.map(t => t.id),
      fecha: tramos.reduce((m, t) => (t.fecha < m ? t.fecha : m), base.fecha),
      numero_oc: numerosOC.join(', ') || null,
      numeros_oc: numerosOC,
      oc_ids: tramos.map(t => t.orden_compra_id),
      tramos: tramos.map(tramoResumen),
      numero_factura: facturas.join(', ') || null,
      estado_facturacion: estado,
      unidades: tramos.reduce((a, t) => a + t.unidades, 0),
      items: [...items.values()].sort((a, b) => a.modelo.localeCompare(b.modelo))
    };
  });
}

/**
 * @param {object} filtros  { cliente_id, orden_compra_id, desde, hasta }
 * @returns una fila por remito (o por tramo si se filtra por OC).
 */
async function listarRemitos(filtros = {}) {
  const filas = await filasDeVentas(filtros);
  if (filtros.orden_compra_id) {
    return filas.map(f => ({
      ...f,
      ids: [f.id],
      numeros_oc: f.numero_oc ? [f.numero_oc] : [],
      oc_ids: [f.orden_compra_id],
      tramos: [tramoResumen(f)],
      estado_facturacion: f.items_total > 0 && f.items_sin_facturar === 0 ? 'FACTURADA'
        : (f.items_sin_facturar < f.items_total ? 'PARCIAL' : 'SIN_FACTURAR')
    }));
  }
  return agruparTramos(filas);
}

/** Ids de todos los tramos del mismo remito que `ventaId` (con el mismo estado de anulación). */
async function idsDelRemito(client, ventaId) {
  const r = await client.query(`
    SELECT o.id
    FROM ventas v
    JOIN ventas o ON o.cliente_id = v.cliente_id
                 AND v.remito_numero IS NOT NULL
                 AND o.remito_numero = v.remito_numero
                 AND (o.anulada_en IS NULL) = (v.anulada_en IS NULL)
    WHERE v.id = $1
    UNION
    SELECT $1::int
    ORDER BY 1`, [ventaId]);
  return r.rows.map(x => x.id);
}

module.exports = { listarRemitos, idsDelRemito, agruparTramos };

/* =====================================================================
 * Pendientes de entrega por cliente (18/11/2026).
 *
 * Lo que cada cliente pidió en sus órdenes de compra y todavía no se le
 * entregó, sumado por modelo: si el mismo modelo está en varias OC del
 * cliente, sale una sola fila con el total y el desglose de a qué OC
 * corresponde cada parte. Lo usan la pantalla de OC (GET /pendientes) y el
 * PDF (GET /pendientes/pdf), así los dos muestran siempre lo mismo.
 *
 * Qué cuenta como pendiente:
 *  - OC vigentes: no anuladas y no cerradas (una OC cerrada es una decisión
 *    de dejar de esperar lo que faltó).
 *  - Por cada ítem de la OC: cantidad_pedida − entregado de ese modelo en los
 *    remitos de esa OC. Lo entregado de más no resta a otras OC (se trunca en 0).
 * ===================================================================== */

const pool = require('../db');

/**
 * @param {number|null} clienteId - null = todos los clientes.
 * @returns {Promise<Array>} [{ cliente_id, cliente, total_pendiente, modelos: [
 *   { ficha_id, modelo, pedido, entregado, pendiente, ordenes: [
 *     { oc_id, numero_oc, fecha_oc, pedido, entregado, pendiente } ] } ] }]
 */
async function pendientesPorCliente(clienteId = null) {
  const params = [];
  let filtroCliente = '';
  if (clienteId) {
    params.push(clienteId);
    filtroCliente = 'AND oc.cliente_id = $1';
  }

  const { rows } = await pool.query(
    `SELECT oc.id AS oc_id, oc.numero_oc, oc.fecha_oc, oc.cliente_id,
            c.nombre AS cliente,
            oci.ficha_id, ft.modelo,
            oci.cantidad_pedida::int AS pedido,
            COALESCE((SELECT SUM(vi.cantidad)
                      FROM ventas v
                      JOIN venta_items vi ON vi.venta_id = v.id
                      WHERE v.orden_compra_id = oc.id
                        AND v.anulada_en IS NULL
                        AND vi.ficha_id = oci.ficha_id), 0)::int AS entregado
     FROM orden_compra_items oci
     JOIN ordenes_compra oc ON oc.id = oci.orden_compra_id
     JOIN clientes c ON c.id = oc.cliente_id
     JOIN ficha_transformador ft ON ft.id = oci.ficha_id
     WHERE oc.anulada_en IS NULL
       AND oc.estado NOT IN ('anulada', 'cerrada')
       ${filtroCliente}
     ORDER BY c.nombre, ft.modelo, oc.fecha_oc, oc.id`,
    params
  );

  const clientes = new Map();
  for (const r of rows) {
    const pendiente = Math.max(r.pedido - r.entregado, 0);
    if (pendiente === 0) continue;

    if (!clientes.has(r.cliente_id)) {
      clientes.set(r.cliente_id, {
        cliente_id: r.cliente_id, cliente: r.cliente, total_pendiente: 0, _modelos: new Map()
      });
    }
    const cli = clientes.get(r.cliente_id);

    if (!cli._modelos.has(r.ficha_id)) {
      cli._modelos.set(r.ficha_id, {
        ficha_id: r.ficha_id, modelo: r.modelo, pedido: 0, entregado: 0, pendiente: 0, ordenes: []
      });
    }
    const mod = cli._modelos.get(r.ficha_id);

    mod.pedido += r.pedido;
    mod.entregado += r.entregado;
    mod.pendiente += pendiente;
    mod.ordenes.push({
      oc_id: r.oc_id, numero_oc: r.numero_oc, fecha_oc: r.fecha_oc,
      pedido: r.pedido, entregado: r.entregado, pendiente
    });
    cli.total_pendiente += pendiente;
  }

  return [...clientes.values()].map(({ _modelos, ...cli }) => ({
    ...cli, modelos: [..._modelos.values()]
  }));
}

module.exports = { pendientesPorCliente };

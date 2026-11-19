/* =====================================================================
 * Entregas a clientes (19/11/2026).
 *
 * Una entrega es lo que se le lleva a un cliente en un viaje: un remito con
 * N°, fecha, modelos y cantidades. Lo entregado se imputa a las órdenes de
 * compra (OC) del cliente: primero la más vieja, para ir liquidando lo
 * pedido. Si el reparto toca más de una OC, se crea una fila de `ventas` por
 * OC con el MISMO número de remito, todas en la misma transacción (factura,
 * stock y anulaciones ya trabajan por OC, así no hace falta una tabla nueva).
 *
 * Reglas que antes solo controlaba el navegador y ahora valida el servidor:
 *  - lo entregado de cada OC no supera lo pendiente de esa OC;
 *  - el stock alcanza (el trigger de venta_items sigue como red de seguridad).
 * ===================================================================== */

const pool = require('../db');
const { pendientesPorCliente } = require('./oc-pendientes');

const PREFIJO_REMITO = 'R-';

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

function entero(valor) {
  const n = Number.parseInt(valor, 10);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Reparte las líneas de la entrega entre las OC del cliente.
 *
 * @param {object} cli       Entrada de pendientesPorCliente() para el cliente.
 * @param {Array}  lineas    [{ ficha_id, cantidad, reparto?: [{ orden_compra_id, cantidad }] }]
 * @param {number|null} ocPrioritaria  OC a la que se imputa primero (si no, la más vieja).
 * @returns {Map<number, Array<{ficha_id:number, cantidad:number}>>} por OC.
 */
function repartirEntreOC(cli, lineas, ocPrioritaria = null) {
  const porOC = new Map();
  const agregar = (ocId, fichaId, cantidad) => {
    if (!porOC.has(ocId)) porOC.set(ocId, []);
    porOC.get(ocId).push({ ficha_id: fichaId, cantidad });
  };
  const vistos = new Set();

  for (const linea of lineas) {
    const fichaId = entero(linea.ficha_id);
    const cantidad = entero(linea.cantidad);
    if (!fichaId || !cantidad || cantidad <= 0) throw fallo(400, 'Hay una línea con modelo o cantidad inválidos');
    if (vistos.has(fichaId)) throw fallo(400, 'Un modelo aparece dos veces en la entrega');
    vistos.add(fichaId);

    const modelo = cli?.modelos.find(m => m.ficha_id === fichaId);
    if (!modelo) throw fallo(400, 'El cliente no tiene pendiente de uno de los modelos de la entrega');
    if (cantidad > modelo.pendiente) {
      throw fallo(400, `${modelo.modelo}: se quieren entregar ${cantidad} pero lo pendiente de las órdenes de compra es ${modelo.pendiente}`);
    }

    if (Array.isArray(linea.reparto) && linea.reparto.length) {
      // Reparto manual: tiene que cerrar exacto y respetar el pendiente de cada OC.
      let suma = 0;
      for (const r of linea.reparto) {
        const ocId = entero(r.orden_compra_id);
        const cant = entero(r.cantidad);
        if (!cant || cant <= 0) continue;
        const oc = modelo.ordenes.find(o => o.oc_id === ocId);
        if (!oc) throw fallo(400, `${modelo.modelo}: la OC indicada no tiene pendiente de ese modelo`);
        if (cant > oc.pendiente) {
          throw fallo(400, `${modelo.modelo}: la OC ${oc.numero_oc} solo tiene ${oc.pendiente} pendientes`);
        }
        suma += cant;
        agregar(ocId, fichaId, cant);
      }
      if (suma !== cantidad) throw fallo(400, `${modelo.modelo}: el reparto entre OC (${suma}) no coincide con la cantidad (${cantidad})`);
      continue;
    }

    // Reparto automático: la OC prioritaria primero y después la más vieja
    // (modelo.ordenes ya viene ordenado por fecha y número de OC).
    const orden = [...modelo.ordenes].sort((a, b) =>
      (b.oc_id === ocPrioritaria) - (a.oc_id === ocPrioritaria));
    let resto = cantidad;
    for (const oc of orden) {
      if (resto <= 0) break;
      const toma = Math.min(resto, oc.pendiente);
      agregar(oc.oc_id, fichaId, toma);
      resto -= toma;
    }
  }
  return porOC;
}

/** Siguiente número de remito automático (R-000001…). Sin saltear números ya usados a mano. */
async function siguienteNumeroRemito(client) {
  await client.query(
    `INSERT INTO parametros (clave, valor, descripcion)
     VALUES ('remito_proximo', '1', 'Próximo número de remito automático')
     ON CONFLICT (clave) DO NOTHING`
  );
  for (let intentos = 0; intentos < 1000; intentos++) {
    const r = await client.query(
      `UPDATE parametros SET valor = ((valor::int) + 1)::text, updated_at = now()
       WHERE clave = 'remito_proximo' RETURNING (valor::int - 1) AS usado`
    );
    const numero = `${PREFIJO_REMITO}${String(r.rows[0].usado).padStart(6, '0')}`;
    const existe = await client.query(
      'SELECT 1 FROM ventas WHERE remito_numero = $1 AND anulada_en IS NULL LIMIT 1', [numero]);
    if (!existe.rows.length) return numero;
  }
  throw fallo(500, 'No se pudo generar un número de remito libre');
}

/** Número que se va a proponer en pantalla (no lo consume). */
async function proximoNumeroRemito(db = pool) {
  const r = await db.query("SELECT valor FROM parametros WHERE clave = 'remito_proximo'");
  let n = r.rows.length ? Number.parseInt(r.rows[0].valor, 10) : 1;
  if (!Number.isInteger(n) || n < 1) n = 1;
  for (let i = 0; i < 1000; i++, n++) {
    const numero = `${PREFIJO_REMITO}${String(n).padStart(6, '0')}`;
    const existe = await db.query(
      'SELECT 1 FROM ventas WHERE remito_numero = $1 AND anulada_en IS NULL LIMIT 1', [numero]);
    if (!existe.rows.length) return numero;
  }
  return null;
}

async function dolarVigente(client, tipoCambio) {
  let tc = Number.parseFloat(tipoCambio);
  if (tc && !Number.isNaN(tc) && tc > 0) return tc;
  const r = await client.query("SELECT valor FROM parametros WHERE clave = 'dolar_banco'");
  tc = r.rows.length ? Number.parseFloat(r.rows[0].valor) : NaN;
  if (!tc || Number.isNaN(tc)) {
    throw fallo(400, 'No hay cotización del dólar cargada. Cargala en Precios antes de registrar la entrega.');
  }
  return tc;
}

/** Inserta un ítem de remito al precio de lista vigente del modelo. */
async function insertarItemVenta(client, ventaId, fichaId, cantidad, tipoCambio) {
  const precioRes = await client.query(
    'SELECT precio FROM precios_modelo WHERE ficha_id = $1 ORDER BY fecha_desde DESC LIMIT 1', [fichaId]);
  if (!precioRes.rows.length) {
    const m = await client.query('SELECT modelo FROM ficha_transformador WHERE id = $1', [fichaId]);
    throw fallo(400, `El modelo ${m.rows[0]?.modelo || `ficha ${fichaId}`} no tiene precio cargado`);
  }
  const precioUsd = precioRes.rows[0].precio;
  // Si la cantidad supera el stock, trigger_verificar_stock rechaza el INSERT.
  const r = await client.query(
    `INSERT INTO venta_items (venta_id, ficha_id, cantidad, precio_unitario_usd, precio_unitario_pesos)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ventaId, fichaId, cantidad, precioUsd, precioUsd * tipoCambio]
  );
  return r.rows[0];
}

/**
 * Registra una entrega completa. Debe llamarse dentro de BEGIN/COMMIT.
 *
 * @returns {{ remito_numero, remito_fecha, cliente_id, ventas: [{id, orden_compra_id, items}] }}
 */
async function crearEntrega(client, datos) {
  const clienteId = entero(datos.cliente_id);
  if (!clienteId) throw fallo(400, 'Falta el cliente');
  if (!Array.isArray(datos.lineas) || !datos.lineas.length) throw fallo(400, 'La entrega no tiene modelos');
  if (!datos.remito_fecha) throw fallo(400, 'La fecha del remito es obligatoria');
  const ocPrioritaria = entero(datos.orden_compra_id) || null;

  // Serializa entregas del mismo cliente (el pendiente se calcula con las OC
  // bloqueadas) y la numeración de remitos.
  await client.query(
    `SELECT id FROM ordenes_compra
      WHERE cliente_id = $1 AND anulada_en IS NULL AND estado NOT IN ('anulada','cerrada')
      ORDER BY id FOR UPDATE`, [clienteId]);
  await client.query("SELECT pg_advisory_xact_lock(hashtext('remito_numero'))");

  const tipoCambio = await dolarVigente(client, datos.tipo_cambio);

  const pendientes = await pendientesPorCliente(clienteId, client);
  const cli = pendientes[0] || null;
  if (!cli) throw fallo(400, 'El cliente no tiene órdenes de compra con entregas pendientes');
  const porOC = repartirEntreOC(cli, datos.lineas, ocPrioritaria);

  let remitoNumero = String(datos.remito_numero || '').trim();
  if (remitoNumero) {
    const existe = await client.query(
      'SELECT 1 FROM ventas WHERE remito_numero = $1 AND anulada_en IS NULL LIMIT 1', [remitoNumero]);
    if (existe.rows.length) throw fallo(400, `El remito N° ${remitoNumero} ya está registrado`);
  } else {
    remitoNumero = await siguienteNumeroRemito(client);
  }

  const ventas = [];
  for (const [ocId, items] of porOC) {
    const v = await client.query(
      `INSERT INTO ventas (cliente_id, orden_compra_id, tipo_cambio, remito_numero, remito_fecha, remito_observaciones)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [clienteId, ocId, tipoCambio, remitoNumero, datos.remito_fecha, datos.remito_observaciones || null]
    );
    const venta = v.rows[0];
    venta.items = [];
    for (const it of items) {
      venta.items.push(await insertarItemVenta(client, venta.id, it.ficha_id, it.cantidad, tipoCambio));
    }
    ventas.push({ id: venta.id, orden_compra_id: ocId, items: venta.items });
  }

  return { remito_numero: remitoNumero, remito_fecha: datos.remito_fecha, cliente_id: clienteId, ventas };
}

/** Pendiente de un modelo en una OC puntual (para validar el alta vieja POST /api/ventas). */
async function pendienteDeItemOC(client, ocId, fichaId) {
  const r = await client.query(
    `SELECT oci.cantidad_pedida::int - COALESCE((
              SELECT SUM(vi.cantidad) FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
              WHERE v.orden_compra_id = oci.orden_compra_id AND v.anulada_en IS NULL
                AND vi.ficha_id = oci.ficha_id), 0)::int AS pendiente
       FROM orden_compra_items oci
      WHERE oci.orden_compra_id = $1 AND oci.ficha_id = $2`, [ocId, fichaId]);
  return r.rows.length ? r.rows[0].pendiente : 0;
}

module.exports = {
  repartirEntreOC, crearEntrega, proximoNumeroRemito, insertarItemVenta,
  dolarVigente, pendienteDeItemOC, fallo
};

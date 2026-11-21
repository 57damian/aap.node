/* =====================================================================
 * Facturas de venta: creación desde uno o varios remitos.
 *
 * Una factura agrupa remitos del MISMO cliente, de cualquier fecha y de
 * cualquier OC: la OC, el remito y la entrega son un control interno y lo que
 * vale es la factura real que se le hace al cliente (21/11/2026; antes
 * exigía una sola OC). Debe llamarse dentro de BEGIN/COMMIT.
 *
 * datos:
 *   venta_ids: [..]  (o venta_id, como enviaba la pantalla vieja)
 *   numero_factura, tipo_factura, fecha, dias_credito
 *   tipo_cambio      (opcional) cotización usada al facturar
 *   precios          (opcional) [{ ficha_id, precio_unitario_usd,
 *                                  precio_unitario_pesos,
 *                                  total_con_iva (opcional) }]
 *                    `total_con_iva` fija el importe final del modelo (con
 *                    IVA) tal cual está en la factura en papel.
 * El precio puede haber cambiado entre la entrega y la factura: si viene
 * `precios`, se factura cada modelo a ese precio (sin IVA, en pesos); si
 * no, al precio de la entrega. venta_items NO se modifica: queda como
 * valor histórico de lo entregado.
 * ===================================================================== */

const pool = require('../db');
const { getIVA } = require('./parametros');

async function crearFacturaDesdeRemitos(client, datos) {
  const {
    venta_id,
    venta_ids,
    numero_factura,
    tipo_factura,
    fecha,
    dias_credito,
    tipo_cambio,
    precios
  } = datos;

  // Normalizar días de crédito: si es null, undefined o string vacío → 0
  const diasCredito = (dias_credito === undefined || dias_credito === null || dias_credito === '')
                      ? 0
                      : Number(dias_credito);

  if (isNaN(diasCredito) || diasCredito < 0) {
    throw new Error('Días de crédito inválido');
  }

  const ids = [...new Set(
    (Array.isArray(venta_ids) ? venta_ids : [venta_id])
      .map(id => Number.parseInt(id, 10))
      .filter(Boolean)
  )];

  if (!ids.length || !numero_factura || !tipo_factura || !fecha) {
    throw new Error('Datos incompletos');
  }

  const tipoCambio = tipo_cambio === undefined || tipo_cambio === null || tipo_cambio === ''
    ? null
    : Number(tipo_cambio);
  if (tipoCambio !== null && (isNaN(tipoCambio) || tipoCambio <= 0)) {
    throw new Error('Cotización del dólar inválida');
  }

  // 1️⃣ Bloquear ventas: tienen que ser todas del mismo cliente (las OC pueden ser varias)
  const ventasRes = await client.query(
    `SELECT * FROM ventas WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
    [ids]
  );

  if (ventasRes.rows.length !== ids.length) {
    throw new Error('Alguna de las ventas seleccionadas no existe');
  }

  const ventas = ventasRes.rows;
  const venta = ventas[0];

  if (ventas.some(v => v.anulada_en)) {
    throw new Error('Alguno de los remitos seleccionados está anulado');
  }
  if (ventas.some(v => v.cliente_id !== venta.cliente_id)) {
    throw new Error('Los remitos seleccionados son de clientes distintos');
  }
  // La OC es un control interno: una factura puede juntar remitos de varias.
  // El atajo facturas.orden_compra_id vale solo si es una; ver services/factura-oc.js.
  const ocs = [...new Set(ventas.map(v => v.orden_compra_id))];
  const ordenCompraId = ocs.length === 1 ? ocs[0] : null;

  // 2️⃣ Traer items de las ventas
  const itemsRes = await client.query(
    `SELECT vi.*, v.remito_numero
     FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id
     WHERE vi.venta_id = ANY($1)
     ORDER BY vi.venta_id, vi.id
     FOR UPDATE OF vi`,
    [ids]
  );

  if (!itemsRes.rows.length) {
    throw new Error('Los remitos seleccionados no tienen items');
  }

  const ventaItems = itemsRes.rows;

  // 3️⃣ Verificar que no estén facturados
  const facturadosRes = await client.query(
    `SELECT DISTINCT COALESCE(v.remito_numero, 'venta #' || v.id) AS remito
     FROM factura_venta_items fvi
     JOIN venta_items vi ON vi.id = fvi.venta_item_id
     JOIN ventas v ON v.id = vi.venta_id
     WHERE fvi.venta_item_id = ANY($1)`,
    [ventaItems.map(i => i.id)]
  );

  if (facturadosRes.rows.length > 0) {
    throw new Error(
      `Ya facturado: ${facturadosRes.rows.map(r => r.remito).join(', ')}`
    );
  }

  // 4️⃣ Precio a facturar por modelo
  let precioPorFicha = null;
  if (precios !== undefined && precios !== null) {
    if (!Array.isArray(precios)) throw new Error('Lista de precios inválida');

    precioPorFicha = new Map();
    for (const p of precios) {
      const pesos = Number(p.precio_unitario_pesos);
      const usd = p.precio_unitario_usd === undefined || p.precio_unitario_usd === null || p.precio_unitario_usd === ''
        ? null
        : Number(p.precio_unitario_usd);
      if (!pesos || isNaN(pesos) || pesos <= 0 || (usd !== null && (isNaN(usd) || usd < 0))) {
        throw new Error('Hay un precio inválido en la factura');
      }
      // Importe final con IVA de ese modelo, escrito a mano (opcional).
      const totalConIva = p.total_con_iva === undefined || p.total_con_iva === null || p.total_con_iva === ''
        ? null
        : Number(p.total_con_iva);
      if (totalConIva !== null && (isNaN(totalConIva) || totalConIva <= 0)) {
        throw new Error('Hay un total con IVA inválido en la factura');
      }
      precioPorFicha.set(Number(p.ficha_id), { pesos, usd, totalConIva });
    }

    const sinPrecio = ventaItems.filter(i => !precioPorFicha.has(Number(i.ficha_id)));
    if (sinPrecio.length) {
      throw new Error('Falta el precio de algún modelo de la factura');
    }
  }

  // 5️⃣ Obtener IVA actual
  const ivaPorcentaje = await getIVA(pool);

  // 6️⃣ Calcular totales (una línea por venta_item, para no perder de qué
  // remito salió cada unidad — lo usan las notas de crédito)
  let subtotal = 0;
  let ivaTotal = 0;
  let total = 0;

  // Modelos con el importe final (con IVA) escrito a mano, p. ej. al cargar
  // una factura vieja cuyo total no sale de cantidad × precio de lista. El
  // total, el IVA y el subtotal del modelo se reparten entre sus ítems de
  // remito según la cantidad; el último se queda con lo que sobra, así la
  // suma da exactamente el importe pedido.
  const repartoFijo = new Map();
  if (precioPorFicha) {
    for (const [fichaId, p] of precioPorFicha) {
      if (p.totalConIva === null) continue;
      const cantidadTotal = ventaItems
        .filter(i => Number(i.ficha_id) === fichaId)
        .reduce((acc, i) => acc + Number(i.cantidad), 0);
      const subModelo = parseFloat((p.totalConIva / (1 + ivaPorcentaje)).toFixed(2));
      repartoFijo.set(fichaId, {
        cantidadRestante: cantidadTotal,
        cantidadTotal,
        subTotal: subModelo,
        subRestante: subModelo,
        ivaTotal: parseFloat((p.totalConIva - subModelo).toFixed(2)),
        ivaRestante: parseFloat((p.totalConIva - subModelo).toFixed(2))
      });
    }
  }

  const calculos = ventaItems.map(item => {
    const precio = precioPorFicha
      ? precioPorFicha.get(Number(item.ficha_id))
      : { pesos: Number(item.precio_unitario_pesos), usd: item.precio_unitario_usd };

    // factura_venta_items.precio_unitario es numeric(15,2): se redondea
    // antes de multiplicar para que cantidad × precio guardado = subtotal.
    precio.pesos = parseFloat(precio.pesos.toFixed(2));

    let sub;
    let ivaItem;
    let tot;
    const fijo = repartoFijo.get(Number(item.ficha_id));
    if (fijo) {
      const ultimo = Number(item.cantidad) === fijo.cantidadRestante;
      sub = ultimo
        ? fijo.subRestante
        : parseFloat((fijo.subTotal * item.cantidad / fijo.cantidadTotal).toFixed(2));
      ivaItem = ultimo
        ? fijo.ivaRestante
        : parseFloat((fijo.ivaTotal * item.cantidad / fijo.cantidadTotal).toFixed(2));
      fijo.cantidadRestante -= Number(item.cantidad);
      fijo.subRestante = parseFloat((fijo.subRestante - sub).toFixed(2));
      fijo.ivaRestante = parseFloat((fijo.ivaRestante - ivaItem).toFixed(2));
      tot = parseFloat((sub + ivaItem).toFixed(2));
    } else {
      sub = parseFloat((item.cantidad * precio.pesos).toFixed(2));
      ivaItem = parseFloat((sub * ivaPorcentaje).toFixed(2));
      tot = parseFloat((sub + ivaItem).toFixed(2));
    }

    subtotal += sub;
    ivaTotal += ivaItem;
    total += tot;

    return {
      ...item,
      precioPesos: precio.pesos,
      precioUsd: precio.usd,
      sub,
      ivaItem,
      tot
    };
  });

  subtotal = parseFloat(subtotal.toFixed(2));
  ivaTotal = parseFloat(ivaTotal.toFixed(2));
  total = parseFloat(total.toFixed(2));

  // 7️⃣ Crear cabecera factura
  const facturaRes = await client.query(
    `INSERT INTO facturas
     (cliente_id, orden_compra_id, numero_factura, tipo_factura,
      fecha, dias_credito, tipo_cambio,
      subtotal_sin_iva, iva_21, total, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'EMITIDA')
     RETURNING *`,
    [
      venta.cliente_id,
      ordenCompraId,
      numero_factura,
      tipo_factura,
      fecha,
      diasCredito,
      tipoCambio,
      subtotal,
      ivaTotal,
      total
    ]
  );

  const factura = facturaRes.rows[0];

  // 8️⃣ Insertar factura_venta_items
  for (const item of calculos) {
    await client.query(
      `INSERT INTO factura_venta_items
       (factura_id, venta_item_id, ficha_id,
        cantidad, precio_unitario, precio_unitario_usd,
        subtotal, iva, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        factura.id,
        item.id,
        item.ficha_id,
        item.cantidad,
        item.precioPesos,
        item.precioUsd,
        item.sub,
        item.ivaItem,
        item.tot
      ]
    );
  }

  return factura;
}

module.exports = { crearFacturaDesdeRemitos };

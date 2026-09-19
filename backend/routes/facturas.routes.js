const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { getIVA } = require('../services/parametros');

router.use(verificarToken);

/* =========================
   CREAR FACTURA DESDE UNA O VARIAS VENTAS (REMITOS)
   ---------------------------------------------------------------
   Una factura puede agrupar varios remitos de la misma OC (entregas
   parciales). Body:
     venta_ids: [..]  (o venta_id, como enviaba la pantalla vieja)
     numero_factura, tipo_factura, fecha, dias_credito
     tipo_cambio      (opcional) cotización usada al facturar
     precios          (opcional) [{ ficha_id, precio_unitario_usd,
                                    precio_unitario_pesos }]
   El precio puede haber cambiado entre la entrega y la factura: si viene
   `precios`, se factura cada modelo a ese precio (sin IVA, en pesos); si
   no, al precio de la entrega. venta_items NO se modifica: queda como
   valor histórico de lo entregado.
========================= */
router.post('/', soloAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      venta_id,
      venta_ids,
      numero_factura,
      tipo_factura,
      fecha,
      dias_credito,
      tipo_cambio,
      precios
    } = req.body;

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

    // 1️⃣ Bloquear ventas: tienen que ser todas del mismo cliente y OC
    const ventasRes = await client.query(
      `SELECT * FROM ventas WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
      [ids]
    );

    if (ventasRes.rows.length !== ids.length) {
      throw new Error('Alguna de las ventas seleccionadas no existe');
    }

    const ventas = ventasRes.rows;
    const venta = ventas[0];

    if (ventas.some(v => v.cliente_id !== venta.cliente_id)) {
      throw new Error('Los remitos seleccionados son de clientes distintos');
    }
    if (ventas.some(v => v.orden_compra_id !== venta.orden_compra_id)) {
      throw new Error('Los remitos seleccionados son de órdenes de compra distintas');
    }

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
        precioPorFicha.set(Number(p.ficha_id), { pesos, usd });
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

    const calculos = ventaItems.map(item => {
      const precio = precioPorFicha
        ? precioPorFicha.get(Number(item.ficha_id))
        : { pesos: Number(item.precio_unitario_pesos), usd: item.precio_unitario_usd };

      // factura_venta_items.precio_unitario es numeric(15,2): se redondea
      // antes de multiplicar para que cantidad × precio guardado = subtotal.
      precio.pesos = parseFloat(precio.pesos.toFixed(2));
      const sub = parseFloat((item.cantidad * precio.pesos).toFixed(2));
      const ivaItem = parseFloat((sub * ivaPorcentaje).toFixed(2));
      const tot = parseFloat((sub + ivaItem).toFixed(2));

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
        venta.orden_compra_id,
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

    await client.query('COMMIT');

    res.json(factura);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando factura:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   OBTENER FACTURA DE VENTA
========================= */
router.get('/venta/:venta_id', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT DISTINCT
        f.id,
        f.numero_factura,
        f.tipo_factura,
        f.fecha,
        f.subtotal_sin_iva,
        f.iva_21,
        f.total,
        f.dias_credito
      FROM facturas f
      JOIN factura_venta_items fi ON fi.factura_id = f.id
      JOIN venta_items vi ON vi.id = fi.venta_item_id
      WHERE vi.venta_id = $1
      `,
      [req.params.venta_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay factura asociada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo factura:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

const IVA = 0.21;

/* =========================
   CREAR FACTURA DESDE ENTREGAS
========================= */
router.post('/', authorize(['admin','control']), async (req, res) => {

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      cliente_id,
      numero_factura,
      tipo_factura,
      fecha,
      dias_credito = 0,
      items
    } = req.body;

    if (!cliente_id || !numero_factura || !fecha || !items || items.length === 0) {
      throw new Error('Datos incompletos');
    }

    const ventaItemsIds = items.map(i => i.venta_item_id);

    const ventaItemsRes = await client.query(
      `SELECT * FROM venta_items WHERE id = ANY($1) FOR UPDATE`,
      [ventaItemsIds]
    );

    if (ventaItemsRes.rows.length !== ventaItemsIds.length) {
      throw new Error('Algún item no existe');
    }

    const ventaItems = ventaItemsRes.rows;

    const facturadosRes = await client.query(
      `SELECT venta_item_id FROM factura_items WHERE venta_item_id = ANY($1)`,
      [ventaItemsIds]
    );

    if (facturadosRes.rows.length > 0) {
      throw new Error('Alguno de los items ya fue facturado');
    }

    let subtotal = 0;
    let ivaTotal = 0;
    let total = 0;

    const calculos = ventaItems.map(item => {
      const sub = item.cantidad * item.precio_unitario_pesos;
      const ivaItem = parseFloat((sub * IVA).toFixed(2));
      const tot = parseFloat((sub + ivaItem).toFixed(2));

      subtotal += sub;
      ivaTotal += ivaItem;
      total += tot;

      return { ...item, sub, ivaItem, tot };
    });

    subtotal = parseFloat(subtotal.toFixed(2));
    ivaTotal = parseFloat(ivaTotal.toFixed(2));
    total = parseFloat(total.toFixed(2));

    const facturaRes = await client.query(
      `INSERT INTO facturas
       (cliente_id, numero_factura, tipo_factura,
        fecha, dias_credito,
        subtotal_sin_iva, iva_21, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        cliente_id,
        numero_factura,
        tipo_factura,
        fecha,
        dias_credito,
        subtotal,
        ivaTotal,
        total
      ]
    );

    const factura = facturaRes.rows[0];

    for (const item of calculos) {
      await client.query(
        `INSERT INTO factura_items
         (factura_id, venta_item_id, ficha_id,
          cantidad, precio_unitario_sin_iva,
          subtotal, iva_21, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          factura.id,
          item.id,
          item.ficha_id,
          item.cantidad,
          item.precio_unitario_pesos,
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
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

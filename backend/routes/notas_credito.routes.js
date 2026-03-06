const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

const IVA = 0.21;

/* =========================
   CREAR NOTA DE CRÉDITO
========================= */
router.post('/', authorize(['admin','control']), async (req, res) => {

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      factura_id,
      numero_nota,
      fecha,
      items
    } = req.body;

    if (!factura_id || !numero_nota || !fecha || !items || items.length === 0) {
      throw new Error('Datos incompletos');
    }

    /* 1️⃣ Bloquear factura */
    const facturaRes = await client.query(
      `SELECT total FROM facturas WHERE id = $1 FOR UPDATE`,
      [factura_id]
    );

    if (facturaRes.rows.length === 0) {
      throw new Error('Factura no encontrada');
    }

    /* 2️⃣ Calcular saldo actual (incluyendo NC previas) */
    const saldoRes = await client.query(
      `
      SELECT
        f.total
        - COALESCE(SUM(ap.monto_aplicado),0)
        - COALESCE(SUM(nc.total),0) AS saldo
      FROM facturas f
      LEFT JOIN aplicacion_pagos ap ON ap.factura_id = f.id
      LEFT JOIN notas_credito nc ON nc.factura_id = f.id
      WHERE f.id = $1
      GROUP BY f.id
      `,
      [factura_id]
    );

    const saldoActual = parseFloat(saldoRes.rows[0].saldo);

    let subtotal = 0;
    let ivaTotal = 0;
    let total = 0;

    for (const item of items) {

      const facturaItemRes = await client.query(
        `SELECT * FROM factura_items WHERE id = $1`,
        [item.factura_item_id]
      );

      if (facturaItemRes.rows.length === 0) {
        throw new Error('Item de factura inválido');
      }

      const facturaItem = facturaItemRes.rows[0];

      if (item.cantidad > facturaItem.cantidad) {
        throw new Error('Cantidad supera la facturada');
      }

      const sub = item.cantidad * facturaItem.precio_unitario_sin_iva;
      const ivaItem = parseFloat((sub * IVA).toFixed(2));
      const tot = sub + ivaItem;

      subtotal += sub;
      ivaTotal += ivaItem;
      total += tot;
    }

    if (total > saldoActual) {
      throw new Error('Nota supera saldo disponible');
    }

    /* 3️⃣ Crear cabecera */
    const notaRes = await client.query(
      `
      INSERT INTO notas_credito
      (factura_id, numero_nota, fecha, subtotal, iva_21, total)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [factura_id, numero_nota, fecha, subtotal, ivaTotal, total]
    );

    const nota = notaRes.rows[0];

    /* 4️⃣ Insertar items */
    for (const item of items) {

      const facturaItemRes = await client.query(
        `SELECT * FROM factura_items WHERE id = $1`,
        [item.factura_item_id]
      );

      const facturaItem = facturaItemRes.rows[0];

      const sub = item.cantidad * facturaItem.precio_unitario_sin_iva;
      const ivaItem = parseFloat((sub * IVA).toFixed(2));
      const tot = sub + ivaItem;

      await client.query(
        `
        INSERT INTO nota_credito_items
        (nota_credito_id, factura_item_id,
         cantidad, precio_unitario,
         subtotal, iva_21, total)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          nota.id,
          item.factura_item_id,
          item.cantidad,
          facturaItem.precio_unitario_sin_iva,
          sub,
          ivaItem,
          tot
        ]
      );
    }

    await client.query('COMMIT');

    res.json(nota);

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }

});

module.exports = router;

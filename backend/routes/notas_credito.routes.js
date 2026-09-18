const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { saldoFactura } = require('../services/cuenta-cliente');
const { getIVA } = require('../services/parametros');

router.use(verificarToken);

/* =========================
   CREAR NOTA DE CRÉDITO
========================= */
router.post('/', soloAdmin, async (req, res) => {

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

    /* 2️⃣ Saldo actual de la factura (incluye NC previas y cobros acreditados).
       La versión anterior hacía LEFT JOIN a aplicacion_pagos y a
       notas_credito en la misma consulta con SUM(): con más de un pago y
       más de una NC el producto cartesiano multiplicaba ambas sumas y el
       saldo salía mal. Ahora se usa el servicio compartido. */
    const factura = await saldoFactura(client, factura_id);
    if (!factura) throw new Error('Factura no encontrada');
    const saldoActual = parseFloat(factura.saldo);

    // IVA leído de parametros (igual que facturas.routes.js), en vez de
    // un 0.21 hardcodeado: si alguien cambia el IVA general, antes las
    // notas de crédito seguían calculando con el valor viejo.
    const ivaPorcentaje = await getIVA(client);

    let subtotal = 0;
    let ivaTotal = 0;
    let total = 0;

    for (const item of items) {

      const facturaItemRes = await client.query(
        `SELECT * FROM factura_venta_items WHERE id = $1`,
        [item.factura_item_id]
      );

      if (facturaItemRes.rows.length === 0) {
        throw new Error('Item de factura inválido');
      }

      const facturaItem = facturaItemRes.rows[0];

      if (item.cantidad > facturaItem.cantidad) {
        throw new Error('Cantidad supera la facturada');
      }

      // facturaItem.precio_unitario ya está SIN IVA: así lo calcula e
      // inserta facturas.routes.js. La columna precio_unitario_sin_iva
      // que se leía antes nunca la completaba ningún INSERT del sistema,
      // así que esto daba NaN y la validación de saldo de abajo nunca se
      // disparaba (hallazgo C3 de la auditoría).
      const sub = item.cantidad * facturaItem.precio_unitario;
      if (!Number.isFinite(sub)) {
        throw new Error(`El item ${facturaItem.id} no tiene precio unitario válido`);
      }
      const ivaItem = parseFloat((sub * ivaPorcentaje).toFixed(2));
      const tot = sub + ivaItem;

      subtotal += sub;
      ivaTotal += ivaItem;
      total += tot;
    }

    if (!Number.isFinite(total) || total <= 0) {
      throw new Error('Nota de crédito con montos inválidos');
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
        `SELECT * FROM factura_venta_items WHERE id = $1`,
        [item.factura_item_id]
      );

      const facturaItem = facturaItemRes.rows[0];

      const sub = item.cantidad * facturaItem.precio_unitario;
      const ivaItem = parseFloat((sub * ivaPorcentaje).toFixed(2));
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
          facturaItem.precio_unitario,
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

const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

/* CREAR PAGO Y APLICARLO */
router.post('/', authorize(['admin','control']), async (req, res) => {

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      cliente_id,
      fecha_recepcion,
      fecha_acreditacion,
      monto,
      medio_pago,
      referencia,
      banco,
      facturas
    } = req.body;

    if (!cliente_id || !fecha_recepcion || !monto || !medio_pago)
      throw new Error('Datos incompletos');

    /* Crear pago */
    const pagoRes = await client.query(
      `
      INSERT INTO pagos
      (cliente_id, fecha_recepcion, fecha_acreditacion,
       monto, medio_pago, referencia, banco)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        cliente_id,
        fecha_recepcion,
        fecha_acreditacion,
        monto,
        medio_pago,
        referencia,
        banco
      ]
    );

    const pago = pagoRes.rows[0];

    /* Aplicar a facturas */
    if (facturas && facturas.length > 0) {

      for (const f of facturas) {

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
          [f.factura_id]
        );

        const saldo = parseFloat(saldoRes.rows[0].saldo);

        if (f.monto_aplicado > saldo)
          throw new Error('Monto supera saldo disponible');

        await client.query(
          `
          INSERT INTO aplicacion_pagos
          (pago_id, factura_id, monto_aplicado)
          VALUES ($1,$2,$3)
          `,
          [pago.id, f.factura_id, f.monto_aplicado]
        );
      }
    }

    await client.query('COMMIT');

    res.json(pago);

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }

});

module.exports = router;

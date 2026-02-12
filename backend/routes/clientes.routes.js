const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

/* CREATE */
router.post('/', authorize(['admin', 'control']), async (req, res) => {
  const {
    nombre,
    cuit,
    telefono,
    correo,
    direccion,
    forma_pago,
    dias_max_pago,
    observaciones
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO clientes
       (nombre, cuit, telefono, correo, direccion,
        forma_pago, dias_max_pago, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        nombre,
        cuit || null,
        telefono || null,
        correo || null,
        direccion || null,
        forma_pago || null,
        dias_max_pago || null,
        observaciones || null
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* LIST */
router.get('/', authorize(['admin', 'control', 'operario']), async (req, res) => {
  const result = await pool.query('SELECT * FROM clientes ORDER BY nombre');
  res.json(result.rows);
});

/* GET ONE */
router.get('/:id', authorize(['admin', 'control', 'operario']), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM clientes WHERE id = $1',
    [req.params.id]
  );

  if (!result.rows.length)
    return res.status(404).json({ error: 'Cliente no encontrado' });

  res.json(result.rows[0]);
});

/* ESTADO FINANCIERO */
router.get('/:id/estado', authorize(['admin','control']), async (req, res) => {

  const { id } = req.params;

  const clienteCheck = await pool.query(
    'SELECT id, nombre FROM clientes WHERE id = $1',
    [id]
  );

  if (!clienteCheck.rows.length)
    return res.status(404).json({ error: 'Cliente no encontrado' });

  /* TOTAL FACTURADO NETO */
  const facturadoRes = await pool.query(
    `
    SELECT
      COALESCE(SUM(f.total),0)
      - COALESCE(SUM(nc.total),0) AS total_facturado
    FROM facturas f
    LEFT JOIN notas_credito nc ON nc.factura_id = f.id
    WHERE f.cliente_id = $1
    `,
    [id]
  );

  /* TOTAL PAGADO SOLO ACREDITADO */
  const pagadoRes = await pool.query(
    `
    SELECT COALESCE(SUM(ap.monto_aplicado),0) AS total_pagado
    FROM aplicacion_pagos ap
    JOIN facturas f ON f.id = ap.factura_id
    JOIN pagos p ON p.id = ap.pago_id
    WHERE f.cliente_id = $1
      AND p.estado = 'acreditado'
    `,
    [id]
  );

  const total_facturado = parseFloat(facturadoRes.rows[0].total_facturado);
  const total_pagado = parseFloat(pagadoRes.rows[0].total_pagado);
  const saldo = total_facturado - total_pagado;

  res.json({
    cliente: clienteCheck.rows[0],
    total_facturado,
    total_pagado,
    saldo
  });
});

/* =========================
   CUENTA CORRIENTE CLIENTE
   CON FILTRO Y CHEQUE PROFESIONAL
========================= */
router.get('/:id/cuenta-corriente', authorize(['admin','control']), async (req, res) => {

  const { id } = req.params;
  const { desde, hasta } = req.query;

  try {

    const clienteCheck = await pool.query(
      'SELECT id, nombre FROM clientes WHERE id = $1',
      [id]
    );

    if (!clienteCheck.rows.length)
      return res.status(404).json({ error: 'Cliente no encontrado' });

    let filtroFecha = '';
    let params = [id];

    if (desde) {
      params.push(desde);
      filtroFecha += ` AND fecha >= $${params.length}`;
    }

    if (hasta) {
      params.push(hasta);
      filtroFecha += ` AND fecha <= $${params.length}`;
    }

    const movimientosRes = await pool.query(
      `
      SELECT *
      FROM (

        -- FACTURAS
        SELECT
          f.fecha,
          'FACTURA' AS tipo,
          f.numero_factura AS numero,
          f.total AS debe,
          0 AS haber,
          NULL AS estado_pago
        FROM facturas f
        WHERE f.cliente_id = $1

        UNION ALL

        -- NOTAS DE CREDITO
        SELECT
          nc.fecha,
          'NOTA_CREDITO' AS tipo,
          nc.numero_nota AS numero,
          0 AS debe,
          nc.total AS haber,
          NULL AS estado_pago
        FROM notas_credito nc
        JOIN facturas f ON f.id = nc.factura_id
        WHERE f.cliente_id = $1

        UNION ALL

        -- PAGOS (SOLO RESTAN SI ACREDITADO)
        SELECT
          p.fecha_recepcion AS fecha,
          'PAGO' AS tipo,
          p.id::text AS numero,
          0 AS debe,
          CASE
            WHEN p.estado = 'acreditado'
            THEN p.monto
            ELSE 0
          END AS haber,
          p.estado AS estado_pago
        FROM pagos p
        WHERE p.cliente_id = $1

      ) movimientos
      WHERE 1=1
      ${filtroFecha}
      ORDER BY fecha, tipo
      `,
      params
    );

    let saldoAcumulado = 0;

    const movimientosConSaldo = movimientosRes.rows.map(m => {
      saldoAcumulado += parseFloat(m.debe) - parseFloat(m.haber);

      return {
        ...m,
        saldo: saldoAcumulado
      };
    });

    res.json({
      cliente: clienteCheck.rows[0],
      filtros: { desde: desde || null, hasta: hasta || null },
      movimientos: movimientosConSaldo
    });

  } catch (err) {
    console.error('Error cuenta corriente:', err);
    res.status(500).json({ error: err.message });
  }

});

module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { asyncHandler } = require('../middlewares/asyncHandler');
const { resumenCliente, cuentaCorriente } = require('../services/cuenta-cliente');

router.use(verificarToken);

/* CREATE */
router.post('/', soloAdmin, async (req, res) => {
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
router.get('/', soloAdmin, asyncHandler(async (req, res) => {
  const result = await pool.query('SELECT * FROM clientes ORDER BY nombre');
  res.json(result.rows);
}));

/* COUNT */
router.get('/count', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS total FROM clientes');
    res.json({
      total: result.rows[0]?.total || 0,
      usuarios_activos: 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET ONE */
router.get('/:id', soloAdmin, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'ID de cliente inválido' });
  }

  const result = await pool.query(
    'SELECT * FROM clientes WHERE id = $1',
    [id]
  );

  if (!result.rows.length)
    return res.status(404).json({ error: 'Cliente no encontrado' });

  res.json(result.rows[0]);
}));

/* ============================================
   ✅ UPDATE - ENDPOINT AGREGADO (FALTABA)
   ============================================ */
router.put('/:id', soloAdmin, async (req, res) => {
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
      `UPDATE clientes SET
        nombre = $1,
        cuit = $2,
        telefono = $3,
        correo = $4,
        direccion = $5,
        forma_pago = $6,
        dias_max_pago = $7,
        observaciones = $8
       WHERE id = $9
       RETURNING *`,
      [
        nombre,
        cuit || null,
        telefono || null,
        correo || null,
        direccion || null,
        forma_pago || null,
        dias_max_pago || null,
        observaciones || null,
        req.params.id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================
   ✅ DELETE - ENDPOINT AGREGADO (FALTABA)
   ============================================ */
router.delete('/:id', soloAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM clientes WHERE id = $1',
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json({ ok: true, deletedId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ESTADO FINANCIERO DEL CLIENTE
   Antes esta ruta sumaba solo los pagos con estado 'acreditado', un valor
   que el módulo de pagos nunca escribía: el total pagado daba siempre 0 y
   el saldo terminaba siendo igual al total facturado. Ahora delega en
   services/cuenta-cliente.js, que es la única definición de saldo del
   sistema (ver claude/modulo-pagos.md). */
router.get('/:id/estado', soloAdmin, async (req, res) => {
  try {
    const cliente = await pool.query(
      'SELECT id, nombre FROM clientes WHERE id = $1', [req.params.id]
    );
    if (!cliente.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const totales = await resumenCliente(pool, req.params.id);

    res.json({
      cliente: cliente.rows[0],
      total_facturado: parseFloat(totales.total_facturado),
      total_pagado: parseFloat(totales.total_cobrado),
      saldo: parseFloat(totales.saldo),
      // datos nuevos: lo que está vencido y lo que depende de un cheque
      vencido: parseFloat(totales.vencido),
      en_gestion: parseFloat(totales.en_gestion),
      saldo_a_favor: parseFloat(totales.saldo_a_favor),
      dias_atraso_max: totales.dias_atraso_max
    });
  } catch (err) {
    console.error('Error obteniendo estado del cliente:', err);
    res.status(500).json({ error: err.message });
  }
});

/* CUENTA CORRIENTE DEL CLIENTE
   Rompía siempre con "column p.monto does not exist" (la columna se llama
   monto_total). Ahora usa el mismo servicio que el módulo de Cobros, así
   los movimientos y el saldo acumulado coinciden con el panel de deuda. */
router.get('/:id/cuenta-corriente', soloAdmin, async (req, res) => {
  try {
    const cliente = await pool.query(
      'SELECT id, nombre FROM clientes WHERE id = $1', [req.params.id]
    );
    if (!cliente.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const movimientos = await cuentaCorriente(pool, req.params.id, req.query);

    res.json({
      cliente: cliente.rows[0],
      filtros: { desde: req.query.desde || null, hasta: req.query.hasta || null },
      movimientos
    });
  } catch (err) {
    console.error('Error en cuenta corriente:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

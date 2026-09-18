const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { asyncHandler } = require('../middlewares/asyncHandler');
const { resumenCliente } = require('../services/cuenta-cliente');

router.use(verificarToken);

/* Saldo por cliente.
 *
 * Antes esta consulta tenía tres problemas (hallazgo C6 de la auditoría):
 * leía vi.precio_unitario, columna que no existe (venta_items tiene
 * precio_unitario_usd / precio_unitario_pesos); sumaba desde
 * pagos_clientes, la tabla legacy que ya nadie escribe (el circuito nuevo
 * es pagos + pago_items + aplicacion_pagos), así que "total pagado"
 * siempre daba 0; y hacía un producto cartesiano entre venta_items y
 * pagos_clientes, multiplicando ambas sumas. En vez de parchear la
 * consulta, se usa el servicio compartido — la única definición de saldo
 * del sistema — para que este endpoint dé siempre lo mismo que
 * GET /api/cobros/clientes/:id y GET /api/clientes/:id/estado. */
router.get('/saldo/cliente/:cliente_id', soloAdmin, asyncHandler(async (req, res) => {
  const cli = await pool.query('SELECT id, nombre FROM clientes WHERE id = $1', [req.params.cliente_id]);
  if (!cli.rows.length) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }

  const t = await resumenCliente(pool, req.params.cliente_id);

  res.json({
    cliente_id: cli.rows[0].id,
    nombre: cli.rows[0].nombre,
    total_vendido: parseFloat(t.total_facturado),
    total_pagado: parseFloat(t.total_cobrado),
    saldo: parseFloat(t.saldo)
  });
}));

module.exports = router;

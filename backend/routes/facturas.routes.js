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

    /* 1️⃣ Traer y bloquear entrega_items */
    const ventaItemsRes = await client.query(
      `
      SELECT vi.*
      FROM venta_items vi
      WHERE vi.id = ANY($1)
      FOR UPDATE
      `,
      [ventaItemsIds]
    );

    if (ventaItemsRes.rows.length !== ventaItemsIds.length) {
      throw new Error('Algún item no existe');
    }

    const ventaItems = ventaItemsRes.rows;

    /* 2️⃣ Verificar que no estén facturados */
    const facturadosRes = await client.query(
      `
      SELECT venta_item_id
      FROM factura_items
      WHERE venta_item_id = ANY($1)
      `,
      [ventaItemsIds]
    );

    if (facturadosRes.rows.length > 0) {
      throw new Error('Alguno de los items ya fue facturado');
    }

    /* 3️⃣ Calcular totales */
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

      return {
        ...item,
        sub,
        ivaItem,
        tot
      };
    });

    subtotal = parseFloat(subtotal.toFixed(2));
    ivaTotal = parseFloat(ivaTotal.toFixed(2));
    total = parseFloat(total.toFixed(2));

    /* 4️⃣ Crear factura */
    const facturaRes = await client.query(
      `
      INSERT INTO facturas
      (cliente_id, numero_factura, tipo_factura,
       fecha, dias_credito,
       subtotal_sin_iva, iva_21, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
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

    /* 5️⃣ Insertar factura_items */
    for (const item of calculos) {
      await client.query(
        `
        INSERT INTO factura_items
        (factura_id, venta_item_id, ficha_id,
         cantidad, precio_unitario_sin_iva,
         subtotal, iva_21, total)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
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

/* =========================
   OBTENER FACTURA COMPLETA
========================= */
router.get('/:id', authorize(['admin','control']), async (req, res) => {

  const { id } = req.params;

  try {

    /* 1️⃣ Traer cabecera */
    const facturaRes = await pool.query(
      `
      SELECT
        f.*,
        (CURRENT_DATE - f.fecha) AS dias_desde_factura,
        (f.fecha + f.dias_credito) AS fecha_vencimiento
      FROM facturas f
      WHERE f.id = $1
      `,
      [id]
    );

    if (facturaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const factura = facturaRes.rows[0];

    /* 2️⃣ Traer items */
    const itemsRes = await pool.query(
      `
      SELECT
        fi.*,
        f.descripcion AS modelo
      FROM factura_items fi
      JOIN fichas f ON f.id = fi.ficha_id
      WHERE fi.factura_id = $1
      `,
      [id]
    );

    /* 3️⃣ Calcular total pagado */
    const pagosRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(monto_aplicado),0) AS total_pagado
      FROM aplicacion_pagos
      WHERE factura_id = $1
      `,
      [id]
    );

    const total_pagado = parseFloat(pagosRes.rows[0].total_pagado);
    const saldo = parseFloat(factura.total) - total_pagado;

    res.json({
      ...factura,
      items: itemsRes.rows,
      total_pagado,
      saldo
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }

});


router.get('/pendiente/:oc_id', authorize(['admin','control']), async (req, res) => {

  const { oc_id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        v.id AS entrega_id,
        v.fecha AS fecha_entrega,
        vi.id AS venta_item_id,
        vi.ficha_id,
        vi.cantidad,
        vi.precio_unitario_pesos,
        (vi.cantidad * vi.precio_unitario_pesos) AS subtotal
      FROM ventas v
      JOIN venta_items vi ON vi.venta_id = v.id
      LEFT JOIN factura_items fi ON fi.venta_item_id = vi.id
      WHERE v.orden_compra_id = $1
        AND fi.id IS NULL
      ORDER BY v.fecha
      `,
      [oc_id]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }

});


module.exports = router;

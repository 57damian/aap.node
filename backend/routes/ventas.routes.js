const express = require('express');
const router = express.Router();
const pool = require('../db');
const authorize = require('../middlewares/authorize');

/* =========================
   LISTAR VENTAS
========================= */
router.get('/', authorize(['admin','control']), async (req, res) => {

  const { cliente_id } = req.query;

  try {

    let query = `
      SELECT
        v.id,
        v.fecha_factura AS fecha,
        c.nombre AS cliente,
        oc.numero_oc,
        v.numero_factura
      FROM ventas v
      JOIN clientes c ON c.id = v.cliente_id
      JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
    `;

    const params = [];

    if (cliente_id) {
      query += ` WHERE v.cliente_id = $1`;
      params.push(cliente_id);
    }

    query += ` ORDER BY v.id DESC`;

    const result = await pool.query(query, params);

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   ESTADO FACTURACIÓN VENTA
========================= */
router.get('/:id/estado-facturacion', authorize(['admin','control']), async (req, res) => {

  const { id } = req.params;

  try {

    const result = await pool.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM factura_items fi
        JOIN venta_items vi ON vi.id = fi.venta_item_id
        WHERE vi.venta_id = $1
      ) AS facturada
      `,
      [id]
    );

    res.json({ facturada: result.rows[0].facturada });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



/* =========================
   DETALLE VENTA
========================= */
router.get('/:id', authorize(['admin','control']), async (req, res) => {

  const { id } = req.params;

  try {

    const ventaRes = await pool.query(
      `
      SELECT
        v.*,
        c.nombre AS cliente,
        oc.numero_oc
      FROM ventas v
      JOIN clientes c ON c.id = v.cliente_id
      JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
      WHERE v.id = $1
      `,
      [id]
    );

    if (!ventaRes.rows.length) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const itemsRes = await pool.query(
      `
      SELECT
        vi.*,
        f.modelo
      FROM venta_items vi
      JOIN ficha_transformador f ON f.id = vi.ficha_id
      WHERE vi.venta_id = $1
      `,
      [id]
    );

    res.json({
      ...ventaRes.rows[0],
      items: itemsRes.rows
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   CREAR VENTA
========================= */
router.post('/', authorize(['admin', 'control']), async (req, res) => {

  const { orden_compra_id, tipo_cambio, numero_factura, fecha_factura, tipo_factura } = req.body;

  if (!orden_compra_id || !tipo_cambio) {
    return res.status(400).json({
      error: 'orden_compra_id y tipo_cambio son obligatorios'
    });
  }

  try {

    const oc = await pool.query(
      `SELECT cliente_id
       FROM ordenes_compra
       WHERE id = $1`,
      [orden_compra_id]
    );

    if (!oc.rows.length) {
      return res.status(404).json({ error: 'Orden de compra no encontrada' });
    }

    const cliente_id = oc.rows[0].cliente_id;

    const result = await pool.query(
      `INSERT INTO ventas
       (cliente_id, orden_compra_id, tipo_cambio, numero_factura, fecha_factura, tipo_factura)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [cliente_id, orden_compra_id, tipo_cambio, numero_factura, fecha_factura, tipo_factura]
    );

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   AGREGAR ITEMS
========================= */
router.post('/:venta_id/items', authorize(['admin', 'control']), async (req, res) => {

  const { ficha_id, cantidad } = req.body;
  const { venta_id } = req.params;

  if (!ficha_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Datos de ítem inválidos' });
  }

  try {

    const ventaRes = await pool.query(
      `SELECT orden_compra_id, tipo_cambio
       FROM ventas
       WHERE id = $1`,
      [venta_id]
    );

    if (!ventaRes.rows.length) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const { orden_compra_id, tipo_cambio } = ventaRes.rows[0];

    const ocItemRes = await pool.query(
      `SELECT
         oci.cantidad_pedida,
         COALESCE(SUM(vi.cantidad),0) AS cantidad_entregada
       FROM orden_compra_items oci
       LEFT JOIN ventas v ON v.orden_compra_id = oci.orden_compra_id
       LEFT JOIN venta_items vi
         ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
       WHERE oci.orden_compra_id = $1
         AND oci.ficha_id = $2
       GROUP BY oci.cantidad_pedida`,
      [orden_compra_id, ficha_id]
    );

    if (!ocItemRes.rows.length) {
      return res.status(400).json({
        error: 'El modelo no pertenece a la orden de compra'
      });
    }

    const { cantidad_pedida, cantidad_entregada } = ocItemRes.rows[0];
    const pendiente = cantidad_pedida - cantidad_entregada;

    if (cantidad > pendiente) {
      return res.status(400).json({
        error: `Cantidad supera el pendiente (${pendiente})`
      });
    }

    const precioRes = await pool.query(
      `SELECT precio
       FROM precios_modelo
       WHERE ficha_id = $1
       ORDER BY fecha_desde DESC
       LIMIT 1`,
      [ficha_id]
    );

    if (!precioRes.rows.length) {
      return res.status(400).json({
        error: 'No hay precio definido para este modelo'
      });
    }

    const precio_usd = precioRes.rows[0].precio;
    const precio_pesos = precio_usd * tipo_cambio;

    const result = await pool.query(
      `INSERT INTO venta_items
       (venta_id, ficha_id, cantidad, precio_unitario_usd, precio_unitario_pesos)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [venta_id, ficha_id, cantidad, precio_usd, precio_pesos]
    );

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/remito', authorize(['admin','control']), async (req,res)=>{
  const { remito_numero, remito_fecha, remito_observaciones } = req.body;

  try {
    const result = await pool.query(
      `UPDATE ventas
       SET remito_numero=$1,
           remito_fecha=$2,
           remito_observaciones=$3
       WHERE id=$4
       RETURNING *`,
      [remito_numero, remito_fecha, remito_observaciones, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




module.exports = router;

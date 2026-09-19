const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { asyncHandler } = require('../middlewares/asyncHandler');

router.use(verificarToken);

/* =========================
   LISTAR VENTAS
========================= */
router.get('/', soloAdmin, async (req, res) => {

  const { cliente_id, orden_compra_id } = req.query;

  try {

    let query = `
      SELECT 
        v.id,
        v.fecha,
        v.tipo_cambio,
        v.remito_numero,
        v.remito_fecha,
        v.remito_observaciones,
        c.nombre AS cliente,
        oc.numero_oc,
        (
          SELECT f.numero_factura
          FROM factura_venta_items fi
          JOIN facturas f ON f.id = fi.factura_id
          JOIN venta_items vi ON vi.id = fi.venta_item_id
          WHERE vi.venta_id = v.id
          LIMIT 1
        ) AS numero_factura
      FROM ventas v
      JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (cliente_id) {
      query += ` AND v.cliente_id = $${paramIndex}`;
      params.push(cliente_id);
      paramIndex++;
    }

    if (orden_compra_id) {
      query += ` AND v.orden_compra_id = $${paramIndex}`;
      params.push(orden_compra_id);
      paramIndex++;
    }

    query += ` ORDER BY v.id DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   CREAR VENTA (ENTREGA) - CORREGIDO
========================= */
router.post('/', soloAdmin, async (req, res) => {
  const {
    orden_compra_id,
    tipo_cambio,
    remito_numero,
    remito_fecha,
    remito_observaciones,
    items
  } = req.body;

  if (!orden_compra_id) {
    return res.status(400).json({ error: 'Falta orden de compra' });
  }

  if (remito_numero && !remito_fecha) {
    return res.status(400).json({ error: 'Si ingresa número de remito, la fecha es obligatoria' });
  }

  if (items !== undefined && (!Array.isArray(items) || !items.length)) {
    return res.status(400).json({ error: 'La lista de items no es válida' });
  }

  // La venta y sus items se crean en la misma transacción: antes eran dos
  // pasos separados (POST / y POST /:id/items por cada item) y si un item
  // fallaba (stock insuficiente, modelo sin precio) quedaba una venta con el
  // remito ya asignado pero sin ningún item — un remito fantasma que además
  // dejaba el número de remito "gastado".
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener el cliente de la OC
    const clienteRes = await client.query(
      `SELECT cliente_id FROM ordenes_compra WHERE id = $1`,
      [orden_compra_id]
    );

    if (!clienteRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }

    const cliente_id = clienteRes.rows[0].cliente_id;

    // ✅ USAR EL TIPO DE CAMBIO RECIBIDO (DEL FRONTEND)
    let tipoCambio = parseFloat(tipo_cambio);

    // Si no viene tipo_cambio, obtener el último registrado. Antes había
    // un fallback hardcodeado (1415.00) que dejaba cargar una venta con
    // un dólar inventado de hace meses si no había cotización — ahora se
    // rechaza explícitamente (hallazgo D8 de la auditoría).
    if (!tipoCambio || isNaN(tipoCambio)) {
      const dolarRes = await client.query(
        "SELECT valor FROM parametros WHERE clave = 'dolar_banco'"
      );
      if (!dolarRes.rows.length || !parseFloat(dolarRes.rows[0].valor)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'No hay cotización del dólar cargada. Cargala en Precios antes de registrar la venta.'
        });
      }
      tipoCambio = parseFloat(dolarRes.rows[0].valor);
    }

    const ventaRes = await client.query(
      `INSERT INTO ventas
       (cliente_id, orden_compra_id, tipo_cambio, remito_numero, remito_fecha, remito_observaciones)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        cliente_id,
        orden_compra_id,
        tipoCambio,
        remito_numero || null,
        remito_fecha || null,
        remito_observaciones || null
      ]
    );
    const venta = ventaRes.rows[0];
    venta.items = [];

    if (items && items.length) {
      for (const it of items) {
        const fichaId = Number.parseInt(it.ficha_id, 10);
        const cantidad = Number.parseInt(it.cantidad, 10);

        if (!fichaId || !cantidad || cantidad <= 0) {
          const e = new Error('Datos de item incompletos');
          e.status = 400;
          throw e;
        }

        const precioRes = await client.query(
          `SELECT precio FROM precios_modelo WHERE ficha_id = $1 ORDER BY fecha_desde DESC LIMIT 1`,
          [fichaId]
        );

        if (!precioRes.rows.length) {
          const modeloRes = await client.query(
            `SELECT modelo FROM ficha_transformador WHERE id = $1`,
            [fichaId]
          );
          const nombreModelo = modeloRes.rows[0]?.modelo || `ficha ${fichaId}`;
          const e = new Error(`El modelo ${nombreModelo} no tiene precio cargado`);
          e.status = 400;
          throw e;
        }

        const precio_usd = precioRes.rows[0].precio;
        const precio_pesos = precio_usd * tipoCambio;

        // Si la cantidad supera el stock disponible, trigger_verificar_stock
        // (sobre venta_items) rechaza el INSERT con una excepción — el
        // ROLLBACK del catch se lleva puesta también la venta recién creada.
        const itemRes = await client.query(
          `INSERT INTO venta_items
           (venta_id, ficha_id, cantidad, precio_unitario_usd, precio_unitario_pesos)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [venta.id, fichaId, cantidad, precio_usd, precio_pesos]
        );
        venta.items.push(itemRes.rows[0]);
      }
    }

    await client.query('COMMIT');
    res.json(venta);

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});


/* =========================
   AGREGAR ITEM A VENTA
========================= */
router.post('/:id/items', soloAdmin, async (req, res) => {

  const { ficha_id, cantidad } = req.body;

  if (!ficha_id || !cantidad)
    return res.status(400).json({ error: 'Datos incompletos' });

  try {

    const precioRes = await pool.query(
      `
      SELECT precio
      FROM precios_modelo
      WHERE ficha_id = $1
      ORDER BY fecha_desde DESC
      LIMIT 1
      `,
      [ficha_id]
    );

    if (!precioRes.rows.length)
      return res.status(400).json({ error: 'Modelo sin precio' });

    const precio_usd = precioRes.rows[0].precio;

    const ventaRes = await pool.query(
      `SELECT tipo_cambio FROM ventas WHERE id = $1`,
      [req.params.id]
    );

    if (!ventaRes.rows.length) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const tipo_cambio = ventaRes.rows[0].tipo_cambio;
    const precio_pesos = precio_usd * tipo_cambio;

    const result = await pool.query(
      `
      INSERT INTO venta_items
      (venta_id, ficha_id, cantidad,
       precio_unitario_usd, precio_unitario_pesos)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [
        req.params.id,
        ficha_id,
        cantidad,
        precio_usd,
        precio_pesos
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   DETALLE VENTA
========================= */
router.get('/:id', soloAdmin, async (req, res) => {

  try {

    const ventaRes = await pool.query(
      `
      SELECT
        v.*,
        c.nombre AS cliente,
        oc.numero_oc
      FROM ventas v
      JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN ordenes_compra oc ON oc.id = v.orden_compra_id
      WHERE v.id = $1
      `,
      [req.params.id]
    );

    if (!ventaRes.rows.length)
      return res.status(404).json({ error: 'Venta no encontrada' });

    const itemsRes = await pool.query(
      `
      SELECT
        vi.*,
        f.modelo
      FROM venta_items vi
      JOIN ficha_transformador f ON f.id = vi.ficha_id
      WHERE vi.venta_id = $1
      `,
      [req.params.id]
    );

    const venta = ventaRes.rows[0];
    venta.items = itemsRes.rows;

    res.json(venta);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   ESTADO FACTURACIÓN
========================= */
router.get('/:id/estado-facturacion', soloAdmin, asyncHandler(async (req, res) => {

  const result = await pool.query(
    `
    SELECT EXISTS (
      SELECT 1
      FROM factura_venta_items fi
      JOIN venta_items vi ON vi.id = fi.venta_item_id
      WHERE vi.venta_id = $1
    ) AS facturada
    `,
    [req.params.id]
  );

  res.json({ facturada: result.rows[0].facturada });

}));


/* =========================
   GUARDAR REMITO
========================= */
router.put('/:id/remito', soloAdmin, asyncHandler(async (req, res) => {

  const {
    remito_numero,
    remito_fecha,
    remito_observaciones
  } = req.body;

  const result = await pool.query(
    `
    UPDATE ventas
    SET remito_numero=$1,
        remito_fecha=$2,
        remito_observaciones=$3
    WHERE id=$4
    RETURNING id
    `,
    [
      remito_numero || null,
      remito_fecha || null,
      remito_observaciones || null,
      req.params.id
    ]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Venta no encontrada' });
  }

  res.json({ ok: true });

}));

/* =========================
   OBTENER FACTURA DE VENTA
========================= */
router.get('/:id/factura', soloAdmin, async (req, res) => {
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
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay factura asociada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

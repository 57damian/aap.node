const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);




// ✅ OBTENER IVA DE LA BASE DE DATOS
async function getIVA() {
  try {
    const result = await pool.query(
      "SELECT valor FROM parametros WHERE clave = 'iva_general'"
    );
    return result.rows.length > 0 ? parseFloat(result.rows[0].valor) / 100 : 0.21;
  } catch (err) {
    console.error('Error obteniendo IVA:', err);
    return 0.21;
  }
}

/* =========================
   CREAR FACTURA DESDE VENTA
========================= */
router.post('/', authorize(['admin','control']), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const {
      venta_id,
      numero_factura,
      tipo_factura,
      fecha,
      dias_credito = 0
    } = req.body;

    if (!venta_id || !numero_factura || !tipo_factura || !fecha) {
      throw new Error('Datos incompletos');
    }

    // 1️⃣ Bloquear venta
    const ventaRes = await client.query(
      `SELECT * FROM ventas WHERE id = $1 FOR UPDATE`,
      [venta_id]
    );

    if (!ventaRes.rows.length) {
      throw new Error('Venta no encontrada');
    }

    const venta = ventaRes.rows[0];

    // 2️⃣ Traer items de la venta
    const itemsRes = await client.query(
      `SELECT * FROM venta_items 
       WHERE venta_id = $1
       FOR UPDATE`,
      [venta_id]
    );

    if (!itemsRes.rows.length) {
      throw new Error('La venta no tiene items');
    }

    const ventaItems = itemsRes.rows;

    // 3️⃣ Verificar que no estén facturados
    const ventaItemIds = ventaItems.map(i => i.id);

    const facturadosRes = await client.query(
      `SELECT venta_item_id
       FROM factura_items
       WHERE venta_item_id = ANY($1)`,
      [ventaItemIds]
    );

    if (facturadosRes.rows.length > 0) {
      throw new Error('La venta ya fue facturada');
    }

    // 4️⃣ Obtener IVA actual
    const ivaPorcentaje = await getIVA();
    
    // 5️⃣ Calcular totales
    let subtotal = 0;
    let ivaTotal = 0;
    let total = 0;

    const calculos = ventaItems.map(item => {
      const sub = item.cantidad * item.precio_unitario_pesos;
      const ivaItem = parseFloat((sub * ivaPorcentaje).toFixed(2));
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

    // 6️⃣ Crear cabecera factura
    const facturaRes = await client.query(
      `INSERT INTO facturas
       (cliente_id, numero_factura, tipo_factura,
        fecha, dias_credito,
        subtotal_sin_iva, iva_21, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        venta.cliente_id,
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

    // 7️⃣ Insertar factura_items
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
    console.error('Error creando factura:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   OBTENER FACTURA DE VENTA
========================= */
router.get('/venta/:venta_id', authorize(['admin','control']), async (req, res) => {
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
      JOIN factura_items fi ON fi.factura_id = f.id
      JOIN venta_items vi ON vi.id = fi.venta_item_id
      WHERE vi.venta_id = $1
      `,
      [req.params.venta_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No hay factura asociada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo factura:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
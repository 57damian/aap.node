const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

// =====================================================
// CREAR COMPRA CON ITEMS + STOCK + HISTORIAL DE PRECIOS
// =====================================================
// Usa tus tablas reales:
// - compras
// - compra_items
// - materias_primas
// - stock_movimientos
// - precios_materia_prima

router.post('/', authorize(['admin', 'control']), async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      proveedor_id,
      fecha_compra,
      numero_comprobante,
      moneda = 'ARS',
      observaciones,
      items
    } = req.body;

    if (!proveedor_id || !fecha_compra || !items || !items.length) {
      return res.status(400).json({ error: 'Faltan datos obligatorios de la compra o no hay items' });
    }

    await client.query('BEGIN');

    // Usuario que registra (opcional, tomado del token si está)
    const usuarioId = req.usuario ? req.usuario.id : null;

    // 1) Crear cabecera de compra con total 0, luego actualizamos
    const compraRes = await client.query(
      `
      INSERT INTO compras
        (proveedor_id, fecha_compra, numero_comprobante, moneda, total, observaciones, created_by)
      VALUES ($1, $2, $3, $4, 0, $5, $6)
      RETURNING *
      `,
      [proveedor_id, fecha_compra, numero_comprobante || null, moneda, observaciones || null, usuarioId]
    );

    const compra = compraRes.rows[0];

    let totalCompra = 0;
    const itemsInsertados = [];
    const variacionesPrecio = [];

    // 2) Insertar items + movimientos de stock + control de precio de referencia
    for (const item of items) {
      const {
        materia_prima_id,
        descripcion,
        unidad, // 'UNI' o 'KG', por ejemplo
        cantidad,
        precio_unitario,
        observaciones_item
      } = item;

      if (!materia_prima_id || !unidad || !cantidad || !precio_unitario) {
        throw new Error('Datos incompletos en un item de compra');
      }

      const subtotal = Number(cantidad) * Number(precio_unitario);
      totalCompra += subtotal;

      // 2.1) Insertar item de compra
      const itemRes = await client.query(
        `
        INSERT INTO compra_items
          (compra_id, materia_prima_id, descripcion, unidad, cantidad, precio_unitario, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [
          compra.id,
          materia_prima_id,
          descripcion || null,
          unidad,
          cantidad,
          precio_unitario,
          subtotal
        ]
      );

      const compraItem = itemRes.rows[0];
      itemsInsertados.push(compraItem);

      // 2.2) Insertar movimiento de stock de materia prima (entrada por COMPRA)
      await client.query(
        `
        INSERT INTO stock_movimientos
          (materia_prima_id, fecha_movimiento, tipo_movimiento, cantidad, unidad, compra_item_id, observaciones, usuario_id)
        VALUES ($1, $2, 'COMPRA', $3, $4, $5, $6, $7)
        `,
        [
          materia_prima_id,
          fecha_compra,
          cantidad,
          unidad,
          compraItem.id,
          observaciones_item || observaciones || null,
          usuarioId
        ]
      );

      // 2.2.1) Actualizar stock_actual en materias_primas
      await client.query(
        `
        UPDATE materias_primas
        SET stock_actual = COALESCE(stock_actual, 0) + $1,
            actualizado_en = NOW()
        WHERE id = $2
        `,
        [cantidad, materia_prima_id]
      );

      // 2.2.2) Actualizar productos_stock (stock por proveedor)
      await client.query(`
        INSERT INTO productos_stock 
          (materia_prima_id, proveedor_id, stock_actual, ultima_compra_id, ultimo_precio, fecha_ultima_actualizacion)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (materia_prima_id, proveedor_id)
        DO UPDATE SET
          stock_actual = productos_stock.stock_actual + $3,
          ultima_compra_id = EXCLUDED.ultima_compra_id,
          ultimo_precio = EXCLUDED.ultimo_precio,
          fecha_ultima_actualizacion = NOW()
      `, [materia_prima_id, proveedor_id, cantidad, compra.id, precio_unitario]);

      // 2.3) Control / historial de precio de referencia
      const precioRefRes = await client.query(
        `
        SELECT id, precio_unitario, fecha_desde
        FROM precios_materia_prima
        WHERE materia_prima_id = $1
        ORDER BY fecha_desde DESC
        LIMIT 1
        `,
        [materia_prima_id]
      );

      const precioActual = Number(precio_unitario);
      let huboVariacion = false;
      let precioAnterior = null;

      if (precioRefRes.rows.length === 0) {
        // No había precio registrado -> insertamos el primero
        await client.query(
          `
          INSERT INTO precios_materia_prima
            (materia_prima_id, fecha_desde, precio_unitario, proveedor_id, moneda)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [materia_prima_id, fecha_compra, precioActual, proveedor_id, moneda]
        );
      } else {
        const ref = precioRefRes.rows[0];
        precioAnterior = Number(ref.precio_unitario);

        if (precioAnterior !== precioActual) {
          huboVariacion = true;
          // Registrar nueva fila de precio con la nueva fecha
          await client.query(
            `
            INSERT INTO precios_materia_prima
              (materia_prima_id, fecha_desde, precio_unitario, proveedor_id, moneda)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [materia_prima_id, fecha_compra, precioActual, proveedor_id, moneda]
          );
        }
      }

      if (huboVariacion) {
        variacionesPrecio.push({
          materia_prima_id,
          compra_item_id: compraItem.id,
          precio_anterior: precioAnterior,
          precio_nuevo: precioActual
        });
      }
    }

    // 3) Actualizar total de la compra
    await client.query(
      `
      UPDATE compras
      SET total = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [totalCompra, compra.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      compra: {
        ...compra,
        total: totalCompra
      },
      items: itemsInsertados,
      variaciones_precio: variacionesPrecio
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando compra:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;


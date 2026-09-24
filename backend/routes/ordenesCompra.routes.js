const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { vistaPreviaAnulacionOC, anularOC } = require('../services/anulaciones');

router.use(verificarToken);
// La foto de la OC va a uploads/ordenes_compra (antes caía en uploads/modelos
// y la ruta guardada en la base no coincidía con el archivo).
const upload = require('../middlewares/uploadImagen').crearUpload('ordenes_compra');


router.get(
  '/',
  soloAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT oc.id, oc.numero_oc, oc.fecha_oc, oc.estado, c.nombre AS cliente,
          (
            -- El número/fecha de la OC los pone cada cliente al hacer el
            -- pedido (no es un correlativo del sistema), así que no sirven
            -- para saber qué se cargó más reciente: se ordena por oc.id
            -- (serial, ya refleja el orden real de alta) más abajo, y acá
            -- se trae de una vez qué remitos tiene, para no tener que
            -- entrar al detalle solo para saber si ya se entregó.
            SELECT COALESCE(json_agg(v.remito_numero ORDER BY v.remito_numero), '[]'::json)
            FROM ventas v
            WHERE v.orden_compra_id = oc.id AND v.anulada_en IS NULL AND v.remito_numero IS NOT NULL
          ) AS remitos
         FROM ordenes_compra oc
         JOIN clientes c ON c.id = oc.cliente_id
         ORDER BY oc.id DESC`
      );

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);


// El alta antes solo creaba la cabecera: los items del pedido se cargaban
// aparte, en oc_detalle.html, obligando a crear la OC, volver a la lista y
// clickear "Ver" para recién ahí poder cargarlos. Ahora oc.html manda los
// items ya armados (mismo patrón que pedidos-proveedor.routes.js) y acá se
// insertan junto con la cabecera, en una sola transacción. `items` es
// opcional (una OC sin items todavía es válida, se pueden seguir agregando
// después desde el detalle).
function normalizarItemsOC(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) {
    throw Object.assign(new Error('Los items tienen que ser una lista'), { status: 400 });
  }
  return raw.map((it, i) => {
    const fichaId = Number.parseInt(it.ficha_id, 10);
    const cantidad = Number.parseInt(it.cantidad_pedida, 10);
    if (!Number.isInteger(fichaId) || fichaId <= 0) {
      throw Object.assign(new Error(`Ítem ${i + 1}: falta el modelo`), { status: 400 });
    }
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      throw Object.assign(new Error(`Ítem ${i + 1}: la cantidad tiene que ser un entero positivo`), { status: 400 });
    }
    return { ficha_id: fichaId, cantidad_pedida: cantidad };
  });
}

router.post(
  '/',
  soloAdmin,
  upload.single('foto_oc'),
  async (req, res) => {
    const { cliente_id, numero_oc, fecha_oc, observaciones } = req.body;

    if (!cliente_id || !numero_oc || !fecha_oc) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    let items;
    try {
      items = normalizarItemsOC(req.body.items);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const foto = req.file
      ? `uploads/ordenes_compra/${req.file.filename}`
      : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO ordenes_compra
         (cliente_id, numero_oc, fecha_oc, foto_oc, observaciones)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [cliente_id, numero_oc, fecha_oc, foto, observaciones]
      );
      const oc = result.rows[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO orden_compra_items (orden_compra_id, ficha_id, cantidad_pedida)
           VALUES ($1,$2,$3)
           ON CONFLICT (orden_compra_id, ficha_id)
           DO UPDATE SET cantidad_pedida = orden_compra_items.cantidad_pedida + EXCLUDED.cantidad_pedida`,
          [oc.id, item.ficha_id, item.cantidad_pedida]
        );
      }

      await client.query('COMMIT');
      res.json(oc);
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);


router.post(
  '/:id/items',
  soloAdmin,
  async (req, res) => {
    const { ficha_id, cantidad_pedida } = req.body;

    // Antes no se validaba nada acá: un ficha_id vacío o una cantidad no
    // numérica llegaban directo al INSERT y salían como 500 (hallazgo C4).
    const cantidad = parseInt(cantidad_pedida, 10);
    if (!ficha_id || !Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'Falta el modelo o la cantidad no es un entero positivo' });
    }

    try {
      const oc = await pool.query('SELECT estado FROM ordenes_compra WHERE id = $1', [req.params.id]);
      if (!oc.rows.length) return res.status(404).json({ error: 'Orden de compra no encontrada' });
      if (oc.rows[0].estado === 'anulada') {
        return res.status(400).json({ error: 'La orden está anulada, no se puede modificar' });
      }

      const result = await pool.query(
        `INSERT INTO orden_compra_items
          (orden_compra_id, ficha_id, cantidad_pedida)
          VALUES ($1,$2,$3)
          ON CONFLICT (orden_compra_id, ficha_id)
          DO UPDATE SET
          cantidad_pedida = orden_compra_items.cantidad_pedida + EXCLUDED.cantidad_pedida
          RETURNING *;`,
        [req.params.id, ficha_id, cantidad]
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Trae un item de la OC con lo ya entregado de ese modelo, bloqueando la
// fila para que no cambie mientras se valida. Devuelve null si el item no
// es de esa OC. Lo usan PUT y DELETE de abajo.
async function itemConEntregado(client, ocId, itemId) {
  const r = await client.query(
    `SELECT oci.id, oci.ficha_id, oci.cantidad_pedida, oc.estado,
       (SELECT COALESCE(SUM(vi.cantidad), 0)
        FROM ventas v
        JOIN venta_items vi ON vi.venta_id = v.id
        WHERE v.orden_compra_id = oci.orden_compra_id
          AND vi.ficha_id = oci.ficha_id) AS entregado
     FROM orden_compra_items oci
     JOIN ordenes_compra oc ON oc.id = oci.orden_compra_id
     WHERE oci.id = $1 AND oci.orden_compra_id = $2
     FOR UPDATE OF oci`,
    [itemId, ocId]
  );
  return r.rows[0] || null;
}

// Corregir la cantidad de un item mal cargado. Fija la cantidad (el POST
// de arriba, en cambio, suma). No se puede bajar por debajo de lo que ya
// se entregó de ese modelo.
router.put(
  '/:id/items/:itemId',
  soloAdmin,
  async (req, res) => {
    const cantidad = parseInt(req.body.cantidad_pedida, 10);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: 'La cantidad tiene que ser un entero positivo' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const item = await itemConEntregado(client, req.params.id, req.params.itemId);

      if (!item) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Item no encontrado en esta orden' });
      }
      if (item.estado === 'cerrada' || item.estado === 'anulada') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `La orden está ${item.estado}, no se puede modificar` });
      }
      if (cantidad < Number(item.entregado)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Ya se entregaron ${item.entregado} unidades de este modelo: la cantidad no puede ser menor`
        });
      }

      const result = await client.query(
        `UPDATE orden_compra_items SET cantidad_pedida = $1 WHERE id = $2 RETURNING *`,
        [cantidad, item.id]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

// Borrar un item mal cargado. Solo si todavía no se entregó nada de ese
// modelo: si ya hay remitos, se puede bajar la cantidad hasta lo entregado.
router.delete(
  '/:id/items/:itemId',
  soloAdmin,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const item = await itemConEntregado(client, req.params.id, req.params.itemId);

      if (!item) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Item no encontrado en esta orden' });
      }
      if (item.estado === 'cerrada' || item.estado === 'anulada') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `La orden está ${item.estado}, no se puede modificar` });
      }
      if (Number(item.entregado) > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Ya se entregaron ${item.entregado} unidades de este modelo: no se puede borrar, solo bajar la cantidad hasta lo entregado`
        });
      }

      await client.query(`DELETE FROM orden_compra_items WHERE id = $1`, [item.id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

router.get(
  '/:id/estado',
  soloAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
          oci.id,
          ft.modelo,
          oci.cantidad_pedida,
          COALESCE(SUM(vi.cantidad), 0) AS cantidad_entregada,
          oci.cantidad_pedida - COALESCE(SUM(vi.cantidad), 0) AS pendiente
        FROM orden_compra_items oci
        JOIN ficha_transformador ft ON ft.id = oci.ficha_id
        LEFT JOIN ventas v ON v.orden_compra_id = oci.orden_compra_id
        LEFT JOIN venta_items vi
          ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
        WHERE oci.orden_compra_id = $1
        GROUP BY oci.id, ft.modelo, oci.cantidad_pedida`,
        [req.params.id]
      );

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.put(
  '/:id/cerrar',
  soloAdmin,
  async (req, res) => {
    try {
      const ocEstado = await pool.query('SELECT estado FROM ordenes_compra WHERE id = $1', [req.params.id]);
      if (ocEstado.rows[0]?.estado === 'anulada') {
        return res.status(400).json({ error: 'La orden está anulada, no se puede cerrar' });
      }

      // La versión anterior hacía SUM(... - SUM(...)) en el mismo nivel:
      // Postgres no permite anidar funciones de agregación así y tiraba
      // "aggregate function calls cannot be nested" (hallazgo C5). Hay que
      // agregar primero por línea de la OC (subconsulta, agrupando por
      // oci.id) y recién ahí sumar el total pendiente.
      const pendientes = await pool.query(
        `SELECT COALESCE(SUM(d.pendiente), 0) AS pendiente
         FROM (
           SELECT oci.cantidad_pedida - COALESCE(SUM(vi.cantidad), 0) AS pendiente
           FROM orden_compra_items oci
           LEFT JOIN ventas v       ON v.orden_compra_id = oci.orden_compra_id
           LEFT JOIN venta_items vi ON vi.venta_id = v.id AND vi.ficha_id = oci.ficha_id
           WHERE oci.orden_compra_id = $1
           GROUP BY oci.id, oci.cantidad_pedida
         ) d`,
        [req.params.id]
      );

      if (Number(pendientes.rows[0].pendiente) > 0) {
        return res.status(400).json({ error: 'La OC todavía tiene pendiente' });
      }

      // Nota: se deja 'cerrada' en minúscula (no se toca la convención de
      // estado en esta pasada) para no desincronizar con oc.js / oc_detalle.js,
      // que hoy comparan contra minúscula. Migrar a MAYÚSCULAS + CHECK queda
      // pendiente junto con el resto de Órdenes de Compra (ver hallazgo C5
      // completo en claude/auditoria-bugs-2026-09-13.md).
      await pool.query(
        `UPDATE ordenes_compra SET estado = 'cerrada' WHERE id = $1`,
        [req.params.id]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* =========================
   ANULAR OC
   preview: qué va a pasar. anular: { motivo, confirmar_numero }
========================= */
router.get('/:id/anulacion-preview', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await vistaPreviaAnulacionOC(client, req.params.id));
  } catch (err) {
    if (!err.status) console.error('Error en vista previa de anulación (OC):', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo preparar la anulación' });
  } finally {
    client.release();
  }
});

router.post('/:id/anular', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await anularOC(client, req.params.id, {
      motivo: req.body.motivo,
      confirmar_numero: req.body.confirmar_numero,
      usuario: req.usuario
    });
    await client.query('COMMIT');
    res.json({ message: `Orden de compra ${r.identificador} anulada.`, ...r });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('Error anulando OC:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo anular la orden de compra' });
  } finally {
    client.release();
  }
});

module.exports = router;

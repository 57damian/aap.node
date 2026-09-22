const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin } = require('../middlewares/auth');
const { generarPdfPedidoProveedor } = require('../services/pdf-pedido-proveedor');

// Es información de compras (proveedores, materia prima, precios de
// referencia): mismo criterio que proveedores.routes.js y
// materias-primas.routes.js — solo admin, nada para operario.
router.use(verificarToken, soloAdmin);

// Mismo criterio de escape que ficha.routes.js: estos textos los ve un
// administrador en el PDF y en la pantalla, y nada impide que se los
// enviara a un proveedor por correo, así que no se aceptan < ni > (evita
// que alguien cuele HTML) ni el resto de caracteres de ruptura en los
// campos cortos.
const SIN_HTML = /[<>]/;
const SIN_ROTURA = /[<>"\\`]/;

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

function validarCaracteres(valor, etiqueta, estricto) {
  if (valor === undefined || valor === null) return;
  if ((estricto ? SIN_ROTURA : SIN_HTML).test(String(valor))) {
    throw fallo(400, `${etiqueta} tiene caracteres no permitidos${estricto ? ' (< > " \\ `)' : ' (< >)'}`);
  }
}

function textoONull(valor, max, etiqueta, estricto) {
  validarCaracteres(valor, etiqueta, estricto);
  const t = String(valor ?? '').trim();
  if (!t) return null;
  if (t.length > max) throw fallo(400, `${etiqueta} es demasiado largo (máximo ${max} caracteres)`);
  return t;
}

function normalizarItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw fallo(400, 'El pedido necesita al menos un ítem');
  }
  return raw.map((it, i) => {
    const materiaPrimaId = Number.parseInt(it.materia_prima_id, 10);
    if (!Number.isInteger(materiaPrimaId) || materiaPrimaId <= 0) {
      throw fallo(400, `Ítem ${i + 1}: falta la materia prima`);
    }
    const cantidad = Number(String(it.cantidad).replace(',', '.'));
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw fallo(400, `Ítem ${i + 1}: la cantidad tiene que ser mayor a 0`);
    }
    let precioReferencia = null;
    if (it.precio_referencia !== undefined && it.precio_referencia !== null && it.precio_referencia !== '') {
      precioReferencia = Number(String(it.precio_referencia).replace(',', '.'));
      if (!Number.isFinite(precioReferencia) || precioReferencia < 0) {
        throw fallo(400, `Ítem ${i + 1}: el precio de referencia no es válido`);
      }
    }
    return {
      materia_prima_id: materiaPrimaId,
      cantidad,
      unidad_medida: textoONull(it.unidad_medida, 20, `Ítem ${i + 1}: la unidad`, true) || 'UNI',
      aproximado: !!it.aproximado,
      precio_referencia: precioReferencia,
      observaciones: textoONull(it.observaciones, 300, `Ítem ${i + 1}: las observaciones`, false)
    };
  });
}

async function siguienteNumero(client) {
  const r = await client.query(
    `SELECT 'PP-' || LPAD(nextval('pedidos_proveedor_numero_seq')::text, 6, '0') AS numero`
  );
  return r.rows[0].numero;
}

async function insertarItems(client, pedidoId, items) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await client.query(
      `INSERT INTO pedido_proveedor_items
         (pedido_id, materia_prima_id, cantidad, unidad_medida, aproximado, precio_referencia, observaciones, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [pedidoId, it.materia_prima_id, it.cantidad, it.unidad_medida, it.aproximado, it.precio_referencia, it.observaciones, i]
    );
  }
}

async function cargarPedidoCompleto(id) {
  const cabecera = await pool.query(
    `SELECT pp.*, p.nombre AS proveedor_nombre, p.cuit AS proveedor_cuit,
            p.direccion AS proveedor_direccion, p.telefono AS proveedor_telefono,
            p.email AS proveedor_email, p.contacto AS proveedor_contacto,
            u.nombre_completo AS creado_por_nombre
       FROM pedidos_proveedor pp
       JOIN proveedores p ON p.id = pp.proveedor_id
       LEFT JOIN usuarios u ON u.id = pp.creado_por
      WHERE pp.id = $1`,
    [id]
  );
  if (cabecera.rows.length === 0) return null;

  const items = await pool.query(
    `SELECT ppi.*, mp.codigo AS materia_codigo, mp.nombre AS materia_nombre
       FROM pedido_proveedor_items ppi
       JOIN materias_primas mp ON mp.id = ppi.materia_prima_id
      WHERE ppi.pedido_id = $1
      ORDER BY ppi.orden, ppi.id`,
    [id]
  );

  return { ...cabecera.rows[0], items: items.rows };
}

/**
 * GET /api/pedidos-proveedor
 * Lista con filtros opcionales por proveedor y estado.
 */
router.get('/', async (req, res) => {
  try {
    const { proveedor_id, estado } = req.query;
    let query = `
      SELECT pp.id, pp.numero, pp.fecha, pp.estado, pp.proveedor_id,
             p.nombre AS proveedor_nombre,
             (SELECT COUNT(*) FROM pedido_proveedor_items ppi WHERE ppi.pedido_id = pp.id) AS cantidad_items
        FROM pedidos_proveedor pp
        JOIN proveedores p ON p.id = pp.proveedor_id
       WHERE 1=1
    `;
    const params = [];
    let n = 1;

    if (proveedor_id) {
      query += ` AND pp.proveedor_id = $${n++}`;
      params.push(proveedor_id);
    }
    if (estado) {
      query += ` AND pp.estado = $${n++}`;
      params.push(String(estado).toUpperCase());
    }

    query += ` ORDER BY pp.fecha DESC, pp.id DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /pedidos-proveedor:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pedidos-proveedor/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const pedido = await cargarPedidoCompleto(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(pedido);
  } catch (err) {
    console.error('Error en GET /pedidos-proveedor/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pedidos-proveedor
 * body: { proveedor_id, fecha, observaciones, items: [...] }
 */
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const proveedorId = Number.parseInt(req.body.proveedor_id, 10);
    if (!Number.isInteger(proveedorId) || proveedorId <= 0) {
      return res.status(400).json({ error: 'Falta el proveedor' });
    }
    const fecha = req.body.fecha || null;
    const observaciones = textoONull(req.body.observaciones, 500, 'Las observaciones', false);
    const items = normalizarItems(req.body.items);

    const proveedorExiste = await client.query('SELECT id FROM proveedores WHERE id = $1', [proveedorId]);
    if (proveedorExiste.rows.length === 0) {
      return res.status(404).json({ error: 'El proveedor no existe' });
    }

    await client.query('BEGIN');

    const numero = await siguienteNumero(client);
    const cabecera = await client.query(
      `INSERT INTO pedidos_proveedor (numero, proveedor_id, fecha, observaciones, creado_por)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5)
       RETURNING id`,
      [numero, proveedorId, fecha, observaciones, req.usuario.id]
    );

    await insertarItems(client, cabecera.rows[0].id, items);

    await client.query('COMMIT');

    const pedido = await cargarPedidoCompleto(cabecera.rows[0].id);
    res.status(201).json(pedido);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en POST /pedidos-proveedor:', err);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PUT /api/pedidos-proveedor/:id
 * Solo mientras está en BORRADOR: reemplaza cabecera e ítems.
 */
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const actual = await client.query('SELECT estado FROM pedidos_proveedor WHERE id = $1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (actual.rows[0].estado !== 'BORRADOR') {
      return res.status(400).json({ error: 'Solo se puede editar un pedido en borrador' });
    }

    const proveedorId = Number.parseInt(req.body.proveedor_id, 10);
    if (!Number.isInteger(proveedorId) || proveedorId <= 0) {
      return res.status(400).json({ error: 'Falta el proveedor' });
    }
    const fecha = req.body.fecha || null;
    const observaciones = textoONull(req.body.observaciones, 500, 'Las observaciones', false);
    const items = normalizarItems(req.body.items);

    await client.query('BEGIN');

    await client.query(
      `UPDATE pedidos_proveedor
          SET proveedor_id = $1, fecha = COALESCE($2, fecha), observaciones = $3
        WHERE id = $4`,
      [proveedorId, fecha, observaciones, id]
    );
    await client.query('DELETE FROM pedido_proveedor_items WHERE pedido_id = $1', [id]);
    await insertarItems(client, id, items);

    await client.query('COMMIT');

    const pedido = await cargarPedidoCompleto(id);
    res.json(pedido);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en PUT /pedidos-proveedor/:id:', err);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/pedidos-proveedor/:id
 * Solo mientras está en BORRADOR (uno ya enviado se anula, no se borra).
 */
router.delete('/:id', async (req, res) => {
  try {
    const actual = await pool.query('SELECT estado FROM pedidos_proveedor WHERE id = $1', [req.params.id]);
    if (actual.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (actual.rows[0].estado !== 'BORRADOR') {
      return res.status(400).json({ error: 'Un pedido ya enviado no se borra: anulalo desde "Anular…"' });
    }
    await pool.query('DELETE FROM pedidos_proveedor WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en DELETE /pedidos-proveedor/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pedidos-proveedor/:id/enviar
 * Marca que ya se le mandó el PDF al proveedor (no dispara ningún envío
 * de correo: eso lo hace la persona a mano, desde su propio correo).
 */
router.post('/:id/enviar', async (req, res) => {
  try {
    const actual = await pool.query('SELECT estado FROM pedidos_proveedor WHERE id = $1', [req.params.id]);
    if (actual.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (actual.rows[0].estado !== 'BORRADOR') {
      return res.status(400).json({ error: 'El pedido ya no está en borrador' });
    }
    await pool.query(
      `UPDATE pedidos_proveedor SET estado = 'ENVIADO', enviado_en = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json(await cargarPedidoCompleto(req.params.id));
  } catch (err) {
    console.error('Error en POST /pedidos-proveedor/:id/enviar:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pedidos-proveedor/:id/anular
 * body: { motivo }
 */
router.post('/:id/anular', async (req, res) => {
  try {
    const motivo = textoONull(req.body.motivo, 500, 'El motivo', false);
    if (!motivo || motivo.length < 5) {
      return res.status(400).json({ error: 'El motivo tiene que tener al menos 5 caracteres' });
    }
    const actual = await pool.query('SELECT estado FROM pedidos_proveedor WHERE id = $1', [req.params.id]);
    if (actual.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (actual.rows[0].estado === 'ANULADO') {
      return res.status(400).json({ error: 'El pedido ya está anulado' });
    }
    await pool.query(
      `UPDATE pedidos_proveedor
          SET estado = 'ANULADO', anulado_en = NOW(), anulado_por = $1, motivo_anulacion = $2
        WHERE id = $3`,
      [req.usuario.id, motivo, req.params.id]
    );
    res.json(await cargarPedidoCompleto(req.params.id));
  } catch (err) {
    console.error('Error en POST /pedidos-proveedor/:id/anular:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/pedidos-proveedor/:id/pdf
 * Descarga el PDF con membrete para mandarle al proveedor por correo.
 */
router.get('/:id/pdf', async (req, res) => {
  try {
    const pedido = await cargarPedidoCompleto(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Pedido-${pedido.numero}.pdf"`);

    generarPdfPedidoProveedor({
      numero: pedido.numero,
      fecha: pedido.fecha,
      estado: pedido.estado,
      observaciones: pedido.observaciones,
      motivo_anulacion: pedido.motivo_anulacion,
      proveedor: {
        nombre: pedido.proveedor_nombre,
        cuit: pedido.proveedor_cuit,
        direccion: pedido.proveedor_direccion,
        telefono: pedido.proveedor_telefono,
        email: pedido.proveedor_email,
        contacto: pedido.proveedor_contacto
      },
      items: pedido.items.map((it) => ({
        codigo: it.materia_codigo,
        material: it.materia_nombre,
        cantidad: it.cantidad,
        unidad_medida: it.unidad_medida,
        aproximado: it.aproximado,
        observaciones: it.observaciones
      }))
    }, res);
  } catch (err) {
    console.error('Error en GET /pedidos-proveedor/:id/pdf:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;

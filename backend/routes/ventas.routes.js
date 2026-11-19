const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { asyncHandler } = require('../middlewares/asyncHandler');
const { vistaPreviaAnulacionRemito, anularRemito } = require('../services/anulaciones');
const { generarPdfRemito } = require('../services/pdf-remito');
const { nombreArchivo, fecha: fmtFecha } = require('../services/pdf-base');
const { generarPdfReporte, ANCHO_UTIL_REPORTE } = require('../services/pdf-reporte');
const { listarRemitos, idsDelRemito } = require('../services/remitos');
const { pendientesPorCliente } = require('../services/oc-pendientes');
const {
  crearEntrega, proximoNumeroRemito, insertarItemVenta, dolarVigente, pendienteDeItemOC
} = require('../services/entregas');

const COLS_PDF_VENTAS = [
  { campo: 'fecha', titulo: 'Fecha', x: 0, ancho: 55 },
  { campo: 'cliente', titulo: 'Cliente', x: 55, ancho: 120 },
  { campo: 'remito', titulo: 'Remito', x: 175, ancho: 60 },
  { campo: 'oc', titulo: 'OC', x: 235, ancho: 60 },
  { campo: 'modelos', titulo: 'Modelos / cantidad', x: 295, ancho: 220 },
  { campo: 'unidades', titulo: 'Unidades', x: 515, ancho: 55, align: 'right' },
  { campo: 'factura', titulo: 'Factura', x: 570, ancho: 70 },
  { campo: 'observaciones', titulo: 'Observaciones', x: 640, ancho: ANCHO_UTIL_REPORTE - 640 }
];

router.use(verificarToken);

/* =========================
   LISTAR REMITOS
   Una fila por remito (un remito con material de varias OC se ve como uno
   solo); con ?orden_compra_id= se ve solo el tramo de esa OC. Ver
   services/remitos.js.
========================= */
router.get('/', soloAdmin, async (req, res) => {
  try {
    const { cliente_id, orden_compra_id, desde, hasta } = req.query;
    res.json(await listarRemitos({ cliente_id, orden_compra_id, desde, hasta }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   PDF DEL INFORME DE ENTREGAS (mismos filtros que GET /)
   GET /api/ventas/reporte/pdf?cliente_id=&orden_compra_id=&desde=&hasta=
========================= */
router.get('/reporte/pdf', soloAdmin, async (req, res) => {
  const { cliente_id, orden_compra_id, desde, hasta } = req.query;

  try {
    const filas = await listarRemitos({ cliente_id, orden_compra_id, desde, hasta });

    const filtros = [];
    if (desde || hasta) filtros.push(`Período: ${desde ? fmtFecha(desde) : 'inicio'} a ${hasta ? fmtFecha(hasta) : 'hoy'}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="entregas-${desde || 'todo'}_a_${hasta || 'hoy'}.pdf"`);
    generarPdfReporte({
      titulo: 'Informe de entregas a clientes',
      filtrosTexto: filtros.join(' · ') || undefined,
      cols: COLS_PDF_VENTAS,
      filas,
      armarCelda: (r) => ({
        fecha: fmtFecha(r.fecha),
        cliente: r.cliente || '—',
        remito: r.remito_numero || '—',
        oc: r.numero_oc || '—',
        modelos: r.items.length ? r.items.map(i => `${i.modelo} x${i.cantidad}`).join(', ') : '—',
        unidades: Number(r.unidades || 0).toLocaleString('es-AR'),
        factura: r.numero_factura || '—',
        observaciones: r.remito_observaciones || '—'
      })
    }, res);
  } catch (err) {
    console.error('Error generando PDF de entregas:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   NUEVA ENTREGA POR CLIENTE
   Ver services/entregas.js: lo entregado se reparte entre las OC del
   cliente (la más vieja primero) y sale UN remito.
========================= */
// Lo pendiente del cliente por modelo (con el desglose por OC), el stock
// disponible de cada modelo y el número de remito que se va a proponer.
router.get('/entrega/pendientes', soloAdmin, asyncHandler(async (req, res) => {
  const clienteId = Number.parseInt(req.query.cliente_id, 10);
  if (!clienteId) return res.status(400).json({ error: 'Falta el cliente' });

  const [pendientes, proximo, dolar] = await Promise.all([
    pendientesPorCliente(clienteId),
    proximoNumeroRemito(),
    pool.query("SELECT valor FROM parametros WHERE clave = 'dolar_banco'")
  ]);
  const cli = pendientes[0] || { cliente_id: clienteId, total_pendiente: 0, modelos: [] };

  const fichaIds = cli.modelos.map(m => m.ficha_id);
  const stock = fichaIds.length
    ? await pool.query('SELECT ficha_id, stock_actual FROM stock_actual WHERE ficha_id = ANY($1)', [fichaIds])
    : { rows: [] };
  const stockPorFicha = new Map(stock.rows.map(r => [r.ficha_id, Number(r.stock_actual) || 0]));

  res.json({
    cliente_id: clienteId,
    total_pendiente: cli.total_pendiente,
    modelos: cli.modelos.map(m => ({ ...m, stock_disponible: stockPorFicha.get(m.ficha_id) || 0 })),
    proximo_remito: proximo,
    dolar: dolar.rows.length ? Number(dolar.rows[0].valor) : null
  });
}));

router.post('/entrega', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await crearEntrega(client, req.body || {});
    await client.query('COMMIT');
    res.json(r);
  } catch (err) {
    await client.query('ROLLBACK');
    // P0001 = excepción levantada por el trigger de stock (stock insuficiente).
    const status = err.status || (err.code === 'P0001' ? 400 : 500);
    if (status === 500) console.error('Error registrando entrega:', err);
    res.status(status).json({ error: status === 500 ? 'No se pudo registrar la entrega' : err.message });
  } finally {
    client.release();
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
      `SELECT cliente_id, estado FROM ordenes_compra WHERE id = $1`,
      [orden_compra_id]
    );

    if (!clienteRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'OC no encontrada' });
    }

    if (clienteRes.rows[0].estado === 'anulada') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La orden de compra está anulada: no se pueden registrar entregas' });
    }

    const cliente_id = clienteRes.rows[0].cliente_id;

    // Cotización recibida del frontend o, si no viene, la última cargada. Si
    // no hay ninguna se rechaza (antes había un fallback hardcodeado que dejaba
    // cargar una venta con un dólar inventado — hallazgo D8 de la auditoría).
    const tipoCambio = await dolarVigente(client, tipo_cambio);

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

        // El servidor también controla el pendiente de la OC (antes solo lo
        // topeaba el navegador y el trigger de stock).
        const pendiente = await pendienteDeItemOC(client, orden_compra_id, fichaId);
        if (cantidad > pendiente) {
          const e = new Error(`La cantidad (${cantidad}) supera lo pendiente de la orden de compra (${pendiente})`);
          e.status = 400;
          throw e;
        }

        // Si la cantidad supera el stock disponible, trigger_verificar_stock
        // (sobre venta_items) rechaza el INSERT con una excepción — el
        // ROLLBACK del catch se lleva puesta también la venta recién creada.
        const itemRes = { rows: [await insertarItemVenta(client, venta.id, fichaId, cantidad, tipoCambio)] };
        venta.items.push(itemRes.rows[0]);
      }
    }

    await client.query('COMMIT');
    res.json(venta);

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.status || (err.code === 'P0001' ? 400 : 500)).json({ error: err.message });
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
      `SELECT tipo_cambio, anulada_en FROM ventas WHERE id = $1`,
      [req.params.id]
    );

    if (!ventaRes.rows.length) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }
    if (ventaRes.rows[0].anulada_en) {
      return res.status(400).json({ error: 'El remito está anulado: no se le pueden agregar ítems' });
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
    WHERE id=$4 AND anulada_en IS NULL
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

/* =========================
   DESCARGAR REMITO EN PDF
========================= */
router.get('/:id/pdf', soloAdmin, async (req, res) => {
  try {
    const ventaRes = await pool.query(
      `
      SELECT
        v.id, v.fecha, v.remito_numero, v.remito_fecha, v.remito_observaciones,
        v.anulada_en, v.motivo_anulacion,
        c.nombre AS cliente_nombre, c.cuit AS cliente_cuit, c.direccion AS cliente_direccion
      FROM ventas v
      JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = $1
      `,
      [req.params.id]
    );

    if (!ventaRes.rows.length) return res.status(404).json({ error: 'Venta no encontrada' });

    // El remito es uno solo aunque se haya imputado a varias OC: se imprimen
    // los ítems de todos sus tramos, un renglón por modelo.
    const ids = await idsDelRemito(pool, req.params.id);
    const itemsRes = await pool.query(
      `
      SELECT f.modelo, SUM(vi.cantidad)::int AS cantidad
      FROM venta_items vi
      JOIN ficha_transformador f ON f.id = vi.ficha_id
      WHERE vi.venta_id = ANY($1)
      GROUP BY f.modelo
      ORDER BY f.modelo
      `,
      [ids]
    );

    const venta = ventaRes.rows[0];
    venta.items = itemsRes.rows;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="Remito-${nombreArchivo(venta.remito_numero, venta.id)}.pdf"`);
    generarPdfRemito(venta, res);
  } catch (err) {
    console.error('Error generando PDF de remito:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* =========================
   ANULAR REMITO
   preview: qué va a pasar. anular: { motivo, confirmar_numero }
========================= */
router.get('/:id/anulacion-preview', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await vistaPreviaAnulacionRemito(client, req.params.id));
  } catch (err) {
    if (!err.status) console.error('Error en vista previa de anulación (REMITO):', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo preparar la anulación' });
  } finally {
    client.release();
  }
});

router.post('/:id/anular', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await anularRemito(client, req.params.id, {
      motivo: req.body.motivo,
      confirmar_numero: req.body.confirmar_numero,
      usuario: req.usuario
    });
    await client.query('COMMIT');
    res.json({ message: `Remito ${r.identificador} anulado. ${r.unidades_devueltas_al_stock} unidad(es) volvieron al stock.`, ...r });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('Error anulando REMITO:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo anular el remito' });
  } finally {
    client.release();
  }
});

module.exports = router;

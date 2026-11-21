const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const { crearFacturaDesdeRemitos } = require('../services/facturas-venta');
const { numerosOcDeFactura } = require('../services/factura-oc');
const { vistaPreviaAnulacion, anularFactura } = require('../services/anulaciones');
const { generarPdfFactura } = require('../services/pdf-factura');
const { nombreArchivo } = require('../services/pdf-base');

router.use(verificarToken);

/* =========================
   CREAR FACTURA DESDE UNO O VARIOS REMITOS
   ---------------------------------------------------------------
   Una factura puede agrupar varios remitos del mismo cliente, de cualquier
   OC (la OC y el remito son un control interno; la factura es lo real). El
   cuerpo y las reglas están en services/facturas-venta.js.
========================= */
router.post('/', soloAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const factura = await crearFacturaDesdeRemitos(client, req.body);
    await client.query('COMMIT');
    res.json(factura);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando factura:', err);
    // El número es único entre las facturas vigentes (las anuladas no cuentan).
    if (err.code === '23505' && err.constraint === 'uq_facturas_numero_vigente') {
      return res.status(400).json({
        error: `Ya existe una factura vigente con el número ${req.body.numero_factura}. ` +
               'Si estaba mal cargada, anulala primero desde Correcciones.'
      });
    }
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   LISTADO DE FACTURAS DE VENTA
   Filtros: cliente_id, estado (EMITIDA | ANULADA), q (número), desde, hasta.
   Incluye las anuladas; el cobrado sale de las imputaciones acreditadas,
   igual que en cuenta-cliente.js.
========================= */
router.get('/', soloAdmin, async (req, res) => {
  try {
    const { cliente_id, estado, q, desde, hasta } = req.query;
    const params = [];
    const filtros = [];
    if (cliente_id) { params.push(cliente_id); filtros.push(`f.cliente_id = $${params.length}`); }
    if (estado) { params.push(String(estado).toUpperCase()); filtros.push(`COALESCE(upper(f.estado),'EMITIDA') = $${params.length}`); }
    if (q) { params.push(`%${q}%`); filtros.push(`f.numero_factura ILIKE $${params.length}`); }
    if (desde) { params.push(desde); filtros.push(`f.fecha >= $${params.length}`); }
    if (hasta) { params.push(hasta); filtros.push(`f.fecha <= $${params.length}`); }

    const { rows } = await pool.query(`
      SELECT
        f.id, f.numero_factura, f.tipo_factura, f.fecha, f.total,
        COALESCE(upper(f.estado), 'EMITIDA') AS estado,
        f.cliente_id, c.nombre AS cliente_nombre,
        f.orden_compra_id, ${numerosOcDeFactura('f')} AS numero_oc,
        f.anulada_en, f.motivo_anulacion,
        ROUND(COALESCE(imp.cobrado, 0), 2)    AS cobrado,
        ROUND(COALESCE(imp.en_gestion, 0), 2) AS en_gestion,
        (SELECT string_agg(DISTINCT v.remito_numero, ', ')
           FROM factura_venta_items fvi
           JOIN venta_items vi ON vi.id = fvi.venta_item_id
           JOIN ventas v ON v.id = vi.venta_id
          WHERE fvi.factura_id = f.id) AS remitos
      FROM facturas f
      JOIN clientes c ON c.id = f.cliente_id
      LEFT JOIN (
        SELECT ap.factura_id,
               SUM(ap.monto_aplicado) FILTER (WHERE pi.estado = 'ACREDITADO')                 AS cobrado,
               SUM(ap.monto_aplicado) FILTER (WHERE pi.estado IN ('EN_CARTERA','DEPOSITADO')) AS en_gestion
        FROM aplicacion_pagos ap
        JOIN pago_items pi ON pi.id = ap.pago_item_id
        GROUP BY ap.factura_id
      ) imp ON imp.factura_id = f.id
      ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
      ORDER BY f.fecha DESC, f.id DESC
      LIMIT 500
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('Error listando facturas:', err);
    res.status(500).json({ error: 'No se pudo listar las facturas' });
  }
});

/* =========================
   DESCARGAR FACTURA EN PDF
========================= */
router.get('/:id/pdf', soloAdmin, async (req, res) => {
  try {
    const facturaRes = await pool.query(
      `
      SELECT
        f.id, f.numero_factura, f.tipo_factura, f.fecha, f.dias_credito,
        f.subtotal_sin_iva, f.iva_21, f.total,
        COALESCE(upper(f.estado), 'EMITIDA') AS estado,
        f.motivo_anulacion,
        c.nombre AS cliente_nombre, c.cuit AS cliente_cuit, c.direccion AS cliente_direccion,
        (SELECT string_agg(DISTINCT v.remito_numero, ', ')
           FROM factura_venta_items fvi
           JOIN venta_items vi ON vi.id = fvi.venta_item_id
           JOIN ventas v ON v.id = vi.venta_id
          WHERE fvi.factura_id = f.id) AS remitos
      FROM facturas f
      JOIN clientes c ON c.id = f.cliente_id
      WHERE f.id = $1
      `,
      [req.params.id]
    );

    if (!facturaRes.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });

    const itemsRes = await pool.query(
      `
      SELECT ft.modelo, fvi.precio_unitario, SUM(fvi.cantidad) AS cantidad, SUM(fvi.subtotal) AS subtotal
      FROM factura_venta_items fvi
      JOIN ficha_transformador ft ON ft.id = fvi.ficha_id
      WHERE fvi.factura_id = $1
      GROUP BY ft.modelo, fvi.precio_unitario
      ORDER BY ft.modelo
      `,
      [req.params.id]
    );

    const factura = facturaRes.rows[0];
    factura.items = itemsRes.rows;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="Factura-${nombreArchivo(factura.numero_factura, factura.id)}.pdf"`);
    generarPdfFactura(factura, res);
  } catch (err) {
    console.error('Error generando PDF de factura:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* =========================
   HISTORIAL DE ANULACIONES (auditoría)
========================= */
router.get('/anulaciones', soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, entidad, entidad_id, numero, motivo, usuario_nombre, creado_en,
             snapshot->'remitos'  AS remitos,
             snapshot->'acciones' AS acciones,
             snapshot->'items'    AS items,
             snapshot->'produccion' AS produccion
      FROM auditoria_anulaciones
      ORDER BY creado_en DESC, id DESC
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error leyendo anulaciones:', err);
    res.status(500).json({ error: 'No se pudo leer el historial de anulaciones' });
  }
});

/* =========================
   ANULAR FACTURA DE VENTA
   preview: qué va a pasar (misma lógica que la anulación real).
   anular:  { motivo, confirmar_numero, acciones_cobros:[{pago_id, accion}] }
            accion = 'A_CUENTA' (default) | 'ANULAR_COBRO'
========================= */
router.get('/:id/anulacion-preview', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    res.json(await vistaPreviaAnulacion(client, req.params.id));
  } catch (err) {
    if (!err.status) console.error('Error en vista previa de anulación:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo preparar la anulación' });
  } finally {
    client.release();
  }
});

router.post('/:id/anular', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await anularFactura(client, req.params.id, {
      motivo: req.body.motivo,
      confirmar_numero: req.body.confirmar_numero,
      acciones_cobros: req.body.acciones_cobros,
      usuario: req.usuario
    });
    await client.query('COMMIT');
    res.json({
      message: `Factura ${resultado.numero_factura} anulada. ` +
               `${resultado.remitos_liberados} remito(s) volvieron a quedar pendientes de facturar.`,
      ...resultado
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('Error anulando factura:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo anular la factura' });
  } finally {
    client.release();
  }
});

/* =========================
   OBTENER FACTURA DE VENTA
========================= */
router.get('/venta/:venta_id', soloAdmin, async (req, res) => {
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
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
const {
  CTE_FACTURAS_COMPRA, ESTADO_FACTURA_COMPRA, SUBQ_IMPUTADO
} = require('../services/cuenta-proveedor');

router.use(verificarToken);

/* =========================
   OBTENER FACTURAS DE COMPRA
========================= */
router.get('/', soloAdmin, async (req, res) => {
  try {
    const { proveedor_id, estado, fecha_desde, fecha_hasta, tipo_factura } = req.query;
    
    let query = `
      SELECT
        fc.*,
        p.nombre as proveedor_nombre,
        p.cuit as proveedor_cuit,
        u.nombre_completo as creado_por,
        hd.dolar as dolar,
        COALESCE(SUM(fi.subtotal), 0) as subtotal_items,
        COALESCE(SUM(fi.iva), 0) as iva_items,
        COALESCE(SUM(fi.total), 0) as total_items,
        COUNT(fi.id) as cantidad_items,
        -- Saldo calculado en vivo (13/09/2026). Antes se leía
        -- fc.neto_pagado, que nunca se actualizaba al pagar; esa columna
        -- y fc.saldo_pendiente se eliminaron en la migración de pagos.
        ROUND(COALESCE(imp.pagado, 0), 2)                  AS pagado,
        ROUND(fc.total - COALESCE(imp.pagado, 0), 2)       AS saldo_pendiente,
        ROUND(COALESCE(imp.en_valores, 0), 2)              AS en_valores,
        COALESCE(
          fc.fecha_vencimiento,
          (fc.fecha_emision + (COALESCE(p.dias_credito, 0) || ' days')::interval)::date
        )                                                  AS vencimiento
      FROM facturas_compra fc
      JOIN proveedores p ON fc.proveedor_id = p.id
      LEFT JOIN usuarios u ON fc.created_by = u.id
      LEFT JOIN historial_dolar hd ON fc.dolar_historial_id = hd.id
      LEFT JOIN factura_items fi ON fc.id = fi.factura_id
      LEFT JOIN (${SUBQ_IMPUTADO}) imp ON imp.factura_compra_id = fc.id
    `;
    
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    
    if (proveedor_id) {
      conditions.push(`fc.proveedor_id = $${paramIndex}`);
      params.push(proveedor_id);
      paramIndex++;
    }
    
    if (estado) {
      conditions.push(`fc.estado = $${paramIndex}`);
      params.push(estado);
      paramIndex++;
    }
    
    if (fecha_desde) {
      conditions.push(`fc.fecha_emision >= $${paramIndex}`);
      params.push(fecha_desde);
      paramIndex++;
    }
    
    if (fecha_hasta) {
      conditions.push(`fc.fecha_emision <= $${paramIndex}`);
      params.push(fecha_hasta);
      paramIndex++;
    }
    
    if (tipo_factura) {
      conditions.push(`fc.tipo_factura = $${paramIndex}`);
      params.push(tipo_factura);
      paramIndex++;
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' GROUP BY fc.id, p.nombre, p.cuit, p.dias_credito, u.nombre_completo, hd.dolar,'
           + ' imp.pagado, imp.en_valores ORDER BY fc.fecha_emision DESC, fc.id DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo facturas de compra:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   OBTENER ÚLTIMO NÚMERO DE FACTURA
========================= */
router.get('/ultimo-numero', soloAdmin, async (req, res) => {
  try {
    const { tipo_factura } = req.query;
    
    let query = `SELECT MAX(numero_factura) as ultimo_numero FROM facturas_compra`;
    const params = [];
    
    if (tipo_factura) {
      query += ` WHERE tipo_factura = $1`;
      params.push(tipo_factura);
    }
    
    const result = await pool.query(query, params);
    
    res.json({
      ultimo_numero: result.rows[0]?.ultimo_numero || '0000-00000000'
    });
    
  } catch (err) {
    console.error('Error obteniendo último número de factura:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   OBTENER FACTURA DE COMPRA POR ID
========================= */
router.get('/:id', soloAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener cabecera de factura
    const facturaResult = await pool.query(
      `SELECT
        fc.*,
        p.nombre as proveedor_nombre,
        p.cuit as proveedor_cuit,
        p.direccion as proveedor_direccion,
        p.telefono as proveedor_telefono,
        p.email as proveedor_email,
        u.nombre_completo as creado_por,
        hd.dolar as dolar
       FROM facturas_compra fc
       JOIN proveedores p ON fc.proveedor_id = p.id
       LEFT JOIN usuarios u ON fc.created_by = u.id
       LEFT JOIN historial_dolar hd ON fc.dolar_historial_id = hd.id
       WHERE fc.id = $1`,
      [id]
    );
    
    if (facturaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    
    // Obtener items de la factura
    const itemsResult = await pool.query(
      `SELECT 
        fi.*,
        mp.codigo as materia_codigo,
        mp.nombre as materia_nombre,
        mp.unidad_medida as materia_unidad_medida,
        mp.precio_referencia as precio_referencia
       FROM factura_items fi
       LEFT JOIN materias_primas mp ON fi.materia_prima_id = mp.id
       WHERE fi.factura_id = $1
       ORDER BY fi.id`,
      [id]
    );
    
    const factura = facturaResult.rows[0];
    factura.items = itemsResult.rows;
    
    res.json(factura);
  } catch (err) {
    console.error('Error obteniendo factura de compra:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   CREAR FACTURA DE COMPRA
========================= */
router.post('/', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      proveedor_id,
      fecha_emision,
      fecha_recepcion,
      tipo_factura,
      punto_venta,
      numero_factura,
      numero_comprobante,
      cae,
      subtotal,
      iva,
      percepciones,
      retenciones,
      total,
      condicion_pago,
      observaciones,
      estado,
      dolar,
      items
    } = req.body;

    const usuario_id = req.usuario.id;

    // Validaciones básicas
    if (!proveedor_id || !fecha_emision || !tipo_factura || !numero_factura || !items || items.length === 0) {
      throw new Error('Datos incompletos: proveedor, fecha, tipo factura, número e items son obligatorios');
    }

    // Validar tipo de factura
    if (!['A', 'B', 'C', 'X'].includes(tipo_factura)) {
      throw new Error('Tipo de factura inválido. Debe ser A, B, C o X');
    }
    
    // Calcular totales si no se proporcionan
    let subtotalCalculado = 0;
    let ivaCalculado = 0;
    let totalCalculado = 0;
    
    // Validar y calcular items
    const itemsValidados = [];
    for (const item of items) {
      if (!item.cantidad || !item.precio_unitario) {
        throw new Error('Cantidad y precio unitario son obligatorios para cada ítem');
      }
      
      const cantidad = parseFloat(item.cantidad);
      const precioUnitario = parseFloat(item.precio_unitario);
      const ivaPorcentaje = item.iva_porcentaje ? parseFloat(item.iva_porcentaje) : 21.00;
      
      if (cantidad <= 0 || precioUnitario <= 0) {
        throw new Error('Cantidad y precio unitario deben ser mayores a 0');
      }
      
      const subtotalItem = cantidad * precioUnitario;
      const ivaItem = subtotalItem * (ivaPorcentaje / 100);
      const totalItem = subtotalItem + ivaItem;
      
      subtotalCalculado += subtotalItem;
      ivaCalculado += ivaItem;
      totalCalculado += totalItem;
      
      itemsValidados.push({
        ...item,
        cantidad,
        precio_unitario: precioUnitario,
        iva_porcentaje: ivaPorcentaje,
        subtotal: subtotalItem,
        iva: ivaItem,
        total: totalItem
      });
    }
    
    // Usar totales calculados si no se proporcionan
    const subtotalFinal = subtotal !== undefined ? parseFloat(subtotal) : subtotalCalculado;
    const ivaFinal = iva !== undefined ? parseFloat(iva) : ivaCalculado;
    const totalFinal = total !== undefined ? parseFloat(total) : totalCalculado;

    // Cotización del dólar para esta factura: campo opcional (diseño acordado
    // 12/09/2026). Si se informa, se registra una fila nueva en historial_dolar
    // (mismo mecanismo que PUT /api/precios/parametros/dolar) y la factura
    // queda ligada a ella vía dolar_historial_id. No se toca el parámetro
    // global parametros.dolar_banco: cargar una factura vieja con su cotización
    // de ese momento no debe pisar el dólar "actual" que se usa como sugerencia
    // en facturas nuevas.
    const dolarValido = dolar !== undefined && dolar !== null && dolar !== '' && !isNaN(parseFloat(dolar)) && parseFloat(dolar) > 0;
    let dolarHistorialId = null;
    if (dolarValido) {
      const dolarResult = await client.query(
        `INSERT INTO historial_dolar (dolar, usuario_id, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id`,
        [parseFloat(dolar), usuario_id]
      );
      dolarHistorialId = dolarResult.rows[0].id;
    }

    // Insertar cabecera de factura
    const facturaResult = await client.query(
      `INSERT INTO facturas_compra (
        proveedor_id, fecha_emision, fecha_recepcion,
        tipo_factura, punto_venta, numero_factura,
        numero_comprobante, cae, subtotal, iva,
        percepciones, retenciones, total,
        condicion_pago, observaciones, estado,
        created_by, dolar_historial_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        proveedor_id,
        fecha_emision,
        fecha_recepcion || null,
        tipo_factura,
        punto_venta || null,
        numero_factura,
        numero_comprobante || null,
        cae || null,
        subtotalFinal,
        ivaFinal,
        percepciones || 0,
        retenciones || 0,
        totalFinal,
        condicion_pago || 'CONTADO',
        observaciones || null,
        estado || 'PENDIENTE',
        usuario_id,
        dolarHistorialId
      ]
    );
    
    const factura = facturaResult.rows[0];
    
    // Insertar items
    for (const item of itemsValidados) {
      let materia_prima_id = item.materia_prima_id;
      let es_item_manual = false;
      let creado_como_materia_prima = false;
      
      // Si es ítem manual y se quiere guardar como nueva materia prima
      if (item.es_item_manual && item.guardar_como_materia_prima) {
        // Crear nueva materia prima
        const mpResult = await client.query(
          `INSERT INTO materias_primas (
            codigo, nombre, unidad_medida,
            precio_referencia, stock_actual,
            fecha_ultima_compra, created_by,
            creado_en, actualizado_en
          ) VALUES ($1, $2, $3, $4, 0, CURRENT_DATE, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id`,
          [
            item.codigo,
            item.nombre,
            item.unidad_medida || 'UNI',
            item.precio_unitario,
            usuario_id
          ]
        );
        
        materia_prima_id = mpResult.rows[0].id;
        es_item_manual = true;
        creado_como_materia_prima = true;
        
        // Registrar en historial de precios (primer precio de este material,
        // no hay anterior con qué comparar, variación 0)
        await client.query(
          `INSERT INTO historial_precios_materias (
            materia_prima_id, proveedor_id,
            precio_anterior, precio_nuevo,
            precio_nuevo_usd,
            variacion_porcentaje, factura_id,
            fecha_cambio, created_by, created_at
          ) VALUES ($1, $2, NULL, $3, $4, 0, $5, CURRENT_DATE, $6, CURRENT_TIMESTAMP)`,
          [
            materia_prima_id,
            proveedor_id,
            item.precio_unitario,
            dolarValido ? item.precio_unitario / parseFloat(dolar) : null,
            factura.id,
            usuario_id
          ]
        );
      } else if (item.es_item_manual) {
        // Ítem manual que no se guarda como materia prima
        es_item_manual = true;
      } else if (materia_prima_id) {
        // Ítem existente. El "último precio" global (mp.precio_referencia, lo que
        // se muestra en el listado de Stock) siempre se actualiza a lo pagado en
        // ESTA compra, sea cual sea el proveedor — es solo una referencia rápida.
        //
        // La "variación" que dispara la alerta, en cambio, es específica del
        // proveedor: se compara contra la última compra de este material A ESTE
        // MISMO proveedor (vía stock_movimientos.proveedor_id), no contra el
        // último precio global. Así, con varios proveedores para un mismo
        // material, cada uno tiene su propia comparación y no se mezclan entre sí.
        // (Diseño acordado 12/09/2026, ver doc del proyecto.)
        // Se trae también el dólar de la factura de esa compra anterior (si
        // la tenía cargada) para poder comparar precios en USD más abajo.
        const precioAnteriorProveedorResult = await client.query(
          `SELECT sm.precio_unitario, hd_anterior.dolar as dolar_anterior
           FROM stock_movimientos sm
           LEFT JOIN facturas_compra fc_anterior ON sm.factura_id = fc_anterior.id
           LEFT JOIN historial_dolar hd_anterior ON fc_anterior.dolar_historial_id = hd_anterior.id
           WHERE sm.materia_prima_id = $1 AND sm.proveedor_id = $2 AND sm.tipo_movimiento = 'ENTRADA'
           ORDER BY sm.fecha_movimiento DESC, sm.id DESC LIMIT 1`,
          [materia_prima_id, proveedor_id]
        );

        const precio_anterior_proveedor = precioAnteriorProveedorResult.rows.length > 0
          ? parseFloat(precioAnteriorProveedorResult.rows[0].precio_unitario)
          : null;
        const dolar_anterior = precioAnteriorProveedorResult.rows.length > 0 && precioAnteriorProveedorResult.rows[0].dolar_anterior !== null
          ? parseFloat(precioAnteriorProveedorResult.rows[0].dolar_anterior)
          : null;
        const precio_nuevo = item.precio_unitario;

        // Actualizar precio de referencia global (siempre, independiente del proveedor)
        await client.query(
          `UPDATE materias_primas
           SET precio_referencia = $1, fecha_ultima_compra = CURRENT_DATE, actualizado_en = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [precio_nuevo, materia_prima_id]
        );

        if (precio_anterior_proveedor === null) {
          console.log(`ℹ️  Primera compra registrada de materia prima ${materia_prima_id} a este proveedor (${proveedor_id}); no hay precio previo de ese proveedor para comparar`);
        } else {
          // Solo registrar variación si el precio en pesos es diferente (con tolerancia de 0.01)
          const diferencia = Math.abs(precio_nuevo - precio_anterior_proveedor);
          if (diferencia > 0.01) {
            // La variación que dispara la alerta ▲/▼ se calcula en USD, no en
            // pesos (diseño acordado 12/09/2026): así una devaluación no se ve
            // como "aumento de precio" del material. Si no hay dólar cargado
            // para esta factura o para la compra anterior, no se puede
            // convertir a USD y por lo tanto no se dispara alerta (queda en
            // NULL); el precio en pesos se sigue guardando igual.
            const precio_anterior_usd = dolar_anterior ? precio_anterior_proveedor / dolar_anterior : null;
            const precio_nuevo_usd = dolarValido ? precio_nuevo / parseFloat(dolar) : null;
            const variacion = (precio_anterior_usd !== null && precio_nuevo_usd !== null && precio_anterior_usd > 0)
              ? ((precio_nuevo_usd - precio_anterior_usd) / precio_anterior_usd) * 100
              : null;

            // Registrar en historial de precios (ligado a este proveedor)
            await client.query(
              `INSERT INTO historial_precios_materias (
                materia_prima_id, proveedor_id,
                precio_anterior, precio_nuevo,
                precio_anterior_usd, precio_nuevo_usd,
                variacion_porcentaje, factura_id,
                fecha_cambio, created_by, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, $9, CURRENT_TIMESTAMP)`,
              [
                materia_prima_id,
                proveedor_id,
                precio_anterior_proveedor,
                precio_nuevo,
                precio_anterior_usd,
                precio_nuevo_usd,
                variacion,
                factura.id,
                usuario_id
              ]
            );

            console.log(`✅ Variación de precio detectada (proveedor ${proveedor_id}) para materia prima ${materia_prima_id}: $${precio_anterior_proveedor} → $${precio_nuevo}` + (variacion !== null ? ` (${variacion.toFixed(2)}% en USD)` : ' (sin dólar cargado, no se calcula % ni se dispara alerta)'));
          } else {
            console.log(`ℹ️  Precio sin cambios para materia prima ${materia_prima_id} respecto al mismo proveedor (${proveedor_id}): $${precio_anterior_proveedor}`);
          }
        }
      }
      
      // Insertar ítem de factura
      await client.query(
        `INSERT INTO factura_items (
          factura_id, materia_prima_id,
          codigo, nombre, descripcion,
          cantidad, unidad_medida,
          precio_unitario, iva_porcentaje,
          subtotal, iva, total,
          es_item_manual, creado_como_materia_prima,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
        [
          factura.id,
          materia_prima_id || null,
          item.codigo || null,
          item.nombre || null,
          item.descripcion || null,
          item.cantidad,
          item.unidad_medida || 'UNI',
          item.precio_unitario,
          item.iva_porcentaje,
          item.subtotal,
          item.iva,
          item.total,
          es_item_manual,
          creado_como_materia_prima
        ]
      );
      
      // Si tiene materia_prima_id, actualizar stock inmediatamente si la factura está activa
      // Usar el estado que se guardará en la base de datos (estado || 'PENDIENTE')
      const estadoFinal = estado || 'PENDIENTE';
      if (materia_prima_id && (estadoFinal === 'PENDIENTE' || estadoFinal === 'PAGADA')) {
        console.log(`📦 Actualizando stock para materia prima ${materia_prima_id}: +${item.cantidad} unidades (estado: ${estadoFinal})`);

        // Tomar el stock actual ANTES de modificarlo (con lock), para poder dejar
        // stock_anterior/stock_nuevo en el movimiento, igual que ya se hace en los
        // ajustes manuales (POST /api/stock/ajuste). Antes quedaban en null/0 para
        // los movimientos generados desde una factura.
        const stockActualResult = await client.query(
          'SELECT stock_actual FROM materias_primas WHERE id = $1 FOR UPDATE',
          [materia_prima_id]
        );
        const stockAnterior = parseFloat(stockActualResult.rows[0]?.stock_actual || 0);
        const stockNuevo = stockAnterior + parseFloat(item.cantidad);

        // Actualizar stock
        await client.query(
          `UPDATE materias_primas
           SET stock_actual = $1,
               fecha_ultima_compra = CURRENT_DATE,
               actualizado_en = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [stockNuevo, materia_prima_id]
        );

        // Crear movimiento de stock
        await client.query(
          `INSERT INTO stock_movimientos (
            materia_prima_id, tipo_movimiento,
            cantidad, precio_unitario,
            factura_id, proveedor_id,
            observaciones, usuario_id, created_at,
            fecha_movimiento, unidad,
            stock_anterior, stock_nuevo
          ) VALUES ($1, 'ENTRADA', $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_DATE, $8, $9, $10)`,
          [
            materia_prima_id,
            item.cantidad,
            item.precio_unitario,
            factura.id,
            proveedor_id,
            `Compra desde factura ${numero_factura}`,
            usuario_id,
            item.unidad_medida || 'UNI',
            stockAnterior,
            stockNuevo
          ]
        );

        console.log(`✅ Stock actualizado (${stockAnterior} → ${stockNuevo}) y movimiento creado para materia prima ${materia_prima_id}`);
      } else {
        console.log(`⚠️  No se actualizó stock para materia prima ${materia_prima_id}:`);
        if (!materia_prima_id) console.log(`   - materia_prima_id es null o undefined`);
        if (estadoFinal !== 'PENDIENTE' && estadoFinal !== 'PAGADA') console.log(`   - estado "${estadoFinal}" no es PENDIENTE o PAGADA`);
      }
    }
    
    await client.query('COMMIT');
    
    // Obtener factura completa para respuesta
    const facturaCompletaResult = await pool.query(
      `SELECT
        fc.*,
        p.nombre as proveedor_nombre,
        p.cuit as proveedor_cuit,
        u.nombre_completo as creado_por,
        hd.dolar as dolar
       FROM facturas_compra fc
       JOIN proveedores p ON fc.proveedor_id = p.id
       LEFT JOIN usuarios u ON fc.created_by = u.id
       LEFT JOIN historial_dolar hd ON fc.dolar_historial_id = hd.id
       WHERE fc.id = $1`,
      [factura.id]
    );
    
    const itemsResult = await pool.query(
      `SELECT 
        fi.*,
        mp.codigo as materia_codigo,
        mp.nombre as materia_nombre,
        mp.unidad_medida as materia_unidad_medida
       FROM factura_items fi
       LEFT JOIN materias_primas mp ON fi.materia_prima_id = mp.id
       WHERE fi.factura_id = $1
       ORDER BY fi.id`,
      [factura.id]
    );
    
    const facturaCompleta = facturaCompletaResult.rows[0];
    facturaCompleta.items = itemsResult.rows;
    
    res.status(201).json(facturaCompleta);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando factura de compra:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   ACTUALIZAR FACTURA DE COMPRA
========================= */
router.put('/:id', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const {
      fecha_emision,
      fecha_recepcion,
      tipo_factura,
      punto_venta,
      numero_factura,
      numero_comprobante,
      cae,
      subtotal,
      iva,
      percepciones,
      retenciones,
      total,
      condicion_pago,
      observaciones,
      estado,
      dolar
    } = req.body;

    const usuario_id = req.usuario.id;

    // Verificar que la factura existe
    const facturaExistente = await client.query(
      'SELECT * FROM facturas_compra WHERE id = $1 FOR UPDATE',
      [id]
    );
    
    if (facturaExistente.rows.length === 0) {
      throw new Error('Factura no encontrada');
    }
    
    const facturaActual = facturaExistente.rows[0];
    
    // Validar tipo de factura si se proporciona
    if (tipo_factura && !['A', 'B', 'C', 'X'].includes(tipo_factura)) {
      throw new Error('Tipo de factura inválido. Debe ser A, B, C o X');
    }
    
    // Actualizar cabecera de factura
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;
    
    if (fecha_emision !== undefined) {
      updateFields.push(`fecha_emision = $${paramIndex}`);
      updateValues.push(fecha_emision);
      paramIndex++;
    }
    
    if (fecha_recepcion !== undefined) {
      updateFields.push(`fecha_recepcion = $${paramIndex}`);
      updateValues.push(fecha_recepcion);
      paramIndex++;
    }
    
    if (tipo_factura !== undefined) {
      updateFields.push(`tipo_factura = $${paramIndex}`);
      updateValues.push(tipo_factura);
      paramIndex++;
    }
    
    if (punto_venta !== undefined) {
      updateFields.push(`punto_venta = $${paramIndex}`);
      updateValues.push(punto_venta);
      paramIndex++;
    }
    
    if (numero_factura !== undefined) {
      updateFields.push(`numero_factura = $${paramIndex}`);
      updateValues.push(numero_factura);
      paramIndex++;
    }
    
    if (numero_comprobante !== undefined) {
      updateFields.push(`numero_comprobante = $${paramIndex}`);
      updateValues.push(numero_comprobante);
      paramIndex++;
    }
    
    if (cae !== undefined) {
      updateFields.push(`cae = $${paramIndex}`);
      updateValues.push(cae);
      paramIndex++;
    }
    
    if (subtotal !== undefined) {
      updateFields.push(`subtotal = $${paramIndex}`);
      updateValues.push(parseFloat(subtotal));
      paramIndex++;
    }
    
    if (iva !== undefined) {
      updateFields.push(`iva = $${paramIndex}`);
      updateValues.push(parseFloat(iva));
      paramIndex++;
    }
    
    if (percepciones !== undefined) {
      updateFields.push(`percepciones = $${paramIndex}`);
      updateValues.push(parseFloat(percepciones));
      paramIndex++;
    }
    
    if (retenciones !== undefined) {
      updateFields.push(`retenciones = $${paramIndex}`);
      updateValues.push(parseFloat(retenciones));
      paramIndex++;
    }
    
    if (total !== undefined) {
      updateFields.push(`total = $${paramIndex}`);
      updateValues.push(parseFloat(total));
      paramIndex++;
    }
    
    if (condicion_pago !== undefined) {
      updateFields.push(`condicion_pago = $${paramIndex}`);
      updateValues.push(condicion_pago);
      paramIndex++;
    }
    
    if (observaciones !== undefined) {
      updateFields.push(`observaciones = $${paramIndex}`);
      updateValues.push(observaciones);
      paramIndex++;
    }
    
    if (estado !== undefined) {
      updateFields.push(`estado = $${paramIndex}`);
      updateValues.push(estado);
      paramIndex++;
    }

    // Cotización del dólar: solo se toca si se manda un valor válido. Igual
    // que en el alta, se registra una fila nueva en historial_dolar y se liga
    // la factura a ella; no pisa parametros.dolar_banco (ver comentario en
    // el POST de este mismo archivo).
    const dolarValido = dolar !== undefined && dolar !== null && dolar !== '' && !isNaN(parseFloat(dolar)) && parseFloat(dolar) > 0;
    if (dolarValido) {
      const dolarResult = await client.query(
        `INSERT INTO historial_dolar (dolar, usuario_id, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id`,
        [parseFloat(dolar), usuario_id]
      );
      updateFields.push(`dolar_historial_id = $${paramIndex}`);
      updateValues.push(dolarResult.rows[0].id);
      paramIndex++;
    }

    // Solo actualizar si hay campos para actualizar
    if (updateFields.length > 0) {
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      
      const updateQuery = `
        UPDATE facturas_compra 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;
      updateValues.push(id);
      
      await client.query(updateQuery, updateValues);
    }
    
    await client.query('COMMIT');
    
    // Obtener factura actualizada
    const facturaActualizada = await pool.query(
      `SELECT
        fc.*,
        p.nombre as proveedor_nombre,
        p.cuit as proveedor_cuit,
        u.nombre_completo as creado_por,
        hd.dolar as dolar
       FROM facturas_compra fc
       JOIN proveedores p ON fc.proveedor_id = p.id
       LEFT JOIN usuarios u ON fc.created_by = u.id
       LEFT JOIN historial_dolar hd ON fc.dolar_historial_id = hd.id
       WHERE fc.id = $1`,
      [id]
    );
    
    res.json(facturaActualizada.rows[0]);
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error actualizando factura de compra:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   ELIMINAR FACTURA DE COMPRA
========================= */
router.delete('/:id', soloAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Verificar que la factura existe
    const facturaExistente = await client.query(
      'SELECT * FROM facturas_compra WHERE id = $1 FOR UPDATE',
      [id]
    );
    
    if (facturaExistente.rows.length === 0) {
      throw new Error('Factura no encontrada');
    }
    
    const factura = facturaExistente.rows[0];
    
    // Verificar que no esté pagada
    if (factura.estado === 'PAGADA') {
      throw new Error('No se puede eliminar una factura pagada');
    }
    
    // Revertir stock si la factura estaba activa
    if (factura.estado === 'PENDIENTE') {
      // Obtener items de la factura
      const itemsResult = await client.query(
        'SELECT * FROM factura_items WHERE factura_id = $1',
        [id]
      );
      
      // Revertir stock para cada item con materia_prima_id
      for (const item of itemsResult.rows) {
        if (item.materia_prima_id) {
          await client.query(
            `UPDATE materias_primas 
             SET stock_actual = stock_actual - $1,
                 actualizado_en = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [item.cantidad, item.materia_prima_id]
          );
          
          // Eliminar movimientos de stock asociados
          await client.query(
            'DELETE FROM stock_movimientos WHERE factura_id = $1 AND materia_prima_id = $2',
            [id, item.materia_prima_id]
          );
        }
      }
    }
    
    // Eliminar items de la factura
    await client.query('DELETE FROM factura_items WHERE factura_id = $1', [id]);
    
    // Eliminar factura
    await client.query('DELETE FROM facturas_compra WHERE id = $1', [id]);
    
    await client.query('COMMIT');
    
    res.json({ message: 'Factura eliminada correctamente' });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error eliminando factura de compra:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* =========================
   OBTENER ITEMS DE FACTURA
========================= */
router.get('/:id/items', soloAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT 
        fi.*,
        mp.codigo as materia_codigo,
        mp.nombre as materia_nombre,
        mp.unidad_medida as materia_unidad_medida,
        mp.precio_referencia as precio_referencia
       FROM factura_items fi
       LEFT JOIN materias_primas mp ON fi.materia_prima_id = mp.id
       WHERE fi.factura_id = $1
       ORDER BY fi.id`,
      [id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo items de factura:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   BUSCAR MATERIAS PRIMAS PARA FACTURA
========================= */
router.get('/materias-primas/buscar', soloAdmin, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.json([]);
    }
    
    const searchQuery = `%${query}%`;
    
    const result = await pool.query(
      `SELECT 
        id,
        codigo,
        nombre,
        unidad_medida,
        precio_referencia,
        stock_actual,
        fecha_ultima_compra
       FROM materias_primas
       WHERE codigo ILIKE $1 OR nombre ILIKE $1
       ORDER BY 
         CASE 
           WHEN codigo ILIKE $1 THEN 1
           WHEN nombre ILIKE $1 THEN 2
         END,
         nombre
       LIMIT 20`,
      [searchQuery]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error buscando materias primas:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   OBTENER ÚLTIMO PRECIO DE MATERIA PRIMA
========================= */
router.get('/materias-primas/:id/ultimo-precio', soloAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT 
        precio_referencia,
        fecha_ultima_compra
       FROM materias_primas
       WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Materia prima no encontrada' });
    }
    
    res.json({
      precio_referencia: result.rows[0].precio_referencia,
      fecha_ultima_compra: result.rows[0].fecha_ultima_compra
    });
  } catch (err) {
    console.error('Error obteniendo último precio:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   OBTENER FACTURAS PENDIENTES DE UN PROVEEDOR
========================= */
router.get('/proveedor/:proveedor_id/pendientes', soloAdmin, async (req, res) => {
  try {
    const { proveedor_id } = req.params;
    
    /* Reescrito 13/09/2026. La versión anterior tiraba 500 SIEMPRE: usaba
       EXTRACT(DAY FROM fc.fecha_vencimiento - CURRENT_DATE), y en Postgres
       `date - date` da integer, que EXTRACT no acepta. Además leía
       fc.neto_pagado, que nunca se actualizaba al pagar. Ahora el saldo
       sale del servicio compartido, igual que en Pagos a Proveedores. */
    const result = await pool.query(
      `WITH ${CTE_FACTURAS_COMPRA}
       SELECT fs.*,
              p.nombre AS proveedor_nombre,
              p.cuit   AS proveedor_cuit,
              fs.saldo AS saldo_pendiente,
              fs.dias_atraso AS dias_vencido,
              ${ESTADO_FACTURA_COMPRA} AS estado
       FROM facturas_compra_saldo fs
       JOIN proveedores p ON p.id = fs.proveedor_id
       WHERE fs.proveedor_id = $1 AND fs.saldo > 0.005
       ORDER BY fs.fecha_vencimiento ASC, fs.id ASC`,
      [proveedor_id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo facturas pendientes:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

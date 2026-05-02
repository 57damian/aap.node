const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

/* =========================
   OBTENER FACTURAS DE COMPRA
========================= */
router.get('/', authorize(['admin', 'control', 'compras']), async (req, res) => {
  try {
    const { proveedor_id, estado, fecha_desde, fecha_hasta, tipo_factura } = req.query;
    
    let query = `
      SELECT 
        fc.*,
        p.nombre as proveedor_nombre,
        p.cuit as proveedor_cuit,
        u.nombre_completo as creado_por,
        COALESCE(SUM(fi.subtotal), 0) as subtotal_items,
        COALESCE(SUM(fi.iva), 0) as iva_items,
        COALESCE(SUM(fi.total), 0) as total_items,
        COUNT(fi.id) as cantidad_items
      FROM facturas_compra fc
      JOIN proveedores p ON fc.proveedor_id = p.id
      LEFT JOIN usuarios u ON fc.created_by = u.id
      LEFT JOIN factura_items fi ON fc.id = fi.factura_id
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
    
    query += ' GROUP BY fc.id, p.nombre, p.cuit, u.nombre_completo ORDER BY fc.fecha_emision DESC, fc.id DESC';
    
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
router.get('/ultimo-numero', authorize(['admin', 'control', 'compras']), async (req, res) => {
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
router.get('/:id', authorize(['admin', 'control', 'compras']), async (req, res) => {
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
        u.nombre_completo as creado_por
       FROM facturas_compra fc
       JOIN proveedores p ON fc.proveedor_id = p.id
       LEFT JOIN usuarios u ON fc.created_by = u.id
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
router.post('/', authorize(['admin', 'control', 'compras']), async (req, res) => {
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
    
    // Insertar cabecera de factura
    const facturaResult = await client.query(
      `INSERT INTO facturas_compra (
        proveedor_id, fecha_emision, fecha_recepcion,
        tipo_factura, punto_venta, numero_factura,
        numero_comprobante, cae, subtotal, iva,
        percepciones, retenciones, total,
        condicion_pago, observaciones, estado,
        created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
        usuario_id
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
        
        // Registrar en historial de precios
        await client.query(
          `INSERT INTO historial_precios_materias (
            materia_prima_id, proveedor_id,
            precio_anterior, precio_nuevo,
            variacion_porcentaje, factura_id,
            fecha_cambio, created_by, created_at
          ) VALUES ($1, $2, NULL, $3, 0, $4, CURRENT_DATE, $5, CURRENT_TIMESTAMP)`,
          [
            materia_prima_id,
            proveedor_id,
            item.precio_unitario,
            factura.id,
            usuario_id
          ]
        );
      } else if (item.es_item_manual) {
        // Ítem manual que no se guarda como materia prima
        es_item_manual = true;
      } else if (materia_prima_id) {
        // Ítem existente - SIEMPRE verificar si el precio cambió
        // Obtener precio anterior actual
        const precioAnteriorResult = await client.query(
          'SELECT precio_referencia FROM materias_primas WHERE id = $1',
          [materia_prima_id]
        );
        
        const precio_anterior = precioAnteriorResult.rows[0]?.precio_referencia || 0;
        const precio_nuevo = item.precio_unitario;
        
        // Solo actualizar si el precio es diferente (con tolerancia de 0.01 para decimales)
        const diferencia = Math.abs(precio_nuevo - precio_anterior);
        if (diferencia > 0.01) {
          const variacion = precio_anterior > 0 
            ? ((precio_nuevo - precio_anterior) / precio_anterior) * 100 
            : 0;
          
          // Actualizar precio de referencia
          await client.query(
            `UPDATE materias_primas 
             SET precio_referencia = $1, fecha_ultima_compra = CURRENT_DATE, actualizado_en = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [precio_nuevo, materia_prima_id]
          );
          
          // Registrar en historial de precios
          await client.query(
            `INSERT INTO historial_precios_materias (
              materia_prima_id, proveedor_id,
              precio_anterior, precio_nuevo,
              variacion_porcentaje, factura_id,
              fecha_cambio, created_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, CURRENT_TIMESTAMP)`,
            [
              materia_prima_id,
              proveedor_id,
              precio_anterior,
              precio_nuevo,
              variacion,
              factura.id,
              usuario_id
            ]
          );
          
          console.log(`✅ Precio actualizado para materia prima ${materia_prima_id}: $${precio_anterior} → $${precio_nuevo} (${variacion.toFixed(2)}%)`);
        } else {
          console.log(`ℹ️  Precio sin cambios para materia prima ${materia_prima_id}: $${precio_anterior}`);
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
        
        // Actualizar stock
        await client.query(
          `UPDATE materias_primas 
           SET stock_actual = stock_actual + $1, 
               fecha_ultima_compra = CURRENT_DATE,
               actualizado_en = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [item.cantidad, materia_prima_id]
        );
        
        // Crear movimiento de stock
        await client.query(
          `INSERT INTO stock_movimientos (
            materia_prima_id, tipo_movimiento,
            cantidad, precio_unitario,
            factura_id, proveedor_id,
            observaciones, usuario_id, created_at,
            fecha_movimiento, unidad
          ) VALUES ($1, 'ENTRADA', $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_DATE, $8)`,
          [
            materia_prima_id,
            item.cantidad,
            item.precio_unitario,
            factura.id,
            proveedor_id,
            `Compra desde factura ${numero_factura}`,
            usuario_id,
            item.unidad_medida || 'UNI'
          ]
        );
        
        console.log(`✅ Stock actualizado y movimiento creado para materia prima ${materia_prima_id}`);
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
        u.nombre_completo as creado_por
       FROM facturas_compra fc
       JOIN proveedores p ON fc.proveedor_id = p.id
       LEFT JOIN usuarios u ON fc.created_by = u.id
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
router.put('/:id', authorize(['admin', 'control', 'compras']), async (req, res) => {
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
      estado
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
        u.nombre_completo as creado_por
       FROM facturas_compra fc
       JOIN proveedores p ON fc.proveedor_id = p.id
       LEFT JOIN usuarios u ON fc.created_by = u.id
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
router.delete('/:id', authorize(['admin', 'control']), async (req, res) => {
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
router.get('/:id/items', authorize(['admin', 'control', 'compras']), async (req, res) => {
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
router.get('/materias-primas/buscar', authorize(['admin', 'control', 'compras']), async (req, res) => {
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
router.get('/materias-primas/:id/ultimo-precio', authorize(['admin', 'control', 'compras']), async (req, res) => {
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
router.get('/proveedor/:proveedor_id/pendientes', authorize(['admin', 'control', 'compras']), async (req, res) => {
  try {
    const { proveedor_id } = req.params;
    
    const result = await pool.query(
      `SELECT 
        fc.*,
        p.nombre as proveedor_nombre,
        p.cuit as proveedor_cuit,
        fc.total - COALESCE(fc.neto_pagado, 0) as saldo_pendiente,
        EXTRACT(DAY FROM fc.fecha_vencimiento - CURRENT_DATE) as dias_vencido
       FROM facturas_compra fc
       JOIN proveedores p ON fc.proveedor_id = p.id
       WHERE fc.proveedor_id = $1 
         AND fc.estado = 'PENDIENTE'
         AND (fc.total - COALESCE(fc.neto_pagado, 0)) > 0
       ORDER BY fc.fecha_vencimiento ASC`,
      [proveedor_id]
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo facturas pendientes:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

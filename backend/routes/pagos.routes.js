const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

// ============================================
// OBTENER CLIENTES (para selects)
// ============================================
router.get('/clientes', authorize(['admin', 'control']), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nombre FROM clientes ORDER BY nombre'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// OBTENER FACTURAS PENDIENTES POR CLIENTE (CORREGIDO)
// ============================================
router.get('/facturas-pendientes/:cliente_id', authorize(['admin', 'control']), async (req, res) => {
    try {
        const result = await pool.query(
            `WITH facturas_con_pagos AS (
                SELECT 
                    f.id,
                    f.numero_factura,
                    f.tipo_factura,
                    f.fecha,
                    f.fecha_vencimiento,
                    f.total,
                    COALESCE(SUM(ap.monto_aplicado), 0) as total_pagado,
                    f.total - COALESCE(SUM(ap.monto_aplicado), 0) as saldo
                FROM facturas f
                LEFT JOIN aplicacion_pagos ap ON ap.factura_id = f.id
                WHERE f.cliente_id = $1
                    AND f.estado != 'anulada'
                GROUP BY f.id
                HAVING f.total - COALESCE(SUM(ap.monto_aplicado), 0) > 0.01
            )
            SELECT 
                *,
                CASE 
                    WHEN fecha_vencimiento < CURRENT_DATE THEN 'vencida'
                    ELSE 'pendiente'
                END as estado_pago,
                CURRENT_DATE - fecha_vencimiento as dias_vencida
            FROM facturas_con_pagos
            ORDER BY fecha_vencimiento ASC, fecha ASC`,
            [req.params.cliente_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error cargando facturas pendientes:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// OBTENER ESTADO DE CUENTA COMPLETO DEL CLIENTE (NUEVO)
// ============================================
router.get('/estado-cuenta/:cliente_id', authorize(['admin', 'control']), async (req, res) => {
    try {
        const facturadoRes = await pool.query(
            `SELECT COALESCE(SUM(f.total), 0) as total_facturado
             FROM facturas f
             WHERE f.cliente_id = $1 AND f.estado != 'anulada'`,
            [req.params.cliente_id]
        );

        const pagadoRes = await pool.query(
            `SELECT COALESCE(SUM(ap.monto_aplicado), 0) as total_pagado
             FROM aplicacion_pagos ap
             JOIN facturas f ON f.id = ap.factura_id
             WHERE f.cliente_id = $1`,
            [req.params.cliente_id]
        );

        const vencidaRes = await pool.query(
            `SELECT COALESCE(SUM(f.total - COALESCE(ap.pagado, 0)), 0) as deuda_vencida
             FROM facturas f
             LEFT JOIN (
                 SELECT factura_id, SUM(monto_aplicado) as pagado
                 FROM aplicacion_pagos
                 GROUP BY factura_id
             ) ap ON ap.factura_id = f.id
             WHERE f.cliente_id = $1 
                 AND f.fecha_vencimiento < CURRENT_DATE
                 AND f.estado != 'anulada'
                 AND f.total > COALESCE(ap.pagado, 0)`,
            [req.params.cliente_id]
        );

        const proximasRes = await pool.query(
            `SELECT COUNT(*) as cantidad, COALESCE(SUM(f.total - COALESCE(ap.pagado, 0)), 0) as total
             FROM facturas f
             LEFT JOIN (
                 SELECT factura_id, SUM(monto_aplicado) as pagado
                 FROM aplicacion_pagos
                 GROUP BY factura_id
             ) ap ON ap.factura_id = f.id
             WHERE f.cliente_id = $1 
                 AND f.fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
                 AND f.estado != 'anulada'
                 AND f.total > COALESCE(ap.pagado, 0)`,
            [req.params.cliente_id]
        );

        res.json({
            total_facturado: parseFloat(facturadoRes.rows[0].total_facturado),
            total_pagado: parseFloat(pagadoRes.rows[0].total_pagado),
            saldo_actual: parseFloat(facturadoRes.rows[0].total_facturado) - parseFloat(pagadoRes.rows[0].total_pagado),
            deuda_vencida: parseFloat(vencidaRes.rows[0].deuda_vencida),
            proximas_a_vencer: {
                cantidad: parseInt(proximasRes.rows[0].cantidad),
                total: parseFloat(proximasRes.rows[0].total)
            }
        });

    } catch (err) {
        console.error('Error obteniendo estado de cuenta:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// OBTENER TALONARIOS DISPONIBLES
// ============================================
router.get('/talonarios', authorize(['admin', 'control']), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM talonarios_recibo WHERE activo = true ORDER BY numero_talonario'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// CREAR PAGO (con múltiples items)
// ============================================
router.post('/pagos', authorize(['admin', 'control']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        const {
            cliente_id,
            fecha_recepcion,
            observaciones,
            items // array de items de pago
        } = req.body;

        // 1️⃣ Validar datos básicos
        if (!cliente_id || !fecha_recepcion || !items || items.length === 0) {
            throw new Error('Datos incompletos');
        }

        // 2️⃣ Calcular monto total
        const monto_total = items.reduce((sum, item) => sum + item.monto, 0);

        // 3️⃣ Crear el pago
        const pagoRes = await client.query(
            `INSERT INTO pagos
             (cliente_id, fecha_recepcion, monto_total, observaciones, estado)
             VALUES ($1, $2, $3, $4, 'pendiente')
             RETURNING *`,
            [cliente_id, fecha_recepcion, monto_total, observaciones]
        );
        const pago = pagoRes.rows[0];

        // 4️⃣ Insertar cada item
        for (const item of items) {
            await client.query(
                `INSERT INTO pago_items
                 (pago_id, tipo, monto, observaciones,
                  cheque_numero, cheque_banco, cheque_fecha_emision, cheque_fecha_cobro,
                  transferencia_banco_origen, transferencia_banco_destino,
                  transferencia_numero_operacion, transferencia_fecha)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    pago.id,
                    item.tipo,
                    item.monto,
                    item.observaciones || null,
                    item.cheque_numero || null,
                    item.cheque_banco || null,
                    item.cheque_fecha_emision || null,
                    item.cheque_fecha_cobro || null,
                    item.transferencia_banco_origen || null,
                    item.transferencia_banco_destino || null,
                    item.transferencia_numero_operacion || null,
                    item.transferencia_fecha || null
                ]
            );
        }

        await client.query('COMMIT');

        res.json({
            ok: true,
            pago: pago,
            message: '✅ Pago registrado correctamente'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creando pago:', err);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================
// APLICAR PAGO A FACTURAS
// ============================================
router.post('/pagos/:id/aplicar', authorize(['admin', 'control']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const { aplicaciones } = req.body; // array de { factura_id, monto_aplicado }

        if (!aplicaciones || aplicaciones.length === 0) {
            throw new Error('Debe seleccionar al menos una factura');
        }

        // 1️⃣ Verificar que el pago existe
        const pagoRes = await client.query(
            'SELECT * FROM pagos WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (pagoRes.rows.length === 0) {
            throw new Error('Pago no encontrado');
        }
        const pago = pagoRes.rows[0];

        // 2️⃣ Verificar que no esté ya aplicado
        if (pago.estado === 'aplicado') {
            throw new Error('El pago ya está completamente aplicado');
        }

        // 3️⃣ Calcular total a aplicar
        const totalAplicar = aplicaciones.reduce((sum, a) => sum + a.monto_aplicado, 0);
        if (totalAplicar > pago.monto_total) {
            throw new Error(`El monto a aplicar ($${totalAplicar}) supera el pago ($${pago.monto_total})`);
        }

        // 4️⃣ Aplicar a cada factura
        for (const ap of aplicaciones) {
            // Verificar saldo de factura
            const facturaRes = await client.query(
                `SELECT 
                    f.total,
                    COALESCE(SUM(ap.monto_aplicado), 0) as ya_aplicado
                FROM facturas f
                LEFT JOIN aplicacion_pagos ap ON ap.factura_id = f.id
                WHERE f.id = $1
                GROUP BY f.id`,
                [ap.factura_id]
            );

            if (facturaRes.rows.length === 0) {
                throw new Error(`Factura ${ap.factura_id} no encontrada`);
            }

            const factura = facturaRes.rows[0];
            const saldo = factura.total - factura.ya_aplicado;

            if (ap.monto_aplicado > saldo) {
                throw new Error(`Monto ${ap.monto_aplicado} supera saldo ${saldo} de factura`);
            }

            // Insertar aplicación
            await client.query(
                `INSERT INTO aplicacion_pagos (pago_id, factura_id, monto_aplicado)
                 VALUES ($1, $2, $3)`,
                [id, ap.factura_id, ap.monto_aplicado]
            );
        }

        // 5️⃣ Actualizar estado del pago
        let nuevoEstado = 'aplicado';
        if (totalAplicar < pago.monto_total) {
            nuevoEstado = 'parcial';
        }
        
        await client.query(
            'UPDATE pagos SET estado = $1, updated_at = NOW() WHERE id = $2',
            [nuevoEstado, id]
        );

        // 6️⃣ Si sobra dinero, crear saldo a favor
        if (totalAplicar < pago.monto_total) {
            const saldoFavor = pago.monto_total - totalAplicar;
            await client.query(
                `INSERT INTO saldos_favor (cliente_id, pago_id, monto_original, monto_utilizado)
                 VALUES ($1, $2, $3, 0)`,
                [pago.cliente_id, id, saldoFavor]
            );
        }

        await client.query('COMMIT');

        res.json({
            ok: true,
            message: '✅ Pago aplicado correctamente',
            estado: nuevoEstado
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error aplicando pago:', err);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================
// CREAR RECIBO (agrupa pagos)
// ============================================
router.post('/recibos', authorize(['admin', 'control']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        const {
            numero_recibo,
            talonario_numero,
            cliente_id,
            fecha_emision,
            pago_ids, // array de IDs de pagos
            observaciones
        } = req.body;

        // 1️⃣ Validar datos básicos
        if (!numero_recibo || !cliente_id || !pago_ids || pago_ids.length === 0) {
            throw new Error('Datos incompletos');
        }

        // 2️⃣ Verificar/crear talonario
        let talonario_id = null;
        if (talonario_numero) {
            const talonarioRes = await client.query(
                `INSERT INTO talonarios_recibo (numero_talonario, fecha_asignacion, usuario_asignado_id)
                 VALUES ($1, CURRENT_DATE, $2)
                 ON CONFLICT (numero_talonario) DO NOTHING
                 RETURNING id`,
                [talonario_numero, req.usuario.id]
            );
            
            if (talonarioRes.rows.length > 0) {
                talonario_id = talonarioRes.rows[0].id;
            } else {
                const talonarioExistente = await client.query(
                    'SELECT id FROM talonarios_recibo WHERE numero_talonario = $1',
                    [talonario_numero]
                );
                talonario_id = talonarioExistente.rows[0].id;
            }
        }

        // 3️⃣ Obtener datos de los pagos para calcular totales
        const pagosData = await client.query(
            `SELECT 
                p.*,
                COALESCE((
                    SELECT SUM(pi.monto)
                    FROM pago_items pi
                    WHERE pi.pago_id = p.id AND pi.tipo = 'EFECTIVO'
                ), 0) as total_efectivo,
                COALESCE((
                    SELECT SUM(pi.monto)
                    FROM pago_items pi
                    WHERE pi.pago_id = p.id AND pi.tipo = 'CHEQUE'
                ), 0) as total_cheques,
                COALESCE((
                    SELECT SUM(pi.monto)
                    FROM pago_items pi
                    WHERE pi.pago_id = p.id AND pi.tipo = 'TRANSFERENCIA'
                ), 0) as total_transferencias
            FROM pagos p
            WHERE p.id = ANY($1::int[])`,
            [pago_ids]
        );

        // 4️⃣ Calcular totales
        const totales = pagosData.rows.reduce((acc, p) => ({
            efectivo: acc.efectivo + parseFloat(p.total_efectivo || 0),
            cheques: acc.cheques + parseFloat(p.total_cheques || 0),
            transferencias: acc.transferencias + parseFloat(p.total_transferencias || 0),
            total: acc.total + parseFloat(p.monto_total || 0)
        }), { efectivo: 0, cheques: 0, transferencias: 0, total: 0 });

        // 5️⃣ Crear recibo
        const reciboRes = await client.query(
            `INSERT INTO recibos
             (numero_recibo, talonario_id, cliente_id, fecha_emision,
              pago_ids, total_efectivo, total_cheques, total_transferencias,
              total_pagado, observaciones, usuario_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
                numero_recibo,
                talonario_id,
                cliente_id,
                fecha_emision || new Date(),
                pago_ids,
                totales.efectivo,
                totales.cheques,
                totales.transferencias,
                totales.total,
                observaciones,
                req.usuario.id
            ]
        );

        await client.query('COMMIT');

        res.json({
            ok: true,
            recibo: reciboRes.rows[0],
            message: '✅ Recibo generado correctamente'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creando recibo:', err);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ============================================
// LISTAR PAGOS
// ============================================
router.get('/pagos', authorize(['admin', 'control']), async (req, res) => {
    const { cliente_id, desde, hasta, estado } = req.query;

    try {
        let query = `
            SELECT 
                p.*,
                cl.nombre as cliente_nombre,
                json_agg(
                    json_build_object(
                        'id', pi.id,
                        'tipo', pi.tipo,
                        'monto', pi.monto,
                        'cheque_numero', pi.cheque_numero,
                        'cheque_banco', pi.cheque_banco,
                        'cheque_fecha_cobro', pi.cheque_fecha_cobro,
                        'cheque_estado', pi.cheque_estado
                    )
                ) as items
            FROM pagos p
            JOIN clientes cl ON cl.id = p.cliente_id
            LEFT JOIN pago_items pi ON pi.pago_id = p.id
            WHERE 1=1
        `;

        const params = [];
        let paramCounter = 1;

        if (cliente_id) {
            query += ` AND p.cliente_id = $${paramCounter++}`;
            params.push(cliente_id);
        }

        if (desde) {
            query += ` AND p.fecha_recepcion >= $${paramCounter++}`;
            params.push(desde);
        }

        if (hasta) {
            query += ` AND p.fecha_recepcion <= $${paramCounter++}`;
            params.push(hasta);
        }

        if (estado) {
            query += ` AND p.estado = $${paramCounter++}`;
            params.push(estado);
        }

        query += ` GROUP BY p.id, cl.nombre ORDER BY p.fecha_recepcion DESC, p.id DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// LISTAR RECIBOS
// ============================================
router.get('/recibos', authorize(['admin', 'control']), async (req, res) => {
    const { cliente_id, desde, hasta } = req.query;

    try {
        let query = `
            SELECT 
                r.*,
                cl.nombre as cliente_nombre,
                t.numero_talonario
            FROM recibos r
            JOIN clientes cl ON cl.id = r.cliente_id
            LEFT JOIN talonarios_recibo t ON t.id = r.talonario_id
            WHERE 1=1
        `;

        const params = [];
        let paramCounter = 1;

        if (cliente_id) {
            query += ` AND r.cliente_id = $${paramCounter++}`;
            params.push(cliente_id);
        }

        if (desde) {
            query += ` AND r.fecha_emision >= $${paramCounter++}`;
            params.push(desde);
        }

        if (hasta) {
            query += ` AND r.fecha_emision <= $${paramCounter++}`;
            params.push(hasta);
        }

        query += ` ORDER BY r.fecha_emision DESC, r.id DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// OBTENER DETALLE DE RECIBO
// ============================================
router.get('/recibos/:id', authorize(['admin', 'control']), async (req, res) => {
    try {
        // Obtener recibo
        const reciboRes = await pool.query(
            `SELECT 
                r.*,
                cl.nombre as cliente_nombre,
                cl.cuit,
                cl.direccion,
                u.nombre_usuario as usuario_creo,
                t.numero_talonario
            FROM recibos r
            JOIN clientes cl ON cl.id = r.cliente_id
            LEFT JOIN usuarios u ON u.id = r.usuario_id
            LEFT JOIN talonarios_recibo t ON t.id = r.talonario_id
            WHERE r.id = $1`,
            [req.params.id]
        );

        if (reciboRes.rows.length === 0) {
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        const recibo = reciboRes.rows[0];

        // Obtener pagos incluidos en el recibo
        const pagosRes = await pool.query(
            `SELECT 
                p.*,
                json_agg(
                    json_build_object(
                        'id', pi.id,
                        'tipo', pi.tipo,
                        'monto', pi.monto,
                        'cheque_numero', pi.cheque_numero,
                        'cheque_banco', pi.cheque_banco,
                        'cheque_fecha_cobro', pi.cheque_fecha_cobro,
                        'cheque_estado', pi.cheque_estado,
                        'transferencia_numero_operacion', pi.transferencia_numero_operacion
                    )
                ) as items
            FROM pagos p
            LEFT JOIN pago_items pi ON pi.pago_id = p.id
            WHERE p.id = ANY($1::int[])
            GROUP BY p.id`,
            [recibo.pago_ids]
        );

        // Obtener aplicaciones a facturas de estos pagos
        const aplicacionesRes = await pool.query(
            `SELECT 
                ap.*,
                f.numero_factura,
                f.tipo_factura,
                f.fecha as fecha_factura
            FROM aplicacion_pagos ap
            JOIN facturas f ON f.id = ap.factura_id
            WHERE ap.pago_id = ANY($1::int[])
            ORDER BY ap.id`,
            [recibo.pago_ids]
        );

        res.json({
            ...recibo,
            pagos: pagosRes.rows,
            aplicaciones: aplicacionesRes.rows
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// OBTENER DETALLE DE PAGO
// ============================================
router.get('/pagos/:id', authorize(['admin', 'control']), async (req, res) => {
    try {
        const pagoRes = await pool.query(
            `SELECT
                p.*,
                cl.nombre as cliente_nombre
             FROM pagos p
             JOIN clientes cl ON cl.id = p.cliente_id
             WHERE p.id = $1`,
            [req.params.id]
        );

        if (pagoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pago no encontrado' });
        }

        const itemsRes = await pool.query(
            `SELECT
                pi.*
             FROM pago_items pi
             WHERE pi.pago_id = $1
             ORDER BY pi.id`,
            [req.params.id]
        );

        const pago = pagoRes.rows[0];
        pago.items = itemsRes.rows;

        res.json(pago);
    } catch (err) {
        console.error('Error obteniendo detalle de pago:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// GESTIÓN DE CHEQUES
// ============================================

// Depositar cheque
router.post('/cheques/:id/depositar', authorize(['admin', 'control']), async (req, res) => {
    const { fecha_depositado } = req.body;

    try {
        const result = await pool.query(
            `UPDATE pago_items 
             SET cheque_fecha_depositado = $1, cheque_estado = 'depositado', updated_at = NOW()
             WHERE id = $2 AND tipo = 'CHEQUE'
             RETURNING *`,
            [fecha_depositado || new Date(), req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cheque no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rechazar cheque
router.post('/cheques/:id/rechazar', authorize(['admin', 'control']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        const {
            motivo_rechazo,
            gasto_comision,
            nuevo_cheque // datos del cheque de reemplazo
        } = req.body;

        // Actualizar cheque original
        await client.query(
            `UPDATE pago_items 
             SET cheque_estado = 'rechazado', 
                 cheque_motivo_rechazo = $1, 
                 cheque_gasto_comision = $2,
                 updated_at = NOW()
             WHERE id = $3 AND tipo = 'CHEQUE'`,
            [motivo_rechazo, gasto_comision || 0, req.params.id]
        );

        // Si hay cheque de reemplazo, crearlo
        let chequeReemplazo = null;
        if (nuevo_cheque) {
            const reemplazoRes = await client.query(
                `INSERT INTO pago_items
                 (pago_id, tipo, monto, cheque_numero, cheque_banco,
                  cheque_fecha_emision, cheque_fecha_cobro, cheque_estado,
                  observaciones, cheque_reemplazo_id)
                 VALUES ($1, 'CHEQUE', $2, $3, $4, $5, $6, 'pendiente', $7, $8)
                 RETURNING *`,
                [
                    nuevo_cheque.pago_id,
                    nuevo_cheque.monto,
                    nuevo_cheque.numero_cheque,
                    nuevo_cheque.banco,
                    nuevo_cheque.fecha_emision,
                    nuevo_cheque.fecha_cobro,
                    nuevo_cheque.observaciones,
                    req.params.id
                ]
            );
            chequeReemplazo = reemplazoRes.rows[0];
        }

        await client.query('COMMIT');

        res.json({
            ok: true,
            message: 'Cheque rechazado registrado',
            cheque_rechazado_id: req.params.id,
            cheque_reemplazo: chequeReemplazo
        });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Acreditar cheque
router.put('/cheques/:id/acreditar', authorize(['admin', 'control']), async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE pago_items 
             SET cheque_estado = 'acreditado', updated_at = NOW()
             WHERE id = $1 AND tipo = 'CHEQUE'
             RETURNING *`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cheque no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Listar cheques con filtros
router.get('/cheques', authorize(['admin', 'control']), async (req, res) => {
    const { cliente_id, estado, desde, hasta } = req.query;

    try {
        let query = `
            SELECT 
                pi.*,
                p.cliente_id,
                cl.nombre as cliente_nombre
            FROM pago_items pi
            JOIN pagos p ON p.id = pi.pago_id
            JOIN clientes cl ON cl.id = p.cliente_id
            WHERE pi.tipo = 'CHEQUE'
        `;

        const params = [];
        let paramCounter = 1;

        if (cliente_id) {
            query += ` AND p.cliente_id = $${paramCounter++}`;
            params.push(cliente_id);
        }

        if (estado) {
            query += ` AND pi.cheque_estado = $${paramCounter++}`;
            params.push(estado);
        }

        if (desde) {
            query += ` AND pi.cheque_fecha_cobro >= $${paramCounter++}`;
            params.push(desde);
        }

        if (hasta) {
            query += ` AND pi.cheque_fecha_cobro <= $${paramCounter++}`;
            params.push(hasta);
        }

        query += ` ORDER BY pi.cheque_fecha_cobro ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// OBTENER DETALLE DE CHEQUE
// ============================================
router.get('/cheques/:id', authorize(['admin', 'control']), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                pi.*,
                p.cliente_id,
                cl.nombre as cliente_nombre
             FROM pago_items pi
             JOIN pagos p ON p.id = pi.pago_id
             JOIN clientes cl ON cl.id = p.cliente_id
             WHERE pi.id = $1 AND pi.tipo = 'CHEQUE'`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Cheque no encontrado' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error obteniendo cheque:', err);
        res.status(500).json({ error: err.message });
    }
});

// Alertas de cheques próximos a vencer
router.get('/cheques/alertas', authorize(['admin', 'control']), async (req, res) => {
    const { dias = 3 } = req.query;

    try {
        const result = await pool.query(
            `SELECT 
                pi.*,
                p.cliente_id,
                cl.nombre as cliente_nombre,
                cl.telefono,
                cl.correo,
                (pi.cheque_fecha_cobro - CURRENT_DATE) as dias_restantes
            FROM pago_items pi
            JOIN pagos p ON p.id = pi.pago_id
            JOIN clientes cl ON cl.id = p.cliente_id
            WHERE pi.tipo = 'CHEQUE'
                AND pi.cheque_estado = 'pendiente'
                AND pi.cheque_fecha_cobro BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::integer
            ORDER BY pi.cheque_fecha_cobro ASC`,
            [dias]
        );

        res.json({
            total: result.rows.length,
            cheques: result.rows,
            mensaje: result.rows.length > 0 
                ? `⚠️ Hay ${result.rows.length} cheque(s) próximo(s) a vencer`
                : '✅ No hay cheques próximos'
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// CUENTA CORRIENTE
// ============================================
router.get('/cuenta-corriente/:cliente_id', authorize(['admin', 'control']), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM cuenta_corriente WHERE cliente_id = $1',
            [req.params.cliente_id]
        );

        if (result.rows.length === 0) {
            return res.json({
                cliente_id: req.params.cliente_id,
                total_facturado: 0,
                total_pagado: 0,
                saldo_favor: 0,
                saldo_pendiente: 0
            });
        }

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

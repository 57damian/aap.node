const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

// =====================================================
// CRUD BÁSICO DE PROVEEDORES
// =====================================================

// Obtener todos los proveedores (con filtros básicos)
router.get('/', verificarToken, async (req, res) => {
    const { search, estado } = req.query;

    try {
        let query = `
            SELECT 
                p.*,
                (SELECT COUNT(*) FROM compras c WHERE c.proveedor_id = p.id) AS total_compras,
                (SELECT COALESCE(SUM(total), 0) FROM facturas_proveedor fp WHERE fp.proveedor_id = p.id AND fp.estado = 'PENDIENTE') AS deuda_pendiente
            FROM proveedores p
            WHERE 1=1
        `;

        const params = [];
        let paramIndex = 1;

        // Filtro por estado (activos/inactivos/todos)
        if (!estado || estado === 'activos') {
            query += ` AND p.activo = true`;
        } else if (estado === 'inactivos') {
            query += ` AND p.activo = false`;
        }

        // Búsqueda por texto (nombre, CUIT, email, contacto)
        if (search && search.trim() !== '') {
            query += ` AND (
                p.nombre ILIKE $${paramIndex} OR
                p.cuit ILIKE $${paramIndex} OR
                p.email ILIKE $${paramIndex} OR
                p.contacto ILIKE $${paramIndex}
            )`;
            params.push(`%${search.trim()}%`);
            paramIndex++;
        }

        query += ` ORDER BY p.nombre`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener proveedor por ID
router.get('/:id', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM proveedores WHERE id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crear proveedor
router.post('/', verificarToken, authorize(['admin', 'control']), async (req, res) => {
    const { 
        nombre, cuit, direccion, telefono, email, 
        contacto, condicion_iva, observaciones 
    } = req.body;
    
    // Validaciones básicas
    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }
    
    try {
        // Verificar si ya existe por CUIT
        if (cuit) {
            const existe = await pool.query(
                'SELECT id FROM proveedores WHERE cuit = $1',
                [cuit]
            );
            if (existe.rows.length > 0) {
                return res.status(400).json({ error: 'Ya existe un proveedor con ese CUIT' });
            }
        }
        
        const result = await pool.query(`
            INSERT INTO proveedores (
                nombre, cuit, direccion, telefono, email, 
                contacto, condicion_iva, observaciones, activo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
            RETURNING *
        `, [nombre, cuit, direccion, telefono, email, contacto, condicion_iva, observaciones]);
        
        // Insertar también en entidades
        await pool.query(`
            INSERT INTO entidades (tipo, entidad_id, nombre, cuit)
            VALUES ('PROVEEDOR', $1, $2, $3)
            ON CONFLICT (tipo, entidad_id) DO NOTHING
        `, [result.rows[0].id, nombre, cuit]);
        
        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Actualizar proveedor
router.put('/:id', verificarToken, authorize(['admin', 'control']), async (req, res) => {
    const { 
        nombre, cuit, direccion, telefono, email, 
        contacto, condicion_iva, observaciones, activo 
    } = req.body;
    
    try {
        // Verificar si existe
        const existe = await pool.query('SELECT id FROM proveedores WHERE id = $1', [req.params.id]);
        if (existe.rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }
        
        // Si cambia el CUIT, verificar que no esté duplicado
        if (cuit) {
            const duplicado = await pool.query(
                'SELECT id FROM proveedores WHERE cuit = $1 AND id != $2',
                [cuit, req.params.id]
            );
            if (duplicado.rows.length > 0) {
                return res.status(400).json({ error: 'Ya existe otro proveedor con ese CUIT' });
            }
        }
        
        const result = await pool.query(`
            UPDATE proveedores SET
                nombre = COALESCE($1, nombre),
                cuit = COALESCE($2, cuit),
                direccion = COALESCE($3, direccion),
                telefono = COALESCE($4, telefono),
                email = COALESCE($5, email),
                contacto = COALESCE($6, contacto),
                condicion_iva = COALESCE($7, condicion_iva),
                observaciones = COALESCE($8, observaciones),
                activo = COALESCE($9, activo),
                updated_at = NOW()
            WHERE id = $10
            RETURNING *
        `, [nombre, cuit, direccion, telefono, email, contacto, condicion_iva, observaciones, activo, req.params.id]);
        
        // Actualizar también en entidades
        await pool.query(`
            UPDATE entidades SET
                nombre = COALESCE($1, nombre),
                cuit = COALESCE($2, cuit)
            WHERE tipo = 'PROVEEDOR' AND entidad_id = $3
        `, [nombre, cuit, req.params.id]);
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar proveedor (soft delete)
router.delete('/:id', verificarToken, authorize(['admin']), async (req, res) => {
    try {
        // Verificar si tiene compras asociadas
        const compras = await pool.query(
            'SELECT COUNT(*) FROM compras WHERE proveedor_id = $1',
            [req.params.id]
        );
        
        if (parseInt(compras.rows[0].count) > 0) {
            // Si tiene compras, solo desactivar
            await pool.query(
                'UPDATE proveedores SET activo = false WHERE id = $1',
                [req.params.id]
            );
            res.json({ message: 'Proveedor desactivado (tiene compras asociadas)' });
        } else {
            // Si no tiene compras, eliminar físicamente
            await pool.query('DELETE FROM proveedores WHERE id = $1', [req.params.id]);
            // Eliminar de entidades
            await pool.query(
                'DELETE FROM entidades WHERE tipo = $1 AND entidad_id = $2',
                ['PROVEEDOR', req.params.id]
            );
            res.json({ message: 'Proveedor eliminado permanentemente' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =====================================================
// ENDPOINTS ESPECÍFICOS DE PROVEEDORES
// =====================================================

// Obtener compras del proveedor
router.get('/:id/compras', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.*,
                (SELECT COUNT(*) FROM compra_items ci WHERE ci.compra_id = c.id) as total_items,
                (SELECT COALESCE(SUM(total), 0) FROM facturas_proveedor fp WHERE fp.compra_id = c.id) as facturado
            FROM compras c
            WHERE c.proveedor_id = $1
            ORDER BY c.fecha_compra DESC
        `, [req.params.id]);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener detalle de una compra específica
router.get('/:id/compras/:compra_id', verificarToken, async (req, res) => {
    try {
        // Obtener cabecera de compra
        const compra = await pool.query(`
            SELECT c.*, p.nombre as proveedor_nombre, p.cuit
            FROM compras c
            JOIN proveedores p ON p.id = c.proveedor_id
            WHERE c.id = $1 AND c.proveedor_id = $2
        `, [req.params.compra_id, req.params.id]);
        
        if (compra.rows.length === 0) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }
        
        // Obtener items
        const items = await pool.query(`
            SELECT * FROM compra_items
            WHERE compra_id = $1
            ORDER BY id
        `, [req.params.compra_id]);
        
        // Obtener facturas asociadas
        const facturas = await pool.query(`
            SELECT * FROM facturas_proveedor
            WHERE compra_id = $1
            ORDER BY fecha_emision
        `, [req.params.compra_id]);
        
        res.json({
            ...compra.rows[0],
            items: items.rows,
            facturas: facturas.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener facturas del proveedor
router.get('/:id/facturas', verificarToken, async (req, res) => {
    const { estado, desde, hasta } = req.query;
    
    try {
        let query = `
            SELECT 
                fp.*,
                c.numero_oc,
                c.fecha_compra
            FROM facturas_proveedor fp
            LEFT JOIN compras c ON c.id = fp.compra_id
            WHERE fp.proveedor_id = $1
        `;
        const params = [req.params.id];
        let paramIndex = 2;
        
        if (estado) {
            query += ` AND fp.estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }
        
        if (desde) {
            query += ` AND fp.fecha_emision >= $${paramIndex}`;
            params.push(desde);
            paramIndex++;
        }
        
        if (hasta) {
            query += ` AND fp.fecha_emision <= $${paramIndex}`;
            params.push(hasta);
            paramIndex++;
        }
        
        query += ` ORDER BY fp.fecha_emision DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener cuenta corriente del proveedor (cálculo directo sin vista)
router.get('/:id/cuenta-corriente', verificarToken, async (req, res) => {
    const proveedorId = parseInt(req.params.id, 10);

    try {
        // Total facturado al proveedor (facturas proveedor)
        const facturasRes = await pool.query(
            `
            SELECT 
                COALESCE(SUM(total), 0) AS total_facturado,
                COALESCE(SUM(saldo_pendiente), 0) AS saldo_pendiente
            FROM facturas_proveedor
            WHERE proveedor_id = $1
            `,
            [proveedorId]
        );

        const totales = facturasRes.rows[0] || { total_facturado: 0, saldo_pendiente: 0 };

        // Total pagado = facturado - saldo pendiente
        const total_facturado = Number(totales.total_facturado || 0);
        const saldo_pendiente = Number(totales.saldo_pendiente || 0);
        const total_pagado = total_facturado - saldo_pendiente;

        res.json({
            proveedor_id: proveedorId,
            total_facturado,
            total_pagado,
            saldo_pendiente
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener cheques entregados al proveedor (cheques propios)
router.get('/:id/cheques-recibidos', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                cp.*,
                pi.id as pago_item_id,
                p.id as pago_id,
                p.fecha_recepcion
            FROM cheques_propios cp
            JOIN pago_items pi ON pi.id = cp.pago_item_id
            JOIN pagos p ON p.id = pi.pago_id
            WHERE cp.beneficiario ILIKE (
                SELECT nombre FROM proveedores WHERE id = $1
            )
            ORDER BY cp.fecha_emision DESC
        `, [req.params.id]);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener cheques de clientes endosados a este proveedor
router.get('/:id/cheques-endosados', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                e.*,
                pi.cheque_numero,
                pi.cheque_banco,
                pi.monto as monto_original,
                c.nombre as cliente_origen
            FROM endosos_cheques e
            JOIN pago_items pi ON pi.id = e.pago_item_id
            JOIN pagos p ON p.id = pi.pago_id
            JOIN clientes c ON c.id = p.cliente_id
            WHERE e.proveedor_id = $1
            ORDER BY e.fecha_endoso DESC
        `, [req.params.id]);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Resumen financiero del proveedor
router.get('/:id/resumen', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.id,
                p.nombre,
                p.cuit,
                COALESCE((
                    SELECT COUNT(*) FROM compras c 
                    WHERE c.proveedor_id = p.id
                ), 0) as total_compras,
                COALESCE((
                    SELECT SUM(total) FROM compras c 
                    WHERE c.proveedor_id = p.id
                ), 0) as monto_total_compras,
                COALESCE((
                    SELECT COUNT(*) FROM facturas_proveedor fp 
                    WHERE fp.proveedor_id = p.id
                ), 0) as total_facturas,
                COALESCE((
                    SELECT SUM(total) FROM facturas_proveedor fp 
                    WHERE fp.proveedor_id = p.id
                ), 0) as monto_total_facturas,
                COALESCE((
                    SELECT SUM(saldo_pendiente) FROM facturas_proveedor fp 
                    WHERE fp.proveedor_id = p.id AND fp.estado = 'PENDIENTE'
                ), 0) as deuda_pendiente,
                COALESCE((
                    SELECT COUNT(*) FROM endosos_cheques e 
                    WHERE e.proveedor_id = p.id AND e.estado = 'PENDIENTE'
                ), 0) as endosos_pendientes
            FROM proveedores p
            WHERE p.id = $1
        `, [req.params.id]);
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
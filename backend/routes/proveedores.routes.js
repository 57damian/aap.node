const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, authorize, soloAdmin } = require('../middlewares/auth');
/* Deuda y cuenta corriente salen del servicio compartido (13/09/2026).
   Antes cada endpoint de este archivo las calculaba por su cuenta contra
   pagos_proveedores filtrando por estado='CONFIRMADO', un estado que el
   alta de pagos nunca escribía: la deuda daba siempre el total facturado. */
const {
  CTE_FACTURAS_COMPRA, CTE_A_FAVOR_PROV, ESTADO_FACTURA_COMPRA, SUBQ_IMPUTADO,
  ESTADO_EFECTIVO_ITEM, resumenProveedor, cuentaCorrienteProveedor
} = require('../services/cuenta-proveedor');

// hallazgo S7: todos los endpoints de este archivo usaban verificarToken
// pero ninguno authorize(...) — cualquier usuario logueado, incluido un
// 'empleado' de planta, podía leer la cuenta corriente y la deuda de
// todos los proveedores. Mismo criterio que ya usan cobros.routes.js y
// pagos-proveedores.routes.js.
// Todo este módulo es plata: lo ve y lo toca solo el administrador.
// Antes la constante de lectura incluía 'operario', así que un usuario de
// planta podía consultar por API la deuda, los cheques y las cuentas
// corrientes aunque el menú no le mostrara esas pantallas.

// =====================================================
// CRUD BÁSICO DE PROVEEDORES
// =====================================================

// Obtener todos los proveedores (con filtros básicos)
router.get('/', verificarToken, soloAdmin, async (req, res) => {
    const { search, estado } = req.query;

    try {
        let query = `
            WITH ${CTE_FACTURAS_COMPRA}
            SELECT
                p.*,
                -- "Compras" cuenta facturas de compra reales, no la tabla
                -- legacy "compras" (que está casi vacía y hacía que esta
                -- columna mostrara 0 para todos).
                (SELECT COUNT(*) FROM facturas_compra fc WHERE fc.proveedor_id = p.id) AS total_compras,
                (SELECT ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005), 0), 2)
                   FROM facturas_compra_saldo fs WHERE fs.proveedor_id = p.id) AS deuda_pendiente,
                (SELECT ROUND(COALESCE(SUM(fs.saldo) FILTER (WHERE fs.saldo > 0.005 AND fs.dias_atraso > 0), 0), 2)
                   FROM facturas_compra_saldo fs WHERE fs.proveedor_id = p.id) AS deuda_vencida
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
router.get('/:id', verificarToken, soloAdmin, async (req, res) => {
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
router.post('/', verificarToken, soloAdmin, async (req, res) => {
    const {
        nombre, cuit, direccion, telefono, email,
        contacto, condicion_iva, observaciones,
        dias_credito, forma_pago_habitual   // hallazgo D3
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

        // hallazgo D3: antes ni el POST ni el PUT aceptaban dias_credito ni
        // forma_pago_habitual, así que dias_credito se quedaba siempre en
        // su default (0) y toda factura cargada aparecía "vencida" desde
        // el día uno en el panel de deuda.
        const result = await pool.query(`
            INSERT INTO proveedores (
                nombre, cuit, direccion, telefono, email,
                contacto, condicion_iva, observaciones, activo,
                dias_credito, forma_pago_habitual
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, COALESCE($9, 0), $10)
            RETURNING *
        `, [nombre, cuit, direccion, telefono, email, contacto, condicion_iva, observaciones, dias_credito, forma_pago_habitual]);

        // Nota (13/09/2026): antes acá se insertaba también en una tabla
        // "entidades" que no existe en la base real. Como esa consulta se
        // hacía después de este INSERT y sin una transacción que envolviera
        // ambas, el proveedor quedaba creado igual pero el endpoint
        // devolvía error 500 (nadie más en el sistema lee "entidades").
        // Se sacó por completo — ver auditoría de Proveedores en el doc del
        // proyecto.

        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Actualizar proveedor
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
    const {
        nombre, cuit, direccion, telefono, email,
        contacto, condicion_iva, observaciones, activo,
        dias_credito, forma_pago_habitual   // hallazgo D3
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
                dias_credito = COALESCE($10, dias_credito),
                forma_pago_habitual = COALESCE($11, forma_pago_habitual),
                updated_at = NOW()
            WHERE id = $12
            RETURNING *
        `, [nombre, cuit, direccion, telefono, email, contacto, condicion_iva, observaciones, activo, dias_credito, forma_pago_habitual, req.params.id]);

        // Nota (13/09/2026): ídem que en el POST de arriba — se sacó el
        // UPDATE a la tabla "entidades" (no existe en la base real, hacía
        // que cualquier edición de proveedor devolviera error 500 aunque el
        // cambio ya hubiera quedado guardado en "proveedores").

        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar proveedor (soft delete)
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
    try {
        /* Corregido 13/09/2026. Antes se miraba la tabla legacy `compras`
           (casi siempre vacía) para decidir si borrar físicamente, así que
           el DELETE se disparaba igual para proveedores con facturas de
           compra reales y Postgres lo rechazaba con un 500 feo por la FK.
           Ahora se chequea contra lo que de verdad depende del proveedor. */
        const dependencias = await pool.query(`
            SELECT
              (SELECT COUNT(*) FROM facturas_compra   WHERE proveedor_id = $1) AS facturas,
              (SELECT COUNT(*) FROM pagos_proveedores WHERE proveedor_id = $1) AS pagos,
              (SELECT COUNT(*) FROM stock_movimientos WHERE proveedor_id = $1) AS movimientos
        `, [req.params.id]);

        const d = dependencias.rows[0];
        const total = Number(d.facturas) + Number(d.pagos) + Number(d.movimientos);

        if (total > 0) {
            await pool.query('UPDATE proveedores SET activo = false WHERE id = $1', [req.params.id]);
            res.json({
                message: 'El proveedor tiene movimientos asociados, así que se desactivó en vez de borrarse',
                facturas: Number(d.facturas),
                pagos: Number(d.pagos),
                movimientos_stock: Number(d.movimientos)
            });
        } else {
            await pool.query('DELETE FROM proveedores WHERE id = $1', [req.params.id]);
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
router.get('/:id/compras', verificarToken, soloAdmin, async (req, res) => {
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
router.get('/:id/compras/:compra_id', verificarToken, soloAdmin, async (req, res) => {
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
router.get('/:id/facturas', verificarToken, soloAdmin, async (req, res) => {
    const { estado, desde, hasta } = req.query;
    
    try {
        let query = `
            WITH ${CTE_FACTURAS_COMPRA}
            SELECT
                fs.*,
                fs.pagado,
                fs.saldo AS saldo_pendiente,
                ${ESTADO_FACTURA_COMPRA} AS estado_calculado
            FROM facturas_compra_saldo fs
            WHERE fs.proveedor_id = $1
        `;
        const params = [req.params.id];
        let paramIndex = 2;

        if (estado) {
            query += ` AND ${ESTADO_FACTURA_COMPRA} = $${paramIndex}`;
            params.push(String(estado).toUpperCase());
            paramIndex++;
        }

        if (desde) {
            query += ` AND fs.fecha >= $${paramIndex}`;
            params.push(desde);
            paramIndex++;
        }

        if (hasta) {
            query += ` AND fs.fecha <= $${paramIndex}`;
            params.push(hasta);
            paramIndex++;
        }

        query += ` ORDER BY fs.fecha DESC`;
        
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener cuenta corriente del proveedor (cálculo directo sin vista)
router.get('/:id/cuenta-corriente', verificarToken, soloAdmin, async (req, res) => {
    const proveedorId = parseInt(req.params.id, 10);

    try {
        const totales = await resumenProveedor(pool, proveedorId);
        const movimientos = await cuentaCorrienteProveedor(pool, proveedorId, req.query);

        res.json({
            proveedor_id: proveedorId,
            total_facturado: Number(totales.total_facturado),
            total_pagado: Number(totales.total_pagado),
            saldo_pendiente: Number(totales.saldo),
            vencido: Number(totales.vencido),
            en_valores: Number(totales.en_valores),
            saldo_a_favor: Number(totales.saldo_a_favor),
            exceso_pagado: Number(totales.exceso_pagado),
            movimientos
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener cheques entregados al proveedor (cheques propios)
router.get('/:id/cheques-recibidos', verificarToken, soloAdmin, async (req, res) => {
    try {
        /* Reescrito 13/09/2026: la consulta anterior leía una tabla
           `cheques_propios` que no existe en la base (500 asegurado) y
           cruzaba por nombre con ILIKE. Los cheques entregados a un
           proveedor viven en pago_proveedor_items. */
        const result = await pool.query(`
            SELECT
                ppi.id, ppi.tipo, ppi.monto,
                COALESCE(ppi.cheque_numero, orig.cheque_numero)  AS cheque_numero,
                COALESCE(ppi.cheque_banco, orig.cheque_banco)    AS cheque_banco,
                COALESCE(ppi.cheque_fecha_emision, orig.cheque_fecha_emision) AS cheque_fecha_emision,
                COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro)     AS cheque_fecha_cobro,
                ppi.fecha_debito,
                ${ESTADO_EFECTIVO_ITEM} AS estado,
                pp.id AS pago_id, pp.fecha AS fecha_pago
            FROM pago_proveedor_items ppi
            JOIN pagos_proveedores pp ON pp.id = ppi.pago_id
            LEFT JOIN pago_items   orig ON orig.id = ppi.pago_item_origen_id
            WHERE pp.proveedor_id = $1
              AND ppi.tipo IN ('CHEQUE','CHEQUE_ENDOSADO')
            ORDER BY COALESCE(ppi.cheque_fecha_cobro, orig.cheque_fecha_cobro) DESC
        `, [req.params.id]);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Obtener cheques de clientes endosados a este proveedor
router.get('/:id/cheques-endosados', verificarToken, soloAdmin, async (req, res) => {
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
router.get('/:id/resumen', verificarToken, soloAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                p.id,
                p.nombre,
                p.cuit,
                p.dias_credito,
                COALESCE((
                    SELECT COUNT(*) FROM facturas_compra fc WHERE fc.proveedor_id = p.id
                ), 0) as total_facturas,
                COALESCE((
                    SELECT SUM(fc.total) FROM facturas_compra fc WHERE fc.proveedor_id = p.id
                ), 0) as monto_total_facturas,
                -- "compras" ahora son las facturas de compra reales, no la
                -- tabla legacy "compras" (que está prácticamente vacía).
                COALESCE((
                    SELECT COUNT(*) FROM facturas_compra fc WHERE fc.proveedor_id = p.id
                ), 0) as total_compras,
                COALESCE((
                    SELECT SUM(fc.total) FROM facturas_compra fc WHERE fc.proveedor_id = p.id
                ), 0) as monto_total_compras,
                -- hallazgo D9: antes solo contaba 'PENDIENTE', así que
                -- ignoraba los endosos creados desde Pagos a Proveedores
                -- (que quedan en 'APLICADO').
                COALESCE((
                    SELECT COUNT(*) FROM endosos_cheques e
                    WHERE e.proveedor_id = p.id AND e.estado IN ('PENDIENTE', 'APLICADO')
                ), 0) as endosos_pendientes
            FROM proveedores p
            WHERE p.id = $1
        `, [req.params.id]);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        const totales = await resumenProveedor(pool, req.params.id);

        res.json({
            ...result.rows[0],
            deuda_pendiente: Number(totales.saldo),
            deuda_vencida: Number(totales.vencido),
            total_pagado: Number(totales.total_pagado),
            en_valores: Number(totales.en_valores),
            saldo_a_favor: Number(totales.saldo_a_favor)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
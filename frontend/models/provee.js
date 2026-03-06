// models/proveedorModel.js
const db = require('../config/database');

class ProveedorModel {
    // Método para insertar un nuevo proveedor
    static async crear(proveedorData) {
        try {
            // Formatear CUIT (quitar guiones si los tiene)
            if (proveedorData.cuit) {
                proveedorData.cuit = proveedorData.cuit.replace(/[-\s]/g, '');
            }

            const [result] = await db.query(
                `INSERT INTO proveedores (
                    nombre, cuit, razon_social, condicion_iva, ingresos_brutos,
                    email, telefono, telefono_secundario, sitio_web,
                    direccion, ciudad, provincia, codigo_postal, pais,
                    banco, tipo_cuenta, numero_cuenta, cbu, alias_cbu,
                    rubro, categoria, observaciones, fecha_alta, activo
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    proveedorData.nombre,
                    proveedorData.cuit,
                    proveedorData.razon_social || null,
                    proveedorData.condicion_iva || 'Responsable Inscripto',
                    proveedorData.ingresos_brutos || null,
                    proveedorData.email || null,
                    proveedorData.telefono || null,
                    proveedorData.telefono_secundario || null,
                    proveedorData.sitio_web || null,
                    proveedorData.direccion || null,
                    proveedorData.ciudad || null,
                    proveedorData.provincia || null,
                    proveedorData.codigo_postal || null,
                    proveedorData.pais || 'Argentina',
                    proveedorData.banco || null,
                    proveedorData.tipo_cuenta || 'Caja de Ahorro',
                    proveedorData.numero_cuenta || null,
                    proveedorData.cbu || null,
                    proveedorData.alias_cbu || null,
                    proveedorData.rubro || null,
                    proveedorData.categoria || null,
                    proveedorData.observaciones || null,
                    new Date(),
                    proveedorData.activo !== undefined ? proveedorData.activo : true
                ]
            );
            
            return { id: result.insertId, ...proveedorData };
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('Ya existe un proveedor con ese CUIT');
            }
            throw error;
        }
    }

    // Método para obtener todos los proveedores
    static async obtenerTodos() {
        const [rows] = await db.query('SELECT * FROM proveedores WHERE activo = true ORDER BY nombre');
        return rows;
    }

    // Método para obtener un proveedor por ID
    static async obtenerPorId(id) {
        const [rows] = await db.query('SELECT * FROM proveedores WHERE id = ?', [id]);
        return rows[0];
    }

    // Método para actualizar un proveedor
    static async actualizar(id, proveedorData) {
        if (proveedorData.cuit) {
            proveedorData.cuit = proveedorData.cuit.replace(/[-\s]/g, '');
        }

        const [result] = await db.query(
            `UPDATE proveedores SET 
                nombre = ?, cuit = ?, razon_social = ?, condicion_iva = ?, 
                ingresos_brutos = ?, email = ?, telefono = ?, telefono_secundario = ?,
                sitio_web = ?, direccion = ?, ciudad = ?, provincia = ?, 
                codigo_postal = ?, pais = ?, banco = ?, tipo_cuenta = ?,
                numero_cuenta = ?, cbu = ?, alias_cbu = ?, rubro = ?,
                categoria = ?, observaciones = ?, activo = ?
            WHERE id = ?`,
            [
                proveedorData.nombre,
                proveedorData.cuit,
                proveedorData.razon_social,
                proveedorData.condicion_iva,
                proveedorData.ingresos_brutos,
                proveedorData.email,
                proveedorData.telefono,
                proveedorData.telefono_secundario,
                proveedorData.sitio_web,
                proveedorData.direccion,
                proveedorData.ciudad,
                proveedorData.provincia,
                proveedorData.codigo_postal,
                proveedorData.pais,
                proveedorData.banco,
                proveedorData.tipo_cuenta,
                proveedorData.numero_cuenta,
                proveedorData.cbu,
                proveedorData.alias_cbu,
                proveedorData.rubro,
                proveedorData.categoria,
                proveedorData.observaciones,
                proveedorData.activo,
                id
            ]
        );
        
        return result.affectedRows > 0;
    }

    // Método para eliminar (borrado lógico)
    static async eliminar(id) {
        const [result] = await db.query('UPDATE proveedores SET activo = false WHERE id = ?', [id]);
        return result.affectedRows > 0;
    }
}

module.exports = ProveedorModel;
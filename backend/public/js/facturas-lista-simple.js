// facturas-lista-simple.js
// Lógica completamente nueva para listar facturas de forma simple

// Variables globales
let facturasCache = [];

// Funciones de utilidad
function formatearMoneda(valor) {
    if (valor === null || valor === undefined) {
        return '$0,00';
    }
    const numero = typeof valor === 'string' ? parseFloat(valor.replace(/[^0-9.-]/g, '')) : valor;
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(numero || 0);
}

function formatearFecha(fecha) {
    if (!fecha) return '-';
    try {
        const date = new Date(fecha);
        if (isNaN(date.getTime())) return '-';
        return date.toLocaleDateString('es-AR');
    } catch (err) {
        console.error('Error formateando fecha:', err);
        return '-';
    }
}

function getEstadoBadge(estado) {
    return Shell.pill(estado || 'SIN ESTADO');
}

// Función principal para cargar facturas
async function cargarFacturas() {
    // Verificar autenticación
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const token = localStorage.getItem('token');

    if (!usuario.id || !token) {
        window.location.href = 'login.html';
        return;
    }

    const tbody = document.getElementById('tablaFacturasBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="muted">Cargando facturas…</td></tr>';
    }

    try {
        const facturas = await apiFetch('/api/facturas-compra');

        // Guardar en cache
        facturasCache = facturas;

        // Actualizar contador
        document.getElementById('totalFacturas').textContent = facturas.length;
        document.getElementById('contadorFacturas').textContent =
            facturas.length === 1 ? '1 factura' : `${facturas.length} facturas`;

        // Renderizar tabla
        renderizarTablaFacturas(facturas);

    } catch (error) {
        Shell.error(error, 'No se pudieron cargar las facturas');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8">${Shell.vacio(
                'No se pudieron cargar las facturas',
                'Probá recargar la página.')}</td></tr>`;
        }
    }
}

// Función para renderizar la tabla
function renderizarTablaFacturas(facturas) {
    const tbody = document.getElementById('tablaFacturasBody');
    if (!tbody) {
        console.error('No se encontró el elemento tablaFacturasBody');
        return;
    }
    
    if (facturas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8">${Shell.vacio(
            'No hay facturas registradas',
            'Cargá la primera desde Facturas de compra.',
            { txt: 'Ir a Facturas de compra', url: 'facturas-compra.html' })}</td></tr>`;
        return;
    }

    try {
        const htmlRows = facturas.map(factura => {
            const tipoFactura = factura.tipo_factura || 'A';
            const puntoVenta = factura.punto_venta || '0001';
            const numeroFactura = factura.numero_factura || '00000000';
            const proveedorNombre = factura.proveedor_nombre || factura.proveedor?.nombre || '—';

            const total = parseFloat(factura.total) || 0;
            const pagado = parseFloat(factura.pagado) || 0;
            const saldo = parseFloat(factura.saldo) || (total - pagado);

            const estado = factura.estado || 'PENDIENTE';
            const estadoBadge = getEstadoBadge(estado);
            const fechaEmision = Shell.fecha(factura.fecha_emision);

            return `
                <tr>
                    <td>
                        <strong>${tipoFactura} ${puntoVenta}-${numeroFactura}</strong>
                        ${factura.cae ? `<div class="muted">CAE: ${factura.cae}</div>` : ''}
                    </td>
                    <td data-label="Proveedor">${proveedorNombre}</td>
                    <td class="muted solo-escritorio" data-label="Emisión">${fechaEmision}</td>
                    <td class="num" data-label="Total">${formatearMoneda(total)}</td>
                    <td class="num muted solo-escritorio" data-label="Pagado">${formatearMoneda(pagado)}</td>
                    <td class="num ${saldo > 0 ? 'neg' : 'pos'}" data-label="Saldo"><strong>${formatearMoneda(saldo)}</strong></td>
                    <td data-label="Estado">${estadoBadge}</td>
                    <td class="num">
                        <button class="b b-ghost b-sm" onclick="verDetalleFactura(${factura.id})">Ver</button>
                        ${estado.toUpperCase() === 'PENDIENTE' ? `
                            <button class="b b-ghost b-sm" onclick="registrarPago(${factura.id})">Pagar</button>
                        ` : ''}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = htmlRows.join('');

    } catch (error) {
        Shell.error(error, 'No se pudo mostrar la lista de facturas');
        tbody.innerHTML = `<tr><td colspan="8">${Shell.vacio(
            'No se pudo mostrar la lista', 'Probá recargar la página.')}</td></tr>`;
    }
}

// Función para ver detalle de factura
async function verDetalleFactura(facturaId) {
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
        if (!usuario.id) {
            window.location.href = 'login.html';
            return;
        }

        // Buscar factura en cache primero; si no está, se pide a la API.
        const factura = facturasCache.find(f => f.id === facturaId)
            || await apiFetch(`/api/facturas-compra/${facturaId}`);

        const total = parseFloat(factura.total) || 0;
        const pagado = parseFloat(factura.pagado) || 0;
        const saldo = total - pagado;

        // Fecha de vencimiento: si no vino cargada, se estima desde la
        // condición de pago (30 o 60 días).
        let fechaVencimiento = '—';
        if (factura.fecha_vencimiento) {
            fechaVencimiento = formatearFecha(factura.fecha_vencimiento);
        } else if (factura.fecha_emision && factura.condicion_pago) {
            const fechaEmision = new Date(factura.fecha_emision);
            if (factura.condicion_pago.includes('30')) {
                fechaEmision.setDate(fechaEmision.getDate() + 30);
                fechaVencimiento = fechaEmision.toLocaleDateString('es-AR');
            } else if (factura.condicion_pago.includes('60')) {
                fechaEmision.setDate(fechaEmision.getDate() + 60);
                fechaVencimiento = fechaEmision.toLocaleDateString('es-AR');
            }
        }

        let html = `
            <div class="form-grid">
                <div class="field"><label>Factura</label><div><strong>${factura.tipo_factura || 'A'} ${factura.punto_venta || '0001'}-${factura.numero_factura || ''}</strong></div></div>
                <div class="field"><label>Proveedor</label><div>${factura.proveedor_nombre || factura.proveedor?.nombre || '—'}</div></div>
                <div class="field"><label>Emisión</label><div>${formatearFecha(factura.fecha_emision)}</div></div>
                <div class="field"><label>Vencimiento</label><div>${fechaVencimiento}</div></div>
                <div class="field"><label>Condición de pago</label><div>${factura.condicion_pago || 'CONTADO'}</div></div>
                <div class="field"><label>Estado</label><div>${getEstadoBadge(factura.estado)}</div></div>
            </div>
            <div class="panel" style="margin-top:16px"><div class="panel-body">
                <div class="totales-inline">
                    <div><span>Total factura</span><strong>${formatearMoneda(total)}</strong></div>
                    <div><span>Pagado</span><strong>${formatearMoneda(pagado)}</strong></div>
                    <div><span>Saldo pendiente</span><strong class="${saldo > 0 ? 'neg' : 'pos'}">${formatearMoneda(saldo)}</strong></div>
                </div>
            </div></div>
        `;

        if (factura.items && factura.items.length > 0) {
            html += `
                <div class="panel" style="margin-top:16px">
                    <div class="panel-head"><h3 style="margin:0;font-size:1rem">Items de la factura</h3></div>
                    <div class="panel-body flush"><div class="table-wrap">
                        <table class="t">
                            <thead><tr><th>Artículo</th><th class="num">Cantidad</th><th class="num">Precio unit.</th><th class="num">Total</th></tr></thead>
                            <tbody>
                                ${factura.items.map(item => `
                                    <tr>
                                        <td>${item.articulo_nombre || item.descripcion || '—'}</td>
                                        <td class="num" data-label="Cantidad">${item.cantidad || 0}</td>
                                        <td class="num" data-label="Precio unit.">${formatearMoneda(item.precio_unitario)}</td>
                                        <td class="num" data-label="Total">${formatearMoneda(item.total)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div></div>
                </div>
            `;
        }

        document.getElementById('detalleFacturaContent').innerHTML = html;
        document.getElementById('detalleFacturaModal').showModal();

    } catch (error) {
        Shell.error(error, 'No se pudo cargar el detalle de la factura');
    }
}

// Función para registrar pago (simplificada)
function registrarPago(facturaId) {
    const factura = facturasCache.find(f => f.id === facturaId);
    if (!factura) {
        Shell.toast('err', 'No se encontró la factura');
        return;
    }

    const total = parseFloat(factura.total) || 0;
    const pagado = parseFloat(factura.pagado) || 0;
    const saldo = total - pagado;

    if (saldo <= 0) {
        Shell.toast('ok', 'Esta factura ya está pagada por completo');
        return;
    }

    // Redirigir a la página de pagos con la factura seleccionada
    window.location.href = `pagos-proveedores.html?factura_id=${facturaId}`;
}

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    console.log('facturas-lista-simple.js cargado');
    
    // Verificar autenticación
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    if (!usuario.id) {
        window.location.href = 'login.html';
        return;
    }
    
    // Cargar facturas automáticamente
    setTimeout(() => {
        cargarFacturas();
    }, 100);
});
// facturas-lista-simple.js
// Lógica completamente nueva para listar facturas de forma simple

// Variables globales
let facturasCache = [];

// Funciones de utilidad
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function formatearMoneda(valor) {
    // Montos ocultos: Shell.monto lo anota para que el ojo lo oculte (shell.js).
    const anotar = t => (window.Shell && Shell.monto ? Shell.monto(t) : t);
    if (valor === null || valor === undefined) {
        return anotar('$0,00');
    }
    const numero = typeof valor === 'string' ? parseFloat(valor.replace(/[^0-9.-]/g, '')) : valor;
    return anotar(new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(numero || 0));
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

        pintarFacturas();

    } catch (error) {
        Shell.error(error, 'No se pudieron cargar las facturas');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8">${Shell.vacio(
                'No se pudieron cargar las facturas',
                'Probá recargar la página.')}</td></tr>`;
        }
    }
}

// Filtro client-side sobre lo ya cargado, sin volver a pedir nada al
// servidor (mismo patrón que oc.js / correcciones.js).
function contieneFactura(factura, texto) {
    const campos = [
        factura.numero_factura, factura.punto_venta,
        factura.proveedor_nombre || factura.proveedor?.nombre, factura.cae
    ];
    return campos.join(' ').toLowerCase().includes(texto.toLowerCase());
}

function pintarFacturas() {
    const texto = document.getElementById('filtroFacturas')?.value.trim() || '';
    const facturas = texto ? facturasCache.filter(f => contieneFactura(f, texto)) : facturasCache;

    document.getElementById('totalFacturas').textContent = facturasCache.length;
    document.getElementById('contadorFacturas').textContent =
        facturasCache.length === 1 ? '1 factura' : `${facturasCache.length} facturas`;

    renderizarTablaFacturas(facturas);
}

// Función para renderizar la tabla
function renderizarTablaFacturas(facturas) {
    const tbody = document.getElementById('tablaFacturasBody');
    if (!tbody) {
        console.error('No se encontró el elemento tablaFacturasBody');
        return;
    }
    
    if (facturas.length === 0) {
        tbody.innerHTML = facturasCache.length
            ? `<tr><td colspan="8">${Shell.vacio('No hay resultados', 'Probá con otra búsqueda.')}</td></tr>`
            : `<tr><td colspan="8">${Shell.vacio(
                'No hay facturas registradas',
                'Cargá la primera desde Facturas de compra.',
                { txt: 'Cargar factura', url: 'facturas-compra.html' })}</td></tr>`;
        return;
    }

    try {
        const htmlRows = facturas.map(factura => {
            const tipoFactura = esc(factura.tipo_factura || 'A');
            const puntoVenta = esc(factura.punto_venta || '0001');
            const numeroFactura = esc(factura.numero_factura || '00000000');
            const proveedorNombre = esc(factura.proveedor_nombre || factura.proveedor?.nombre || '—');

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
                        ${factura.cae ? `<div class="muted">CAE: ${esc(factura.cae)}</div>` : ''}
                    </td>
                    <td data-label="Proveedor">${proveedorNombre}</td>
                    <td class="muted solo-escritorio" data-label="Emisión">${fechaEmision}</td>
                    <td class="num" data-label="Total">${formatearMoneda(total)}</td>
                    <td class="num muted solo-escritorio" data-label="Pagado">${formatearMoneda(pagado)}</td>
                    <td class="num ${saldo > 0 ? 'neg' : 'pos'}" data-label="Saldo"><strong>${formatearMoneda(saldo)}</strong></td>
                    <td data-label="Estado">${estadoBadge}</td>
                    <td class="num">
                        <button class="b b-ghost b-sm" onclick="verDetalleFactura(${factura.id})">Ver</button>
                        <a class="b b-ghost b-sm" href="facturas-compra.html?id=${factura.id}">Editar</a>
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

        // Siempre se pide el detalle a la API: GET /api/facturas-compra (la
        // lista, lo que llena facturasCache) no trae los ítems, así que
        // usar la caché acá los dejaba afuera del diálogo siempre (hallazgo
        // 28/09/2026). GET /api/facturas-compra/:id sí los trae.
        const factura = await apiFetch(`/api/facturas-compra/${facturaId}`);

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
                <div class="field"><label>Factura</label><div><strong>${esc(factura.tipo_factura || 'A')} ${esc(factura.punto_venta || '0001')}-${esc(factura.numero_factura || '')}</strong></div></div>
                <div class="field"><label>Proveedor</label><div>${esc(factura.proveedor_nombre || factura.proveedor?.nombre || '—')}</div></div>
                <div class="field"><label>Emisión</label><div>${formatearFecha(factura.fecha_emision)}</div></div>
                <div class="field"><label>Vencimiento</label><div>${fechaVencimiento}</div></div>
                <div class="field"><label>Condición de pago</label><div>${esc(factura.condicion_pago || 'CONTADO')}</div></div>
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
                                        <td>${esc(item.nombre || item.materia_nombre || item.descripcion || '—')}</td>
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
    
    document.getElementById('filtroFacturas')?.addEventListener('input', pintarFacturas);

    // Cargar facturas automáticamente
    setTimeout(() => {
        cargarFacturas();
    }, 100);
});
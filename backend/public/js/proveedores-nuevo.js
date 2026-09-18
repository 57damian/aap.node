/* =====================================================================
 * proveedores-nuevo.js — Alta y listado de proveedores
 * Migrado al shell (F1.5 del plan de rediseño): misma lógica de negocio.
 * Los dos modales viejos (alta/edición y detalle) se unifican en el
 * mismo drawer lateral que usan Cobros, Pagos a proveedores y Clientes,
 * cambiando solo lo que se le carga adentro.
 *
 * F3.4 (hallazgo D3 de la auditoría): el formulario ya incluye
 * "Días de crédito" y "Forma de pago habitual" — el backend los acepta
 * en el POST/PUT desde el 13/09/2026, así que acá no hace falta ningún
 * fix adicional, solo migrar la pantalla.
 * ===================================================================== */

let proveedoresData = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnNuevoProveedor').addEventListener('click', () => abrirDrawerForm());
  document.getElementById('btnBuscar').addEventListener('click', cargarProveedores);
  document.getElementById('btnLimpiarFiltros').addEventListener('click', limpiarFiltros);
  document.getElementById('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') cargarProveedores();
  });
  document.getElementById('btnCerrarDrawer').addEventListener('click', cerrarDrawer);
  document.getElementById('drawerBg').addEventListener('click', cerrarDrawer);

  cargarProveedores();
});

/* ---------------------- listado ---------------------- */

async function cargarProveedores() {
  const search = document.getElementById('searchInput').value;
  const estado = document.getElementById('filtroEstado').value;
  const deudaFiltro = document.getElementById('filtroDeuda').value;

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (estado !== 'todos') params.append('estado', estado);

  const tbody = document.getElementById('proveedoresTableBody');
  try {
    let proveedores = await apiFetch(`/api/proveedores?${params.toString()}`);
    if (deudaFiltro === 'con-deuda') {
      proveedores = proveedores.filter(p => parseFloat(p.deuda_pendiente || 0) > 0);
    } else if (deudaFiltro === 'sin-deuda') {
      proveedores = proveedores.filter(p => parseFloat(p.deuda_pendiente || 0) === 0);
    }
    proveedoresData = proveedores;
    renderTabla(proveedores);
    renderKpis(proveedores);
  } catch (err) {
    Shell.error(err, 'No se pudieron cargar los proveedores');
    tbody.innerHTML = '<tr><td colspan="6">' + Shell.vacio('No se pudo cargar esta tabla', 'Probá recargar la página.') + '</td></tr>';
  }
}

function renderTabla(proveedores) {
  const tbody = document.getElementById('proveedoresTableBody');

  if (!proveedores.length) {
    tbody.innerHTML = '<tr><td colspan="6">' + Shell.vacio(
      'No hay proveedores para este filtro',
      'Probá limpiar los filtros o cargá el primer proveedor.',
      { txt: 'Nuevo proveedor', url: '#' }
    ) + '</td></tr>';
    return;
  }

  tbody.innerHTML = proveedores.map(p => `
    <tr>
      <td><strong>${escapeHtml(p.nombre)}</strong><div class="muted">${p.cuit || 'Sin CUIT'}</div></td>
      <td data-label="Contacto">${p.telefono || '—'}${p.email ? '<div class="muted">' + escapeHtml(p.email) + '</div>' : ''}</td>
      <td class="num" data-label="Compras">${p.total_compras || 0}</td>
      <td class="num ${p.deuda_pendiente > 0 ? 'neg' : ''}" data-label="Deuda">${Shell.money(p.deuda_pendiente || 0)}</td>
      <td data-label="Estado"><span class="pill ${p.activo ? 'pill-ok' : 'pill-neutral'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td data-label="Acciones">
        <button class="b b-ghost b-sm" onclick="abrirDrawerVer(${p.id})">Ver</button>
        <button class="b b-ghost b-sm" onclick="abrirDrawerForm(${p.id})">Editar</button>
        <button class="b b-danger b-sm" onclick="confirmarEliminar(${p.id}, '${escapeHtml(p.nombre).replace(/'/g, "\\'")}')">Eliminar</button>
      </td>
    </tr>`).join('');
}

function renderKpis(proveedores) {
  const total = proveedores.length;
  const activos = proveedores.filter(p => p.activo).length;
  const deudaTotal = proveedores.reduce((sum, p) => sum + (parseFloat(p.deuda_pendiente) || 0), 0);
  const totalCompras = proveedores.reduce((sum, p) => sum + (Number(p.total_compras) || 0), 0);

  document.getElementById('kpis').innerHTML = `
    <div class="kpi">
      <div class="kpi-k">Proveedores</div>
      <div class="kpi-v">${total}</div>
    </div>
    <div class="kpi is-success">
      <div class="kpi-k">Activos</div>
      <div class="kpi-v">${activos}</div>
    </div>
    <div class="kpi ${deudaTotal > 0 ? 'is-danger' : ''}">
      <div class="kpi-k">Deuda total</div>
      <div class="kpi-v">${Shell.money(deudaTotal)}</div>
    </div>
    <div class="kpi is-info">
      <div class="kpi-k">Compras registradas</div>
      <div class="kpi-v">${totalCompras}</div>
    </div>`;
}

function limpiarFiltros() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filtroEstado').value = 'activos';
  document.getElementById('filtroDeuda').value = 'todos';
  cargarProveedores();
}

/* ---------------------- alta / edición (drawer) ---------------------- */

function abrirDrawerForm(id = null) {
  const proveedor = id ? proveedoresData.find(p => p.id === id) : null;

  document.getElementById('drawerTitulo').textContent = id ? 'Editar proveedor' : 'Nuevo proveedor';
  document.getElementById('drawerMeta').textContent = id ? (proveedor ? proveedor.nombre : '') : 'Alta de proveedor';

  document.getElementById('drawerCuerpo').innerHTML = `
    <form id="proveedorForm">
      <div class="panel">
        <div class="panel-head">Datos generales</div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="field ancho-total">
              <label for="nombre">Nombre *</label>
              <input class="input" type="text" id="nombre" required value="${proveedor ? escapeHtml(proveedor.nombre) : ''}">
            </div>
            <div class="field">
              <label for="cuit">CUIT</label>
              <input class="input" type="text" id="cuit" placeholder="XX-XXXXXXXX-X" value="${proveedor ? (proveedor.cuit || '') : ''}">
            </div>
            <div class="field">
              <label for="telefono">Teléfono</label>
              <input class="input" type="text" id="telefono" value="${proveedor ? (proveedor.telefono || '') : ''}">
            </div>
            <div class="field">
              <label for="email">Email</label>
              <input class="input" type="email" id="email" value="${proveedor ? (proveedor.email || '') : ''}">
            </div>
            <div class="field">
              <label for="direccion">Dirección</label>
              <input class="input" type="text" id="direccion" value="${proveedor ? (proveedor.direccion || '') : ''}">
            </div>
            <div class="field">
              <label for="contacto">Contacto</label>
              <input class="input" type="text" id="contacto" value="${proveedor ? (proveedor.contacto || '') : ''}">
            </div>
            <div class="field">
              <label for="condicion_iva">Condición IVA</label>
              <select class="select" id="condicion_iva">
                <option${!proveedor || proveedor.condicion_iva === 'RESPONSABLE INSCRIPTO' ? ' selected' : ''}>RESPONSABLE INSCRIPTO</option>
                <option${proveedor && proveedor.condicion_iva === 'MONOTRIBUTO' ? ' selected' : ''}>MONOTRIBUTO</option>
                <option${proveedor && proveedor.condicion_iva === 'EXENTO' ? ' selected' : ''}>EXENTO</option>
                <option${proveedor && proveedor.condicion_iva === 'CONSUMIDOR FINAL' ? ' selected' : ''}>CONSUMIDOR FINAL</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">Condiciones de pago</div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="field">
              <label for="dias_credito">Días de crédito <button type="button" class="ayuda" data-ayuda="dias_credito">?</button></label>
              <input class="input" type="number" id="dias_credito" min="0" step="1" value="${proveedor ? (proveedor.dias_credito ?? 0) : 0}">
            </div>
            <div class="field">
              <label for="forma_pago_habitual">Forma de pago habitual</label>
              <select class="select" id="forma_pago_habitual">
                <option value=""${!proveedor || !proveedor.forma_pago_habitual ? ' selected' : ''}>-- Sin especificar --</option>
                <option value="TRANSFERENCIA"${proveedor && proveedor.forma_pago_habitual === 'TRANSFERENCIA' ? ' selected' : ''}>TRANSFERENCIA</option>
                <option value="CHEQUE"${proveedor && proveedor.forma_pago_habitual === 'CHEQUE' ? ' selected' : ''}>CHEQUE</option>
                <option value="EFECTIVO"${proveedor && proveedor.forma_pago_habitual === 'EFECTIVO' ? ' selected' : ''}>EFECTIVO</option>
              </select>
            </div>
            ${id ? `
            <div class="field">
              <label for="activo">Estado</label>
              <select class="select" id="activo">
                <option value="true"${!proveedor || proveedor.activo ? ' selected' : ''}>Activo</option>
                <option value="false"${proveedor && !proveedor.activo ? ' selected' : ''}>Inactivo</option>
              </select>
            </div>` : ''}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">Observaciones</div>
        <div class="panel-body">
          <div class="field ancho-total">
            <label for="observaciones">Notas adicionales</label>
            <textarea class="input" style="height:80px" id="observaciones">${proveedor ? (proveedor.observaciones || '') : ''}</textarea>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:var(--space-3); flex-wrap:wrap;">
        <button type="submit" class="b b-primary">Guardar</button>
        <button type="button" class="b b-ghost" id="btnCancelarForm">Cancelar</button>
      </div>
    </form>`;

  document.getElementById('proveedorForm').addEventListener('submit', (e) => { e.preventDefault(); guardarProveedor(id); });
  document.getElementById('btnCancelarForm').addEventListener('click', cerrarDrawer);

  abrirDrawer();
}

async function guardarProveedor(id) {
  const data = {
    nombre: document.getElementById('nombre').value,
    cuit: document.getElementById('cuit').value,
    telefono: document.getElementById('telefono').value,
    email: document.getElementById('email').value,
    direccion: document.getElementById('direccion').value,
    contacto: document.getElementById('contacto').value,
    condicion_iva: document.getElementById('condicion_iva').value,
    dias_credito: parseInt(document.getElementById('dias_credito').value, 10) || 0,
    forma_pago_habitual: document.getElementById('forma_pago_habitual').value || null,
    observaciones: document.getElementById('observaciones').value
  };
  if (id) data.activo = document.getElementById('activo').value === 'true';
  if (!data.nombre) { Shell.toast('err', 'El nombre es obligatorio.'); return; }

  const url = id ? `/api/proveedores/${id}` : '/api/proveedores';
  const method = id ? 'PUT' : 'POST';
  try {
    await apiFetch(url, { method, body: JSON.stringify(data) });
    Shell.toast('ok', id ? 'Proveedor actualizado correctamente.' : 'Proveedor creado correctamente.');
    cerrarDrawer();
    cargarProveedores();
  } catch (err) {
    Shell.error(err, 'No se pudo guardar el proveedor');
  }
}

/* ---------------------- ficha del proveedor (drawer) ---------------------- */

async function abrirDrawerVer(id) {
  document.getElementById('drawerTitulo').textContent = 'Cargando...';
  document.getElementById('drawerMeta').textContent = '';
  document.getElementById('drawerCuerpo').innerHTML = '';
  abrirDrawer();

  try {
    const r = await apiFetch(`/api/proveedores/${id}/resumen`);

    document.getElementById('drawerTitulo').textContent = r.nombre || 'Proveedor';
    document.getElementById('drawerMeta').textContent = r.cuit || '';

    let html = `
      <div class="kpi-row">
        <div class="kpi ${r.deuda_pendiente > 0 ? 'is-danger' : ''}">
          <div class="kpi-k">Deuda pendiente</div>
          <div class="kpi-v">${Shell.money(r.deuda_pendiente)}</div>
        </div>
        <div class="kpi ${r.deuda_vencida > 0 ? 'is-warning' : ''}">
          <div class="kpi-k">Vencido</div>
          <div class="kpi-v">${Shell.money(r.deuda_vencida)}</div>
        </div>
        <div class="kpi is-info">
          <div class="kpi-k">En valores <button type="button" class="ayuda" data-ayuda="en_valores">?</button></div>
          <div class="kpi-v">${Shell.money(r.en_valores)}</div>
        </div>
        <div class="kpi is-success">
          <div class="kpi-k">Saldo a favor</div>
          <div class="kpi-v">${Shell.money(r.saldo_a_favor)}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">Condiciones de pago</div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="field"><label>Días de crédito <button type="button" class="ayuda" data-ayuda="dias_credito">?</button></label><div>${r.dias_credito ?? 0} días</div></div>
            <div class="field"><label>Compras registradas</label><div>${r.total_compras || 0} (${Shell.money(r.monto_total_compras)})</div></div>
            <div class="field"><label>Endosos pendientes</label><div>${r.endosos_pendientes || 0}</div></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">Cuenta corriente <button type="button" class="ayuda" data-ayuda="cuenta_corriente">?</button></div>
        <div class="panel-body">
          <p class="muted">El detalle movimiento por movimiento está en Pagos a proveedores.</p>
          <a class="b b-ghost b-sm" href="pagos-proveedores.html">Ver en Pagos a proveedores</a>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">Facturas pendientes</div>
        <div class="panel-body flush" id="facturasPendientes">
          <div class="table-wrap"><table class="t"><tbody><tr><td>Cargando...</td></tr></tbody></table></div>
        </div>
      </div>`;

    document.getElementById('drawerCuerpo').innerHTML = html;

    const facturas = await apiFetch(`/api/proveedores/${id}/facturas?estado=PENDIENTE`);
    const cont = document.getElementById('facturasPendientes');
    if (!facturas.length) {
      cont.innerHTML = Shell.vacio('No hay facturas pendientes', 'Todas las facturas de este proveedor están al día.');
      return;
    }
    cont.innerHTML = `<div class="table-wrap"><table class="t">
      <thead><tr><th>Comprobante</th><th>Vence</th><th class="num">Saldo</th><th>Estado</th></tr></thead>
      <tbody>${facturas.map(f => `
        <tr>
          <td data-label="Comprobante">${f.tipo_factura || ''} ${f.punto_venta ? String(f.punto_venta).padStart(4, '0') : ''}-${f.numero_factura}</td>
          <td data-label="Vence">${Shell.fecha(f.fecha_vencimiento)}</td>
          <td class="num neg" data-label="Saldo">${Shell.money(f.saldo_pendiente)}</td>
          <td data-label="Estado">${Shell.pill(f.estado_calculado)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (err) {
    document.getElementById('drawerCuerpo').innerHTML = '<div class="notice notice-err">No se pudo cargar la ficha de este proveedor.</div>';
    Shell.error(err, 'No se pudo cargar el proveedor');
  }
}

function abrirDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerBg').classList.add('open');
}

function cerrarDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerBg').classList.remove('open');
}

/* ---------------------- eliminar ---------------------- */

function confirmarEliminar(id, nombre) {
  if (!confirm(`¿Eliminar al proveedor "${nombre}"? Si tiene compras asociadas, se desactivará en vez de borrarse.`)) return;
  eliminarProveedor(id);
}

async function eliminarProveedor(id) {
  try {
    await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
    Shell.toast('ok', 'Proveedor eliminado o desactivado.');
    cargarProveedores();
  } catch (err) {
    Shell.error(err, 'No se pudo eliminar el proveedor');
  }
}

/* ---------------------- utilidades ---------------------- */

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}

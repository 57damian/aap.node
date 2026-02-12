let editMode = false;
let currentId = null;
let currentFicha = null;

/* =====================
   AUTH CHECK
===================== */
if (!localStorage.getItem('rol')) {
  window.location.href = 'index.html';
}

/* =====================
   INIT
===================== */
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('fichaForm');
  if (form) form.addEventListener('submit', handleSubmit);

  window.onclick = function (event) {
    const modal = document.getElementById('detailModal');
    if (event.target == modal) closeDetailModal();
  };

  cargarClientes();
  cargarFichas();
});

/* =====================
   CARGAR CLIENTES
===================== */
async function cargarClientes() {
  try {
    const clientes = await apiFetch('/clientes');
    const select = document.getElementById('cliente_id');

    select.innerHTML = '<option value="">-- Modelo Genérico --</option>';

    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
    });

  } catch (err) {
    showAlert(err.error || err.message || 'Error cargando clientes', 'error');
  }
}

/* =====================
   CARGAR FICHAS
===================== */
async function cargarFichas() {
  try {
    const fichas = await apiFetch('/ficha-transformador');

    const tbody = document.getElementById('fichasList');
    tbody.innerHTML = '';

    if (!fichas.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:20px;">
            No hay modelos creados
          </td>
        </tr>
      `;
      return;
    }

    fichas.forEach(ficha => {
      const tr = document.createElement('tr');

      const tipoBadge = ficha.cliente_id
        ? '<span class="badge badge-specific">Específico</span>'
        : '<span class="badge badge-generic">Genérico</span>';

      const modeloEscapado = (ficha.modelo || '').replace(/'/g, "\\'");

      tr.innerHTML = `
        <td>#${ficha.id}</td>
        <td>${ficha.modelo}</td>
        <td>${tipoBadge}</td>
        <td>${ficha.voltaje_entrada || '-'}V / ${ficha.voltaje_salida || '-'}V</td>
        <td>
          <button onclick="verDetalles(${ficha.id})">Ver</button>
          <button onclick="editarFicha(${ficha.id})">Editar</button>
          ${rolPermiteEliminar() ?
            `<button onclick="confirmarEliminar(${ficha.id}, '${modeloEscapado}')">Eliminar</button>`
            : ''
          }
        </td>
      `;

      tbody.appendChild(tr);
    });

  } catch (err) {
    showAlert(err.error || err.message || 'Error cargando fichas', 'error');
  }
}

/* =====================
   ELIMINAR
===================== */
async function eliminarFicha(id) {
  try {
    await apiFetch(`/ficha-transformador/${id}`, {
      method: 'DELETE'
    });

    showAlert('Ficha eliminada correctamente', 'success');
    cargarFichas();

  } catch (err) {
    showAlert(err.error || err.message || 'Error eliminando ficha', 'error');
  }
}

function confirmarEliminar(id, modelo) {
  if (confirm(`¿Eliminar modelo "${modelo}"?`)) {
    eliminarFicha(id);
  }
}

function rolPermiteEliminar() {
  const rol = localStorage.getItem('rol');
  return rol === 'admin' || rol === 'control';
}

/* =====================
   VER DETALLES
===================== */
async function verDetalles(id) {
  try {
    const ficha = await apiFetch(`/ficha-transformador/${id}`);
    currentFicha = ficha;

    const content = document.getElementById('detailContent');
    const title = document.getElementById('detailModelo');

    title.textContent = `${ficha.modelo} - Ficha Técnica`;

    content.innerHTML = `
      <p><strong>Modelo:</strong> ${ficha.modelo}</p>
      <p><strong>Voltaje:</strong> ${ficha.voltaje_entrada || '-'}V / ${ficha.voltaje_salida || '-'}V</p>
      <p><strong>Observaciones:</strong> ${ficha.observaciones || '-'}</p>
    `;

    document.getElementById('detailModal').style.display = 'block';

  } catch (err) {
    showAlert(err.error || err.message || 'Error cargando detalle', 'error');
  }
}

function closeDetailModal() {
  document.getElementById('detailModal').style.display = 'none';
  currentFicha = null;
}

/* =====================
   SUBMIT
===================== */
async function handleSubmit(e) {
  e.preventDefault();

  const formData = new FormData();

  const fields = [
    'modelo', 'cliente_id',
    'voltaje_entrada', 'voltaje_salida',
    'amperaje_entrada', 'amperaje_salida',
    'tipo_carretel', 'laminacion',
    'peso_laminacion_kg', 'observaciones',
    'alambre_primario', 'diametro_primario_mm',
    'espiras_primario', 'pines_primario',
    'peso_primario_kg',
    'alambre_secundario', 'diametro_secundario_mm',
    'espiras_secundario', 'pines_secundario',
    'peso_secundario_kg'
  ];

  fields.forEach(field => {
    const value = document.getElementById(field)?.value;
    if (value !== '') formData.append(field, value);
  });

  const fotoInput = document.getElementById('foto');
  if (fotoInput?.files[0]) {
    formData.append('foto', fotoInput.files[0]);
  }

  try {
    if (editMode) {
      await apiFetch(`/ficha-transformador/${currentId}`, {
        method: 'PUT',
        body: formData
      });
      showAlert('Ficha actualizada', 'success');
    } else {
      await apiFetch('/ficha-transformador', {
        method: 'POST',
        body: formData
      });
      showAlert('Ficha creada', 'success');
    }

    resetForm();
    cargarFichas();
    showTab('listar');

  } catch (err) {
    showAlert(err.error || err.message || 'Error guardando ficha', 'error');
  }
}

/* =====================
   EDITAR
===================== */
async function editarFicha(id) {
  try {
    const ficha = await apiFetch(`/ficha-transformador/${id}`);

    Object.keys(ficha).forEach(key => {
      const el = document.getElementById(key);
      if (el) el.value = ficha[key] || '';
    });

    editMode = true;
    currentId = id;
    showTab('crear');

  } catch (err) {
    showAlert(err.error || err.message || 'Error cargando ficha', 'error');
  }
}

/* =====================
   UI
===================== */
function resetForm() {
  document.getElementById('fichaForm').reset();
  editMode = false;
  currentId = null;
}

function showTab(tabName, event) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  document.getElementById(tabName).classList.add('active');

  if (tabName === 'listar') cargarFichas();
}

function showAlert(message, type) {
  const alertDiv = document.getElementById('alert');
  alertDiv.textContent = message;
  alertDiv.className = type === 'success'
    ? 'alert alert-success'
    : 'alert alert-error';
  alertDiv.style.display = 'block';

  setTimeout(() => alertDiv.style.display = 'none', 3000);
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

let editMode = false;
let currentId = null;
let currentFicha = null;

// =====================
// VERIFICAR AUTENTICACIÓN
// =====================
const usuario = (() => {
  const token = localStorage.getItem('token');
  const userStr = localStorage.getItem('usuario');
  
  if (!token || !userStr) {
    window.location.href = 'index.html';
    return null;
  }
  
  try {
    return JSON.parse(userStr);
  } catch {
    window.location.href = 'index.html';
    return null;
  }
})();

if (!usuario) {
  throw new Error('No autenticado');
}

// Ahora puedes usar usuario.rol en lugar de localStorage.getItem('rol')

/* =====================
   INIT
===================== */
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ ficha.js cargado');
  
  const form = document.getElementById('fichaForm');
  if (form) {
    form.addEventListener('submit', handleSubmit);
    console.log('✅ Event listener agregado al formulario');
  }

  // Cerrar modal al hacer clic fuera
  window.onclick = function (event) {
    const modal = document.getElementById('detailModal');
    if (event.target == modal) closeDetailModal();
  };

  // Vista previa de imagen
  const fotoInput = document.getElementById('foto');
  if (fotoInput) {
    fotoInput.addEventListener('change', previewFoto);
  }

  cargarClientes();
  cargarFichas();
});

/* =====================
   PREVIEW FOTO
===================== */
function previewFoto() {
  const fotoInput = document.getElementById('foto');
  const preview = document.getElementById('fotoPreview');
  if (!preview) return;

  if (fotoInput.files && fotoInput.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.src = e.target.result;
      preview.classList.add('show');
    };
    reader.readAsDataURL(fotoInput.files[0]);
  } else {
    preview.src = '#';
    preview.classList.remove('show');
  }
}

/* =====================
   CARGAR CLIENTES
===================== */
async function cargarClientes() {
  try {
    console.log('Cargando clientes...');
    const clientes = await apiFetch('/api/clientes');
    const select = document.getElementById('cliente_id');

    select.innerHTML = '<option value="">-- Modelo Genérico --</option>';

    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
    });

    console.log(`✅ ${clientes.length} clientes cargados`);

  } catch (err) {
    console.error('Error cargando clientes:', err);
    showAlert(err.error || err.message || 'Error cargando clientes', 'error');
  }
}

/* =====================
   CARGAR FICHAS
===================== */
async function cargarFichas() {
  try {
    console.log('Cargando fichas...');
    const fichas = await apiFetch('/api/ficha-transformador');
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
        ? '<span class="badge badge-specific">🔵 Específico</span>'
        : '<span class="badge badge-generic">⚪ Genérico</span>';

      // Escapar comillas simples para el onclick
      const modeloEscapado = (ficha.modelo || '').replace(/'/g, "\\'");

      tr.innerHTML = `
        <td>#${ficha.id}</td>
        <td><strong>${ficha.modelo}</strong></td>
        <td>${tipoBadge}</td>
        <td>${ficha.voltaje_entrada || '-'}V / ${ficha.voltaje_salida || '-'}V</td>
        <td>
          <button class="btn-ver" onclick="verDetalles(${ficha.id})">👁️ Ver</button>
          <button class="btn-editar" onclick="editarFicha(${ficha.id})">✏️ Editar</button>
          ${rolPermiteEliminar() ?
            `<button class="btn-eliminar" onclick="confirmarEliminar(${ficha.id}, '${modeloEscapado}')">🗑️ Eliminar</button>`
            : ''
          }
        </td>
      `;

      tbody.appendChild(tr);
    });

    console.log(`✅ ${fichas.length} fichas cargadas`);

  } catch (err) {
    console.error('Error cargando fichas:', err);
    showAlert(err.error || err.message || 'Error cargando fichas', 'error');
  }
}

/* =====================
   VER DETALLES - CORREGIDO
===================== */
// =====================
// VER DETALLES - VERSIÓN MEJORADA CON DISEÑO DE TARJETAS
// =====================
async function verDetalles(id) {
  try {
    console.log('Cargando detalles de ficha:', id);
    
    const ficha = await apiFetch(`/api/ficha-transformador/${id}`);
    currentFicha = ficha;

    const content = document.getElementById('detailContent');
    const title = document.getElementById('detailModelo');

    title.textContent = `⚡ ${ficha.modelo} - Ficha Técnica Completa`;

    // Determinar el tipo para mostrarlo como badge
    const tipoBadge = ficha.cliente_id 
        ? '<span class="badge" style="background: #fed7e2; color: #702459; margin-left: 1rem; padding: 0.3rem 1rem;">🔵 Modelo Específico</span>' 
        : '<span class="badge" style="background: #c6f6d5; color: #22543d; margin-left: 1rem; padding: 0.3rem 1rem;">⚪ Modelo Genérico</span>';

    // Inyectar el badge al lado del título
    title.innerHTML = `⚡ ${ficha.modelo} - Ficha Técnica Completa ${tipoBadge}`;

    // Construir HTML de detalles con un sistema de grid moderno
    let html = `
      <style>
        .detail-grid-moderno {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
          margin-top: 1rem;
        }
        .detail-card {
          background: #f8fafc;
          border: 1px solid #e9ecef;
          border-radius: 1rem;
          padding: 1.2rem;
          box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .detail-card h4 {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #2d3748;
          font-size: 1.1rem;
          font-weight: 600;
          margin-top: 0;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 2px solid #e2e8f0;
        }
        .detail-card-row {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem 0;
          border-bottom: 1px dashed #e2e8f0;
        }
        .detail-card-row:last-child {
          border-bottom: none;
        }
        .detail-card-label {
          color: #4a5568;
          font-weight: 500;
          font-size: 0.9rem;
        }
        .detail-card-value {
          color: #1e293b;
          font-weight: 600;
          background: white;
          padding: 0.2rem 0.8rem;
          border-radius: 2rem;
          border: 1px solid #e2e8f0;
          font-size: 0.9rem;
        }
        .foto-detalle {
          grid-column: 1 / -1;
          text-align: center;
          background: #f1f5f9;
          padding: 2rem;
          border-radius: 1rem;
        }
        .foto-detalle img {
          max-width: 300px;
          max-height: 250px;
          border-radius: 1rem;
          box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
        }
        .observaciones-detalle {
          background: #fff9e6;
          border-left: 4px solid #fbbf24;
          padding: 1rem 1.5rem;
          border-radius: 0.75rem;
          grid-column: 1 / -1;
        }
      </style>
    `;

    // --- FILA 1: Información General y Foto (si existe) ---
    html += `<div class="detail-grid-moderno">`;

    // Tarjeta de información general
    html += `
      <div class="detail-card">
        <h4>📌 Información General</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">ID del Modelo</span>
          <span class="detail-card-value">#${ficha.id}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Cliente Asociado</span>
          <span class="detail-card-value">${ficha.cliente_nombre || 'Modelo Genérico'}</span>
        </div>
      </div>
    `;

    // Tarjeta de foto (si existe)
    if (ficha.foto_modelo) {
      html += `
        <div class="detail-card" style="grid-column: span 2; display: flex; flex-direction: column; align-items: center;">
          <h4>📸 Imagen del Modelo</h4>
          <img src="${ficha.foto_modelo}" style="max-width: 250px; border-radius: 0.75rem; border: 2px solid #cbd5e0;">
        </div>
      `;
    }

    html += `</div>`; // Cierre de la primera grid

    // --- FILA 2: Especificaciones Eléctricas ---
    html += `<div class="detail-grid-moderno">`;
    html += `
      <div class="detail-card">
        <h4>⚡ Eléctricas</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">Voltaje Entrada</span>
          <span class="detail-card-value">${ficha.voltaje_entrada || '-'} V</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Voltaje Salida</span>
          <span class="detail-card-value">${ficha.voltaje_salida || '-'} V</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Amperaje Entrada</span>
          <span class="detail-card-value">${ficha.amperaje_entrada || '-'} A</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Amperaje Salida</span>
          <span class="detail-card-value">${ficha.amperaje_salida || '-'} A</span>
        </div>
      </div>
    `;

    // --- FILA 2 (cont): Características Físicas ---
    html += `
      <div class="detail-card">
        <h4>🔧 Físicas</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">Tipo Carretel</span>
          <span class="detail-card-value">${ficha.tipo_carretel || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Laminación</span>
          <span class="detail-card-value">${ficha.laminacion || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Peso Laminación</span>
          <span class="detail-card-value">${ficha.peso_laminacion_kg || '-'} kg</span>
        </div>
      </div>
    `;
    html += `</div>`; // Cierre de la segunda grid

    // --- FILA 3: Devanados (Pueden ir en una grid de 2 columnas) ---
    html += `<div class="detail-grid-moderno">`;

    // Devanado Primario
    html += `
      <div class="detail-card">
        <h4>🔄 Devanado Primario</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">Alambre</span>
          <span class="detail-card-value">${ficha.alambre_primario || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Diámetro</span>
          <span class="detail-card-value">${ficha.diametro_primario_mm || '-'} mm</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Espiras</span>
          <span class="detail-card-value">${ficha.espiras_primario || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Pines</span>
          <span class="detail-card-value">${ficha.pines_primario || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Peso</span>
          <span class="detail-card-value">${ficha.peso_primario_kg || '-'} kg</span>
        </div>
      </div>
    `;

    // Devanado Secundario
    html += `
      <div class="detail-card">
        <h4>🔄 Devanado Secundario</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">Alambre</span>
          <span class="detail-card-value">${ficha.alambre_secundario || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Diámetro</span>
          <span class="detail-card-value">${ficha.diametro_secundario_mm || '-'} mm</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Espiras</span>
          <span class="detail-card-value">${ficha.espiras_secundario || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Pines</span>
          <span class="detail-card-value">${ficha.pines_secundario || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Peso</span>
          <span class="detail-card-value">${ficha.peso_secundario_kg || '-'} kg</span>
        </div>
      </div>
    `;

    html += `</div>`; // Cierre de la grid de devanados

    // --- FILA 4: Observaciones (siempre al final y ancho completo) ---
    html += `
      <div class="observaciones-detalle" style="margin-top: 1rem;">
        <h4 style="display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.5rem 0;">
          <span>📝</span> Observaciones
        </h4>
        <p style="margin: 0; color: #334155;">${ficha.observaciones || 'Sin observaciones adicionales.'}</p>
      </div>
    `;

    content.innerHTML = html;
    document.getElementById('detailModal').style.display = 'block';

  } catch (err) {
    console.error('Error cargando detalles:', err);
    showAlert('Error cargando detalles: ' + (err.error || err.message), 'error');
  }
}
/* =====================
   CERRAR MODAL
===================== */
function closeDetailModal() {
  document.getElementById('detailModal').style.display = 'none';
  currentFicha = null;
}

/* =====================
   EXPORTAR PDF
===================== */
async function exportarPDF() {
  if (!currentFicha) {
    showAlert('No hay ficha para exportar', 'error');
    return;
  }

  try {
    // Verificar que jsPDF está disponible
    if (typeof jspdf === 'undefined') {
      throw new Error('Biblioteca jsPDF no cargada');
    }

    const { jsPDF } = jspdf;
    const doc = new jsPDF();
    
    // Título
    doc.setFontSize(20);
    doc.setTextColor(102, 126, 234);
    doc.text(`Ficha Técnica: ${currentFicha.modelo}`, 20, 20);
    
    // Información general
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Información General', 20, 35);
    
    doc.setFontSize(10);
    doc.text(`ID: ${currentFicha.id}`, 20, 45);
    doc.text(`Modelo: ${currentFicha.modelo}`, 20, 52);
    doc.text(`Voltaje: ${currentFicha.voltaje_entrada || '-'}V / ${currentFicha.voltaje_salida || '-'}V`, 20, 59);
    
    // Guardar PDF
    doc.save(`ficha_${currentFicha.modelo}.pdf`);
    
    showAlert('✅ PDF generado correctamente', 'success');
    
  } catch (err) {
    console.error('Error generando PDF:', err);
    showAlert('Error generando PDF: ' + err.message, 'error');
  }
}

/* =====================
   ELIMINAR
===================== */
async function eliminarFicha(id) {
  try {
    console.log('Eliminando ficha:', id);
    
    await apiFetch(`/api/ficha-transformador/${id}`, {
      method: 'DELETE'
    });

    showAlert('✅ Ficha eliminada correctamente', 'success');
    cargarFichas();

  } catch (err) {
    console.error('Error eliminando ficha:', err);
    showAlert(err.error || err.message || 'Error eliminando ficha', 'error');
  }
}

function confirmarEliminar(id, modelo) {
  if (confirm(`¿Está seguro de eliminar el modelo "${modelo}"?\n\nEsta acción no se puede deshacer.`)) {
    eliminarFicha(id);
  }
}

function rolPermiteEliminar() {
  return usuario.rol === 'admin' || usuario.rol === 'control';
}

/* =====================
   SUBMIT FORMULARIO
===================== */
async function handleSubmit(e) {
  e.preventDefault();
  console.log('Enviando formulario...');

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
    const element = document.getElementById(field);
    if (element && element.value) {
      formData.append(field, element.value);
    }
  });

  const fotoInput = document.getElementById('foto');
  if (fotoInput?.files[0]) {
    formData.append('foto', fotoInput.files[0]);
  }

  try {
    if (editMode) {
      console.log('Actualizando ficha ID:', currentId);
      await apiFetch(`/api/ficha-transformador/${currentId}`, {
        method: 'PUT',
        body: formData
      });
      showAlert('✅ Ficha actualizada correctamente', 'success');
    } else {
      console.log('Creando nueva ficha');
      await apiFetch('/api/ficha-transformador', {
        method: 'POST',
        body: formData
      });
      showAlert('✅ Ficha creada correctamente', 'success');
    }

    resetForm();
    cargarFichas();
    showTab('listar');

  } catch (err) {
    console.error('Error guardando ficha:', err);
    showAlert(err.error || err.message || 'Error guardando ficha', 'error');
  }
}

/* =====================
   EDITAR FICHA
===================== */
async function editarFicha(id) {
  try {
    console.log('Editando ficha:', id);
    
    const ficha = await apiFetch(`/api/ficha-transformador/${id}`);

    // Llenar el formulario con los datos de la ficha
    Object.keys(ficha).forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        el.value = ficha[key] || '';
      }
    });

    // Mostrar foto actual si existe
    const preview = document.getElementById('fotoPreview');
    if (preview && ficha.foto_modelo) {
      preview.src = ficha.foto_modelo;
      preview.classList.add('show');
    } else if (preview) {
      preview.src = '#';
      preview.classList.remove('show');
    }

    editMode = true;
    currentId = id;
    showTab('crear');
    
    showAlert('Editando ficha ID: ' + id, 'success');

  } catch (err) {
    console.error('Error cargando ficha:', err);
    showAlert(err.error || err.message || 'Error cargando ficha', 'error');
  }
}

/* =====================
   RESET FORMULARIO
===================== */
function resetForm() {
  document.getElementById('fichaForm').reset();
  const preview = document.getElementById('fotoPreview');
  if (preview) {
    preview.src = '#';
    preview.classList.remove('show');
  }
  editMode = false;
  currentId = null;
}

/* =====================
   MOSTRAR TAB
===================== */
function showTab(tabName, event) {
  const createView = document.getElementById('createView');
  const listView = document.getElementById('listView');

  if (createView && listView) {
    if (tabName === 'crear') {
      createView.style.display = 'block';
      listView.style.display = 'none';
    } else if (tabName === 'listar') {
      createView.style.display = 'none';
      listView.style.display = 'block';
      cargarFichas();
    }
    return;
  }

  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(btn => btn.classList.remove('active'));
  const tab = document.getElementById(tabName);
  if (tab) tab.classList.add('active');
  if (event?.target) event.target.classList.add('active');
  if (tabName === 'listar') cargarFichas();
}

/* =====================
   ALERTA
===================== */
function showAlert(message, type) {
  const alertDiv = document.getElementById('alert');
  if (!alertDiv) return;
  
  alertDiv.textContent = message;
  alertDiv.className = type === 'success'
    ? 'alert alert-success'
    : 'alert alert-error';
  alertDiv.style.display = 'block';

  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 5000);
}

/* =====================
   LOGOUT
===================== */
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

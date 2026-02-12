let editMode = false;
let currentId = null;
let currentFicha = null;

// =====================
// DEBUG INIT
// =====================
console.log('🔍 ficha.js cargado');
console.log('👤 localStorage.rol:', localStorage.getItem('rol'));

if (!localStorage.getItem('rol')) {
  console.warn('❌ No hay rol en localStorage, redirigiendo a login...');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 100);
  throw new Error('No autenticado');
}

// =====================
// INICIALIZAR
// =====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ DOMContentLoaded - Adjuntando event listeners');
  
  const form = document.getElementById('fichaForm');
  if (form) {
    form.addEventListener('submit', handleSubmit);
    console.log('✅ Event listener "submit" adjuntado al formulario');
  } else {
    console.error('❌ Formulario #fichaForm no encontrado');
  }
  
  // Cerrar modal al hacer clic fuera
  window.onclick = function(event) {
    const modal = document.getElementById('detailModal');
    if (event.target == modal) {
      closeDetailModal();
    }
  }
  
  cargarClientes();
  cargarFichas();
});

// =====================
// CARGAR CLIENTES
// =====================
async function cargarClientes() {
  try {
    console.log('📥 Cargando clientes...');
    const clientes = await apiFetch('/clientes');
    console.log('✅ Clientes cargados:', clientes.length);
    
    const select = document.getElementById('cliente_id');
    select.innerHTML = '<option value="">-- Modelo Genérico --</option>';
    
    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('❌ Error cargando clientes:', err);
    showAlert('Error al cargar clientes', 'error');
  }
}

// =====================
// CARGAR FICHAS
// =====================
async function cargarFichas() {
  try {
    console.log('📥 Cargando fichas técnicas...');
    const response = await fetch('http://localhost:3000/ficha-transformador', {
      headers: { 'rol': localStorage.getItem('rol') }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw error;
    }
    
    const fichas = await response.json();
    console.log('✅ Fichas cargadas:', fichas.length);
    
    const tbody = document.getElementById('fichasList');
    tbody.innerHTML = '';

    if (fichas.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 30px;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 15px;">
              <div style="font-size: 48px;">📦</div>
              <p style="color: #999; font-size: 16px;">No hay modelos creados aún</p>
              <button class="btn-primary" onclick="showTab('crear', event)" style="padding: 10px 30px;">
                ➕ Crear Primer Modelo
              </button>
            </div>
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
      
      const modeloEscapado = (ficha.modelo || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      
      tr.innerHTML = `
        <td><strong>#${ficha.id}</strong></td>
        <td><strong>${ficha.modelo}</strong></td>
        <td>${tipoBadge}</td>
        <td>${ficha.voltaje_entrada || '-'}V / ${ficha.voltaje_salida || '-'}V</td>
        <td>
          <button class="btn-info" onclick="verDetalles(${ficha.id})" style="padding: 6px 12px; margin-right: 5px;">👁️ Ver</button>
          <button class="btn-warning" onclick="editarFicha(${ficha.id})" style="padding: 6px 12px; margin-right: 5px;">✏️ Editar</button>
          ${rolPermiteEliminar() ? `<button class="btn-danger" onclick="confirmarEliminar(${ficha.id}, '${modeloEscapado}')">🗑️ Eliminar</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('❌ Error cargando fichas:', err);
    showAlert('Error al cargar modelos: ' + (err.error || err.message || 'Error desconocido'), 'error');
  }
}

// =====================
// VERIFICAR SI EL ROL PERMITE ELIMINAR
// =====================
function rolPermiteEliminar() {
  const rol = localStorage.getItem('rol');
  return rol === 'admin' || rol === 'control';
}

// =====================
// VER DETALLES (MODAL) - CORREGIDO
// =====================
async function verDetalles(id) {
  try {
    const ficha = await apiFetch(`/ficha-transformador/${id}`);
    currentFicha = ficha;
    
    const content = document.getElementById('detailContent');
    const title = document.getElementById('detailModelo');
    
    title.textContent = `${ficha.modelo || 'Sin nombre'} - Ficha Técnica`;
    
    // Construir contenido del modal ORGANIZADO
    let html = `
      <!-- INFORMACIÓN GENERAL -->
      <div class="detail-section">
        <div class="detail-section-title">📋 Información General</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">Modelo</div>
            <div class="detail-value">${ficha.modelo || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Tipo</div>
            <div class="detail-value">${ficha.cliente_id ? 'Específico de Cliente' : 'Genérico'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">ID</div>
            <div class="detail-value">#${ficha.id}</div>
          </div>
        </div>
      </div>

      <!-- ESPECIFICACIONES ELÉCTRICAS -->
      <div class="detail-section">
        <div class="detail-section-title">⚡ Especificaciones Eléctricas</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">Voltaje Entrada</div>
            <div class="detail-value">${ficha.voltaje_entrada ? ficha.voltaje_entrada + ' V' : '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Voltaje Salida</div>
            <div class="detail-value">${ficha.voltaje_salida ? ficha.voltaje_salida + ' V' : '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Amperaje Entrada</div>
            <div class="detail-value">${ficha.amperaje_entrada ? ficha.amperaje_entrada + ' A' : '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Amperaje Salida</div>
            <div class="detail-value">${ficha.amperaje_salida ? ficha.amperaje_salida + ' A' : '-'}</div>
          </div>
        </div>
      </div>

      <!-- DEVANADO PRIMARIO -->
      <div class="detail-section">
        <div class="detail-section-title">🔄 Devanado Primario</div>
        <div class="devanado-grid">
          <div class="devanado-item">
            <div class="devanado-label">Alambre</div>
            <div class="devanado-value">${ficha.alambre_primario || '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Diámetro</div>
            <div class="devanado-value">${ficha.diametro_primario_mm ? ficha.diametro_primario_mm + ' mm' : '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Espiras</div>
            <div class="devanado-value">${ficha.espiras_primario || '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Pines</div>
            <div class="devanado-value">${ficha.pines_primario || '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Peso</div>
            <div class="devanado-value">${ficha.peso_primario_kg ? ficha.peso_primario_kg + ' kg' : '-'}</div>
          </div>
        </div>
      </div>

      <!-- DEVANADO SECUNDARIO -->
      <div class="detail-section">
        <div class="detail-section-title">🔄 Devanado Secundario</div>
        <div class="devanado-grid">
          <div class="devanado-item">
            <div class="devanado-label">Alambre</div>
            <div class="devanado-value">${ficha.alambre_secundario || '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Diámetro</div>
            <div class="devanado-value">${ficha.diametro_secundario_mm ? ficha.diametro_secundario_mm + ' mm' : '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Espiras</div>
            <div class="devanado-value">${ficha.espiras_secundario || '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Pines</div>
            <div class="devanado-value">${ficha.pines_secundario || '-'}</div>
          </div>
          <div class="devanado-item">
            <div class="devanado-label">Peso</div>
            <div class="devanado-value">${ficha.peso_secundario_kg ? ficha.peso_secundario_kg + ' kg' : '-'}</div>
          </div>
        </div>
      </div>

      <!-- CARACTERÍSTICAS FÍSICAS -->
      <div class="detail-section">
        <div class="detail-section-title">🔧 Características Físicas</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-label">Tipo de Carretel</div>
            <div class="detail-value">${ficha.tipo_carretel || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Laminación</div>
            <div class="detail-value">${ficha.laminacion || '-'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Peso Laminación</div>
            <div class="detail-value">${ficha.peso_laminacion_kg ? ficha.peso_laminacion_kg + ' kg' : '-'}</div>
          </div>
        </div>
      </div>
      
      <!-- FOTO - ✅ CORREGIDO -->
      ${ficha.foto_modelo ? `
      <div class="detail-section">
        <div class="detail-section-title">📸 Foto del Modelo</div>
        <div style="text-align: center; padding: 20px;">
          <img src="http://localhost:3000/${ficha.foto_modelo}" 
               alt="Foto del modelo" 
               style="max-width: 500px; max-height: 500px; border-radius: 8px; border: 3px solid #667eea; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
          <p style="margin-top: 10px; color: #666; font-size: 14px;">
            Foto del transformador ${ficha.modelo}
          </p>
        </div>
      </div>
      ` : `
      <div class="detail-section">
        <div class="detail-section-title">📸 Foto del Modelo</div>
        <div style="text-align: center; padding: 40px; color: #999;">
          <p style="font-size: 16px;">No hay foto disponible</p>
        </div>
      </div>
      `}
      
      <!-- OBSERVACIONES -->
      <div class="detail-section">
        <div class="detail-section-title">📝 Observaciones</div>
        <div class="detail-value" style="white-space: pre-wrap; padding: 15px; background: #fff9e6; border-radius: 6px; min-height: 60px;">
          ${ficha.observaciones || 'Sin observaciones'}
        </div>
      </div>
    `;
    
    content.innerHTML = html;
    document.getElementById('detailModal').style.display = 'block';
  } catch (err) {
    console.error('Error al cargar detalles:', err);
    showAlert('Error al cargar detalles: ' + (err.error || err.message), 'error');
  }
}

// =====================
// CERRAR MODAL
// =====================
function closeDetailModal() {
  document.getElementById('detailModal').style.display = 'none';
  currentFicha = null;
}

// =====================
// EXPORTAR A PDF
// =====================
async function exportarPDF() {
  if (!currentFicha) return;
  
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    pdf.setFontSize(18);
    pdf.setTextColor(102, 126, 234);
    pdf.text(`FICHA TÉCNICA - ${currentFicha.modelo}`, 105, 20, null, null, 'center');
    
    pdf.setLineWidth(0.5);
    pdf.line(20, 25, 190, 25);
    
    let y = 35;
    
    pdf.setFontSize(14);
    pdf.setTextColor(0, 0, 0);
    pdf.text('INFORMACIÓN GENERAL', 20, y);
    y += 10;
    
    pdf.setFontSize(10);
    pdf.text(`Modelo: ${currentFicha.modelo || '-'}`, 20, y);
    y += 6;
    pdf.text(`Tipo: ${currentFicha.cliente_id ? 'Específico de Cliente' : 'Genérico'}`, 20, y);
    y += 10;
    
    pdf.setFontSize(14);
    pdf.text('ESPECIFICACIONES ELÉCTRICAS', 20, y);
    y += 10;
    
    pdf.setFontSize(10);
    pdf.text(`Voltaje Entrada: ${currentFicha.voltaje_entrada || '-'} V`, 20, y);
    y += 6;
    pdf.text(`Voltaje Salida: ${currentFicha.voltaje_salida || '-'} V`, 20, y);
    y += 6;
    pdf.text(`Amperaje Entrada: ${currentFicha.amperaje_entrada || '-'} A`, 20, y);
    y += 6;
    pdf.text(`Amperaje Salida: ${currentFicha.amperaje_salida || '-'} A`, 20, y);
    y += 10;
    
    pdf.setFontSize(14);
    pdf.text('DEVANADO PRIMARIO', 20, y);
    y += 10;
    
    pdf.setFontSize(10);
    pdf.text(`Alambre: ${currentFicha.alambre_primario || '-'}`, 20, y);
    y += 6;
    pdf.text(`Diámetro: ${currentFicha.diametro_primario_mm || '-'} mm`, 20, y);
    y += 6;
    pdf.text(`Espiras: ${currentFicha.espiras_primario || '-'}`, 20, y);
    y += 6;
    pdf.text(`Pines: ${currentFicha.pines_primario || '-'}`, 20, y);
    y += 6;
    pdf.text(`Peso: ${currentFicha.peso_primario_kg || '-'} kg`, 20, y);
    y += 10;
    
    pdf.setFontSize(14);
    pdf.text('DEVANADO SECUNDARIO', 20, y);
    y += 10;
    
    pdf.setFontSize(10);
    pdf.text(`Alambre: ${currentFicha.alambre_secundario || '-'}`, 20, y);
    y += 6;
    pdf.text(`Diámetro: ${currentFicha.diametro_secundario_mm || '-'} mm`, 20, y);
    y += 6;
    pdf.text(`Espiras: ${currentFicha.espiras_secundario || '-'}`, 20, y);
    y += 6;
    pdf.text(`Pines: ${currentFicha.pines_secundario || '-'}`, 20, y);
    y += 6;
    pdf.text(`Peso: ${currentFicha.peso_secundario_kg || '-'} kg`, 20, y);
    y += 10;
    
    pdf.setFontSize(14);
    pdf.text('CARACTERÍSTICAS FÍSICAS', 20, y);
    y += 10;
    
    pdf.setFontSize(10);
    pdf.text(`Tipo de Carretel: ${currentFicha.tipo_carretel || '-'}`, 20, y);
    y += 6;
    pdf.text(`Laminación: ${currentFicha.laminacion || '-'}`, 20, y);
    y += 6;
    pdf.text(`Peso Laminación: ${currentFicha.peso_laminacion_kg || '-'} kg`, 20, y);
    y += 10;
    
    pdf.setFontSize(14);
    pdf.text('OBSERVACIONES', 20, y);
    y += 10;
    
    pdf.setFontSize(10);
    const observaciones = currentFicha.observaciones || '-';
    const lines = pdf.splitTextToSize(observaciones, 170);
    pdf.text(lines, 20, y);
    
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text('Sistema de Gestión de Transformadores', 105, 285, null, null, 'center');
    pdf.text(`Generado: ${new Date().toLocaleDateString()}`, 105, 290, null, null, 'center');
    
    pdf.save(`ficha-tecnica-${currentFicha.modelo}.pdf`);
    showAlert('PDF exportado correctamente', 'success');
  } catch (err) {
    console.error('Error exportando PDF:', err);
    showAlert('Error al exportar PDF: ' + (err.message || 'Verifica librerías'), 'error');
  }
}

// =====================
// CONFIRMAR ELIMINAR
// =====================
function confirmarEliminar(id, modelo) {
  if (confirm(`⚠️ ¿Estás seguro de eliminar el modelo "${modelo}"?\n\nEsta acción no se puede deshacer.`)) {
    eliminarFicha(id);
  }
}

// =====================
// ELIMINAR FICHA - CORREGIDO
// =====================
async function eliminarFicha(id) {
  try {
    const rol = localStorage.getItem('rol');
    if (rol !== 'admin' && rol !== 'control') {
      showAlert('⚠️ Solo administradores y control pueden eliminar modelos', 'error');
      return;
    }
    
    const response = await fetch(`http://localhost:3000/ficha-transformador/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'rol': rol
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Error desconocido' }));
      throw new Error(errorData.error || `Error ${response.status}`);
    }
    
    showAlert('✅ Ficha eliminada correctamente', 'success');
    await new Promise(resolve => setTimeout(resolve, 300));
    cargarFichas();
  } catch (err) {
    console.error('❌ Error al eliminar:', err);
    showAlert('❌ Error al eliminar: ' + (err.message || 'Verifica permisos'), 'error');
  }
}

// =====================
// SUBMIT FORMULARIO - CORREGIDO
// =====================
async function handleSubmit(e) {
  e.preventDefault();
  console.log('📤 Submit del formulario (prevención activa)');
  
  const formData = new FormData();
  
  const fields = [
    'modelo', 'cliente_id', 'voltaje_entrada', 'voltaje_salida',
    'amperaje_entrada', 'amperaje_salida', 'tipo_carretel', 'laminacion',
    'peso_laminacion_kg', 'observaciones',
    'alambre_primario', 'diametro_primario_mm', 'espiras_primario', 'pines_primario', 'peso_primario_kg',
    'alambre_secundario', 'diametro_secundario_mm', 'espiras_secundario', 'pines_secundario', 'peso_secundario_kg'
  ];

  fields.forEach(field => {
    const value = document.getElementById(field)?.value;
    if (value !== '') {  // ✅ Solo enviar si no está vacío
      formData.append(field, value);
    }
  });

  const fotoInput = document.getElementById('foto');
  if (fotoInput?.files[0]) {
    formData.append('foto', fotoInput.files[0]);
  }

  try {
    let response;
    
    if (editMode) {
      // ✅ EDITAR: Usar FormData directamente (no JSON)
      console.log('📤 Enviando PUT a /ficha-transformador/' + currentId + ' con FormData');
      
      const responseRaw = await fetch(`http://localhost:3000/ficha-transformador/${currentId}`, {
        method: 'PUT',
        headers: {
          'rol': localStorage.getItem('rol')
          // ⚠️ NO poner 'Content-Type', el navegador lo establece automáticamente con boundary
        },
        body: formData
      });

      console.log('📥 Respuesta PUT status:', responseRaw.status);
      
      if (!responseRaw.ok) {
        const errorText = await responseRaw.text();
        console.error('❌ Error response:', errorText);
        try {
          const errorJson = JSON.parse(errorText);
          throw errorJson;
        } catch {
          throw new Error('Error del servidor: ' + errorText.substring(0, 100));
        }
      }

      response = await responseRaw.json();
      console.log('✅ Ficha actualizada:', response);
      showAlert('Ficha actualizada correctamente', 'success');
    } else {
      // ✅ CREAR: Usar FormData
      console.log('📤 Enviando POST a /ficha-transformador con FormData');
      
      const responseRaw = await fetch('http://localhost:3000/ficha-transformador', {
        method: 'POST',
        headers: {
          'rol': localStorage.getItem('rol')
        },
        body: formData
      });

      console.log('📥 Respuesta status:', responseRaw.status);
      
      if (!responseRaw.ok) {
        const errorText = await responseRaw.text();
        console.error('❌ Error response:', errorText);
        try {
          const errorJson = JSON.parse(errorText);
          throw errorJson;
        } catch {
          throw new Error('Error del servidor: ' + errorText.substring(0, 100));
        }
      }

      response = await responseRaw.json();
      console.log('✅ Ficha creada:', response);
      showAlert('Ficha creada correctamente', 'success');
    }

    resetForm();
    cargarFichas();
    showTab('listar');
  } catch (err) {
    console.error('❌ Error en submit:', err);
    showAlert(err.error || err.message || 'Error al guardar', 'error');
  }
}

// =====================
// EDITAR FICHA - CORREGIDO CON VISTA PREVIA DE FOTO
// =====================
async function editarFicha(id) {
  try {
    const ficha = await apiFetch(`/ficha-transformador/${id}`);
    
    // Rellenar TODOS los campos del formulario
    document.getElementById('modelo').value = ficha.modelo || '';
    document.getElementById('cliente_id').value = ficha.cliente_id || '';
    
    // Especificaciones eléctricas
    document.getElementById('voltaje_entrada').value = ficha.voltaje_entrada || '';
    document.getElementById('voltaje_salida').value = ficha.voltaje_salida || '';
    document.getElementById('amperaje_entrada').value = ficha.amperaje_entrada || '';
    document.getElementById('amperaje_salida').value = ficha.amperaje_salida || '';
    
    // Devanado Primario
    document.getElementById('alambre_primario').value = ficha.alambre_primario || '';
    document.getElementById('diametro_primario_mm').value = ficha.diametro_primario_mm || '';
    document.getElementById('espiras_primario').value = ficha.espiras_primario || '';
    document.getElementById('pines_primario').value = ficha.pines_primario || '';
    document.getElementById('peso_primario_kg').value = ficha.peso_primario_kg || '';
    
    // Devanado Secundario
    document.getElementById('alambre_secundario').value = ficha.alambre_secundario || '';
    document.getElementById('diametro_secundario_mm').value = ficha.diametro_secundario_mm || '';
    document.getElementById('espiras_secundario').value = ficha.espiras_secundario || '';
    document.getElementById('pines_secundario').value = ficha.pines_secundario || '';
    document.getElementById('peso_secundario_kg').value = ficha.peso_secundario_kg || '';
    
    // Características físicas
    document.getElementById('tipo_carretel').value = ficha.tipo_carretel || '';
    document.getElementById('laminacion').value = ficha.laminacion || '';
    document.getElementById('peso_laminacion_kg').value = ficha.peso_laminacion_kg || '';
    
    // Observaciones
    document.getElementById('observaciones').value = ficha.observaciones || '';
    
    // ✅ Mostrar vista previa de la foto existente
    const fotoPreview = document.getElementById('fotoPreview');
    if (fotoPreview) {
      if (ficha.foto_modelo) {
        fotoPreview.innerHTML = `
          <div style="margin-top: 15px; padding: 15px; border: 2px solid #667eea; border-radius: 8px; background: #f8f9fa;">
            <p style="font-weight: bold; color: #667eea; margin-bottom: 10px; text-align: center;">
              📸 Foto Actual:
            </p>
            <div style="text-align: center;">
              <img src="http://localhost:3000/${ficha.foto_modelo}" 
                   alt="Foto actual" 
                   style="max-width: 300px; max-height: 300px; border-radius: 8px; border: 2px solid #ddd; margin: 0 auto;">
              <p style="font-size: 12px; color: #666; margin-top: 8px;">
                (Selecciona una nueva foto para reemplazarla)
              </p>
            </div>
          </div>
        `;
      } else {
        fotoPreview.innerHTML = `
          <div style="margin-top: 15px; padding: 15px; border: 2px dashed #ccc; border-radius: 8px; background: #f8f9fa; text-align: center;">
            <p style="color: #999; font-size: 14px;">
              ⚠️ No hay foto actual
            </p>
          </div>
        `;
      }
    }
    
    // Limpiar campo de archivo (no se puede precargar)
    document.getElementById('foto').value = '';
    
    editMode = true;
    currentId = id;
    
    showTab('crear');
    showAlert('Editando ficha ID: ' + id, 'success');
  } catch (err) {
    console.error('Error al cargar ficha:', err);
    showAlert('Error al cargar ficha: ' + (err.error || err.message), 'error');
  }
}

// =====================
// SELECCIONAR PARA OC
// =====================
function seleccionarParaOC(fichaId) {
  localStorage.setItem('ficha_seleccionada', fichaId);
  showAlert('Modelo seleccionado para usar en Orden de Compra', 'success');
}

// =====================
// RESET FORMULARIO
// =====================
function resetForm() {
  document.getElementById('fichaForm').reset();
  editMode = false;
  currentId = null;
  document.getElementById('alert').style.display = 'none';
  
  // Limpiar vista previa de foto
  const fotoPreview = document.getElementById('fotoPreview');
  if (fotoPreview) {
    fotoPreview.innerHTML = '';
  }
}

// =====================
// MOSTRAR TAB
// =====================
function showTab(tabName, event) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const tabElement = document.getElementById(tabName);
  if (tabElement) {
    tabElement.classList.add('active');
  }
  
  if (event && event.target) {
    event.target.classList.add('active');
  }
  
  if (tabName === 'listar') {
    cargarFichas();
  }
}


// =====================
// ALERTA
// =====================
function showAlert(message, type) {
  const alertDiv = document.getElementById('alert');
  alertDiv.textContent = message;
  alertDiv.className = type === 'success' ? 'alert alert-success' : 'alert alert-error';
  alertDiv.style.display = 'block';
  
  setTimeout(() => {
    alertDiv.style.display = 'none';
  }, 3000);
}

// =====================
// LOGOUT
// =====================
function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}
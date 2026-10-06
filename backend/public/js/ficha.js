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
    window.location.href = 'login.html';
    return null;
  }
  
  try {
    return JSON.parse(userStr);
  } catch {
    window.location.href = 'login.html';
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

  cargarClientes();
  cargarFichas();
  materialesListos = cargarMateriales();
});

/* =====================
   MATERIALES (catálogo de materias primas para la receta y para elegir el
   alambre de cada devanado). Sin precios.
===================== */
let materialesCache = [];
let materialesListos = Promise.resolve();

async function cargarMateriales() {
  try {
    materialesCache = await apiFetch('/api/ficha-transformador/materiales');
  } catch (err) {
    console.error('Error cargando materiales:', err);
    materialesCache = [];
  }
  document.querySelectorAll('select[data-select-material]').forEach(sel => {
    const elegido = sel.value;
    sel.innerHTML = opcionesMateriales(elegido);
    sel.value = elegido;
  });
}

/** <option>s de materiales: primero los de la categoría Alambres, después el resto. */
function opcionesMateriales(seleccionadoId) {
  const grupo = (lista) => lista.map(m =>
    `<option value="${m.id}" ${String(m.id) === String(seleccionadoId) ? 'selected' : ''}>${escHtml(m.nombre)} (${escHtml(m.unidad_medida)})</option>`).join('');
  const alambres = materialesCache.filter(m => m.categoria_nombre === 'Alambres');
  const otros = materialesCache.filter(m => m.categoria_nombre !== 'Alambres');
  return '<option value="">Sin material (no descuenta stock)</option>' +
    (alambres.length ? `<optgroup label="Alambres">${grupo(alambres)}</optgroup>` : '') +
    (otros.length ? `<optgroup label="${alambres.length ? 'Otros materiales' : 'Materiales'}">${grupo(otros)}</optgroup>` : '');
}

/* =====================
   SOLAPAS DEL DETALLE: Ficha · Receta · Diagrama de salidas
===================== */
function mostrarSolapaDetalle(nombre) {
  document.querySelectorAll('#detailModal .dtab').forEach(b => b.classList.toggle('active', b.dataset.dtab === nombre));
  ['ficha', 'receta', 'diagrama'].forEach(n => {
    const pane = document.getElementById('dtab-' + n);
    if (pane) pane.hidden = n !== nombre;
  });
  if (nombre === 'receta' && typeof cargarRecetaTab === 'function') cargarRecetaTab();
  if (nombre === 'diagrama' && typeof cargarDiagramaTab === 'function') cargarDiagramaTab();
}

/* =====================
   FOTO DEL MODELO
   La foto elegida se valida y se reduce en el navegador (las de celular
   suelen pasar de 5 MB o venir en HEIC, y antes eso hacía fallar el
   guardado entero sin explicar nada). Lo que se manda al servidor es
   `fotoLista`, no el archivo original del <input>.
===================== */
const FOTO_MAX_BYTES = 5 * 1024 * 1024;
const FOTO_LADO_MAX = 1600;       // px del lado más largo
const FOTO_SIN_REDUCIR = 1.5 * 1024 * 1024;

let fotoLista = null;      // File listo para subir (null = no se eligió una nueva)
let quitarFoto = false;    // al editar: pidió sacar la foto actual

function mostrarError(id, mensaje) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = mensaje || '';
  el.hidden = !mensaje;
}

async function prepararFoto(archivo) {
  if (archivo.type && !/^image\/(jpeg|png|webp|gif)$/.test(archivo.type)) {
    throw new Error('La foto tiene que ser JPG, PNG, WEBP o GIF. Si viene de un iPhone (HEIC), sacala o guardala como JPG.');
  }
  let bmp;
  try {
    bmp = await createImageBitmap(archivo);
  } catch (_) {
    throw new Error('No se pudo leer la imagen. Probá con otra foto.');
  }
  const escala = Math.min(1, FOTO_LADO_MAX / Math.max(bmp.width, bmp.height));
  if (escala === 1 && archivo.size <= FOTO_SIN_REDUCIR) {
    bmp.close();
    return archivo;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // el JPEG no tiene transparencia
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('No se pudo reducir la imagen. Probá con otra foto.');
  if (blob.size > FOTO_MAX_BYTES) throw new Error('La foto sigue pesando más de 5 MB aun reducida. Probá con otra.');
  return new File([blob], (archivo.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

function mostrarVistaPreviaFoto(src) {
  const preview = document.getElementById('fotoPreview');
  if (!preview) return;
  if (src) {
    preview.src = src;
    preview.classList.add('show');
  } else {
    preview.removeAttribute('src');
    preview.classList.remove('show');
  }
  const acciones = document.getElementById('fotoAcciones');
  if (acciones) acciones.hidden = !src;
}

async function onFotoElegida() {
  const input = document.getElementById('foto');
  const archivo = input.files && input.files[0];
  mostrarError('fotoError', '');
  if (!archivo) return;

  try {
    fotoLista = await prepararFoto(archivo);
    quitarFoto = false;
    mostrarVistaPreviaFoto(URL.createObjectURL(fotoLista));
  } catch (err) {
    fotoLista = null;
    input.value = '';
    mostrarError('fotoError', err.message);
  }
}

function quitarFotoActual() {
  fotoLista = null;
  quitarFoto = editMode; // al crear no hay nada guardado que quitar
  document.getElementById('foto').value = '';
  mostrarError('fotoError', '');
  mostrarVistaPreviaFoto(null);
}

// Delegación: el shell vuelve a armar el body, así que no se enganchan
// listeners a elementos concretos al cargar el archivo.
document.addEventListener('change', (e) => {
  if (e.target.id === 'foto') onFotoElegida();
  else if (e.target.id === 'etiquetaInput') subirEtiqueta();
});

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
      tbody.innerHTML = `<tr><td colspan="5">${Shell.vacio(
        'Todavía no hay modelos cargados',
        'Creá el primero desde la pestaña "Nueva ficha".')}</td></tr>`;
      return;
    }

    fichas.forEach(ficha => {
      const tr = document.createElement('tr');

      // Antes esta fila tenía una columna de #id que no estaba en el
      // encabezado, y le faltaban Amperaje y Cliente, que sí estaban
      // anunciados: la tabla quedaba desalineada.
      const tipoBadge = ficha.cliente_id ? Shell.pill('ESPECIFICO') : Shell.pill('GENERICO');

      tr.innerHTML = `
        <td><strong>${escHtml(ficha.modelo)}</strong></td>
        <td data-label="Tipo">${tipoBadge}</td>
        <td class="num muted solo-escritorio" data-label="Voltaje E/S">${escHtml(ficha.voltaje_entrada) || '—'}V / ${escHtml(ficha.voltaje_salida) || '—'}V</td>
        <td class="num muted solo-escritorio" data-label="Amperaje E/S">${escHtml(ficha.amperaje_entrada) || '—'}A / ${escHtml(ficha.amperaje_salida) || '—'}A</td>
        <td class="num">
          <button class="b b-ghost b-sm" onclick="verDetalles(${ficha.id})">Ver</button>
          <button class="b b-ghost b-sm" onclick="editarFicha(${ficha.id})">Editar</button>
          ${rolPermiteEliminar() ?
            `<button class="b b-ghost b-sm" data-eliminar="${ficha.id}" data-modelo="${escHtml(ficha.modelo)}">Eliminar</button>`
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
    title.innerHTML = `⚡ ${escHtml(ficha.modelo)} - Ficha Técnica Completa ${tipoBadge}`;

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
          <span class="detail-card-value">${escHtml(ficha.cliente_nombre) || 'Modelo Genérico'}</span>
        </div>
      </div>
    `;

    // Tarjeta de foto (si existe)
    if (ficha.foto_modelo) {
      html += `
        <div class="detail-card" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center;">
          <h4>📸 Imagen del Modelo</h4>
          <img data-foto="${escHtml(ficha.foto_modelo)}" alt="Foto del modelo" style="max-width: 250px; border-radius: 0.75rem; border: 2px solid #cbd5e0;">
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
          <span class="detail-card-value">${escHtml(ficha.voltaje_entrada) || '-'} V</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Voltaje Salida</span>
          <span class="detail-card-value">${escHtml(ficha.voltaje_salida) || '-'} V</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Amperaje Entrada</span>
          <span class="detail-card-value">${escHtml(ficha.amperaje_entrada) || '-'} A</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Amperaje Salida</span>
          <span class="detail-card-value">${escHtml(ficha.amperaje_salida) || '-'} A</span>
        </div>
      </div>
    `;

    // --- FILA 2 (cont): Características Físicas ---
    html += `
      <div class="detail-card">
        <h4>🔧 Físicas</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">Tipo Carretel</span>
          <span class="detail-card-value">${escHtml(ficha.tipo_carretel) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Laminación</span>
          <span class="detail-card-value">${escHtml(ficha.laminacion) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Peso Laminación</span>
          <span class="detail-card-value">${escHtml(ficha.peso_laminacion_kg) || '-'} gr</span>
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
          <span class="detail-card-value">${escHtml(ficha.alambre_primario) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Diámetro</span>
          <span class="detail-card-value">${escHtml(ficha.diametro_primario_mm) || '-'} mm</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Espiras</span>
          <span class="detail-card-value">${escHtml(ficha.espiras_primario) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Pines</span>
          <span class="detail-card-value">${escHtml(ficha.pines_primario) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Peso</span>
          <span class="detail-card-value">${escHtml(ficha.peso_primario_kg) || '-'} gr</span>
        </div>
      </div>
    `;

    // Devanado Secundario
    html += `
      <div class="detail-card">
        <h4>🔄 Devanado Secundario</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">Alambre</span>
          <span class="detail-card-value">${escHtml(ficha.alambre_secundario) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Diámetro</span>
          <span class="detail-card-value">${escHtml(ficha.diametro_secundario_mm) || '-'} mm</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Espiras</span>
          <span class="detail-card-value">${escHtml(ficha.espiras_secundario) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Pines</span>
          <span class="detail-card-value">${escHtml(ficha.pines_secundario) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Peso</span>
          <span class="detail-card-value">${escHtml(ficha.peso_secundario_kg) || '-'} gr</span>
        </div>
      </div>
    `;

    // Devanados adicionales (terciario, cuarto…), si la ficha los tiene
    (ficha.devanados_extra || []).forEach((d, i) => {
      html += `
      <div class="detail-card">
        <h4>🔄 Devanado ${NOMBRES_DEVANADO[i] ? NOMBRES_DEVANADO[i].charAt(0).toUpperCase() + NOMBRES_DEVANADO[i].slice(1) : (i + 3) + '°'}</h4>
        <div class="detail-card-row">
          <span class="detail-card-label">Alambre</span>
          <span class="detail-card-value">${escHtml(d.alambre) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Diámetro</span>
          <span class="detail-card-value">${escHtml(d.diametro_mm) || '-'} mm</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Espiras</span>
          <span class="detail-card-value">${escHtml(d.espiras) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Pines</span>
          <span class="detail-card-value">${escHtml(d.pines) || '-'}</span>
        </div>
        <div class="detail-card-row">
          <span class="detail-card-label">Peso</span>
          <span class="detail-card-value">${escHtml(d.peso_kg) || '-'} gr</span>
        </div>
      </div>`;
    });

    html += `</div>`; // Cierre de la grid de devanados

    // --- FILA 4: Observaciones (siempre al final y ancho completo) ---
    html += `
      <div class="observaciones-detalle" style="margin-top: 1rem;">
        <h4 style="display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.5rem 0;">
          <span>📝</span> Observaciones
        </h4>
        <p style="margin: 0; color: #334155;">${escHtml(ficha.observaciones) || 'Sin observaciones adicionales.'}</p>
      </div>
    `;

    content.innerHTML = html;
    // La foto está protegida: se pide con la sesión (ver cargarImagenProtegida en api.js).
    content.querySelectorAll('img[data-foto]').forEach(img => cargarImagenProtegida(img, img.dataset.foto));
    mostrarError('etiquetaError', '');
    actualizarEtiquetasUI(ficha);
    mostrarSolapaDetalle('ficha');
    document.getElementById('detailModal').showModal();

  } catch (err) {
    console.error('Error cargando detalles:', err);
    showAlert('Error cargando detalles: ' + (err.error || err.message), 'error');
  }
}
/* =====================
   CERRAR MODAL
===================== */
function closeDetailModal() {
  document.getElementById('detailModal').close();
  currentFicha = null;
}

/* =====================
   VER PDF — se abre en una pestaña nueva
===================== */
async function verFichaPdf() {
  if (!currentFicha) {
    showAlert('No hay ficha para exportar', 'error');
    return;
  }

  try {
    await verArchivoProtegido(`api/ficha-transformador/${currentFicha.id}/pdf`);
  } catch (err) {
    console.error('Error abriendo PDF:', err);
    showAlert('Error abriendo PDF: ' + err.message, 'error');
  }
}

/* =====================
   ETIQUETAS (PDF que lleva pegado el transformador; algunos modelos
   llevan más de una — ej. primario y secundario por separado)
===================== */
function actualizarEtiquetasUI(ficha) {
  const estado = document.getElementById('etiquetaEstado');
  const lista = document.getElementById('etiquetasLista');
  const etiquetas = ficha.etiquetas || [];

  estado.textContent = etiquetas.length
    ? `${etiquetas.length} etiqueta${etiquetas.length === 1 ? '' : 's'} cargada${etiquetas.length === 1 ? '' : 's'}.`
    : 'Todavía no se cargó ninguna etiqueta de este modelo.';

  lista.innerHTML = etiquetas.map((e, i) => `
    <li style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed #e2e8f0">
      <span>${escHtml(e.nombre_original) || ('Etiqueta ' + (i + 1))}</span>
      <span>
        <button type="button" class="b b-ghost b-sm" onclick="verEtiqueta(${e.id})">Ver</button>
        <button type="button" class="b b-danger b-sm" onclick="borrarEtiqueta(${e.id})">Eliminar</button>
      </span>
    </li>
  `).join('');
}

// Los errores de esta ventana se muestran adentro del <dialog>: un toast
// queda DETRÁS de un diálogo abierto con showModal() y no se veía.
let etiquetaSubiendo = false;

async function subirEtiqueta() {
  const input = document.getElementById('etiquetaInput');
  const archivo = input.files[0];
  if (!archivo || !currentFicha || etiquetaSubiendo) return;
  mostrarError('etiquetaError', '');

  // Se valida por extensión, no por archivo.type: el navegador no siempre
  // reporta "application/pdf" para un PDF real (adjuntos de mail, escaneos,
  // "imprimir a PDF" de ciertos programas), y esa comparación estaba
  // rechazando etiquetas válidas. La comprobación de verdad (la firma real
  // del archivo) la hace el servidor.
  if (!/\.pdf$/i.test(archivo.name)) {
    mostrarError('etiquetaError', 'La etiqueta tiene que ser un archivo .pdf');
    input.value = '';
    return;
  }
  if (archivo.size > FOTO_MAX_BYTES) {
    mostrarError('etiquetaError', 'El PDF pesa más de 5 MB. Probá exportarlo con menos calidad o menos páginas.');
    input.value = '';
    return;
  }

  const formData = new FormData();
  formData.append('etiqueta', archivo);

  etiquetaSubiendo = true;
  const btn = document.getElementById('btnAgregarEtiqueta');
  if (btn) btn.disabled = true;
  try {
    const nueva = await apiFetch(`/api/ficha-transformador/${currentFicha.id}/etiquetas`, {
      method: 'POST',
      body: formData
    });
    currentFicha.etiquetas = [...(currentFicha.etiquetas || []), nueva];
    actualizarEtiquetasUI(currentFicha);
  } catch (err) {
    console.error('Error subiendo etiqueta:', err);
    mostrarError('etiquetaError', 'No se pudo subir la etiqueta: ' + (err.error || err.message));
  } finally {
    etiquetaSubiendo = false;
    if (btn) btn.disabled = false;
    input.value = '';
  }
}

async function verEtiqueta(id) {
  if (!currentFicha) return;
  const etiqueta = (currentFicha.etiquetas || []).find(e => e.id === id);
  if (!etiqueta) return;
  mostrarError('etiquetaError', '');

  try {
    await verArchivoProtegido(etiqueta.archivo);
  } catch (err) {
    console.error('Error abriendo etiqueta:', err);
    mostrarError('etiquetaError', 'No se pudo abrir la etiqueta: ' + err.message);
  }
}

async function borrarEtiqueta(id) {
  if (!currentFicha) return;
  mostrarError('etiquetaError', '');
  if (!await confirmarFicha('Quitar etiqueta', '¿Quitar esta etiqueta del modelo?', 'Quitar')) return;

  try {
    await apiFetch(`/api/ficha-transformador/${currentFicha.id}/etiquetas/${id}`, { method: 'DELETE' });
    currentFicha.etiquetas = (currentFicha.etiquetas || []).filter(e => e.id !== id);
    actualizarEtiquetasUI(currentFicha);
  } catch (err) {
    console.error('Error borrando etiqueta:', err);
    mostrarError('etiquetaError', 'No se pudo eliminar la etiqueta: ' + (err.error || err.message));
  }
}

/* Confirmación en un <dialog class="panel"> (no confirm(): ver CLAUDE.md).
   Devuelve una Promise<boolean>. */
function confirmarFicha(titulo, mensajeHtml, textoBoton) {
  return new Promise((resolve) => {
    document.getElementById('confirmarFichaTitulo').textContent = titulo;
    document.getElementById('confirmarFichaMsg').innerHTML = mensajeHtml;
    const modal = document.getElementById('confirmarFichaModal');
    const btn = document.getElementById('btnConfirmarFicha');
    btn.textContent = textoBoton || 'Confirmar';

    function limpiar() {
      btn.removeEventListener('click', onConfirmar);
      modal.removeEventListener('close', onCerrar);
    }
    function onConfirmar() { limpiar(); modal.close(); resolve(true); }
    function onCerrar() { limpiar(); resolve(false); }

    btn.addEventListener('click', onConfirmar);
    modal.addEventListener('close', onCerrar);
    modal.showModal();
  });
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

async function confirmarEliminar(id, modelo) {
  const ok = await confirmarFicha(
    'Eliminar modelo',
    `¿Está seguro de eliminar el modelo <strong>${escHtml(modelo)}</strong>?<br>Esta acción no se puede deshacer.`,
    'Eliminar'
  );
  if (ok) eliminarFicha(id);
}

function rolPermiteEliminar() {
  return usuario.rol === 'admin' || usuario.rol === 'control';
}

/* =====================
   DEVANADOS ADICIONALES (terciario, cuarto…)
   Se agregan con el botón del formulario. Se mandan al servidor como una
   lista JSON (`devanados_extra`) y ahí reemplazan a los guardados.
===================== */
const NOMBRES_DEVANADO = ['terciario', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];
let contadorDevanados = 0;

// Lo que viene de la base o de lo tipeado se escapa antes de armar HTML.
function escHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function agregarDevanadoExtra(datos) {
  const cont = document.getElementById('devanadosExtra');
  if (!cont) return;
  if (cont.children.length >= NOMBRES_DEVANADO.length) {
    showAlert(`Se pueden agregar hasta ${NOMBRES_DEVANADO.length} devanados además del primario y el secundario`, 'error');
    return;
  }
  const d = datos || {};
  const id = 'dx' + (++contadorDevanados);
  const panel = document.createElement('div');
  panel.className = 'panel devanado-extra';
  panel.innerHTML = `
    <div class="panel-head">
      <h2 data-titulo-devanado></h2>
      <div class="page-head-actions">
        <button type="button" class="b b-danger b-sm" data-quitar-devanado>Quitar</button>
      </div>
    </div>
    <div class="panel-body">
      <div class="form-grid">
        <div class="field ancho-total">
          <label for="${id}_alambre">Alambre</label>
          <input class="input" type="text" id="${id}_alambre" data-campo="alambre" maxlength="100"
                 placeholder="Ej: Esmaltado 1.0mm" value="${escHtml(d.alambre)}">
        </div>
        <div class="field ancho-total">
          <label for="${id}_material">Material de alambre en stock <span class="muted">(opcional)</span></label>
          <select class="input" id="${id}_material" data-campo="material_id" data-select-material="alambre">${opcionesMateriales(d.material_id)}</select>
        </div>
        <div class="field">
          <label for="${id}_diametro">Diámetro</label>
          <div class="field-unit">
            <input class="input" type="number" id="${id}_diametro" data-campo="diametro_mm" step="0.01" min="0"
                   value="${escHtml(d.diametro_mm)}"><span>mm</span>
          </div>
        </div>
        <div class="field">
          <label for="${id}_espiras">Espiras</label>
          <input class="input" type="text" id="${id}_espiras" data-campo="espiras" maxlength="40"
                 placeholder="Ej: 120 o 60 + 60" value="${escHtml(d.espiras)}">
        </div>
        <div class="field">
          <label for="${id}_pines">Pines</label>
          <input class="input" type="text" id="${id}_pines" data-campo="pines" maxlength="50"
                 placeholder="5-6" value="${escHtml(d.pines)}">
        </div>
        <div class="field">
          <label for="${id}_peso">Peso</label>
          <div class="field-unit">
            <input class="input" type="number" id="${id}_peso" data-campo="peso_kg" step="0.1" min="0"
                   value="${escHtml(d.peso_kg)}"><span>gr</span>
          </div>
        </div>
      </div>
    </div>`;
  cont.appendChild(panel);
  renumerarDevanados();
}

// Los títulos dependen del lugar: tras quitar uno, los demás se corren.
function renumerarDevanados() {
  const cont = document.getElementById('devanadosExtra');
  if (!cont) return;
  Array.from(cont.children).forEach((panel, i) => {
    const t = panel.querySelector('[data-titulo-devanado]');
    if (t) t.textContent = 'Devanado ' + NOMBRES_DEVANADO[i];
  });
  const btn = document.getElementById('btnAgregarDevanado');
  if (btn) btn.disabled = cont.children.length >= NOMBRES_DEVANADO.length;
}

function limpiarDevanadosExtra() {
  const cont = document.getElementById('devanadosExtra');
  if (cont) cont.innerHTML = '';
  renumerarDevanados();
}

function cargarDevanadosExtra(lista) {
  limpiarDevanadosExtra();
  (lista || []).forEach(d => agregarDevanadoExtra(d));
}

// Un devanado sin ningún dato no se guarda (se agregó y se dejó en blanco).
function leerDevanadosExtra() {
  const cont = document.getElementById('devanadosExtra');
  if (!cont) return [];
  return Array.from(cont.children).map(panel => {
    const d = {};
    panel.querySelectorAll('[data-campo]').forEach(inp => { d[inp.dataset.campo] = inp.value.trim(); });
    return d;
  }).filter(d => Object.values(d).some(v => v !== ''));
}

// Delegación: el shell vuelve a armar el body, así que no se enganchan
// listeners a elementos concretos al cargar el archivo.
document.addEventListener('click', (e) => {
  if (e.target.closest('#btnAgregarDevanado')) {
    agregarDevanadoExtra();
    return;
  }
  const solapa = e.target.closest('#detailModal .dtab');
  if (solapa) {
    mostrarSolapaDetalle(solapa.dataset.dtab);
    return;
  }
  if (e.target.closest('#btnQuitarFoto')) {
    quitarFotoActual();
    return;
  }
  if (e.target.closest('#btnEtiquetasEditor') && currentId) {
    verDetalles(currentId);
    return;
  }
  const eliminar = e.target.closest('[data-eliminar]');
  if (eliminar) {
    confirmarEliminar(Number(eliminar.dataset.eliminar), eliminar.dataset.modelo);
    return;
  }
  const quitar = e.target.closest('[data-quitar-devanado]');
  if (quitar) {
    quitar.closest('.devanado-extra')?.remove();
    renumerarDevanados();
  }
});

/* =====================
   SUBMIT FORMULARIO
===================== */
// Sin esta guarda, un doble click en "Guardar ficha técnica" mandaba dos
// POST idénticos (hallazgo 27/09/2026, mismo patrón que oc.js/clientes.js).
// Al crear, el UNIQUE de ficha_transformador.modelo frena el segundo con un
// error feo; al editar (PUT), nada lo frena.
let fichaEnviando = false;

async function handleSubmit(e) {
  e.preventDefault();
  if (fichaEnviando) return;
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
    'peso_primario_kg', 'material_primario_id',
    'alambre_secundario', 'diametro_secundario_mm',
    'espiras_secundario', 'pines_secundario',
    'peso_secundario_kg', 'material_secundario_id'
  ];

  fields.forEach(field => {
    const element = document.getElementById(field);
    if (element && element.value) {
      formData.append(field, element.value);
    }
  });

  // Siempre se manda la lista (aunque esté vacía): así, al editar, quitar
  // todos los devanados adicionales también se guarda.
  formData.append('devanados_extra', JSON.stringify(leerDevanadosExtra()));

  // Se manda la foto ya validada y reducida (fotoLista), no la del <input>.
  if (fotoLista) formData.append('foto', fotoLista);
  else if (editMode && quitarFoto) formData.append('quitar_foto', '1');

  fichaEnviando = true;
  const btn = e.target.querySelector('button[type="submit"]');
  const textoBoton = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

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
  } finally {
    fichaEnviando = false;
    if (btn) { btn.disabled = false; btn.textContent = textoBoton; }
  }
}

/* =====================
   EDITAR FICHA
===================== */
async function editarFicha(id) {
  try {
    console.log('Editando ficha:', id);
    
    const ficha = await apiFetch(`/api/ficha-transformador/${id}`);
    // Los desplegables de material tienen que estar armados antes de asignarles valor.
    await materialesListos;

    // Se parte de un formulario limpio: sin esto quedaba la foto elegida (o el
    // aviso de error) de la ficha anterior, y se mandaba al guardar esta.
    resetForm();

    // Llenar el formulario con los datos de la ficha
    Object.keys(ficha).forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        el.value = ficha[key] || '';
      }
    });
    cargarDevanadosExtra(ficha.devanados_extra);

    // Mostrar foto actual si existe
    const preview = document.getElementById('fotoPreview');
    if (preview && ficha.foto_modelo) {
      cargarImagenProtegida(preview, ficha.foto_modelo);
      preview.classList.add('show');
      document.getElementById('fotoAcciones').hidden = false;
    }

    editMode = true;
    currentId = id;
    actualizarPanelEtiquetasEditor();
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
  limpiarDevanadosExtra();
  fotoLista = null;
  quitarFoto = false;
  mostrarError('fotoError', '');
  mostrarVistaPreviaFoto(null);
  editMode = false;
  currentId = null;
  actualizarPanelEtiquetasEditor();
}

// En el editor las etiquetas se administran desde la ventana de detalle
// (la ficha tiene que existir para poder subirle un archivo).
function actualizarPanelEtiquetasEditor() {
  const msg = document.getElementById('etiquetasEditorMsg');
  const btn = document.getElementById('btnEtiquetasEditor');
  if (!msg || !btn) return;
  btn.hidden = !editMode;
  msg.textContent = editMode
    ? 'Las etiquetas de este modelo se agregan, descargan y quitan desde la ventana de detalle.'
    : 'Guardá la ficha y después agregá las etiquetas desde «Ver».';
}

/* =====================
   MOSTRAR TAB
===================== */
function showTab(tabName, event) {
  // Tocar "Nueva ficha" (viene con `event`) arranca un formulario limpio. Antes
  // quedaba el modo edición de la ficha anterior y "Guardar" hacía un PUT
  // sobre ella en vez de crear una nueva. editarFicha() llama sin `event`.
  if (tabName === 'crear' && event) resetForm();

  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  const tab = document.getElementById(tabName);
  if (tab) tab.classList.add('active');
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  if (tabName === 'listar') cargarFichas();
}

/* =====================
   ALERTA
===================== */
function showAlert(message, type) {
  Shell.toast(type === 'success' ? 'ok' : 'err', message);
}

/* =====================
   LOGOUT
===================== */
function logout() {
  localStorage.clear();
  window.location.href = 'login.html';
}

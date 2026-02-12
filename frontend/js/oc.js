const lista = document.getElementById('listaOC');
const form = document.getElementById('ocForm');

// =====================
// CARGAR CLIENTES
// =====================
async function cargarClientesSelect() {
  try {
    const clientes = await apiFetch('/clientes');
    const select = document.getElementById('cliente_id');
    
    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Error cargando clientes:', err);
  }
}

// =====================
// CREAR OC
// =====================
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const data = {
    cliente_id: parseInt(document.getElementById('cliente_id').value),
    numero_oc: document.getElementById('numero_oc').value,
    fecha_oc: document.getElementById('fecha_oc').value
  };

  if (!data.cliente_id || !data.numero_oc || !data.fecha_oc) {
    alert('Complete todos los campos obligatorios');
    return;
  }

  try {
    await apiFetch('/ordenes-compra', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    
    form.reset();
    alert('OC creada correctamente');
    cargarOC();
  } catch (err) {
    alert(err.error || 'Error al crear OC');
  }
});

// =====================
// LISTAR OCS
// =====================
async function cargarOC() {
  lista.innerHTML = '';
  
  try {
    const ocs = await apiFetch('/ordenes-compra');
    
    if (ocs.length === 0) {
      lista.innerHTML = '<li>No hay órdenes de compra</li>';
      return;
    }

    ocs.forEach(oc => {
      const li = document.createElement('li');
      li.innerHTML = `
        OC ${oc.numero_oc} - ${oc.cliente} - ${oc.estado}
        <button class="btn-warning" onclick="verOC(${oc.id})">Ver Detalle</button>
      `;
      lista.appendChild(li);
    });
  } catch (err) {
    alert('Error cargando OCs');
  }
}

// =====================
// VER OC
// =====================
function verOC(id) {
  window.location.href = `oc_detalle.html?id=${id}`;
}

// =====================
// INIT
// =====================
cargarClientesSelect();
cargarOC();
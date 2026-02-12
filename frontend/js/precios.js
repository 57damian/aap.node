document.addEventListener('DOMContentLoaded', () => {
  cargarPrecios();
  cargarModelos();

  document.getElementById('btnAumentar')
    .addEventListener('click', aplicarAumento);

  document.getElementById('modeloSelect')
  .addEventListener('change', mostrarHistorial);

});

async function cargarPrecios() {
  const data = await apiFetch('/precios/actuales');
  const tbody = document.getElementById('tablaPrecios');
  tbody.innerHTML = '';

  data.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.modelo}</td>
      <td>${p.precio_usd || '-'}</td>
      <td>${p.fecha_desde || '-'}</td>
      <td>
        <button onclick="actualizarPrecio(${p.ficha_id})">
          Nuevo precio
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function cargarModelos() {
  const data = await apiFetch('/precios/actuales');
  const select = document.getElementById('modeloSelect');
  select.innerHTML = '';

  const modelosConPrecio = data.filter(p => p.precio_usd !== null);

  modelosConPrecio.forEach(p => {
    const option = document.createElement('option');
    option.value = p.ficha_id;
    option.textContent = `${p.modelo} (USD ${p.precio_usd})`;
    select.appendChild(option);
  });

  if (modelosConPrecio.length > 0) {
    select.value = modelosConPrecio[0].ficha_id;
    await mostrarHistorial();
  }
}

  




async function actualizarPrecio(ficha_id) {
  const nuevoPrecio = prompt('Nuevo precio USD:');
  if (!nuevoPrecio) return;

  const observaciones = prompt('Observaciones (opcional):');

  await apiFetch('/precios/modelo', {
    method: 'POST',
    body: JSON.stringify({
      ficha_id,
      precio: parseFloat(nuevoPrecio),
      observaciones
    })
  });

  alert('Precio actualizado');
  cargarPrecios();
  cargarModelos();
}

async function aplicarAumento() {
  const ficha_id = document.getElementById('modeloSelect').value;
  const porcentaje = Number(document.getElementById('porcentaje').value);
  const observaciones = document.getElementById('observaciones').value;

  if (!ficha_id || !porcentaje) {
    alert('Datos incompletos');
    return;
  }

  await apiFetch(`/precios/aumento/${ficha_id}`, {
    method: 'POST',
    body: JSON.stringify({ 
      porcentaje,
      observaciones
    })
  });

  alert('Aumento aplicado');

  cargarPrecios();
  cargarModelos();
  mostrarHistorial();

  document.getElementById('observaciones').value = '';
}



async function mostrarHistorial() {

  const ficha_id = document.getElementById('modeloSelect').value;
  if (!ficha_id) return;




  const data = await apiFetch(`/precios/modelo/${ficha_id}`);
  const tbody = document.getElementById('tablaHistorial');
  tbody.innerHTML = '';
  console.log("tbody:", tbody);
    console.log("DATA:", data);
  console.log("LENGTH:", data.length);
  data.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.precio_usd}</td>
      <td>${p.fecha_desde}</td>
      <td>${p.observaciones || '-'}</td>
    `;
    tbody.appendChild(tr);
    console.log("tbody:", tbody);
    
  });
}

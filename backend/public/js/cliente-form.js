/* =====================================================================
 * cliente-form.js — Campos del cliente, compartidos
 * Los usan el diálogo "Nuevo cliente" (clientes.html) y la solapa "Datos"
 * de la ficha (cliente.html), para no mantener dos formularios iguales.
 *
 *   ClienteForm.campos()          → HTML de los campos
 *   ClienteForm.cargar(raiz, c)   → vuelca un cliente en los campos
 *   ClienteForm.leer(raiz)        → objeto listo para POST/PUT /api/clientes
 *   ClienteForm.limpiar(raiz)
 * ===================================================================== */
(function (global) {
  'use strict';

  const CAMPOS = ['nombre', 'cuit', 'telefono', 'correo', 'direccion', 'forma_pago', 'dias_max_pago', 'observaciones'];

  function campos() {
    return `
    <div class="form-grid">
      <div class="field ancho-total">
        <label>Nombre del cliente *</label>
        <input class="input" type="text" name="nombre" required placeholder="Ej: Industrias ABC S.A.">
      </div>
      <div class="field"><label>CUIT</label>
        <input class="input" type="text" name="cuit" placeholder="Ej: 30-12345678-9"></div>
      <div class="field"><label>Teléfono</label>
        <input class="input" type="tel" name="telefono" placeholder="Ej: 11 1234-5678"></div>
      <div class="field"><label>Correo electrónico</label>
        <input class="input" type="email" name="correo" placeholder="ejemplo@empresa.com"></div>
      <div class="field"><label>Dirección</label>
        <input class="input" type="text" name="direccion" placeholder="Calle 123, Ciudad"></div>
      <div class="field"><label>Forma de pago</label>
        <select class="select" name="forma_pago">
          <option value="">-- Seleccionar --</option>
          <option value="contado">Contado</option>
          <option value="cheque">Cheque</option>
          <option value="transferencia">Transferencia</option>
          <option value="otro">Otro</option>
        </select></div>
      <div class="field"><label>Días máximo de pago</label>
        <input class="input" type="number" name="dias_max_pago" min="0" placeholder="Ej: 30"></div>
      <div class="field ancho-total"><label>Observaciones</label>
        <textarea class="input" name="observaciones" placeholder="Notas adicionales sobre el cliente..."></textarea></div>
    </div>`;
  }

  const campo = (raiz, nombre) => raiz.querySelector(`[name="${nombre}"]`);

  function cargar(raiz, cliente) {
    CAMPOS.forEach((n) => { campo(raiz, n).value = (cliente && cliente[n]) ?? ''; });
  }

  function limpiar(raiz) {
    cargar(raiz, null);
  }

  function leer(raiz) {
    const d = {};
    CAMPOS.forEach((n) => { d[n] = campo(raiz, n).value; });
    d.dias_max_pago = Number.parseInt(d.dias_max_pago, 10) || null;
    return d;
  }

  global.ClienteForm = { campos, cargar, leer, limpiar };
})(window);

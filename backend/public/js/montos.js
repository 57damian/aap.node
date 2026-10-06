/* =====================================================================
 * MONTOS EN PESOS (compartido: lo carga el navegador y lo usa el servidor
 * a través de services/montos.js) — redondeo a centavos
 * ---------------------------------------------------------------------
 * Una factura impresa redondea a centavos cada importe (renglón, IVA,
 * total). El sistema sumaba los importes sin redondear y recién al final
 * mostraba 2 decimales, y la base redondeaba cada renglón por su cuenta:
 * el total de la cabecera y la suma de los renglones podían diferir en
 * $0,01 (y contra el papel del proveedor también).
 *
 * Regla única (la misma en public/js/facturas-compra.js):
 *   - subtotal del renglón = cantidad × precio, redondeado a centavos;
 *   - IVA por alícuota = subtotal neto de esa alícuota × % , redondeado
 *     UNA vez (como lo discrimina la factura); se reparte entre los
 *     renglones para que la suma de los renglones dé exactamente ese IVA;
 *   - total del renglón = subtotal + IVA.
 * Redondeo "medio hacia arriba" sobre el valor decimal (no sobre el
 * binario: 1,005 · 100 da 100,49999… en coma flotante).
 * ===================================================================== */

/** Redondea a 2 decimales, medio hacia arriba (para importes positivos o negativos). */
function r2(valor) {
  const n = Number(valor);
  if (!isFinite(n)) return 0;
  // toPrecision(15) descarta el ruido binario y el desplazamiento por
  // exponente ('1.005e2' = 100,5 exacto) evita el 100,4999… de 1,005 · 100.
  const abs = Math.abs(Number(n.toPrecision(15)));
  const redondeado = Number(Math.round(Number(abs.toFixed(10) + 'e2')) + 'e-2');
  return n < 0 ? -redondeado : redondeado;
}

/**
 * Calcula subtotal / IVA / total de cada renglón y los totales de la factura.
 * `renglones`: [{ cantidad, precio_unitario, iva_porcentaje }]. Devuelve los
 * mismos renglones con subtotal, iva y total, más los acumulados.
 */
function calcularRenglones(renglones) {
  const subtotales = renglones.map(r => r2((Number(r.cantidad) || 0) * (Number(r.precio_unitario) || 0)));

  // IVA acumulado por alícuota: el de cada renglón es la diferencia entre el
  // IVA redondeado del neto acumulado hasta él y hasta el renglón anterior.
  const netoPorAlicuota = new Map();
  const ivas = renglones.map((r, i) => {
    const alicuota = Number(r.iva_porcentaje) || 0;
    const antes = netoPorAlicuota.get(alicuota) || 0;
    const despues = r2(antes + subtotales[i]);
    netoPorAlicuota.set(alicuota, despues);
    return r2(r2(despues * alicuota / 100) - r2(antes * alicuota / 100));
  });

  const items = renglones.map((r, i) => ({
    ...r,
    subtotal: subtotales[i],
    iva: ivas[i],
    total: r2(subtotales[i] + ivas[i])
  }));

  const subtotal = r2(subtotales.reduce((s, v) => s + v, 0));
  const iva = r2(ivas.reduce((s, v) => s + v, 0));
  return { items, subtotal, iva, total: r2(subtotal + iva) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { r2, calcularRenglones };
if (typeof window !== 'undefined') window.Montos = { r2, calcularRenglones };

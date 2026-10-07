/* Prueba de solo lectura de services/informes.js: compara cada total del
 * informe contra consultas directas e independientes y chequea las
 * identidades (resultado, suma de meses). Uso:
 *   cd backend && node scripts/probar-informes.js [desde] [hasta]
 * Sin argumentos usa del 1 de enero del año en curso a hoy. */
const pool = require('../db');
const { resumen } = require('../services/informes');
const { r2 } = require('../services/montos');

let fallos = 0;
function igual(nombre, a, b) {
  const ok = Math.abs(Number(a) - Number(b)) < 0.005;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK ' : 'MAL'} ${nombre}: informe=${a} esperado=${b}`);
}
const q = async (sql, p) => Number((await pool.query(sql, p)).rows[0].v) || 0;

(async () => {
  let [desde, hasta] = process.argv.slice(2);
  if (!desde || !hasta) {
    const y = new Date().getFullYear();
    desde = desde || y + '-01-01';
    hasta = hasta || new Date().toISOString().slice(0, 10);
  }
  const p = [desde, hasta];
  console.log(`Período ${desde} a ${hasta}\n`);

  // ---- devengado
  const inf = await resumen(pool, { desde, hasta, criterio: 'factura' });

  const ventasNeto = await q(`SELECT COALESCE(SUM(subtotal_sin_iva),0) v FROM facturas WHERE estado <> 'ANULADA' AND fecha BETWEEN $1 AND $2`, p)
    - await q(`SELECT COALESCE(SUM(subtotal),0) v FROM notas_credito WHERE fecha BETWEEN $1 AND $2`, p);
  const ventasIva = await q(`SELECT COALESCE(SUM(iva_21),0) v FROM facturas WHERE estado <> 'ANULADA' AND fecha BETWEEN $1 AND $2`, p)
    - await q(`SELECT COALESCE(SUM(iva_21),0) v FROM notas_credito WHERE fecha BETWEEN $1 AND $2`, p);
  igual('ventas neto', inf.ventas.neto, r2(ventasNeto));
  igual('IVA débito', inf.iva.debito, r2(ventasIva));

  igual('compras neto', inf.compras.neto, await q(`SELECT COALESCE(SUM(subtotal),0) v FROM facturas_compra WHERE estado <> 'ANULADA' AND fecha_emision BETWEEN $1 AND $2`, p));
  igual('IVA crédito compras', inf.iva.credito_compras, await q(`SELECT COALESCE(SUM(iva),0) v FROM facturas_compra WHERE estado <> 'ANULADA' AND fecha_emision BETWEEN $1 AND $2`, p));
  igual('percepciones', inf.compras.percepciones, await q(`SELECT COALESCE(SUM(percepciones),0) v FROM facturas_compra WHERE estado <> 'ANULADA' AND fecha_emision BETWEEN $1 AND $2`, p));
  igual('gastos neto total', inf.gastos.neto, await q(`SELECT COALESCE(SUM(neto),0) v FROM gastos WHERE estado = 'VIGENTE' AND fecha BETWEEN $1 AND $2`, p));
  igual('gastos IVA', inf.iva.credito_gastos, await q(`SELECT COALESCE(SUM(iva),0) v FROM gastos WHERE estado = 'VIGENTE' AND fecha BETWEEN $1 AND $2`, p));
  igual('gastos impuestos', inf.gastos.impuestos, await q(`SELECT COALESCE(SUM(g.neto),0) v FROM gastos g JOIN categorias_gasto c ON c.id=g.categoria_id WHERE g.estado='VIGENTE' AND c.es_impuesto AND g.fecha BETWEEN $1 AND $2`, p));
  igual('retenciones sufridas', inf.impuestos.retenciones_sufridas_total, await q(`SELECT COALESCE(SUM(pi.monto),0) v FROM pago_items pi JOIN pagos p ON p.id=pi.pago_id WHERE pi.tipo='RETENCION' AND pi.estado='ACREDITADO' AND NOT COALESCE(p.anulado,false) AND COALESCE(pi.fecha_acreditacion,p.fecha_recepcion) BETWEEN $1 AND $2`, p));

  // Identidades
  igual('IVA por alícuota + sin detalle = IVA crédito compras', r2(inf.iva.por_alicuota.reduce((s, a) => s + a.iva, 0) + inf.iva.credito_compras_sin_detalle), inf.iva.credito_compras);
  igual('saldo IVA = débito − crédito', inf.iva.saldo, r2(inf.iva.debito - inf.iva.credito_total));
  const b = inf.balance;
  igual('resultado = ventas − compras − gastos − impuestos − percepciones',
    b.resultado, r2(b.ventas_netas - b.compras_netas - b.gastos_netos - b.impuestos_pagados - b.percepciones_y_provinciales));
  igual('Σ meses ventas = total', r2(inf.mensual.reduce((s, m) => s + m.ventas, 0)), inf.ventas.neto);
  igual('Σ meses compras = total', r2(inf.mensual.reduce((s, m) => s + m.compras, 0)), inf.compras.neto);
  igual('Σ meses resultado = resultado', r2(inf.mensual.reduce((s, m) => s + m.resultado, 0)), b.resultado);
  igual('Σ meses saldo IVA = saldo IVA', r2(inf.mensual.reduce((s, m) => s + m.iva_saldo, 0)), inf.iva.saldo);
  igual('Σ categorías = gastos total', r2(inf.gastos.por_categoria.reduce((s, c) => s + c.total, 0)), inf.gastos.total);

  // ---- percibido
  const per = await resumen(pool, { desde, hasta, criterio: 'percibido' });
  igual('cobrado', per.flujo.cobrado, await q(`SELECT COALESCE(SUM(pi.monto),0) v FROM pago_items pi JOIN pagos p ON p.id=pi.pago_id WHERE pi.tipo<>'RETENCION' AND pi.estado='ACREDITADO' AND NOT COALESCE(p.anulado,false) AND COALESCE(pi.fecha_acreditacion,p.fecha_recepcion) BETWEEN $1 AND $2`, p));
  igual('saldo flujo = cobrado − pagado − gastos', per.flujo.saldo, r2(per.flujo.cobrado - per.flujo.pagado_proveedores - per.flujo.gastos));
  igual('Σ meses saldo = saldo', r2(per.mensual.reduce((s, m) => s + m.saldo, 0)), per.flujo.saldo);

  console.log(fallos ? `\n${fallos} comprobación(es) con diferencia.` : '\nTodo coincide.');
  await pool.end();
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

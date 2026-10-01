// Casos de prueba de la calculadora de transformadores (30/09/2026).
// Los valores esperados son los de los tres trafos reales de la especificación
// (100 mA por salida). Solo lectura, no toca la base: `node scripts/probar-calculadora-trafo.js`.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CT = require('../public/js/calc-trafo');
const { calcular } = CT;
const CSV = fs.readFileSync(path.join(__dirname, '../public/data/carreteles.csv'), 'utf8');

// Datos por defecto + la tabla de carreteles corregida.
function datosPorDefecto() {
  const d = CT.datosPorDefecto();
  d.carreteles = CT.importarCarreteles(CSV, d.params.pared);
  CT.completarLaminaciones(d.laminaciones, d.carreteles);
  return d;
}

let fallas = 0;
function cerca(nombre, real, esperado, tol) {
  const ok = Math.abs(real - esperado) <= tol;
  if (!ok) fallas++;
  console.log((ok ? 'ok    ' : 'FALLA ') + nombre + ': ' + real.toFixed(3) + ' (esperado ' + esperado + ' ±' + tol + ')');
}

// Trafo 1: 220 V, carretel 004080, una salida de 20 V en vacío.
let d = datosPorDefecto();
let r = calcular({ vin: 220, carretel: '004080', salidas: [{ v: 20, i: 0.1 }] }, d);
cerca('Np', r.Np, 4983, 1); // BA_ref de la especificación está redondeado (±1 espira)
assert.strictEqual(r.salidas[0].Ns, 453);
assert.strictEqual(r.devanados[0].hilo, '0.08');
assert.strictEqual(r.devanados[1].hilo, '0.28');
cerca('T1 flujo_rel', r.flujo_rel, 1.0, 0.005);
cerca('T1 Rp', r.Rp, 1191, 2);
cerca('T1 Rs', r.salidas[0].Rs, 11.3, 0.1);
cerca('T1 V0', r.salidas[0].V0, 20.0, 0.02);
cerca('T1 Vcarga', r.salidas[0].Vcarga, 17.88, 0.02);
cerca('T1 altura', r.camaras[0].altura, 5.76, 0.01);

// Trafo 2: 380 V, 004Z80 (separador 60/40), k_flujo 0.932 (flujo 93 %).
d = datosPorDefecto(); d.params.k_flujo = 0.932;
r = calcular({ vin: 380, carretel: '004Z80', salidas: [{ v: 13.5, i: 0.1 }] }, d);
cerca('Np', r.Np, 9233, 1); // BA_ref de la especificación está redondeado (±1 espira)
assert.strictEqual(r.salidas[0].Ns, 328);
assert.strictEqual(r.devanados[0].hilo, '0.06');
cerca('T2 Rp', r.Rp, 4975, 10);
cerca('T2 Rs', r.salidas[0].Rs, 7.5, 0.1);
cerca('T2 V0', r.salidas[0].V0, 13.5, 0.02);
cerca('T2 Vcarga', r.salidas[0].Vcarga, 12.12, 0.03);
cerca('T2 cámara 6.6', r.camaras[0].altura, 6.35, 0.01);
cerca('T2 cámara 9.9', r.camaras[1].altura, 5.10, 0.01);

// Trafo 3: 220 V, 012180, 14+14 V (2 secciones), primario 0.06 bifilar.
// El hilo del primario se fuerza a 2 hebras: con J_max = 3.0 la elección
// automática daría 3 hebras (J = 3.2 con 2), y el trafo real es bifilar.
d = datosPorDefecto();
r = calcular({
  vin: 220, carretel: '012180',
  primario_hilo: { alias: '0.06', hebras: 2 },
  salidas: [{ v: 14, i: 0.1, secciones: 2 }]
}, d);
cerca('Np', r.Np, 4000, 1); // BA_ref de la especificación está redondeado (±1 espira)
assert.strictEqual(r.salidas[0].Ns, 255);
cerca('T3 flujo_rel', r.flujo_rel, 1.0, 0.005);
cerca('T3 Rp', r.Rp, 1227, 3);
cerca('T3 Rs', r.salidas[0].Rs, 6.7, 0.1);
cerca('T3 V0', r.salidas[0].V0, 14.03, 0.02);
cerca('T3 Vcarga', r.salidas[0].Vcarga, 12.36, 0.03);
cerca('T3 cámara 8.0', r.camaras[0].altura, 5.62, 0.01);
cerca('T3 cámara 8.9', r.camaras[1].altura, 7.36, 0.01);

// --- Importación y estados de la tabla de carreteles ---
const cs = datosPorDefecto().carreteles;
const est = (c) => cs.find((x) => x.codigo === c).estado;
function igual(nombre, real, esperado) {
  const ok = real === esperado;
  if (!ok) fallas++;
  console.log((ok ? 'ok    ' : 'FALLA ') + nombre + ': ' + real + ' (esperado ' + esperado + ')');
}
igual('E141281 (sep con una cámara)', est('E141281'), 'excluido');
igual('128110 (separador < 0,5 mm)', est('128110'), 'revisar');
igual('143110 (EI 125, separador > 4 mm)', est('143110'), 'revisar');
igual('009080 (EI 75 con N=22,5)', est('009080'), 'revisar');
igual('128010 (EI 75 con N=25,6)', est('128010'), 'revisar');
igual('A156981 (dice pin, sin pines)', est('A156981'), 'revisar');
igual('332981 (descripción 53/47, real 50/50)', est('332981'), 'revisar');
igual('188181 (descripción 54/46, real 60/40)', est('188181'), 'revisar');
igual('004080', est('004080'), 'ok');
igual('004Z80', est('004Z80'), 'ok');
igual('012180', est('012180'), 'ok');
igual('carreteles sin ningún Y en 0', cs.filter((c) => c.Y1 === 0 || c.Y2 === 0).length, 0);
igual('separador 004Z80', cs.find((c) => c.codigo === '004Z80').separador, 0.8);

// Espiras por volt de los 3 trafos y escalado por pila (EI 37x20 = 4983 · 13/20).
d = datosPorDefecto();
cerca('004080 espiras/V', calcular({ vin: 220, carretel: '004080', salidas: [{ v: 20, i: 0.1 }] }, d).nv, 22.65, 0.01);
cerca('012180 espiras/V', calcular({ vin: 220, carretel: '012180', salidas: [{ v: 14, i: 0.1 }] }, d).nv, 18.18, 0.01);
cerca('015080 (EI 37x20) primario', calcular({ vin: 220, carretel: '015080', salidas: [{ v: 20, i: 0.1 }] }, d).Np, 3240, 2);
// Familia sin BA_ref: respaldo Se = N·A·0,92 con B de taller 1,55 T (EI 62x16: Se = 2,55 cm²).
const sinRef = calcular({ vin: 220, carretel: '127010', salidas: [{ v: 12, i: 0.1 }] }, d);
cerca('EI 62 sin BA_ref: espiras/V', sinRef.nv, 11.40, 0.02);
igual('EI 62 sin BA_ref: confianza', sinRef.confianza, 'baja');
cerca('EI 62 sin BA_ref: B real', sinRef.B_tesla, 1.55, 0.001);
igual('EI 37 con BA_ref: confianza', calcular({ vin: 220, carretel: '004080', salidas: [{ v: 20, i: 0.1 }] }, d).confianza, 'media');

// B real de los trafos del taller sobre el agujero del carretel (1,66 / 1,55 / 1,50 T).
cerca('T1 B real', calcular({ vin: 220, carretel: '004080', salidas: [{ v: 20, i: 0.1 }] }, d).B_tesla, 1.66, 0.02);
cerca('T3 B real', calcular({ vin: 220, carretel: '012180', salidas: [{ v: 14, i: 0.1 }] }, d).B_tesla, 1.50, 0.02);
d.params.k_flujo = 0.932;
cerca('T2 B real', calcular({ vin: 380, carretel: '004Z80', salidas: [{ v: 13.5, i: 0.1 }] }, d).B_tesla, 1.55, 0.02);


// --- Reingeniería (datos parciales) ---
d = datosPorDefecto();
const rein = (e) => CT.reingenieria(e, d);
let q = rein({ vp: 220, salidas: [{ v: 20, i: 0.1 }] });
igual('sin núcleo: insuficiente', q.confianza, 'insuficiente');
q = rein({ salidas: [{ v: 20, i: 0.1 }], carretel: '004080' });
igual('sin Vp: insuficiente', q.confianza, 'insuficiente');
q = rein({ vp: 220, carretel: '004080', salidas: [{ v: 20, i: 0.1 }] });
igual('solo carretel: confianza', q.confianza, 'media'); // EI 37 tiene BA_ref de trafo real
q = rein({ vp: 220, carretel: '127010', salidas: [{ v: 12, i: 0.1 }] });
igual('familia sin BA_ref: confianza', q.confianza, 'baja');
q = rein({ vp: 220, carretel: '004080', Np: 4983, salidas: [{ v: 20, i: 0.1 }] });
igual('Np medido: confianza', q.confianza, 'alta');
cerca('Np medido: N/V', q.nv, 22.65, 0.01);
igual('Np medido: Np usado', q.Np, 4983);
igual('Np medido: Ns', q.salidas[0].Ns, 453);
q = rein({ vp: 220, carretel: '004080', Ns: 453, salidas: [{ v: 20, i: 0.1, Ns: 453 }] });
cerca('Ns medido en vacío: N/V', q.nv, 22.65, 0.01);
q = rein({ vp: 220, carretel: '004080', condicion: 'carga', salidas: [{ v: 18.18, i: 0.1, Ns: 453 }] });
cerca('Ns medido con carga: N/V corregido', q.nv, 22.65, 0.15);
// Resistencias medidas a ~20 °C: Rp = 1190 Ω a 60 °C → ~1029 Ω a 20 °C no debe avisar.
q = rein({ vp: 220, carretel: '004080', Np: 4983, Rp: 1029, dp: { valor: 0.08, esmalte: false }, salidas: [{ v: 20, i: 0.1 }] });
igual('Rp coherente: sin avisos de resistencia', q.avisos.filter((x) => /Rp/.test(x.texto)).length, 0);
q = rein({ vp: 220, carretel: '004080', Np: 4983, Rp: 600, dp: { valor: 0.08, esmalte: false }, salidas: [{ v: 20, i: 0.1 }] });
igual('Rp incoherente: avisa', q.avisos.some((x) => /Rp/.test(x.texto)), true);
// 18 V / 300 mA en el 004080: no entra (rojo) y sugiere un carretel más grande que sí.
q = rein({ vp: 220, carretel: '004080', salidas: [{ v: 18, i: 0.3 }] });
igual('18 V / 300 mA en 004080: no entra', q.camaras.some((k) => k.semaforo === 'rojo'), true);
igual('18 V / 300 mA: hay sugerencias', q.sugerencias.length > 0, true);
igual('sugerencias sin carretel actual', q.sugerencias.every((x) => x.codigo !== '004080'), true);
q = rein({ vp: 220, N: 10, A: 13, I: 17.3, salidas: [{ v: 20, i: 0.1 }] });
igual('núcleo con medidas manuales calcula', q.Np > 0, true);
q = rein({ vp: 220, carretel: '004080', salidas: [{ v: 20 }] });
igual('sin corriente: lo marca', q.sin_corriente, true);

if (fallas) { console.error('\n' + fallas + ' comprobaciones fallaron.'); process.exit(1); }
console.log('\nTodo ok.');

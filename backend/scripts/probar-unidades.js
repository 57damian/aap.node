// Pruebas (solo lectura, sin base) de services/unidades.js
// Uso: cd backend && node scripts/probar-unidades.js
const assert = require('assert');
const { normalizarUnidad, factorAUnidadMaterial, sonIncompatibles } = require('../services/unidades');

const casos = [
  ['KG', 'GR', 1000],
  ['kg', 'gr', 1000],
  ['Kilos', 'GR', 1000],
  ['GR', 'KG', 0.001],
  ['gramos', 'kg', 0.001],
  ['GR', 'GR', 1],
  ['KG', 'KG', 1],
  ['UNI', 'UNI', 1],
  ['M', 'GR', 1],
  ['ROLLO', 'UNI', 1],
  ['', 'GR', 1],
  [null, 'GR', 1],
  ['KG', undefined, 1]
];
casos.forEach(([a, b, esperado]) => {
  assert.strictEqual(factorAUnidadMaterial(a, b), esperado, `factor(${a} -> ${b})`);
});

assert.strictEqual(normalizarUnidad(' kgs '), 'KG');
assert.strictEqual(normalizarUnidad('g'), 'GR');
assert.strictEqual(normalizarUnidad('uni'), 'UNI');

assert.strictEqual(sonIncompatibles('KG', 'GR'), false);  // se convierte
assert.strictEqual(sonIncompatibles('GR', 'GR'), false);
assert.strictEqual(sonIncompatibles('M', 'GR'), true);
assert.strictEqual(sonIncompatibles('ROLLO', 'UNI'), true);
assert.strictEqual(sonIncompatibles('', 'GR'), false);

// ---- Receta: cantidades por transformador -> unidad de stock del material ----
const { unidadesPermitidas, convertirAUnidadMaterial, redondear4 } = require('../services/unidades');

const alambre = { unidad_medida: 'GR' };
const cintaRollo = { unidad_medida: 'UNI', metros_por_rollo: 50 };
const cintaSinMetros = { unidad_medida: 'UNI', metros_por_rollo: null };
const tornillo = { unidad_medida: 'UNI' };
const cintaEnMetros = { unidad_medida: 'M' };

const conv = (n, u, mat) => convertirAUnidadMaterial(n, u, mat);
assert.deepStrictEqual(conv(22, 'GR', alambre), { ok: true, cantidad: 22 });
assert.strictEqual(conv(0.5, 'KG', alambre).cantidad, 500);
assert.strictEqual(conv(4, 'UNI', tornillo).cantidad, 4);
assert.strictEqual(conv(30, 'CM', cintaEnMetros).cantidad, 0.3);
// 30 cm de una cinta de 50 m = 0,006 rollos
assert.strictEqual(redondear4(conv(30, 'CM', cintaRollo).cantidad), 0.006);
// el redondeo se hace sobre el total del lote, no por unidad: 100 trafos × 30 cm = 0,6 rollos
assert.strictEqual(redondear4(conv(30 * 100, 'CM', cintaRollo).cantidad), 0.6);
assert.strictEqual(redondear4(conv(1, 'M', cintaRollo).cantidad), 0.02);
assert.strictEqual(conv(30, 'CM', cintaSinMetros).ok, false);   // falta metros por rollo
assert.strictEqual(conv(30, 'CM', alambre).ok, false);          // longitud -> peso
assert.strictEqual(conv(5, 'GR', tornillo).ok, false);          // peso -> unidades
assert.strictEqual(conv('x', 'GR', alambre).ok, false);
assert.strictEqual(conv(1, '', alambre).ok, false);

assert.deepStrictEqual(unidadesPermitidas(alambre), ['GR', 'KG']);
// "Rollos" es una unidad del desplegable de materiales: se comporta igual que UNI
const cintaEnRollos = { unidad_medida: 'ROLLO', metros_por_rollo: 50 };
assert.strictEqual(redondear4(conv(30, 'CM', cintaEnRollos).cantidad), 0.006);
assert.deepStrictEqual(unidadesPermitidas(cintaEnRollos), ['ROLLO', 'CM', 'M']);
assert.deepStrictEqual(unidadesPermitidas({ unidad_medida: 'ROLLO' }), ['ROLLO']);
assert.deepStrictEqual(conv(2, 'ROLLO', cintaEnRollos), { ok: true, cantidad: 2 });

assert.deepStrictEqual(unidadesPermitidas(cintaRollo), ['UNI', 'CM', 'M']);
assert.deepStrictEqual(unidadesPermitidas(cintaSinMetros), ['UNI']);
assert.deepStrictEqual(unidadesPermitidas(cintaEnMetros), ['CM', 'M']);
assert.deepStrictEqual(unidadesPermitidas({ unidad_medida: 'LT' }), ['LT']);

assert.strictEqual(normalizarUnidad('cms'), 'CM');
assert.strictEqual(normalizarUnidad('mts'), 'M');
assert.strictEqual(redondear4(0.1 + 0.2), 0.3);

console.log(`OK: ${casos.length} conversiones y las pruebas de normalización/compatibilidad y de receta.`);

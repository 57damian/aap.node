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

console.log(`OK: ${casos.length} conversiones y las pruebas de normalización/compatibilidad.`);

// backend/scripts/convertir-pesos-kg-a-gramos.js
//
// Por qué: el alambre de cobre se pide y se registra en gramos (ver
// "Pedidos a proveedores" en el CLAUDE.md — un rollo de 500gr, no 0.5kg),
// pero en esta base los dos materiales de alambre quedaron cargados en KG
// desde el principio. Este script los pasa a GR y recalcula todo lo que
// depende de esa unidad para que quede consistente: stock, precio de
// referencia, movimientos de stock, ítems de facturas de compra e
// historial de precios. También pasa a gramos los pesos de ficha técnica
// (peso_primario_kg, peso_secundario_kg, peso_laminacion_kg y
// ficha_devanados_extra.peso_kg), que seguían la misma convención en kg.
//
// Solo toca materias_primas con unidad_medida = 'KG' — por eso es
// idempotente para esa parte (correrlo de nuevo no hace nada, porque ya
// quedaron en 'GR'). La conversión de los pesos de ficha NO es idempotente
// (multiplica por 1000 cada vez): es un script de una sola vez, no lo
// corras dos veces.
//
// Requiere backend/scripts/migracion-ficha-pesos-gramos.sql ya aplicada
// (si no, las columnas de peso de ficha no entran valores en gramos:
// numeric(6,3) se queda corto y Postgres tira overflow).
//
// Uso:
//   cd backend
//   node scripts/convertir-pesos-kg-a-gramos.js
// Contra Neon (PowerShell): $env:DATABASE_URL="<url de Neon>"; node scripts/convertir-pesos-kg-a-gramos.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');

const FACTOR = 1000; // 1 kg = 1000 gr

async function main() {
  const host = new URL(process.env.DATABASE_URL).host;
  console.log('Base de datos:', host);

  const client = await pool.connect();
  try {
    const materias = (await client.query(
      `SELECT id, codigo, nombre, unidad_medida, stock_actual, stock_minimo, precio_referencia
         FROM materias_primas WHERE unidad_medida = 'KG'`
    )).rows;

    if (materias.length === 0) {
      console.log('No hay materias primas en KG: nada que convertir ahí (puede que ya se haya corrido antes).');
    }

    const materiaIds = materias.map((m) => m.id);

    // --------- Backup antes de tocar nada ---------
    const backup = { materias_primas: materias };
    if (materiaIds.length > 0) {
      backup.stock_movimientos = (await client.query(
        `SELECT * FROM stock_movimientos WHERE materia_prima_id = ANY($1) AND unidad = 'KG'`,
        [materiaIds]
      )).rows;
      backup.factura_items = (await client.query(
        `SELECT * FROM factura_items WHERE materia_prima_id = ANY($1) AND unidad_medida = 'KG'`,
        [materiaIds]
      )).rows;
      backup.historial_precios_materias = (await client.query(
        `SELECT * FROM historial_precios_materias WHERE materia_prima_id = ANY($1)`,
        [materiaIds]
      )).rows;
    }
    backup.ficha_transformador = (await client.query(
      `SELECT id, modelo, peso_primario_kg, peso_secundario_kg, peso_laminacion_kg FROM ficha_transformador`
    )).rows;
    const tieneDevanadosExtra = (await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ficha_devanados_extra')`
    )).rows[0].exists;
    if (tieneDevanadosExtra) {
      backup.ficha_devanados_extra = (await client.query(
        `SELECT id, ficha_id, orden, peso_kg FROM ficha_devanados_extra`
      )).rows;
    }

    const backupDir = path.join(__dirname, '..', '..', 'docs', '_backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `datos-antes-de-convertir-pesos-a-gramos-${new Date().toISOString().slice(0, 10)}.json`
    );
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log('Backup guardado en', backupPath);

    await client.query('BEGIN');

    // --------- Materias primas en KG -> GR ---------
    if (materiaIds.length > 0) {
      const mp = await client.query(
        `UPDATE materias_primas
            SET unidad_medida = 'GR',
                stock_actual = stock_actual * $1,
                stock_minimo = stock_minimo * $1,
                precio_referencia = precio_referencia / $1
          WHERE unidad_medida = 'KG'
          RETURNING id, codigo, nombre, stock_actual, precio_referencia`,
        [FACTOR]
      );
      console.log(`materias_primas convertidas (${mp.rows.length}):`, mp.rows);

      const sm = await client.query(
        `UPDATE stock_movimientos
            SET cantidad = cantidad * $2,
                stock_anterior = stock_anterior * $2,
                stock_nuevo = stock_nuevo * $2,
                precio_unitario = precio_unitario / $2,
                unidad = 'GR'
          WHERE materia_prima_id = ANY($1) AND unidad = 'KG'`,
        [materiaIds, FACTOR]
      );
      console.log('stock_movimientos convertidos:', sm.rowCount);

      // subtotal/iva/total NO se tocan: son cantidad * precio_unitario, y al
      // escalar cantidad x1000 y precio_unitario /1000 el producto no cambia.
      const fi = await client.query(
        `UPDATE factura_items
            SET cantidad = cantidad * $2,
                precio_unitario = precio_unitario / $2,
                unidad_medida = 'GR'
          WHERE materia_prima_id = ANY($1) AND unidad_medida = 'KG'`,
        [materiaIds, FACTOR]
      );
      console.log('factura_items convertidos:', fi.rowCount);

      const hp = await client.query(
        `UPDATE historial_precios_materias
            SET precio_anterior = CASE WHEN precio_anterior IS NULL THEN NULL ELSE precio_anterior / $2 END,
                precio_nuevo = precio_nuevo / $2,
                precio_anterior_usd = CASE WHEN precio_anterior_usd IS NULL THEN NULL ELSE precio_anterior_usd / $2 END,
                precio_nuevo_usd = CASE WHEN precio_nuevo_usd IS NULL THEN NULL ELSE precio_nuevo_usd / $2 END
          WHERE materia_prima_id = ANY($1)`,
        [materiaIds, FACTOR]
      );
      console.log('historial_precios_materias convertidos:', hp.rowCount);
    }

    // --------- Ficha técnica: pesos kg -> gr ---------
    const ficha = await client.query(
      `UPDATE ficha_transformador
          SET peso_primario_kg = CASE WHEN peso_primario_kg IS NULL THEN NULL ELSE peso_primario_kg * $1 END,
              peso_secundario_kg = CASE WHEN peso_secundario_kg IS NULL THEN NULL ELSE peso_secundario_kg * $1 END,
              peso_laminacion_kg = CASE WHEN peso_laminacion_kg IS NULL THEN NULL ELSE peso_laminacion_kg * $1 END`,
      [FACTOR]
    );
    console.log('ficha_transformador (filas tocadas):', ficha.rowCount);

    if (tieneDevanadosExtra) {
      const dev = await client.query(
        `UPDATE ficha_devanados_extra
            SET peso_kg = CASE WHEN peso_kg IS NULL THEN NULL ELSE peso_kg * $1 END`,
        [FACTOR]
      );
      console.log('ficha_devanados_extra (filas tocadas):', dev.rowCount);
    } else {
      console.log('ficha_devanados_extra no existe en esta base: nada que convertir ahí.');
    }

    await client.query('COMMIT');
    console.log('Listo.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR, se hizo ROLLBACK:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

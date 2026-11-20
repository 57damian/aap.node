// ============================================================================
// Receta de un modelo de transformador y descuento de materia prima.
//
// La receta tiene dos partes (decididas el 06/10/2026):
//   - El alambre de cada devanado: el devanado elige un material del catálogo
//     (ficha_transformador.material_primario_id / material_secundario_id /
//     ficha_devanados_extra.material_id) y el consumo sale del peso en gramos
//     que ya se anota en el devanado.
//   - El resto (carretel, estaño, barniz, cinta, tornillos, bridas, borneras…):
//     renglones de ficha_receta_items, con la cantidad POR transformador y la
//     unidad en que se anotó (cm de cinta, unidades de tornillos…).
//
// Solo se descuenta lo que está anotado: no hay cálculo automático. Un modelo
// sin receta produce igual y no descuenta nada.
//
// Al producir se descuenta cantidad × receta, todo en la unidad de stock de
// cada material y con el redondeo hecho UNA vez sobre el total del lote (no por
// unidad: 0,006 rollos por transformador × 100 = 0,6, no 100 × 0,01).
// ============================================================================

const { convertirAUnidadMaterial, redondear4, normalizarUnidad } = require('./unidades');

/** Nombres de los devanados adicionales (orden 3 en adelante). */
const NOMBRE_DEVANADO = ['terciario', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo'];

const MATERIAL_COLS = `mp.nombre AS material_nombre, mp.unidad_medida AS material_unidad, mp.metros_por_rollo`;

/**
 * Lee la receta guardada de una ficha:
 *   devanados: [{ clave, nombre, alambre, peso_gr, material_id, material_nombre, material_unidad }]
 *   items:     [{ id, materia_prima_id, cantidad, unidad, observaciones, orden, material_nombre,
 *                 material_unidad, metros_por_rollo }]
 * Devuelve null si la ficha no existe.
 */
async function leerReceta(client, fichaId) {
  const f = await client.query(`
    SELECT ft.id, ft.modelo,
           ft.alambre_primario, ft.peso_primario_kg AS peso_primario, ft.material_primario_id,
           ft.alambre_secundario, ft.peso_secundario_kg AS peso_secundario, ft.material_secundario_id,
           mp1.nombre AS material_primario_nombre, mp1.unidad_medida AS material_primario_unidad,
           mp2.nombre AS material_secundario_nombre, mp2.unidad_medida AS material_secundario_unidad
      FROM ficha_transformador ft
      LEFT JOIN materias_primas mp1 ON mp1.id = ft.material_primario_id
      LEFT JOIN materias_primas mp2 ON mp2.id = ft.material_secundario_id
     WHERE ft.id = $1`, [fichaId]);
  if (!f.rows.length) return null;
  const ficha = f.rows[0];

  const devanados = [
    {
      clave: 'primario', nombre: 'Primario', alambre: ficha.alambre_primario,
      peso_gr: ficha.peso_primario === null ? null : Number(ficha.peso_primario),
      material_id: ficha.material_primario_id, material_nombre: ficha.material_primario_nombre,
      material_unidad: ficha.material_primario_unidad
    },
    {
      clave: 'secundario', nombre: 'Secundario', alambre: ficha.alambre_secundario,
      peso_gr: ficha.peso_secundario === null ? null : Number(ficha.peso_secundario),
      material_id: ficha.material_secundario_id, material_nombre: ficha.material_secundario_nombre,
      material_unidad: ficha.material_secundario_unidad
    }
  ];

  const extras = await client.query(`
    SELECT e.orden, e.alambre, e.peso_kg AS peso, e.material_id, ${MATERIAL_COLS}
      FROM ficha_devanados_extra e
      LEFT JOIN materias_primas mp ON mp.id = e.material_id
     WHERE e.ficha_id = $1 ORDER BY e.orden`, [fichaId]);
  extras.rows.forEach((e, i) => {
    devanados.push({
      clave: `extra${e.orden}`, nombre: NOMBRE_DEVANADO[i] ? NOMBRE_DEVANADO[i][0].toUpperCase() + NOMBRE_DEVANADO[i].slice(1) : `${e.orden}°`,
      alambre: e.alambre, peso_gr: e.peso === null ? null : Number(e.peso),
      material_id: e.material_id, material_nombre: e.material_nombre, material_unidad: e.material_unidad
    });
  });

  const items = await client.query(`
    SELECT r.id, r.materia_prima_id, r.cantidad, r.unidad, r.observaciones, r.orden, ${MATERIAL_COLS}
      FROM ficha_receta_items r
      JOIN materias_primas mp ON mp.id = r.materia_prima_id
     WHERE r.ficha_id = $1 ORDER BY r.orden, r.id`, [fichaId]);

  return {
    ficha: { id: ficha.id, modelo: ficha.modelo },
    devanados,
    items: items.rows.map(i => ({ ...i, cantidad: Number(i.cantidad), metros_por_rollo: i.metros_por_rollo === null ? null : Number(i.metros_por_rollo) }))
  };
}

/**
 * Qué material hay que descontar para fabricar `unidades` transformadores del
 * modelo, contra el stock actual. Con `bloquear`, las materias primas se leen
 * con FOR UPDATE (en orden de id, para que dos cargas simultáneas no se
 * bloqueen entre sí).
 *
 * Devuelve:
 *   tiene_receta  true si hay al menos una línea para descontar
 *   lineas        [{ materia_prima_id, nombre, unidad, por_unidad, necesaria, stock_actual,
 *                    faltante, origenes: ['Primario', 'Cinta…'] }]
 *   faltantes     las líneas con faltante > 0
 *   errores       problemas que impiden calcular (unidades incompatibles): hay que corregir la receta
 *   avisos        cosas a tener en cuenta (un devanado con peso pero sin material elegido)
 */
async function calcularNecesidad(client, fichaId, unidades, { bloquear = false } = {}) {
  const receta = await leerReceta(client, fichaId);
  if (!receta) return null;

  const errores = [];
  const avisos = [];
  const acumulado = new Map(); // materia_prima_id -> { por_unidad, origenes, ... }

  // Datos de todos los materiales involucrados, de una vez.
  const ids = new Set();
  receta.devanados.forEach(d => { if (d.material_id && d.peso_gr > 0) ids.add(d.material_id); });
  receta.items.forEach(i => ids.add(i.materia_prima_id));
  const idsOrdenados = [...ids].sort((a, b) => a - b);

  const materiales = new Map();
  if (idsOrdenados.length) {
    const r = await client.query(`
      SELECT id, nombre, unidad_medida, metros_por_rollo, stock_actual
        FROM materias_primas WHERE id = ANY($1::int[]) ORDER BY id
        ${bloquear ? 'FOR UPDATE' : ''}`, [idsOrdenados]);
    r.rows.forEach(m => materiales.set(m.id, {
      ...m, stock_actual: Number(m.stock_actual),
      metros_por_rollo: m.metros_por_rollo === null ? null : Number(m.metros_por_rollo)
    }));
  }

  function sumar(materialId, cantidad, unidad, origen) {
    const mat = materiales.get(materialId);
    if (!mat) { errores.push(`${origen}: el material ya no existe`); return; }
    const c = convertirAUnidadMaterial(cantidad, unidad, mat);
    if (!c.ok) { errores.push(`${origen} (${mat.nombre}): ${c.error}`); return; }
    const a = acumulado.get(materialId) || { materia_prima_id: materialId, nombre: mat.nombre, unidad: mat.unidad_medida, por_unidad: 0, origenes: [] };
    a.por_unidad += c.cantidad;
    a.origenes.push(origen);
    acumulado.set(materialId, a);
  }

  for (const d of receta.devanados) {
    if (!(d.peso_gr > 0)) continue;
    if (!d.material_id) {
      avisos.push(`El devanado ${d.nombre.toLowerCase()} tiene peso cargado pero no tiene material de alambre elegido: no se descuenta.`);
      continue;
    }
    sumar(d.material_id, d.peso_gr, 'GR', `Devanado ${d.nombre.toLowerCase()}`);
  }
  for (const i of receta.items) {
    sumar(i.materia_prima_id, i.cantidad, i.unidad, `Receta`);
  }

  const lineas = [...acumulado.values()]
    .sort((a, b) => a.materia_prima_id - b.materia_prima_id)
    .map(a => {
      const mat = materiales.get(a.materia_prima_id);
      const necesaria = redondear4(a.por_unidad * unidades);
      const faltante = redondear4(Math.max(0, necesaria - mat.stock_actual));
      return {
        materia_prima_id: a.materia_prima_id, nombre: a.nombre, unidad: a.unidad,
        por_unidad: redondear4(a.por_unidad), necesaria, stock_actual: mat.stock_actual, faltante,
        origenes: [...new Set(a.origenes)]
      };
    });

  return {
    ficha: receta.ficha,
    tiene_receta: lineas.length > 0,
    lineas,
    faltantes: lineas.filter(l => l.faltante > 0),
    errores,
    avisos
  };
}

/* ---------------------------------------------------------------------------
 * Materiales para un PEDIDO (varios modelos juntos) — 20/11/2026.
 *
 * Es solo una consulta para planificar compras: no descuenta nada. Suma lo que
 * pide la receta de cada modelo × su cantidad, material por material, y lo
 * compara con el stock. No falla si a un modelo le faltan datos: calcula lo que
 * se puede y dice, modelo por modelo, qué falta cargar para que el número sea
 * completo.
 *
 * Además de lo vinculado al catálogo (devanados con material + renglones de la
 * receta) informa aparte lo que la ficha tiene anotado pero NO está vinculado
 * (alambre con peso y sin material elegido, laminación, tipo de carretel):
 * se ve cuánto hace falta aunque todavía no se pueda comparar con el stock.
 * ------------------------------------------------------------------------- */

/** Unidades que se compran enteras: se redondea para arriba lo que falta. */
const UNIDADES_ENTERAS = new Set(['UNI', 'ROLLO', 'PAR', 'JUEGO', 'BOLSA', 'CAJA']);

const MAX_MODELOS_PEDIDO = 60;

async function calcularNecesidadPedido(client, pedido) {
  if (!Array.isArray(pedido) || !pedido.length) throw fallo(400, 'Agregá al menos un modelo con su cantidad');

  // Un modelo repetido se suma.
  const porFicha = new Map();
  pedido.forEach((p, i) => {
    const fichaId = Number(p && p.ficha_id);
    const cantidad = Number(p && p.cantidad);
    if (!Number.isInteger(fichaId) || fichaId <= 0) throw fallo(400, `Renglón ${i + 1}: elegí el modelo`);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1000000) {
      throw fallo(400, `Renglón ${i + 1}: la cantidad tiene que ser un número entero mayor a cero`);
    }
    porFicha.set(fichaId, (porFicha.get(fichaId) || 0) + cantidad);
  });
  if (porFicha.size > MAX_MODELOS_PEDIDO) throw fallo(400, `El pedido admite hasta ${MAX_MODELOS_PEDIDO} modelos distintos`);

  const fichaIds = [...porFicha.keys()];

  // Fichas (no eliminadas) con lo que anotan aparte de la receta.
  const fichas = await client.query(`
    SELECT id, modelo, tipo_carretel, laminacion, peso_laminacion_kg AS peso_laminacion
      FROM ficha_transformador WHERE id = ANY($1::int[]) AND deleted_at IS NULL`, [fichaIds]);
  const fichaPorId = new Map(fichas.rows.map(f => [f.id, f]));
  for (const id of fichaIds) {
    if (!fichaPorId.has(id)) throw fallo(404, 'Uno de los modelos no existe o fue eliminado');
  }

  // Etiquetas cargadas (PDF) de cada modelo: se informa cuántas imprimir.
  const et = await client.query(`
    SELECT ficha_id, id, nombre_original FROM ficha_archivos
     WHERE tipo = 'ETIQUETA' AND ficha_id = ANY($1::int[]) ORDER BY ficha_id, id`, [fichaIds]);
  const etiquetasPorFicha = new Map();
  et.rows.forEach(e => {
    if (!etiquetasPorFicha.has(e.ficha_id)) etiquetasPorFicha.set(e.ficha_id, []);
    etiquetasPorFicha.get(e.ficha_id).push({ id: e.id, nombre: e.nombre_original });
  });

  const modelos = [];
  const acumulado = new Map();   // materia_prima_id -> línea del pedido
  const sinVincular = new Map(); // concepto -> { concepto, cantidad, unidad, modelos: [] }
  const etiquetas = [];

  function sumarSinVincular(concepto, cantidad, unidad, modelo) {
    const k = `${concepto}|${unidad}`;
    const s = sinVincular.get(k) || { concepto, cantidad: 0, unidad, modelos: [] };
    s.cantidad += cantidad;
    s.modelos.push(modelo);
    sinVincular.set(k, s);
  }

  for (const fichaId of fichaIds) {
    const unidades = porFicha.get(fichaId);
    const ficha = fichaPorId.get(fichaId);
    const receta = await leerReceta(client, fichaId);
    const n = await calcularNecesidad(client, fichaId, unidades);
    const faltanDatos = [];

    // Alambre de cada devanado.
    for (const d of receta.devanados) {
      const nombre = d.nombre.toLowerCase();
      const tieneAlambre = String(d.alambre || '').trim() !== '';
      if (d.peso_gr > 0 && d.material_id) continue; // ya está en las líneas
      if (d.peso_gr > 0 && !d.material_id) {
        faltanDatos.push(`Devanado ${nombre}: tiene el peso pero no el material de alambre elegido (no se puede comparar con el stock).`);
        sumarSinVincular(`Alambre ${nombre}${tieneAlambre ? ` (${d.alambre})` : ''}`, d.peso_gr * unidades, 'GR', ficha.modelo);
      } else if (tieneAlambre) {
        faltanDatos.push(`Devanado ${nombre} (${d.alambre}): no tiene el peso cargado, no se puede calcular el alambre.`);
      }
    }

    // Laminación: la ficha anota el peso, pero no está vinculada al catálogo.
    const pesoLam = ficha.peso_laminacion === null ? null : Number(ficha.peso_laminacion);
    if (pesoLam > 0) {
      sumarSinVincular(`Laminación${ficha.laminacion ? ` ${ficha.laminacion}` : ''}`, pesoLam * unidades, 'GR', ficha.modelo);
    } else if (String(ficha.laminacion || '').trim()) {
      faltanDatos.push(`Laminación ${ficha.laminacion}: no tiene el peso cargado.`);
    }

    if (!n.tiene_receta) faltanDatos.push('No tiene receta ni alambre vinculado: no suma materiales.');

    // Carretel: si la ficha dice el tipo pero la receta no tiene ningún carretel cargado, se informa aparte.
    const tipoCarretel = String(ficha.tipo_carretel || '').trim();
    const idsReceta = receta.items.map(i => i.materia_prima_id);
    let recetaTieneCarretel = false;
    if (idsReceta.length) {
      const c = await client.query(`
        SELECT 1 FROM materias_primas mp
          JOIN categorias_materia_prima c ON c.id = mp.categoria_id
         WHERE mp.id = ANY($1::int[]) AND c.nombre ILIKE 'carretel%' LIMIT 1`, [idsReceta]);
      recetaTieneCarretel = c.rows.length > 0;
    }
    if (tipoCarretel && !recetaTieneCarretel) {
      sumarSinVincular(`Carretel ${tipoCarretel}`, unidades, 'UNI', ficha.modelo);
      faltanDatos.push(`Carretel ${tipoCarretel}: está en la ficha pero no en la receta (se cuenta 1 por transformador).`);
    }

    const etiquetasModelo = etiquetasPorFicha.get(fichaId) || [];
    if (etiquetasModelo.length) etiquetas.push({ ficha_id: fichaId, modelo: ficha.modelo, cantidad: unidades, archivos: etiquetasModelo });

    modelos.push({
      ficha_id: fichaId, modelo: ficha.modelo, cantidad: unidades,
      tiene_receta: n.tiene_receta, lleva_etiqueta: etiquetasModelo.length > 0,
      etiquetas: etiquetasModelo.length, faltan_datos: faltanDatos, errores: n.errores
    });

    // Se acumulan las líneas de este modelo en el total del pedido.
    for (const l of n.lineas) {
      const a = acumulado.get(l.materia_prima_id) || {
        materia_prima_id: l.materia_prima_id, nombre: l.nombre, unidad: l.unidad,
        necesaria: 0, stock_actual: l.stock_actual, por_modelo: []
      };
      a.necesaria += l.necesaria;
      a.por_modelo.push({ modelo: ficha.modelo, cantidad: unidades, por_unidad: l.por_unidad, necesaria: l.necesaria, origenes: l.origenes });
      acumulado.set(l.materia_prima_id, a);
    }
  }

  // Datos de catálogo de los materiales: categoría y metros por rollo.
  const idsMat = [...acumulado.keys()];
  const cat = new Map();
  if (idsMat.length) {
    const r = await client.query(`
      SELECT mp.id, c.nombre AS categoria, mp.metros_por_rollo
        FROM materias_primas mp LEFT JOIN categorias_materia_prima c ON c.id = mp.categoria_id
       WHERE mp.id = ANY($1::int[])`, [idsMat]);
    r.rows.forEach(m => cat.set(m.id, m));
  }

  const materiales = [...acumulado.values()].map(a => {
    const necesaria = redondear4(a.necesaria);
    const faltante = redondear4(Math.max(0, necesaria - a.stock_actual));
    const entera = UNIDADES_ENTERAS.has(normalizarUnidad(a.unidad));
    const c = cat.get(a.materia_prima_id) || {};
    return {
      materia_prima_id: a.materia_prima_id, nombre: a.nombre, unidad: a.unidad,
      categoria: c.categoria || null,
      necesaria, stock_actual: a.stock_actual, faltante,
      // Lo que conviene comprar: unidades enteras hacia arriba (no se compra 0,6 de un rollo).
      a_comprar: entera ? Math.ceil(faltante - 1e-9) : faltante,
      por_modelo: a.por_modelo
    };
  }).sort((x, y) => (x.categoria || '~').localeCompare(y.categoria || '~', 'es') || x.nombre.localeCompare(y.nombre, 'es'));

  return {
    unidades_total: [...porFicha.values()].reduce((s, n) => s + n, 0),
    modelos,
    materiales,
    faltantes: materiales.filter(m => m.faltante > 0).length,
    sin_vincular: [...sinVincular.values()].map(s => ({ ...s, cantidad: redondear4(s.cantidad), modelos: [...new Set(s.modelos)] })),
    etiquetas
  };
}

/**
 * Descuenta del stock lo calculado por calcularNecesidad(…, { bloquear: true }),
 * dentro de la transacción de quien llama. Nunca deja el stock negativo: si no
 * alcanza, descuenta lo que haya y anota el faltante. Devuelve las filas de
 * produccion_consumos creadas.
 */
async function aplicarConsumo(client, { produccionId, lineas, observaciones, usuarioId }) {
  const consumos = [];
  for (const l of lineas) {
    if (!(l.necesaria > 0)) continue;
    const descontar = redondear4(Math.min(l.necesaria, l.stock_actual));
    const stockNuevo = redondear4(l.stock_actual - descontar);

    let movimientoId = null;
    if (descontar > 0) {
      await client.query('UPDATE materias_primas SET stock_actual = $1 WHERE id = $2', [stockNuevo, l.materia_prima_id]);
      // SALIDA con cantidad negativa: el signo lo da la cantidad (igual que POST /api/stock/ajuste).
      const m = await client.query(`
        INSERT INTO stock_movimientos
          (materia_prima_id, fecha_movimiento, tipo_movimiento, cantidad, unidad,
           stock_anterior, stock_nuevo, observaciones, usuario_id, produccion_id)
        VALUES ($1, CURRENT_DATE, 'SALIDA', $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [l.materia_prima_id, -descontar, l.unidad, l.stock_actual, stockNuevo, observaciones, usuarioId || null, produccionId]);
      movimientoId = m.rows[0].id;
    }

    const c = await client.query(`
      INSERT INTO produccion_consumos
        (produccion_id, materia_prima_id, cantidad_necesaria, cantidad_descontada, faltante, unidad, stock_movimiento_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [produccionId, l.materia_prima_id, l.necesaria, descontar, redondear4(l.necesaria - descontar), l.unidad, movimientoId]);
    const fila = c.rows[0];
    consumos.push({
      ...fila, nombre: l.nombre,
      cantidad_necesaria: Number(fila.cantidad_necesaria),
      cantidad_descontada: Number(fila.cantidad_descontada),
      faltante: Number(fila.faltante)
    });
  }
  return consumos;
}

/** Lo que se descontó en una carga de producción (para mostrarlo o devolverlo). */
async function leerConsumos(client, produccionId, { bloquear = false } = {}) {
  const r = await client.query(`
    SELECT pc.*, mp.nombre, mp.stock_actual
      FROM produccion_consumos pc
      JOIN materias_primas mp ON mp.id = pc.materia_prima_id
     WHERE pc.produccion_id = $1
     ORDER BY pc.materia_prima_id
     ${bloquear ? 'FOR UPDATE OF mp' : ''}`, [produccionId]);
  return r.rows.map(c => ({
    ...c,
    cantidad_necesaria: Number(c.cantidad_necesaria),
    cantidad_descontada: Number(c.cantidad_descontada),
    faltante: Number(c.faltante),
    stock_actual: Number(c.stock_actual)
  }));
}

/**
 * Devuelve al stock lo que descontó una carga de producción (al anularla).
 * Deja un movimiento ENTRADA por cada material. Dentro de la transacción de
 * quien llama.
 */
async function devolverConsumo(client, produccionId, { observaciones, usuarioId }) {
  const consumos = await leerConsumos(client, produccionId, { bloquear: true });
  const devueltos = [];
  for (const c of consumos) {
    if (!(c.cantidad_descontada > 0)) continue;
    const stockNuevo = redondear4(c.stock_actual + c.cantidad_descontada);
    await client.query('UPDATE materias_primas SET stock_actual = $1 WHERE id = $2', [stockNuevo, c.materia_prima_id]);
    await client.query(`
      INSERT INTO stock_movimientos
        (materia_prima_id, fecha_movimiento, tipo_movimiento, cantidad, unidad,
         stock_anterior, stock_nuevo, observaciones, usuario_id)
      VALUES ($1, CURRENT_DATE, 'ENTRADA', $2, $3, $4, $5, $6, $7)`,
      [c.materia_prima_id, c.cantidad_descontada, c.unidad, c.stock_actual, stockNuevo, observaciones, usuarioId || null]);
    devueltos.push({ materia_prima_id: c.materia_prima_id, nombre: c.nombre, unidad: c.unidad, cantidad: c.cantidad_descontada });
  }
  return { consumos, devueltos };
}

/* ---------------------------------------------------------------------------
 * Alta/edición de los renglones de receta (ficha_receta_items).
 *
 * Los usa PUT /api/ficha-transformador/:id/receta (solapa Receta) y también el
 * alta y la edición de la ficha (el formulario manda `receta_items` junto con
 * el resto de la ficha, en la misma transacción).
 * ------------------------------------------------------------------------- */
const MAX_ITEMS = 40;
const MAX_CANTIDAD = 99999999;
const SIN_ROTURA = /[<>"\\`]/;

function fallo(status, mensaje) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

/**
 * Valida los renglones que manda el formulario y devuelve la lista limpia.
 * `raw` puede ser un array o un JSON en texto (así llega en un multipart).
 */
async function normalizarItems(client, raw) {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw || '[]'); }
    catch (_) { throw fallo(400, 'La receta no tiene un formato válido'); }
  }
  if (!Array.isArray(raw)) throw fallo(400, 'La receta no tiene un formato válido');
  if (raw.length > MAX_ITEMS) throw fallo(400, `La receta admite hasta ${MAX_ITEMS} renglones`);

  const items = raw.map((it, i) => {
    const cual = `Renglón ${i + 1}`;
    const materialId = Number(it && it.materia_prima_id);
    if (!Number.isInteger(materialId) || materialId <= 0) throw fallo(400, `${cual}: elegí el material`);

    const cantidad = Number(String(it.cantidad ?? '').replace(',', '.'));
    if (!isFinite(cantidad) || cantidad <= 0 || cantidad > MAX_CANTIDAD) {
      throw fallo(400, `${cual}: la cantidad tiene que ser un número mayor a cero`);
    }

    // Que la unidad sea compatible con el material se comprueba más abajo
    // (convertirAUnidadMaterial); acá solo que tenga forma de unidad.
    const unidad = normalizarUnidad(it.unidad);
    if (!/^[A-Z0-9]{1,10}$/.test(unidad)) throw fallo(400, `${cual}: elegí la unidad`);

    let observaciones = String(it.observaciones ?? '').trim();
    if (SIN_ROTURA.test(observaciones)) throw fallo(400, `${cual}: la nota tiene caracteres no permitidos (< > " \\ \`)`);
    if (observaciones.length > 200) throw fallo(400, `${cual}: la nota es demasiado larga (máximo 200 caracteres)`);
    observaciones = observaciones || null;

    return { materia_prima_id: materialId, cantidad, unidad, observaciones, orden: i };
  });

  if (!items.length) return items;

  const ids = [...new Set(items.map(i => i.materia_prima_id))];
  const r = await client.query(
    'SELECT id, nombre, unidad_medida, metros_por_rollo, activo FROM materias_primas WHERE id = ANY($1::int[])', [ids]);
  const porId = new Map(r.rows.map(m => [m.id, m]));

  items.forEach((it, i) => {
    const mat = porId.get(it.materia_prima_id);
    if (!mat || mat.activo === false) throw fallo(400, `Renglón ${i + 1}: el material no existe o está dado de baja`);
    const c = convertirAUnidadMaterial(1, it.unidad, mat);
    if (!c.ok) throw fallo(400, `Renglón ${i + 1} (${mat.nombre}): ${c.error}`);
  });

  return items;
}

/** Reemplaza todos los renglones de la receta de la ficha. Dentro de la transacción de quien llama. */
async function guardarItems(client, fichaId, items) {
  await client.query('DELETE FROM ficha_receta_items WHERE ficha_id = $1', [fichaId]);
  for (const it of items) {
    await client.query(
      `INSERT INTO ficha_receta_items (ficha_id, materia_prima_id, cantidad, unidad, observaciones, orden)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [fichaId, it.materia_prima_id, it.cantidad, it.unidad, it.observaciones, it.orden]);
  }
}

module.exports = { leerReceta, calcularNecesidad, calcularNecesidadPedido, aplicarConsumo, leerConsumos, devolverConsumo, normalizarUnidad, normalizarItems, guardarItems };

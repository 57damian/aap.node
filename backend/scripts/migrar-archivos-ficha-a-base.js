// backend/scripts/migrar-archivos-ficha-a-base.js
//
// Pasa a la tabla ficha_archivos las fotos de modelos y las etiquetas PDF que
// todavía existen como archivo en disco (UPLOAD_PATH). Requiere haber
// aplicado antes migracion-ficha-archivos.sql.
//
// - Foto: si la ficha todavía no tiene FOTO en la base y el archivo existe, se carga.
// - Etiqueta: cada fila de la tabla vieja ficha_etiquetas cuyo archivo exista se carga
//   como ETIQUETA y se borra de la tabla vieja (así volver a correr el script no la duplica).
// - Lo que apunta a un archivo que ya no existe se informa y no se toca: hay que volver a subirlo.
//
// Uso (solo escribe en la base a la que apunte DATABASE_URL):
//   cd backend
//   node scripts/migrar-archivos-ficha-a-base.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { rutaFisica } = require('../config/uploads');

const MIME_POR_EXTENSION = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf'
};

function leer(rutaLogica) {
  const ruta = rutaFisica(rutaLogica);
  if (!fs.existsSync(ruta)) return null;
  const mime = MIME_POR_EXTENSION[path.extname(ruta).toLowerCase()];
  if (!mime) return null;
  const contenido = fs.readFileSync(ruta);
  return { contenido, mime, nombre: path.basename(ruta) };
}

(async () => {
  const resumen = { fotos: 0, etiquetas: 0, faltan: [] };
  try {
    const fotos = await pool.query(
      `SELECT ft.id, ft.modelo, ft.foto_modelo FROM ficha_transformador ft
       WHERE ft.foto_modelo IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ficha_archivos fa WHERE fa.ficha_id = ft.id AND fa.tipo = 'FOTO')`
    );
    for (const f of fotos.rows) {
      const a = leer(f.foto_modelo);
      if (!a) { resumen.faltan.push(`foto de "${f.modelo}" (ficha ${f.id}): ${f.foto_modelo}`); continue; }
      await pool.query(
        `INSERT INTO ficha_archivos (ficha_id, tipo, nombre_original, mime, tamano, contenido)
         VALUES ($1, 'FOTO', $2, $3, $4, $5)`,
        [f.id, a.nombre, a.mime, a.contenido.length, a.contenido]
      );
      resumen.fotos++;
    }

    const etiquetas = await pool.query(
      `SELECT id, ficha_id, archivo, nombre_original, creado_en, creado_por FROM ficha_etiquetas ORDER BY id`
    );
    for (const e of etiquetas.rows) {
      const a = leer(e.archivo);
      if (!a) { resumen.faltan.push(`etiqueta ${e.id} (ficha ${e.ficha_id}): ${e.archivo}`); continue; }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO ficha_archivos (ficha_id, tipo, nombre_original, mime, tamano, contenido, creado_en, creado_por)
           VALUES ($1, 'ETIQUETA', $2, $3, $4, $5, $6, $7)`,
          [e.ficha_id, e.nombre_original || a.nombre, a.mime, a.contenido.length, a.contenido, e.creado_en, e.creado_por]
        );
        await client.query('DELETE FROM ficha_etiquetas WHERE id = $1', [e.id]);
        await client.query('COMMIT');
        resumen.etiquetas++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    console.log(`✅ Fotos pasadas a la base: ${resumen.fotos}`);
    console.log(`✅ Etiquetas pasadas a la base: ${resumen.etiquetas}`);
    if (resumen.faltan.length) {
      console.log(`⚠️  ${resumen.faltan.length} archivo(s) ya no existen en disco y hay que volver a subirlos:`);
      resumen.faltan.forEach(l => console.log('   - ' + l));
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

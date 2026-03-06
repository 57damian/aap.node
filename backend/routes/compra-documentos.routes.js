const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const { verificarToken, authorize } = require('../middlewares/auth');

router.use(verificarToken);

// Configuración de multer para subir archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/compras');
    
    // Crear directorio si no existe
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generar nombre único: compra_id-timestamp-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `compra-${req.body.compra_id || 'temp'}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Permitir solo PDF y imágenes
  const allowedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif'
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos PDF y imágenes (JPG, PNG, GIF)'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB máximo
    files: 5 // Máximo 5 archivos por solicitud
  }
});

// =============================
// SUBIR DOCUMENTOS DE COMPRA
// POST /api/compras/:id/documentos
// =============================
router.post('/:id/documentos', authorize(['admin', 'control']), upload.array('documentos', 5), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const compraId = req.params.id;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se subieron archivos' });
    }
    
    // Verificar que la compra existe
    const compraCheck = await client.query(
      'SELECT id FROM compras WHERE id = $1',
      [compraId]
    );
    
    if (compraCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    
    const documentosInsertados = [];
    
    for (const file of req.files) {
      const tipoDocumento = req.body.tipo_documento || 'OTRO';
      const observaciones = req.body.observaciones || null;
      
      const result = await client.query(`
        INSERT INTO compra_documentos 
          (compra_id, tipo_documento, nombre_archivo, ruta_archivo, tamaño_bytes, mime_type, usuario_id, observaciones)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        compraId,
        tipoDocumento,
        file.originalname,
        file.path,
        file.size,
        file.mimetype,
        req.usuario ? req.usuario.id : null,
        observaciones
      ]);
      
      documentosInsertados.push(result.rows[0]);
    }
    
    res.status(201).json({
      ok: true,
      message: 'Documentos subidos correctamente',
      documentos: documentosInsertados
    });
    
  } catch (err) {
    console.error('Error subiendo documentos:', err);
    
    // Eliminar archivos si hubo error
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkErr) {
          console.error('Error eliminando archivo:', unlinkErr);
        }
      });
    }
    
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// LISTAR DOCUMENTOS DE COMPRA
// GET /api/compras/:id/documentos
// =============================
router.get('/:id/documentos', authorize(['admin', 'control', 'operario']), async (req, res) => {
  try {
    const compraId = req.params.id;
    
    const result = await pool.query(`
      SELECT 
        cd.*,
        u.usuario as nombre_usuario
      FROM compra_documentos cd
      LEFT JOIN usuarios u ON cd.usuario_id = u.id
      WHERE cd.compra_id = $1
      ORDER BY cd.fecha_subida DESC
    `, [compraId]);
    
    res.json(result.rows);
    
  } catch (err) {
    console.error('Error listando documentos:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// DESCARGAR DOCUMENTO
// GET /api/compras/:id/documentos/:docId/download
// =============================
router.get('/:id/documentos/:docId/download', authorize(['admin', 'control', 'operario']), async (req, res) => {
  try {
    const docId = req.params.docId;
    
    const result = await pool.query(
      'SELECT * FROM compra_documentos WHERE id = $1',
      [docId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    
    const documento = result.rows[0];
    
    // Verificar que el archivo exista
    if (!fs.existsSync(documento.ruta_archivo)) {
      return res.status(404).json({ error: 'Archivo no encontrado en servidor' });
    }
    
    // Enviar archivo
    res.download(documento.ruta_archivo, documento.nombre_archivo, (err) => {
      if (err) {
        console.error('Error descargando archivo:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error al descargar archivo' });
        }
      }
    });
    
  } catch (err) {
    console.error('Error descargando documento:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================
// ELIMINAR DOCUMENTO
// DELETE /api/compras/:id/documentos/:docId
// =============================
router.delete('/:id/documentos/:docId', authorize(['admin', 'control']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const docId = req.params.docId;
    
    // Obtener información del documento
    const docResult = await client.query(
      'SELECT * FROM compra_documentos WHERE id = $1',
      [docId]
    );
    
    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    
    const documento = docResult.rows[0];
    
    // Eliminar registro de la base de datos
    await client.query('DELETE FROM compra_documentos WHERE id = $1', [docId]);
    
    // Eliminar archivo físico
    try {
      if (fs.existsSync(documento.ruta_archivo)) {
        fs.unlinkSync(documento.ruta_archivo);
      }
    } catch (unlinkErr) {
      console.error('Error eliminando archivo físico:', unlinkErr);
      // No fallar si no se puede eliminar el archivo
    }
    
    res.json({
      ok: true,
      message: 'Documento eliminado correctamente'
    });
    
  } catch (err) {
    console.error('Error eliminando documento:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================
// ACTUALIZAR INFORMACIÓN DE DOCUMENTO
// PUT /api/compras/:id/documentos/:docId
// =============================
router.put('/:id/documentos/:docId', authorize(['admin', 'control']), async (req, res) => {
  try {
    const docId = req.params.docId;
    const { tipo_documento, observaciones } = req.body;
    
    const result = await pool.query(`
      UPDATE compra_documentos 
      SET tipo_documento = COALESCE($1, tipo_documento),
          observaciones = COALESCE($2, observaciones)
      WHERE id = $3
      RETURNING *
    `, [tipo_documento, observaciones, docId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    
    res.json({
      ok: true,
      documento: result.rows[0]
    });
    
  } catch (err) {
    console.error('Error actualizando documento:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

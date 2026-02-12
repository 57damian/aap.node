const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: 'uploads/modelos',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Solo imágenes'));
    }
    cb(null, true);
  }
});

module.exports = upload;

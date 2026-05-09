const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const pool = require('./db');
const { verificarToken } = require('./middlewares/auth');

// Importar rutas existentes que se mantienen
const authRoutes = require('./routes/auth.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const clientesRoutes = require('./routes/clientes.routes');
const facturasRoutes = require('./routes/facturas.routes');
const fichaRoutes = require('./routes/ficha.routes');
const notasCreditoRoutes = require('./routes/notas_credito.routes');
const ordenesCompraRoutes = require('./routes/ordenesCompra.routes');
const preciosRoutes = require('./routes/precios.routes');
const produccionRoutes = require('./routes/produccion.routes');
const reportesRoutes = require('./routes/reportes.routes');
const reportesOCRoutes = require('./routes/reportesOC.routes');
const ventasRoutes = require('./routes/ventas.routes');

// ========== NUEVAS RUTAS (reconstrucción módulo proveedores) ==========
const materiasPrimasRoutes = require('./routes/materias-primas.routes');   // CRUD materias primas
const stockRoutes = require('./routes/stock.routes');                     // Movimientos y ajustes de materias primas
const stockProduccionRoutes = require('./routes/stock-produccion.routes'); // Stock de productos terminados
const facturasCompraRoutes = require('./routes/facturas-compra.routes');   // Facturas de compra
const pagosRoutes = require('./routes/pagos.routes');                     // Pagos a proveedores
const pagosClientesRoutes = require('./routes/pagos-clientes.routes');    // Pagos de clientes
// =====================================================================

// ========== RUTAS ANTIGUAS QUE SERÁN REEMPLAZADAS (comentadas) ==========
// const proveedoresRoutesOld = require('./routes/proveedores.routes');       // Se reemplazará
// const comprasRoutesOld = require('./routes/compras.routes');               // Se reemplazará
// const compraDocumentosRoutes = require('./routes/compra-documentos.routes'); // Opcional
// const articulosRoutes = require('./routes/articulos.routes');              // Se elimina
// const facturasCompraRoutes = require('./routes/facturas-compra.routes');   // Se elimina
// const stockRoutesOld = require('./routes/stock.routes');                   // Se reemplaza
// const materiasPrimasRoutesOld = require('./routes/materiasPrimas.routes'); // Se reemplaza
// ========================================================================

const app = express();
const port = process.env.PORT || 3000;

// Configuración de seguridad
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'", "http://127.0.0.1:5501", "http://localhost:5501"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"]
        }
    }
}));

    // CORS
    app.use(cors({
        origin: function (origin, callback) {
            const allowedOrigins = [
                'http://localhost:5500',
                'http://127.0.0.1:5500',
                'http://localhost:5501',
                'http://127.0.0.1:5501',
                'http://localhost:5502',
                'http://127.0.0.1:5502',
                'http://localhost:3000',
                'http://127.0.0.1:3000'
            ];
            // Agregar origen de Railway desde variable de entorno (si existe)
            if (process.env.RAILWAY_PUBLIC_DOMAIN) {
                allowedOrigins.push(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
            }
            // Permitir cualquier origen de Railway (*.railway.app)
            if (origin && origin.endsWith('.railway.app')) {
                return callback(null, true);
            }
            // Permitir requests sin origin (como Postman, curl, etc.)
            if (!origin || allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                console.log('CORS blocked for origin:', origin);
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
        optionsSuccessStatus: 200,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
    }));

// Middlewares básicos
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// En producción, servir el frontend desde la raíz
const rutaFrontend = path.join(__dirname, '../frontend');
app.use(express.static(rutaFrontend));

// Logging (desarrollo)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// Rutas públicas
app.use('/api/auth', authRoutes);
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ruta principal
app.get('/', (req, res) => {
  res.json({ message: '🚀 API de Transformadores funcionando correctamente' });
});

// Middleware de autenticación para todas las rutas /api excepto /api/auth
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    verificarToken(req, res, next);
});

// Rate limiting
const limiter = rateLimit({
    windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX || 100,
    message: { error: 'Demasiadas peticiones, intenta más tarde' },
    skip: (req) => req.path === '/health'
});
app.use('/api/', limiter);

// ========== RUTAS PROTEGIDAS ACTIVAS ==========
app.use('/api/materias-primas', materiasPrimasRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/stock-produccion', stockProduccionRoutes);
app.use('/api/facturas-compra', facturasCompraRoutes);
app.use('/api/pagos-proveedores', pagosRoutes);
app.use('/api/pagos-clientes', pagosClientesRoutes);

// Rutas para proveedores
const proveedoresRoutes = require('./routes/proveedores.routes');
app.use('/api/proveedores', proveedoresRoutes);

// ========== RUTAS EXISTENTES QUE SE MANTIENEN ==========
app.use('/api/clientes', clientesRoutes);
app.use('/api/facturas', facturasRoutes);
app.use('/api/ficha-transformador', fichaRoutes);
app.use('/api/notas-credito', notasCreditoRoutes);
app.use('/api/ordenes-compra', ordenesCompraRoutes);
app.use('/api/precios', preciosRoutes);
app.use('/api/produccion', produccionRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/reportes-oc', reportesOCRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/usuarios', usuariosRoutes);

// Ruta comodín para el frontend (Solo en producción)
// Si la ruta no es /api/*, intenta servir el index.html del frontend
app.get('*', (req, res) => {
    // No interferir con rutas de API
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Ruta no encontrada' });
    }
    // Servir el index.html del frontend
    res.sendFile(path.join(rutaFrontend, 'index.html'));
});

// Manejo de errores 404
app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'El archivo es demasiado grande' });
    }
    if (err.message === 'Solo imágenes') {
        return res.status(400).json({ error: 'Solo se permiten archivos de imagen' });
    }
    res.status(500).json({ 
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en puerto ${port}`);
    console.log(`📝 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ Rutas activas: materias-primas, stock, facturas-compra, y módulos existentes.`);
    console.log(`⏳ Próximas rutas (compras, pagos) se agregarán progresivamente.`);
});

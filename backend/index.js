const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const pool = require('./db');
const { verificarToken, exigirPasswordAlDia } = require('./middlewares/auth');

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
const pagosProveedoresRoutes = require('./routes/pagos-proveedores.routes'); // Pagos a proveedores (reemplaza pagos.routes.js)
const cobrosRoutes = require('./routes/cobros.routes');                   // Cobros a clientes (reemplaza pagos-clientes.routes.js)
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
app.set('trust proxy', 1); // Confiar en proxy inverso (Railway)
const port = process.env.PORT || 3000;
const enProduccion = process.env.NODE_ENV === 'production';

// Con la app publicada en internet, el login y el token no pueden viajar en
// claro. Railway termina TLS en su proxy y reenvía por HTTP, así que hay que
// mirar x-forwarded-proto (trust proxy ya está activado arriba).
if (enProduccion) {
    app.use((req, res, next) => {
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
        if (req.method === 'GET' || req.method === 'HEAD') {
            return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
        }
        return res.status(403).json({ error: 'Se requiere HTTPS' });
    });
}

// Configuración de seguridad
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // HSTS: el navegador no vuelve a intentar por HTTP durante un año.
    // Solo tiene efecto sobre HTTPS, así que en local no molesta.
    hsts: enProduccion
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Los localhost son para el Live Server de VS Code: fuera de
            // desarrollo no tienen nada que hacer en la política.
            connectSrc: enProduccion
                ? ["'self'"]
                : ["'self'", "http://127.0.0.1:5501", "http://localhost:5501"],
            ...(enProduccion ? { upgradeInsecureRequests: [] } : {}),
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com",
                // hallazgo S10: alertas-pagos.html y facturas-compra.html cargan
                // jQuery y DataTables desde estos hosts; sin ellos en la CSP el
                // navegador los bloquea en silencio cuando se sirven desde Express
                // (por eso "funcionaba" solo abriendo el HTML con Live Server).
                "https://code.jquery.com",
                "https://cdn.datatables.net"
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com",
                "https://cdn.datatables.net"
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com"
            ],
            imgSrc: ["'self'", "data:", "blob:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"]
        }
    }
}));

    // CORS
    //
    // Antes esto aceptaba como origen CUALQUIER dominio terminado en
    // '.railway.app': con la app publicada, alguien que despliegue su propio
    // proyecto en Railway quedaba autorizado a hablarle a esta API desde el
    // navegador de un usuario logueado. Ahora la lista es explícita: los
    // puertos de desarrollo local más lo que diga CORS_ORIGIN en el .env
    // (separado por comas), variable que existía y no leía nadie.
    const ORIGENES_DESARROLLO = [
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://localhost:5501',
        'http://127.0.0.1:5501',
        'http://localhost:5502',
        'http://127.0.0.1:5502',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ];

    const origenesPermitidos = [
        ...(process.env.NODE_ENV === 'production' ? [] : ORIGENES_DESARROLLO),
        ...(process.env.CORS_ORIGIN || '')
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean),
        ...(process.env.RAILWAY_PUBLIC_DOMAIN
            ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
            : [])
    ];

    app.use(cors({
        origin: function (origin, callback) {
            // Sin cabecera Origin (curl, Postman, el propio front servido desde
            // este mismo server): no es una request entre sitios, no aplica CORS.
            if (!origin) return callback(null, true);

            if (origenesPermitidos.includes(origin)) {
                return callback(null, true);
            }

            console.warn('CORS: origen rechazado:', origin);
            callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
        optionsSuccessStatus: 200,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
    }));

// Middlewares básicos
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Los endpoints de diagnóstico /test-login y /reset-password-admin que
// vivían acá (hallazgos S1 y S2 de la auditoría) se sacaron: no tenían
// autenticación, así que cualquiera en internet podía resetear la
// contraseña del admin a 'admin123' o usar /test-login como oráculo de
// contraseñas (existencia de usuario + hash bcrypt de regalo). La
// funcionalidad legítima de reset ya existe protegida con
// authorize(['admin']) en POST /api/usuarios/:id/reset-password, y para
// recuperar acceso sin server está backend/scripts/reset-admin-password.js.

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// En producción, servir el frontend desde la carpeta public/
const rutaFrontend = path.join(__dirname, 'public');
// Las rutas del filesystem del server se logueaban en cada arranque: es
// información sobre la máquina que no aporta nada en funcionamiento normal.
app.use(express.static(rutaFrontend));

// Logging (desarrollo)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// /test-db y /debug-paths (hallazgo S3) se sacaron: no tenían autenticación
// y /debug-paths listaba el contenido del directorio del proyecto en el
// server. Para diagnosticar que la base responde alcanza con /health.

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rate limiting (hallazgo S4: esto tiene que ir ANTES de montar /api/auth,
// si no /api/auth/login nunca pasa por acá porque Express corre los
// middlewares en el orden en que se registran). Number(...) explícito
// porque process.env.* siempre llega como string y express-rate-limit
// espera un number.
const limiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX || 100),
    message: { error: 'Demasiadas peticiones, intenta más tarde' },
    skip: (req) => req.path === '/health'
});
app.use('/api/', limiter);

// Límite más estricto solo para el login: 10 intentos cada 15 minutos,
// sin contar los que salieron bien (hallazgo S4).
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    message: { error: 'Demasiados intentos de login. Esperá 15 minutos.' }
});
app.use('/api/auth/login', loginLimiter);

// Los endpoints de contraseña caían bajo el límite general de 100 requests:
// suficiente para probar contraseñas actuales a mano. Este es más estricto.
const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Demasiados intentos. Esperá 15 minutos.' }
});
app.use('/api/usuarios/cambiar-password', passwordLimiter);

// Rutas públicas
app.use('/api/auth', authRoutes);

// Middleware de autenticación para todas las rutas /api excepto /api/auth
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth')) return next();
    verificarToken(req, res, next);
});

// Mientras la contraseña sea la temporal que entregó el administrador, lo
// único habilitado es cambiarla. Va después de verificarToken porque necesita
// req.usuario, y antes de montar los routers para que cubra todo el sistema.
app.use('/api', exigirPasswordAlDia);

// ========== RUTAS PROTEGIDAS ACTIVAS ==========
app.use('/api/materias-primas', materiasPrimasRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/stock-produccion', stockProduccionRoutes);
app.use('/api/facturas-compra', facturasCompraRoutes);
app.use('/api/pagos-proveedores', pagosProveedoresRoutes);
app.use('/api/cobros', cobrosRoutes);
// Alias del prefijo viejo: la pantalla anterior llamaba a /api/pagos/... y a
// /api/pagos-clientes/..., que nunca estuvo montado del todo. Se deja el alias
// para que nada quede en 404 mientras se termina de migrar el frontend.
app.use('/api/pagos-clientes', cobrosRoutes);

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

// Ruta comodín para el frontend
// Cualquier ruta que no sea /api/* sirve el index.html del frontend
app.get('*', (req, res) => {
    // No interferir con rutas de API
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Ruta no encontrada' });
    }
    // Servir el index.html del frontend
    const indexPath = path.join(rutaFrontend, 'index.html');
    res.sendFile(indexPath);
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

// Red de seguridad (hallazgo C1): Express 4 no captura promesas
// rechazadas en handlers async — sin esto, un error de base en un
// handler que no esté envuelto con asyncHandler tira el proceso entero.
// Esto no reemplaza asyncHandler, es el último resguardo si algún
// handler se queda sin envolver.
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection (no debería pasar, revisar handler async):', err);
});

app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en puerto ${port}`);
    console.log(`📝 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ Rutas activas: materias-primas, stock, facturas-compra, y módulos existentes.`);
    console.log(`⏳ Próximas rutas (compras, pagos) se agregarán progresivamente.`);
});

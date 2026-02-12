require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

/* =====================
   RUTAS
===================== */
const authRoutes = require('./routes/auth.routes');
const clientesRoutes = require('./routes/clientes.routes');
const ventasRoutes = require('./routes/ventas.routes');
const pagosClientesRoutes = require('./routes/pagos-clientes.routes');
const produccionRoutes = require('./routes/produccion.routes');
const fichaRoutes = require('./routes/ficha.routes');
const preciosRoutes = require('./routes/precios.routes');
const reportesRoutes = require('./routes/reportes.routes');
const ordenesCompraRoutes = require('./routes/ordenesCompra.routes');
const reportesOCRoutes = require('./routes/reportesOC.routes');

// Rutas - Orden importante (las más específicas primero)
app.use('/reportes', reportesOCRoutes);     // ✅ Reportes de OC
app.use('/reportes', reportesRoutes);             // ✅ Otros reportes
app.use('/ordenes-compra', ordenesCompraRoutes);
app.use('/precios', preciosRoutes);
app.use('/ficha-transformador', fichaRoutes);     // ✅ Ruta corregida
app.use('/produccion', produccionRoutes);
app.use('/pagos-clientes', pagosClientesRoutes);
app.use('/ventas', ventasRoutes);
app.use('/auth', authRoutes);
app.use('/clientes', clientesRoutes);
app.use('/uploads', express.static('uploads'));   // Archivos estáticos al final
app.use('/facturas', require('./routes/facturas.routes'));
app.use('/pagos', require('./routes/pagos.routes'));
app.use('/notas-credito', require('./routes/notas_credito.routes'));

/* =====================
   HEALTH CHECK
===================== */
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/* =====================
   ERROR HANDLER
===================== */
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

/* =====================
   404 HANDLER
===================== */
app.use((req, res) => {
  console.log('404 - Ruta no encontrada:', req.method, req.url);
  res.status(404).json({ error: 'Ruta no encontrada' });
});

/* =====================
   SERVER
===================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 Servidor corriendo en puerto', PORT);
  console.log('✅ Rutas disponibles:');
  console.log('   - /auth');
  console.log('   - /clientes');
  console.log('   - /ficha-transformador');
  console.log('   - /ordenes-compra');
  console.log('   - /ventas');
  console.log('   - /pagos-clientes');
  console.log('   - /produccion');
  console.log('   - /precios');
  console.log('   - /reportes');
  console.log('   - /reportes/oc');
  console.log('   - /uploads');
  console.log('   - /health');
});
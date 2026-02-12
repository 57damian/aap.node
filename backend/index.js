require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

/* =====================
   RUTAS
===================== */

// ✅ Cargar solo rutas que EXISTEN
const authRoutes = require('./routes/auth.routes');
const clientesRoutes = require('./routes/clientes.routes');
const ventasRoutes = require('./routes/ventas.routes');
const produccionRoutes = require('./routes/produccion.routes');
const fichaRoutes = require('./routes/ficha.routes');
const preciosRoutes = require('./routes/precios.routes');
const reportesRoutes = require('./routes/reportes.routes');
const ordenesCompraRoutes = require('./routes/ordenesCompra.routes');
const reportesOCRoutes = require('./routes/reportesOC.routes');

// ⚠️ Si el archivo existe, descomentá esto:
// const pagosClientesRoutes = require('./routes/pagos-clientes.routes');

/* =====================
   USO DE RUTAS
===================== */

// Orden importante (más específicas primero)
app.use('/reportes', reportesOCRoutes);
app.use('/reportes', reportesRoutes);

app.use('/ordenes-compra', ordenesCompraRoutes);
app.use('/precios', preciosRoutes);
app.use('/ficha-transformador', fichaRoutes);
app.use('/produccion', produccionRoutes);
// app.use('/pagos-clientes', pagosClientesRoutes); // activar solo si existe
app.use('/ventas', ventasRoutes);
app.use('/auth', authRoutes);
app.use('/clientes', clientesRoutes);

app.use('/facturas', require('./routes/facturas.routes'));
app.use('/pagos', require('./routes/pagos.routes'));
app.use('/notas-credito', require('./routes/notas_credito.routes'));

app.use('/uploads', express.static('uploads'));

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
});
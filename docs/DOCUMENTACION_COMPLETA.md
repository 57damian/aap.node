# Documentación Completa del Proyecto - Transformadores ERP

---

## 1. Estructura de Carpetas

```
mi-proyecto/
├── .gitignore
├── .vscode/
│   └── settings.json
├── backend/                    # Código fuente del backend (Node.js + Express)
│   ├── .env                    # Variables de entorno (no subir a git)
│   ├── index.js                # Punto de entrada del servidor
│   ├── db.js                   # Configuración de conexión a PostgreSQL
│   ├── package.json            # Dependencias y scripts
│   ├── controller/             # Controladores (auth, clientes)
│   │   ├── auth.controller.js
│   │   └── clientes.controller.js
│   ├── middlewares/            # Middlewares de Express
│   │   ├── auth.js             # JWT + autorización por roles
│   │   └── uploadModelo.js     # Multer para subida de archivos
│   ├── routes/                 # Rutas de la API (21 archivos)
│   │   ├── auth.routes.js
│   │   ├── clientes.routes.js
│   │   ├── facturas-compra.routes.js
│   │   ├── facturas.routes.js
│   │   ├── ficha.routes.js
│   │   ├── materias-primas.routes.js
│   │   ├── notas_credito.routes.js
│   │   ├── ordenesCompra.routes.js
│   │   ├── pagos-clientes.routes.js
│   │   ├── pagos.routes.js
│   │   ├── precios.routes.js
│   │   ├── produccion.routes.js
│   │   ├── proveedores-extended.routes.js
│   │   ├── proveedores.routes.js
│   │   ├── reportes.routes.js
│   │   ├── reportesOC.routes.js
│   │   ├── stock-movimientos.js
│   │   ├── stock-produccion.routes.js
│   │   ├── stock.routes.js
│   │   ├── usuarios.routes.js
│   │   └── ventas.routes.js
│   ├── public/                 # Frontend (HTML/CSS/JS puro)
│   │   ├── index.html
│   │   ├── login.html
│   │   ├── dashboard.html
│   │   ├── clientes.html
│   │   ├── ventas.html
│   │   ├── facturas-compra.html
│   │   ├── facturas-compra-corregida.html
│   │   ├── facturas-lista-simple.html
│   │   ├── ficha.html
│   │   ├── oc.html / oc_detalle.html
│   │   ├── proveedores.html
│   │   ├── pagos-proveedores.html
│   │   ├── pagos-proveedores-mejorado.html
│   │   ├── pagos-clientes.html
│   │   ├── precios.html
│   │   ├── produccion.html
│   │   ├── stock.html / stock-mp.html
│   │   ├── usuarios.html
│   │   ├── alertas-pagos.html
│   │   ├── trazabilidad-pagos.html
│   │   ├── venta_detalle.html
│   │   ├── css/ (estilos)
│   │   ├── js/ (scripts frontend)
│   │   └── models/ (modelos 3D)
│   ├── scripts/                # Scripts de mantenimiento y migración
│   │   ├── create-admin.js
│   │   ├── migrate.js
│   │   ├── crear-tablas-*.sql / .js
│   │   ├── check-*.js
│   │   ├── fix-*.js
│   │   ├── test-*.js
│   │   └── *.md (documentación de módulos)
│   └── node_modules/
├── docs/                       # Documentación
│   ├── ESQUEMA_BD.md.txt
│   ├── SISTEMA_FACTURAS_COMPRA.md
│   ├── SISTEMA_PAGOS_PROVEEDORES.md
│   ├── SISTEMA_PRECIOS_MATERIAS_PRIMAS.md
│   ├── SistemadeFacturacióndeVentas.md
│   └── DOCUMENTACION_COMPLETA.md (este archivo)
├── frontend-react/             # Proyecto React (en desarrollo inicial)
│   └── package.json
├── uploads/
│   └── modelos/                # Archivos subidos (modelos 3D, fotos OC)
├── test-auth.html
├── test-navegacion.html
└── test-ultimo-numero.js
```

### Carpetas con código fuente:
| Carpeta | Descripción |
|---------|-------------|
| `backend/` | Backend completo (Node.js + Express) |
| `backend/routes/` | Endpoints de la API REST |
| `backend/middlewares/` | Middlewares de autenticación y subida |
| `backend/controller/` | Controladores (parcial) |
| `backend/public/` | Frontend HTML/CSS/JS |
| `backend/scripts/` | Scripts de mantenimiento, migraciones, tests |
| `docs/` | Documentación del proyecto |
| `frontend-react/` | Frontend en React (en etapa inicial) |
| `uploads/` | Archivos subidos por usuarios |

---

## 2. Tecnologías Utilizadas

### Backend
| Tecnología | Versión | Uso |
|------------|---------|-----|
| Node.js | 18+ | Runtime |
| Express | ^4.18.2 | Framework web |
| PostgreSQL (pg) | ^8.11.3 | Base de datos relacional |
| jsonwebtoken | ^9.0.2 | Autenticación JWT |
| bcryptjs | ^2.4.3 | Hash de contraseñas |
| cors | ^2.8.5 | CORS |
| helmet | ^7.2.0 | Seguridad HTTP |
| express-rate-limit | ^7.5.1 | Rate limiting |
| express-validator | ^7.0.1 | Validación de datos |
| multer | ^1.4.5-lts.1 | Subida de archivos |
| dotenv | ^16.6.1 | Variables de entorno |
| node-fetch | ^3.3.2 | HTTP client |

### Frontend
| Tecnología | Uso |
|------------|-----|
| HTML5 | Estructura de páginas |
| CSS3 | Estilos (con variables CSS, flexbox, grid) |
| JavaScript (vanilla) | Lógica del frontend |
| Font Awesome 6 | Iconos |
| Google Fonts (Inter) | Tipografía |

### Base de Datos
| Componente | Detalle |
|------------|---------|
| Motor | PostgreSQL (local y Neon.tech cloud) |
| Versión | 15+ |
| Extensiones | Ninguna especial requerida |
| Pool de conexiones | `pg.Pool` con SSL configurable |

### Herramientas de Desarrollo
| Herramienta | Uso |
|-------------|-----|
| nodemon | Recarga automática en desarrollo |
| VS Code | IDE principal |
| Git | Control de versiones |

---

## 3. Base de Datos

### Configuración de Conexión (`backend/db.js`)
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
```

### Variables de Entorno para BD
```
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres2026
DB_DATABASE=transformadores
```

### Tablas Principales

Ver archivo `docs/ESQUEMA_BD.md.txt` para el detalle completo. Resumen de tablas:

| Tabla | Propósito |
|-------|-----------|
| `usuarios` | Usuarios del sistema (admin, control, operario, empleado) |
| `clientes` | Clientes |
| `proveedores` | Proveedores |
| `entidades` | Entidades unificadas (clientes + proveedores) |
| `ficha_transformador` | Fichas técnicas de transformadores (modelos) |
| `ordenes_compra` | Órdenes de compra de clientes |
| `orden_compra_items` | Items de cada OC |
| `ventas` | Ventas/entregas |
| `venta_items` | Items de cada venta |
| `facturas` | Facturas de venta |
| `factura_items` | Items de facturas de venta |
| `notas_credito` | Notas de crédito |
| `facturas_compra` | Facturas de compra a proveedores |
| `factura_items` (compra) | Items de facturas de compra (materias primas) |
| `materias_primas` | Materias primas (stock, precios) |
| `stock_movimientos` | Movimientos de stock de materias primas |
| `stock_produccion` | Stock de productos terminados |
| `precios_modelo` | Histórico de precios de modelos |
| `precios_materia_prima` | Histórico de precios de materias primas |
| `historial_precios_materias` | Historial detallado de cambios de precios |
| `pagos_proveedores` | Pagos a proveedores |
| `pagos_proveedores_items` | Items/aplicaciones de pagos a proveedores |
| `pagos` | Pagos de clientes |
| `aplicacion_pagos` | Aplicación de pagos a facturas |
| `pago_items` | Items de pago (cheques, transferencias) |
| `cheques_propios` | Cheques emitidos |
| `endosos_cheques` | Endosos de cheques a proveedores |
| `ordenes_pago_proveedores` | Órdenes de pago |
| `parametros` | Parámetros del sistema (IVA, tipo de cambio) |
| `produccion` | Registro de producción |

---

## 4. Endpoints de la API

### 4.1 Autenticación (`/api/auth`)

| Método | URL | Body | Respuesta | Roles |
|--------|-----|------|-----------|-------|
| POST | `/api/auth/login` | `{usuario, password}` | `{token, usuario: {id, usuario, rol}}` | Público |
| GET | `/api/auth/verificar` | - | `{ok, usuario}` | Todos (token válido) |
| POST | `/api/auth/cambiar-password` | `{password_actual, password_nueva}` | `{ok, message}` | Todos |
| GET | `/api/auth/usuarios` | - | `{ok, usuarios[]}` | admin |
| POST | `/api/auth/usuarios` | `{usuario, password, rol}` | `{ok, usuario}` | admin |
| PUT | `/api/auth/usuarios/:id` | `{activo?, rol?}` | `{ok, usuario}` | admin |
| POST | `/api/auth/usuarios/:id/reset-password` | - | `{ok, password_temporal}` | admin |
| DELETE | `/api/auth/usuarios/:id` | - | `{ok, message}` | admin |

### 4.2 Usuarios (`/api/usuarios`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/usuarios` | `?search&rol&activo&page&limit` | `{usuarios[], total, page, totalPages}` | admin |
| GET | `/api/usuarios/stats` | - | `{stats, ultimos_registrados}` | admin |
| GET | `/api/usuarios/:id` | - | Usuario | admin |
| POST | `/api/usuarios` | `{nombre_usuario, email, password, rol, ...}` | Usuario creado | admin |
| POST | `/api/usuarios/alta` | `{nombre_usuario, email, password, perfil}` | Usuario creado | admin |
| PUT | `/api/usuarios/:id` | `{nombre_usuario?, email?, password?, rol?, ...}` | Usuario actualizado | admin |
| DELETE | `/api/usuarios/:id` | - | `{message}` | admin |
| POST | `/api/usuarios/:id/reset-password` | `{nueva_password?}` | `{nueva_password}` | admin |
| PUT | `/api/usuarios/cambiar-password` | `{password_actual, password_nueva, password_confirmacion}` | `{message}` | Todos |

### 4.3 Clientes (`/api/clientes`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/clientes` | - | `clientes[]` | admin, control, operario |
| GET | `/api/clientes/count` | - | `{total}` | admin, control, operario |
| GET | `/api/clientes/:id` | - | Cliente | admin, control, operario |
| POST | `/api/clientes` | `{nombre, cuit, telefono, ...}` | Cliente creado | admin, control |
| PUT | `/api/clientes/:id` | `{nombre, cuit, ...}` | Cliente actualizado | admin, control |
| DELETE | `/api/clientes/:id` | - | `{ok, deletedId}` | admin, control |
| GET | `/api/clientes/:id/estado` | - | `{cliente, total_facturado, total_pagado, saldo}` | admin, control |
| GET | `/api/clientes/:id/cuenta-corriente` | `?desde&hasta` | `{cliente, filtros, movimientos[]}` | admin, control |

### 4.4 Proveedores (`/api/proveedores`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/proveedores` | `?search&estado` | `proveedores[]` con deuda_pendiente | Todos (token) |
| GET | `/api/proveedores/:id` | - | Proveedor | Todos |
| POST | `/api/proveedores` | `{nombre, cuit, direccion, ...}` | Proveedor creado | admin, control |
| PUT | `/api/proveedores/:id` | `{nombre, cuit, ..., activo?}` | Proveedor actualizado | admin, control |
| DELETE | `/api/proveedores/:id` | - | `{message}` (soft delete si tiene compras) | admin |
| GET | `/api/proveedores/:id/compras` | - | Compras del proveedor | Todos |
| GET | `/api/proveedores/:id/compras/:compra_id` | - | Detalle de compra + items + facturas | Todos |
| GET | `/api/proveedores/:id/facturas` | `?estado&desde&hasta` | Facturas del proveedor | Todos |
| GET | `/api/proveedores/:id/cuenta-corriente` | - | `{total_facturado, total_pagado, saldo_pendiente}` | Todos |
| GET | `/api/proveedores/:id/cheques-recibidos` | - | Cheques emitidos al proveedor | Todos |
| GET | `/api/proveedores/:id/cheques-endosados` | - | Cheques endosados al proveedor | Todos |
| GET | `/api/proveedores/:id/resumen` | - | Resumen financiero completo | Todos |

### 4.5 Órdenes de Compra (`/api/ordenes-compra`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/ordenes-compra` | - | `[{id, numero_oc, fecha_oc, estado, cliente}]` | admin, control |
| POST | `/api/ordenes-compra` | `{cliente_id, numero_oc, fecha_oc, foto_oc?, observaciones?}` | OC creada | admin, control |
| POST | `/api/ordenes-compra/:id/items` | `{ficha_id, cantidad_pedida}` | Item agregado | admin, control |
| GET | `/api/ordenes-compra/:id/estado` | - | Estado de cumplimiento por item | admin, control |
| PUT | `/api/ordenes-compra/:id/cerrar` | - | Cierra la OC si no hay pendientes | admin, control |

### 4.6 Ventas (`/api/ventas`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/ventas` | `?cliente_id&orden_compra_id` | `ventas[]` con cliente, OC, factura | admin, control |
| POST | `/api/ventas` | `{orden_compra_id, tipo_cambio, remito_numero?, ...}` | Venta creada | admin, control |
| POST | `/api/ventas/:id/items` | `{ficha_id, cantidad}` | Item agregado con precio calculado | admin, control |
| GET | `/api/ventas/:id` | - | Venta + items | admin, control |
| GET | `/api/ventas/:id/estado-facturacion` | - | `{facturada: bool}` | admin, control |
| PUT | `/api/ventas/:id/remito` | `{remito_numero, remito_fecha, ...}` | Actualiza remito | admin, control |
| GET | `/api/ventas/:id/factura` | - | Factura asociada a la venta | admin, control |

### 4.7 Facturación de Ventas (`/api/facturas`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| POST | `/api/facturas` | `{venta_id, numero_factura, tipo_factura, fecha, dias_credito}` | Factura creada (calcula IVA automáticamente) | admin, control |
| GET | `/api/facturas/venta/:venta_id` | - | Factura asociada a venta | admin, control |

### 4.8 Facturas de Compra (`/api/facturas-compra`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/facturas-compra` | `?proveedor_id&estado&fecha_desde&fecha_hasta&tipo_factura` | Facturas de compra | admin, control, compras |
| GET | `/api/facturas-compra/ultimo-numero` | `?tipo_factura` | `{ultimo_numero}` | admin, control, compras |
| GET | `/api/facturas-compra/:id` | - | Factura + items | admin, control, compras |
| POST | `/api/facturas-compra` | `{proveedor_id, fecha_emision, tipo_factura, numero_factura, items[], ...}` | Factura creada (actualiza stock y precios) | admin, control, compras |
| PUT | `/api/facturas-compra/:id` | Campos a actualizar | Factura actualizada | admin, control, compras |
| DELETE | `/api/facturas-compra/:id` | - | Factura eliminada (revierte stock) | admin, control |
| GET | `/api/facturas-compra/:id/items` | - | Items de la factura | admin, control, compras |
| GET | `/api/facturas-compra/materias-primas/buscar` | `?query` | Materias primas (autocomplete) | admin, control, compras |
| GET | `/api/facturas-compra/materias-primas/:id/ultimo-precio` | - | `{precio_referencia, fecha_ultima_compra}` | admin, control, compras |
| GET | `/api/facturas-compra/proveedor/:proveedor_id/pendientes` | - | Facturas pendientes del proveedor | admin, control, compras |

### 4.9 Pagos a Proveedores (`/api/pagos-proveedores`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/pagos-proveedores` | `?proveedor_id&fecha_desde&fecha_hasta&estado&forma_pago&search` | Pagos | Todos (token) |
| POST | `/api/pagos-proveedores` | `{proveedor_id, fecha_pago, metodo_pago, monto_total, items[]}` | Pago creado | Todos |
| GET | `/api/pagos-proveedores/:id` | - | Pago + items | Todos |
| PUT | `/api/pagos-proveedores/:id` | `{fecha_pago, metodo_pago, ...}` | Pago actualizado | Todos |
| DELETE | `/api/pagos-proveedores/:id` | - | Pago eliminado (revierte saldos) | Todos |
| GET | `/api/pagos-proveedores/cheques` | `?proveedor_id&estado&desde&hasta` | Cheques emitidos | Todos |
| GET | `/api/pagos-proveedores/cheques/:id` | - | Detalle de cheque | Todos |
| GET | `/api/pagos-proveedores/cheques/alertas` | `?dias=3` | Alertas de cheques próximos a vencer | Todos |
| POST | `/api/pagos-proveedores/cheques/:id/depositar` | `{fecha_depositado?}` | Cheque depositado | Todos |
| POST | `/api/pagos-proveedores/cheques/:id/rechazar` | `{motivo_rechazo, gasto_comision?, nuevo_cheque?}` | Cheque rechazado | Todos |
| PUT | `/api/pagos-proveedores/cheques/:id/acreditar` | - | Cheque acreditado | Todos |
| GET | `/api/pagos-proveedores/proveedor/:proveedor_id/facturas-pendientes` | - | Facturas pendientes | Todos |
| GET | `/api/pagos-proveedores/alertas/facturas-pendientes` | `?dias_vencimiento=7` | Alertas de facturas vencidas/por vencer | Todos |
| GET | `/api/pagos-proveedores/factura/:factura_id/historial` | - | Historial de pagos de una factura | Todos |
| GET | `/api/pagos-proveedores/busqueda/avanzada` | `?metodo_pago&fecha_desde&...` | Búsqueda avanzada con estadísticas | Todos |
| GET | `/api/pagos-proveedores/ordenes` | `?proveedor_id&fecha_desde&fecha_hasta&estado` | Órdenes de pago | Todos |
| POST | `/api/pagos-proveedores/ordenes` | `{proveedor_id, fecha, monto, motivo, ...}` | Orden de pago creada | Todos |
| GET | `/api/pagos-proveedores/ordenes/:id` | - | Orden de pago | Todos |
| PUT | `/api/pagos-proveedores/ordenes/:id/autorizar` | - | Orden autorizada | Todos |
| PUT | `/api/pagos-proveedores/ordenes/:id/cancelar` | `{motivo}` | Orden cancelada | Todos |
| POST | `/api/pagos-proveedores/ordenes/:id/generar-pago` | - | Genera pago desde orden autorizada | Todos |
| GET | `/api/pagos-proveedores/estado-cuenta/:proveedor_id` | - | Estado de cuenta completo | Todos |

### 4.10 Stock / Materias Primas (`/api/stock`, `/api/materias-primas`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/stock` | `?proveedor_id&estado&search` | Stock de materias primas | Todos |
| GET | `/api/materias-primas` | `?search&proveedor_id` | Materias primas | admin, control |
| POST | `/api/materias-primas` | `{codigo, nombre, unidad_medida, ...}` | Materia prima creada | admin, control |
| PUT | `/api/materias-primas/:id` | Campos a actualizar | Materia prima actualizada | admin, control |
| DELETE | `/api/materias-primas/:id` | - | Materia prima eliminada | admin |

### 4.11 Producción (`/api/produccion`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| POST | `/api/produccion` | `{ficha_id, cantidad, fecha_produccion?, observaciones?}` | Producción registrada | admin, operario, empleado |
| GET | `/api/produccion` | `?ficha_id&fecha_desde&fecha_hasta` | Listado de producción | admin, operario, empleado |
| GET | `/api/produccion/:id` | - | Detalle de producción | admin, operario, empleado |

### 4.12 Precios (`/api/precios`)

| Método | URL | Body/Query | Respuesta | Roles |
|--------|-----|------------|-----------|-------|
| GET | `/api/precios/actuales` | - | Precios actuales de todos los modelos | admin, control |
| POST | `/api/precios` | `{ficha_id, precio, fecha_desde}` | Nuevo precio | admin, control |
| GET | `/api/precios/historial/:ficha_id` | - | Historial de precios de un modelo | admin, control |

### 4.13 Reportes (`/api/reportes`, `/api/reportes-oc`)

| Método | URL | Descripción |
|--------|-----|-------------|
| GET | `/api/reportes` | Reportes generales |
| GET | `/api/reportes-oc` | Reportes de órdenes de compra |

### 4.14 Endpoints Auxiliares

| Método | URL | Descripción |
|--------|-----|-------------|
| GET | `/health` | Health check (público) |
| GET | `/test-db` | Prueba de conexión a BD |
| POST | `/test-login` | Diagnóstico de login |
| POST | `/reset-password-admin` | Resetear contraseña admin |
| GET | `/debug-paths` | Depuración de rutas en Railway |

---

## 5. Autenticación y Autorización

### JWT (JSON Web Token)
- **Secret**: `JWT_SECRET` en variables de entorno
- **Expiración**: 8 horas (`JWT_EXPIRES_IN=8h`)
- **Almacenamiento**: `localStorage` del navegador (clave `token`)
- **Envío**: Header `Authorization: Bearer <token>`

### Middleware `verificarToken` (`backend/middlewares/auth.js`)
1. Extrae token del header `Authorization`
2. Verifica con `jwt.verify(token, JWT_SECRET)`
3. Consulta BD para confirmar que el usuario existe y está activo
4. Adjunta `req.usuario = {id, nombre_usuario, rol}`
5. Responde 401 si: token no proporcionado, expirado, inválido, o usuario inactivo

### Middleware `authorize(rolesPermitidos)`
- Recibe array de roles permitidos: `['admin', 'control']`
- Verifica que `req.usuario.rol` esté incluido
- Responde 403 si no tiene permiso

### Roles del Sistema

| Rol | Acceso | Descripción |
|-----|--------|-------------|
| `admin` | Total | Acceso a todas las funcionalidades y gestión de usuarios |
| `control` | Operativo | Gestión de clientes, ventas, facturas, proveedores, stock |
| `operario` | Producción | Registro de producción, consulta de stock |
| `empleado` | Producción | Registro de producción (limitado) |

### Mapa de Roles por Página
| Página | Roles |
|--------|-------|
| Dashboard | admin, control |
| Fichas Técnicas | admin, control |
| Órdenes de Compra | admin, control |
| Ventas | admin, control |
| Clientes | admin, control |
| Proveedores | admin, control |
| Facturas | admin, control |
| Pagos | admin, control |
| Stock | admin, control |
| Reportes | admin, control |
| Producción | admin, operario, empleado |
| Usuarios | admin |
| Precios | admin |

---

## 6. Configuración del Entorno

### Variables de Entorno (`.env`)
```
# Base de datos
DATABASE_URL=postgresql://...
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres2026
DB_DATABASE=transformadores

# JWT
JWT_SECRET=secreto_temporal_para_pruebas#_cambiar_en_produccion
JWT_EXPIRES_IN=8h

# Servidor
PORT=3000
NODE_ENV=development

# Seguridad
CORS_ORIGIN=http://localhost:5500
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100

# Archivos
UPLOAD_PATH=uploads
MAX_FILE_SIZE=10485760  # 10MB
```

### Configuración de Seguridad (en `index.js`)
- **Helmet**: Configurado con CSP personalizada (permite CDNs de Font Awesome, Google Fonts, jsDelivr)
- **CORS**: Orígenes permitidos: localhost:5500-5502, localhost:3000, dominios *.railway.app
- **Rate Limiting**: 100 peticiones por ventana de 15 minutos (configurable)
- **JSON body limit**: 10MB

### Archivos Estáticos
- `/uploads` → `backend/uploads/` (archivos subidos)
- `/` (raíz) → `backend/public/` (frontend HTML)

---

## 7. Flujos de Negocio Principales

### 7.1 Venta a Cliente (OC → Venta → Factura → Pago)
```
1. Cliente emite Orden de Compra (OC)
   → Se registra en /api/ordenes-compra (POST)
   → Se agregan items (modelos + cantidades)

2. Se registra la Venta/Entrega
   → POST /api/ventas (vinculada a una OC)
   → Se agregan items con precio calculado (USD * tipo_cambio)
   → Se registra número de remito

3. Se emite Factura de Venta
   → POST /api/facturas
   → Calcula IVA 21% automáticamente
   → Crea factura_items desde venta_items

4. Cliente paga
   → Se registra en /api/pagos-clientes
   → Se aplica a facturas (aplicacion_pagos)
   → Soporta: transferencia, cheque, efectivo
```

### 7.2 Compra a Proveedor (Factura → Stock → Pago)
```
1. Se recibe Factura de Compra
   → POST /api/facturas-compra
   → Se registran items (materias primas)
   → Se actualiza stock automáticamente
   → Se actualiza precio de referencia de materias primas
   → Se registra en historial_precios_materias

2. Se gestiona el pago
   → POST /api/pagos-proveedores
   → Se aplica a una o varias facturas
   → Soporta: transferencia, cheque, efectivo
   → Los cheques pasan por estados: pendiente → depositado → acreditado/rechazado

3. Órdenes de Pago (opcional)
   → Se crea orden de pago
   → Se autoriza
   → Se genera el pago
```

### 7.3 Producción
```
1. Se registra producción de transformadores
   → POST /api/produccion
   → Se especifica ficha_id (modelo), cantidad, fecha
   → Se actualiza stock de productos terminados (stock_produccion)
```

### 7.4 Gestión de Precios
```
1. Precios de modelos (transformadores)
   → Se registran en precios_modelo con fecha_desde
   → El precio vigente es el último registrado
   → Se usa en ventas para calcular precio en pesos (USD * tipo_cambio)

2. Precios de materias primas
   → Se actualizan automáticamente al registrar facturas de compra
   → Se guarda historial en historial_precios_materias
   → Se puede actualizar manualmente desde /api/materias-primas
```

### 7.5 Manejo de Cheques y Endosos
```
1. Cheque propio (emitido a proveedor)
   → Se registra en pago_items con tipo='CHEQUE'
   → Estados: pendiente → depositado → acreditado / rechazado
   → Si se rechaza, se puede generar cheque de reemplazo

2. Cheque de cliente endosado a proveedor
   → Se registra en endosos_cheques
   → Se vincula al pago_item original del cliente
   → El proveedor aparece como beneficiario del endoso
```

---

## 8. Módulos Documentados vs Pendientes

### Ya Documentados
| Archivo | Contenido |
|---------|-----------|
| `docs/ESQUEMA_BD.md.txt` | Esquema completo de la base de datos |
| `docs/SISTEMA_FACTURAS_COMPRA.md` | Sistema de facturación de compras |
| `docs/SISTEMA_PAGOS_PROVEEDORES.md` | Sistema de pagos a proveedores |
| `docs/SISTEMA_PRECIOS_MATERIAS_PRIMAS.md` | Sistema de precios de materias primas |
| `docs/SistemadeFacturacióndeVentas.md` | Sistema de facturación de ventas |
| `docs/DOCUMENTACION_COMPLETA.md` | Este documento (documentación integral) |
| `docs/TROUBLESHOOTING_FACTURACION.md` | Troubleshooting de facturación de ventas (errores comunes y soluciones) |

### Pendientes de Documentar
| Módulo | Prioridad |
|--------|----------|
| Sistema de Stock (materias primas + productos terminados) | Alta |
| Sistema de Producción | Alta |
| Sistema de Clientes (cuenta corriente, estado financiero) | Alta |
| Sistema de Órdenes de Compra de Clientes | Alta |
| Sistema de Ventas (con remitos y facturación) | Alta |
| Sistema de Pagos de Clientes | Alta |
| Sistema de Notas de Crédito | Media |
| Sistema de Cheques y Endosos | Media |
| Sistema de Reportes | Media |
| Frontend React (en desarrollo) | Baja |

---

## 9. Scripts de Mantenimiento

Los scripts se encuentran en `backend/scripts/` y cubren las siguientes áreas:

### Migraciones y Creación de Tablas
| Script | Propósito |
|--------|-----------|
| `crear-tablas-facturas.sql` | Crear tablas de facturación de compras |
| `crear-tablas-pagos.sql` | Crear tablas de pagos a proveedores |
| `crear-tablas-simple.js` | Crear tablas básicas |
| `crear-factura-compra-items.sql` | Crear tabla de items de facturas de compra |
| `migrate.js` | Migración general de base de datos |
| `create-admin.js` | Crear usuario admin inicial |

### Verificación y Diagnóstico
| Script | Propósito |
|--------|-----------|
| `check-views.js` | Verificar vistas de base de datos |
| `check-stock-fk.js` | Verificar foreign keys de stock |
| `check-facturas-tables.js` | Verificar tablas de facturas |
| `check-proveedores-structure.js` | Verificar estructura de proveedores |
| `check-pagos-table.js` | Verificar tabla de pagos |
| `check-usuarios.js` | Verificar usuarios existentes |
| `check-stock-movimientos.js` | Verificar movimientos de stock |
| `check-historico-precios.js` | Verificar historial de precios |
| `diagnostico-facturas.js` | Diagnosticar problemas en facturas |
| `diagnostico-stock-facturas.js` | Diagnosticar stock vs facturas |
| `verificar-sistema-stock.js` | Verificar integridad del sistema de stock |
| `verificar-estructura-facturas.js` | Verificar estructura de tablas de facturas |

### Correcciones y Reparaciones
| Script | Propósito |
|--------|-----------|
| `fix-stock-system.js` | Corregir sistema de stock |
| `fix-stock-fk.js` | Corregir foreign keys de stock |
| `corregir-tablas-facturas.js` | Corregir tablas de facturas |
| `corregir-estado-facturas.js` | Corregir estados de facturas |
| `agregar-campos-facturas-compra.js` | Agregar campos faltantes a facturas de compra |
| `agregar-historial-pagos.js` | Agregar historial de pagos |
| `actualizar-precios-desde-facturas.js` | Actualizar precios desde facturas de compra |

### Tests
| Script | Propósito |
|--------|-----------|
| `test-sistema-precios.js` | Test del sistema de precios |
| `test-completo-sistema-precios.js` | Test completo de precios |
| `test-stock-factura.js` | Test de stock vs facturas |
| `test-sistema-precios.js` | Test de precios de materias primas |

### Documentación de Módulos
| Archivo | Contenido |
|---------|-----------|
| `documentacion-sistema-stock.md` | Documentación del sistema de stock |
| `capacitacion-equipo-stock.md` | Guía de capacitación para stock |

---

## 10. Instrucciones de Despliegue

### Desarrollo Local

```bash
# 1. Clonar repositorio
git clone <repo-url>
cd mi-proyecto

# 2. Instalar dependencias
cd backend
npm install

# 3. Configurar variables de entorno
# Editar backend/.env con datos de BD local

# 4. Inicializar base de datos
# Ejecutar scripts de migración en orden:
node scripts/create-admin.js
node scripts/migrate.js
# (ejecutar scripts SQL necesarios según módulos)

# 5. Iniciar servidor
npm run dev   # con nodemon (recarga automática)
# o
npm start     # producción

# 6. Acceder al frontend
# Abrir en navegador: http://localhost:3000
# (los archivos HTML están en backend/public/)
```

### Producción (Railway.app)

El proyecto está configurado para desplegarse en Railway.app:

1. Conectar repositorio a Railway
2. Configurar variables de entorno en Railway:
   - `DATABASE_URL` (proporcionada por Railway PostgreSQL)
   - `JWT_SECRET` (generar secreto seguro)
   - `NODE_ENV=production`
   - `CORS_ORIGIN=https://<dominio-railway>.railway.app`
3. Railway detecta automáticamente `npm start` desde `package.json`
4. El build command se configura como `npm install`

**Nota**: Railway no soporta archivos estáticos desde `backend/public/` de forma predeterminada. El servidor Express sirve estos archivos correctamente.

### Variables de Entorno Requeridas en Producción
```
DATABASE_URL=<postgresql-connection-string>
JWT_SECRET=<random-secure-string>
JWT_EXPIRES_IN=8h
PORT=3000
NODE_ENV=production
CORS_ORIGIN=<frontend-url>
```

---

## 11. Problemas Conocidos y Consideraciones

### Problemas Conocidos
1. **Puerto 3000 ocupado**: A veces el puerto 3000 queda ocupado después de cerrar el servidor. Usar `kill-port-3000.bat` para liberarlo.
2. **CORS en desarrollo**: Si se abre el HTML directamente (file://), las peticiones fetch fallarán por CORS. Usar Live Server (puerto 5500) o acceder via `http://localhost:3000`.
3. **Dos rutas de auth**: Existen `/api/auth` (auth.routes.js) y `/api/usuarios` (usuarios.routes.js) con funcionalidad superpuesta. La ruta `/api/usuarios` es la más completa y moderna.
4. **Dos versiones de proveedores.html**: Existe `proveedores.html` y `proveedores-nuevo.js` como versión mejorada. La versión final es `proveedores.html` con `js/proveedores.js`.
5. **Frontend React incompleto**: El proyecto `frontend-react/` está en etapa inicial y no funcional.
6. **Error 23503 al facturar ventas (FK incorrecta)**: La tabla `factura_items` tenía su foreign key `factura_id` apuntando a `facturas_compra` en lugar de `facturas`. Se corrigió con:
   ```sql
   ALTER TABLE factura_items DROP CONSTRAINT factura_items_nueva_factura_id_fkey;
   DELETE FROM factura_items WHERE id IN (SELECT fi.id FROM factura_items fi LEFT JOIN facturas f ON f.id = fi.factura_id WHERE f.id IS NULL);
   ALTER TABLE factura_items ADD CONSTRAINT factura_items_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE;
   ```
   Ver `docs/TROUBLESHOOTING_FACTURACION.md` para más detalles.

### Consideraciones de Seguridad
- El JWT_SECRET en `.env` es temporal y debe cambiarse en producción
- Las contraseñas se hashean con bcrypt (12 rondas)
- Los tokens expiran a las 8 horas
- Hay rate limiting configurado (100 req/15min)
- Helmet protege contra vulnerabilidades HTTP comunes
- CORS restringido a orígenes específicos

### Buenas Prácticas
- No commitear `.env` al repositorio
- No commitear `node_modules/`
- Usar migraciones para cambios de esquema
- Mantener los scripts de verificación actualizados
- Documentar los cambios en el esquema de BD

---

## 12. Frontend - Páginas y Funcionalidad

### Páginas del Sistema
| Página | Archivo | Funcionalidad |
|--------|---------|---------------|
| Login | `login.html` | Autenticación de usuarios |
| Dashboard | `dashboard.html` | Panel principal con resumen de datos |
| Fichas Técnicas | `ficha.html` | CRUD de modelos de transformadores |
| Órdenes de Compra | `oc.html`, `oc_detalle.html` | Gestión de OC de clientes |
| Ventas | `ventas.html`, `venta_detalle.html` | Registro de ventas/entregas |
| Clientes | `clientes.html` | CRUD de clientes + estado financiero |
| Proveedores | `proveedores.html` | CRUD de proveedores + cuenta corriente |
| Facturas Compra | `facturas-compra.html` | Facturación de compras |
| Pagos Proveedores | `pagos-proveedores.html` | Pagos a proveedores |
| Pagos Clientes | `pagos-clientes.html` | Pagos de clientes |
| Precios | `precios.html` | Gestión de precios de modelos |
| Producción | `produccion.html` | Registro de producción |
| Stock | `stock.html`, `stock-mp.html` | Control de stock |
| Usuarios | `usuarios.html` | Gestión de usuarios (solo admin) |
| Reportes | `reportes.html` | Reportes del sistema |
| Alertas Pagos | `alertas-pagos.html` | Alertas de vencimientos |
| Trazabilidad | `trazabilidad-pagos.html` | Trazabilidad de pagos |

### Scripts JS Compartidos
| Script | Propósito |
|--------|-----------|
| `js/api.js` | Funciones de API (fetch con token) |
| `js/auth.js` | Manejo de autenticación (login, logout, verificación) |
| `js/roleGuard.js` | Protección de páginas por rol |

---

## 13. Estructura de la API - Resumen

### Prefijos de Ruta
| Prefijo | Archivo de Rutas |
|---------|------------------|
| `/api/auth` | `routes/auth.routes.js` |
| `/api/usuarios` | `routes/usuarios.routes.js` |
| `/api/clientes` | `routes/clientes.routes.js` |
| `/api/proveedores` | `routes/proveedores.routes.js` |
| `/api/proveedores-extended` | `routes/proveedores-extended.routes.js` |
| `/api/ordenes-compra` | `routes/ordenesCompra.routes.js` |
| `/api/ventas` | `routes/ventas.routes.js` |
| `/api/facturas` | `routes/facturas.routes.js` |
| `/api/facturas-compra` | `routes/facturas-compra.routes.js` |
| `/api/pagos-proveedores` | `routes/pagos.routes.js` |
| `/api/pagos-clientes` | `routes/pagos-clientes.routes.js` |
| `/api/stock` | `routes/stock.routes.js` |
| `/api/stock-movimientos` | `routes/stock-movimientos.js` |
| `/api/stock-produccion` | `routes/stock-produccion.routes.js` |
| `/api/materias-primas` | `routes/materias-primas.routes.js` |
| `/api/produccion` | `routes/produccion.routes.js` |
| `/api/precios` | `routes/precios.routes.js` |
| `/api/ficha` | `routes/ficha.routes.js` |
| `/api/notas-credito` | `routes/notas_credito.routes.js` |
| `/api/reportes` | `routes/reportes.routes.js` |
| `/api/reportes-oc` | `routes/reportesOC.routes.js` |

### Total de Endpoints: ~100+
- Autenticación: 8 endpoints
- Usuarios: 9 endpoints
- Clientes: 8 endpoints
- Proveedores: 12 endpoints
- Órdenes de Compra: 5 endpoints
- Ventas: 7 endpoints
- Facturación Ventas: 2 endpoints
- Facturas Compra: 10 endpoints
- Pagos Proveedores: 22 endpoints
- Stock/Materias Primas: 5+ endpoints
- Producción: 3 endpoints
- Precios: 3 endpoints
- Reportes: 2+ endpoints
- Auxiliares: 5+ endpoints

---

*Documento generado el 29/05/2026*
*Última actualización: 29/05/2026*

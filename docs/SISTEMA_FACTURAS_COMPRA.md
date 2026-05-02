# Sistema de Facturas de Compra

## Descripción General
Sistema completo para la gestión de facturas de proveedores que permite:
- Cargar facturas físicas con datos ingresados manualmente
- Asociar facturas a proveedores previamente cargados
- Gestionar ítems de compra (materias primas)
- Actualizar automáticamente el stock de materias primas
- Mantener historial de precios
- Calcular IVA sobre el subtotal total de la factura

## Características Principales

### 1. **Carga de Facturas**
- **Proveedores**: Selección de proveedores existentes con autocompletado
- **Datos de Factura**:
  - Tipo de factura (A, B, C, X)
  - Punto de venta
  - Número de factura (formato: 0000-00000000)
  - CAE (Código de Autorización Electrónica)
  - Fechas de emisión y recepción
  - Condición de pago
  - Estado (Pendiente, Pagada, Anulada)
  - Percepciones y retenciones
  - Observaciones

### 2. **Gestión de Ítems**
- **Dos modos de carga**:
  1. **Búsqueda de materias primas existentes**: Trae automáticamente el último precio
  2. **Ítems manuales**: Permite crear nuevos ítems sin que existan previamente en el sistema

- **Datos por ítem**:
  - Código y nombre
  - Descripción
  - Cantidad (con soporte para decimales)
  - Unidad de medida (UNI, KG, LT)
  - Precio unitario
  - Porcentaje de IVA

### 3. **Cálculo de Totales**
- **IVA calculado sobre el subtotal total**: El IVA se aplica al subtotal total de la factura, no por ítem individual
- **Distribución proporcional**: El IVA total se distribuye proporcionalmente entre los ítems para mostrar en la tabla
- **Cálculos automáticos**:
  - Subtotal = Σ(cantidad × precio unitario)
  - IVA = subtotal × (porcentaje IVA / 100)
  - Total = subtotal + IVA + percepciones - retenciones

### 4. **Integración con Sistema Existente**
- **Actualización de stock**: Al guardar la factura, la cantidad de los ítems se suma al stock de materias primas
- **Historial de precios**: Se registra automáticamente cuando se actualiza el precio de referencia
- **Creación de materias primas**: Los ítems manuales pueden guardarse como nuevas materias primas

## Estructura de Archivos

### Frontend
- `frontend/facturas-compra.html` - Interfaz principal
- `frontend/js/facturas-compra.js` - Lógica de la interfaz
- `frontend/facturas-lista-simple.html` - Listado de facturas
- `frontend/js/facturas-lista-simple.js` - Lógica del listado

### Backend
- `backend/routes/facturas-compra.routes.js` - Rutas API
- `backend/routes/proveedores.routes.js` - Rutas de proveedores
- `backend/routes/materias-primas.routes.js` - Rutas de materias primas

## Funcionalidades Técnicas

### 1. **Último Precio Automático**
```javascript
// Al seleccionar una materia prima existente
async selectMateriaPrima(id) {
    // Obtiene el último precio de compra desde la API
    const response = await fetch(`/api/facturas-compra/materias-primas/${id}/ultimo-precio`);
    // Carga automáticamente en el formulario
}
```

### 2. **Cálculo de IVA Proporcional**
```javascript
calculateTotals() {
    // Calcular subtotal total
    let subtotal = this.items.reduce((sum, item) => sum + item.subtotal, 0);
    
    // Calcular IVA sobre el subtotal total
    const iva = subtotal * (ivaPorcentaje / 100);
    
    // Distribuir IVA proporcionalmente entre ítems
    this.items.forEach(item => {
        const proporcion = item.subtotal / subtotal;
        item.iva = iva * proporcion;
        item.total = item.subtotal + item.iva;
    });
}
```

### 3. **Gestión de Ítems Manuales**
```javascript
switchToManualMode() {
    // Configurar para ítem manual
    document.getElementById('item-es-manual').value = 'true';
    document.getElementById('item-guardar-materia').checked = true;
    
    // Generar código automático
    this.generateAutoCode();
}
```

### 4. **Transacciones en Backend**
```javascript
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Insertar cabecera de factura
        // 2. Procesar cada ítem
        // 3. Actualizar stock si corresponde
        // 4. Registrar en historial de precios si corresponde
        
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
});
```

## Flujo de Trabajo

### 1. **Carga de Factura**
```
1. Seleccionar proveedor → Se autocompletan datos
2. Completar datos de factura
3. Agregar ítems:
   a. Buscar materia prima existente (trae último precio)
   b. O crear ítem manual (se puede guardar como nueva materia prima)
4. Verificar totales (calculados automáticamente)
5. Guardar factura
```

### 2. **Procesamiento Automático al Guardar**
```
1. Validar datos de factura e ítems
2. Guardar cabecera de factura
3. Para cada ítem:
   a. Si es manual y se guarda como materia prima → crear nueva materia prima
   b. Si es existente y actualizar precio → actualizar precio y registrar en historial
   c. Si tiene materia_prima_id y factura activa → actualizar stock
4. Crear movimientos de stock
5. Retornar factura completa
```

## Validaciones

### Frontend
- Proveedor obligatorio
- Tipo de factura obligatorio
- Número de factura en formato correcto (0000-00000000)
- Al menos un ítem en la factura
- Cantidad y precio unitario mayores a 0
- Código y nombre obligatorios para ítems

### Backend
- Validación de tipo de factura (A, B, C, X)
- Validación de datos de ítems
- Control de transacciones (rollback en caso de error)
- Verificación de existencia de proveedor y materias primas

## API Endpoints

### Facturas de Compra
- `GET /api/facturas-compra` - Listar facturas
- `GET /api/facturas-compra/:id` - Obtener factura por ID
- `POST /api/facturas-compra` - Crear factura
- `PUT /api/facturas-compra/:id` - Actualizar factura
- `DELETE /api/facturas-compra/:id` - Eliminar factura
- `GET /api/facturas-compra/:id/items` - Obtener ítems de factura

### Utilidades
- `GET /api/facturas-compra/materias-primas/buscar` - Buscar materias primas
- `GET /api/facturas-compra/materias-primas/:id/ultimo-precio` - Obtener último precio

## Consideraciones de Seguridad
- Autenticación requerida para todas las rutas
- Autorización por roles (admin, control, compras)
- Validación de datos en frontend y backend
- Transacciones atómicas en base de datos

## Mejoras Futuras
1. **Importación masiva** desde archivos Excel/CSV
2. **Integración con AFIP** para validación automática de facturas
3. **Notificaciones** por email para facturas próximas a vencer
4. **Reportes avanzados** de compras por proveedor/período
5. **Conciliación automática** con pagos

## Solución de Problemas Comunes

### 1. **Error en cálculo de IVA**
- Verificar que el IVA se calcule sobre el subtotal total
- Confirmar que la distribución proporcional sea correcta

### 2. **Stock no se actualiza**
- Verificar que la factura esté en estado "PENDIENTE" o "PAGADA"
- Confirmar que los ítems tengan `materia_prima_id`

### 3. **Último precio no se carga**
- Verificar conexión con la API
- Confirmar que la materia prima tenga precio de referencia

### 4. **Error al guardar ítem manual**
- Verificar que el código no exista previamente
- Confirmar permisos para crear nuevas materias primas

## Conclusión
El sistema de facturas de compra proporciona una solución completa para la gestión de compras a proveedores, integrada perfectamente con el sistema existente de materias primas y stock. La implementación considera todos los requerimientos del negocio, incluyendo el cálculo correcto de IVA, actualización automática de stock y mantenimiento del historial de precios.
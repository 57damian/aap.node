# 📋 DOCUMENTACIÓN DEL SISTEMA DE STOCK

## 🎯 OBJETIVO
Clarificar la diferencia entre los dos tipos de stock en el sistema:
1. **Stock de Materias Primas** (Compras)
2. **Stock de Producción** (Modelos producidos)

## 📊 ESTRUCTURA ACTUAL

### 1. STOCK DE MATERIAS PRIMAS (COMPRAS)
**Tablas principales:**
- `materias_primas` - Catálogo de materias primas
- `facturas_compra` - Facturas de compra
- `factura_items` - Items de facturas
- `stock_movimientos` - Movimientos de stock
- `historial_precios_materias` - Historial de precios

**Flujo de trabajo:**
1. Proveedor → Factura de compra → Entrada de stock
2. Stock disponible para producción
3. Salida de stock cuando se usa en producción

### 2. STOCK DE PRODUCCIÓN (MODELOS)
**Tablas principales:**
- `produccion` - Registros de producción
- `produccion_items` - Items de producción
- `stock_produccion` - Stock de modelos terminados
- `stock_produccion_movimientos` - Movimientos de stock de producción

**Flujo de trabajo:**
1. Producción → Modelos terminados → Entrada de stock
2. Stock disponible para ventas
3. Salida de stock cuando se vende

## 🔧 CORRECCIONES IMPLEMENTADAS

### 1. CORRECCIÓN DE NOMENCLATURA
- **ANTES:** `articulos_proveedor`, `stock_articulos`, `movimientos_stock`, `historial_precios_articulos`
- **DESPUÉS:** `materias_primas`, `stock_movimientos`, `historial_precios_materias`

### 2. CORRECCIÓN DE RUTAS
Archivo `backend/routes/facturas-compra.routes.js`:
- Cambiado `articulo_id` → `materia_prima_id`
- Cambiado `articulos_proveedor` → `materias_primas`
- Cambiado `stock_articulos` → `materias_primas`
- Cambiado `movimientos_stock` → `stock_movimientos`
- Cambiado `historial_precios_articulos` → `historial_precios_materias`

### 3. VISTA DE STOCK DE PRODUCCIÓN
Creada vista `stock_produccion_view` que muestra:
- Modelos producidos
- Stock disponible
- Movimientos recientes
- Historial de producción

## 📱 FRONTEND - CLARIFICACIÓN

### 1. PÁGINAS SEPARADAS
- **`stock-mp.html`** - Stock de Materias Primas (Compras)
- **`stock.html`** - Stock de Producción (Modelos)

### 2. ETIQUETAS CLARAS
Cada página debe mostrar claramente:
- **Stock MP:** "MATERIAS PRIMAS - Stock de compras"
- **Stock Producción:** "MODELOS PRODUCIDOS - Stock de producción"

### 3. COLORES DIFERENTES
- **Materias Primas:** Color azul/verde
- **Producción:** Color naranja/morado

## 🚀 GUÍA DE USO

### PARA EL EQUIPO DE COMPRAS:
1. Ir a **Stock MP** para ver materias primas
2. Registrar facturas de compra
3. Ver stock disponible para producción
4. Revisar historial de precios

### PARA EL EQUIPO DE PRODUCCIÓN:
1. Ir a **Stock Producción** para ver modelos
2. Registrar producción de modelos
3. Ver stock disponible para ventas
4. Revisar historial de producción

### PARA EL EQUIPO DE VENTAS:
1. Ir a **Stock Producción** para ver modelos disponibles
2. Usar stock de producción para ventas
3. No usar stock de materias primas

## ⚠️ ERRORES COMUNES A EVITAR

### 1. CONFUSIÓN DE STOCK
- ❌ **ERROR:** Usar stock de materias primas para ventas
- ✅ **CORRECTO:** Usar stock de producción para ventas

### 2. CONFUSIÓN DE NOMENCLATURA
- ❌ **ERROR:** Llamar "artículos" a las materias primas
- ✅ **CORRECTO:** "Materias primas" para compras, "Modelos" para producción

### 3. CONFUSIÓN DE PÁGINAS
- ❌ **ERROR:** Ir a Stock MP para ver modelos
- ✅ **CORRECTO:** Ir a Stock Producción para ver modelos

## 🔍 VERIFICACIÓN DEL SISTEMA

### Scripts disponibles:
1. `verificar-sistema-stock.js` - Verifica estado completo
2. `corregir-tablas-facturas.js` - Corrige tablas de facturas
3. `fix-stock-system.js` - Corrige sistema de stock

### Comandos útiles:
```bash
# Verificar sistema completo
node scripts/verificar-sistema-stock.js

# Corregir tablas de facturas
node scripts/corregir-tablas-facturas.js

# Corregir sistema de stock
node scripts/fix-stock-system.js
```

## 📞 SOPORTE

### Problemas comunes y soluciones:

1. **"No veo los modelos en stock"**
   - Verificar que estás en `stock.html` (producción)
   - Verificar que hay producción registrada

2. **"No veo las materias primas"**
   - Verificar que estás en `stock-mp.html` (compras)
   - Verificar que hay facturas de compra registradas

3. **"Error al registrar factura"**
   - Verificar que las materias primas existen
   - Verificar que el proveedor existe
   - Ejecutar script de corrección

4. **"Error al registrar producción"**
   - Verificar que hay stock de materias primas
   - Verificar que el modelo existe
   - Verificar permisos de usuario

## 🎯 RESUMEN

### Sistema funcionando correctamente:
- ✅ Tablas principales creadas
- ✅ Relaciones establecidas
- ✅ Rutas corregidas
- ✅ Vistas implementadas
- ✅ Frontend separado

### Próximos pasos:
1. Capacitar al equipo en la diferencia de stocks
2. Actualizar manuales de procedimiento
3. Monitorear uso durante primera semana
4. Realizar ajustes según feedback

---

**Última actualización:** 08/03/2026  
**Responsable:** Sistema de Gestión  
**Estado:** ✅ FUNCIONANDO
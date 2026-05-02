# 📚 CAPACITACIÓN DEL EQUIPO - SISTEMA DE STOCK

## 🎯 OBJETIVO DE LA CAPACITACIÓN
Capacitar al equipo en la correcta diferenciación y uso de los dos sistemas de stock:
1. **Stock de Materias Primas** (Compras)
2. **Stock de Producción** (Modelos)

## 👥 EQUIPOS INVOLUCRADOS

### 1. EQUIPO DE COMPRAS
- Responsable: Compras de materias primas
- Herramientas: `stock-mp.html`, `facturas-compras.html`
- Objetivo: Mantener stock de insumos para producción

### 2. EQUIPO DE PRODUCCIÓN
- Responsable: Fabricación de modelos
- Herramientas: `produccion.html`, `stock.html`
- Objetivo: Transformar materias primas en modelos terminados

### 3. EQUIPO DE VENTAS
- Responsable: Venta de modelos
- Herramientas: `stock.html`, `ventas.html`
- Objetivo: Vender stock de producción disponible

## 📋 GUÍA PASO A PASO

### PASO 1: IDENTIFICAR QUÉ STOCK NECESITAS

**Pregúntate:**
- ¿Necesito **materias primas** para producir? → **Stock MP**
- ¿Necesito **modelos terminados** para vender? → **Stock Producción**

### PASO 2: ACCEDER A LA PÁGINA CORRECTA

#### Para Materias Primas (Compras):
```
Dashboard → "Materias Primas" (botón azul)
O directamente: http://localhost:3000/stock-mp.html
```

#### Para Producción (Modelos):
```
Dashboard → "Stock" (botón naranja)
O directamente: http://localhost:3000/stock.html
```

### PASO 3: DIFERENCIAS VISUALES

#### Stock de Materias Primas:
- **Color:** Azul/Verde
- **Icono:** 📦 (caja)
- **Título:** "MATERIAS PRIMAS - Stock de compras"
- **Botón:** "Ir a Stock de Producción"

#### Stock de Producción:
- **Color:** Naranja/Morado
- **Icono:** 🏭 (fábrica)
- **Título:** "MODELOS PRODUCIDOS - Stock de producción"
- **Botón:** "Ir a Stock de Materias Primas"

## 🔄 FLUJOS DE TRABAJO

### FLUJO 1: COMPRA DE MATERIAS PRIMAS
1. Proveedor envía factura
2. **Equipo de Compras:** Registra factura en `facturas-compras.html`
3. Sistema actualiza automáticamente stock en `stock-mp.html`
4. Materias primas disponibles para producción

### FLUJO 2: PRODUCCIÓN DE MODELOS
1. **Equipo de Producción:** Registra producción en `produccion.html`
2. Sistema consume materias primas de `stock-mp.html`
3. Sistema genera modelos terminados en `stock.html`
4. Modelos disponibles para venta

### FLUJO 3: VENTA DE MODELOS
1. Cliente solicita modelo
2. **Equipo de Ventas:** Verifica disponibilidad en `stock.html`
3. Registra venta en `ventas.html`
4. Sistema reduce stock en `stock.html`

## ⚠️ ERRORES COMUNES Y SOLUCIONES

### ERROR 1: "No veo los modelos que produje"
**Causa:** Estás en `stock-mp.html` en lugar de `stock.html`
**Solución:** Ir a `stock.html` (Stock de Producción)

### ERROR 2: "No puedo registrar factura de compra"
**Causa:** La materia prima no existe en el catálogo
**Solución:** Primero crear la materia prima en `stock-mp.html`

### ERROR 3: "No tengo materias primas para producir"
**Causa:** Stock insuficiente en `stock-mp.html`
**Solución:** Comprar más materias primas o ajustar producción

### ERROR 4: "Confundo los precios"
**Causa:** Precios de materias primas vs precios de modelos
**Solución:**
- Materias primas: Precio de compra (en `stock-mp.html`)
- Modelos: Precio de venta (en `stock.html`)

## 🎮 EJERCICIOS PRÁCTICOS

### EJERCICIO 1: COMPRA DE MATERIAS PRIMAS
1. Crear nueva materia prima: "Cobre 2.5mm"
2. Registrar factura de compra: 100kg a $5000/kg
3. Verificar stock en `stock-mp.html`

### EJERCICIO 2: PRODUCCIÓN DE MODELOS
1. Ir a `produccion.html`
2. Registrar producción: Modelo "Transformador 10KVA"
3. Usar 50kg de "Cobre 2.5mm"
4. Verificar stock resultante en `stock.html`

### EJERCICIO 3: VENTA DE MODELOS
1. Ir a `stock.html`
2. Verificar disponibilidad de "Transformador 10KVA"
3. Ir a `ventas.html`
4. Registrar venta de 1 unidad

## 📊 INDICADORES CLAVE

### Para Materias Primas:
- **Stock disponible:** Cantidad actual
- **Stock mínimo:** Punto de reorden
- **Último precio:** Precio de compra más reciente
- **Proveedor:** Quién suministra

### Para Producción:
- **Modelos disponibles:** Cantidad para venta
- **Fecha producción:** Cuándo se fabricó
- **Costo producción:** Costo de materiales + mano de obra
- **Precio venta:** Precio al cliente

## 🔧 HERRAMIENTAS DE SOPORTE

### Scripts de verificación:
```bash
# Verificar estado del sistema
node scripts/verificar-sistema-stock.js

# Corregir problemas
node scripts/fix-stock-system.js
```

### Documentación:
- `documentacion-sistema-stock.md` - Documentación completa
- Esta guía de capacitación

### Contacto soporte:
- **Equipo técnico:** Para problemas técnicos
- **Administrador:** Para permisos y configuración
- **Capacitador:** Para dudas de uso

## 📝 EVALUACIÓN DE CONOCIMIENTOS

### Preguntas de evaluación:
1. ¿Dónde veo el stock de alambre para producir?
2. ¿Dónde veo los transformadores disponibles para vender?
3. ¿Qué página uso para registrar una factura de compra?
4. ¿Qué página uso para registrar producción?
5. ¿Cómo sé si necesito comprar más materias primas?

### Respuestas correctas:
1. `stock-mp.html` (Materias Primas)
2. `stock.html` (Producción)
3. `facturas-compras.html`
4. `produccion.html`
5. Revisando `stock-mp.html` y comparando con stock mínimo

## 🎯 RESUMEN FINAL

### Reglas de oro:
1. **Materias primas** → `stock-mp.html` (COMPRAS)
2. **Modelos terminados** → `stock.html` (PRODUCCIÓN)
3. **Facturas** → `facturas-compras.html`
4. **Producción** → `produccion.html`
5. **Ventas** → `ventas.html`

### Beneficios del sistema:
- ✅ Claridad total entre stocks
- ✅ Seguimiento completo de materiales
- ✅ Control de costos y precios
- ✅ Mejora en la planificación
- ✅ Reducción de errores

---

**Fecha capacitación:** 08/03/2026  
**Duración:** 1 hora  
**Materiales:** Esta guía + sistema en vivo  
**Evaluación:** Prueba práctica al finalizar  

**¡El éxito del sistema depende del uso correcto por parte de todo el equipo!**
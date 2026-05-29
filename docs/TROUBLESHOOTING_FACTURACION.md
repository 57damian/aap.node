# Troubleshooting - Facturación de Ventas

## Error 1: "Datos incompletos" al facturar

**Síntoma**: Al hacer clic en "Facturar" en el modal de facturación, aparece el error `Datos incompletos`.

**Causas posibles**:
1. El frontend no envía `venta_id`, `numero_factura`, `tipo_factura` o `fecha`.
2. El modal no se abrió correctamente o el usuario no completó todos los campos.

**Solución**:
- Verificar que el modal de facturación muestre todos los campos requeridos.
- Revisar la consola del servidor para ver el log `📥 Body recibido en facturación:`.

---

## Error 2: "Días de crédito inválido"

**Síntoma**: Error al facturar si el campo "días de crédito" está vacío o contiene un valor no numérico.

**Causa**: El frontend envía `dias_credito` como string vacío (`""`) o `null` cuando el usuario no completa el campo.

**Solución en backend** (`backend/routes/facturas.routes.js`):
```javascript
// Normalizar días de crédito: si es null, undefined o string vacío → 0
const diasCredito = (dias_credito === undefined || dias_credito === null || dias_credito === '') 
                    ? 0 
                    : Number(dias_credito);

if (isNaN(diasCredito) || diasCredito < 0) {
  throw new Error('Días de crédito inválido');
}
```

**Ver logs**: Buscar en la consola del servidor:
```
📥 Body recibido en facturación: { venta_id: 81, ..., dias_credito: '' }
🔍 dias_credito (original):  tipo: string
✅ diasCredito (normalizado): 0 tipo: number
```

---

## Error 3: Error 23503 - Foreign key violation

**Síntoma**: Al intentar facturar una venta, se obtiene un error 400 con mensaje similar a:
```
inserción o actualización en la tabla «factura_items» viola la llave foránea 
«factura_items_nueva_factura_id_fkey». 
La llave (factura_id)=(X) no está presente en la tabla «facturas_compra».
```

**Causa raíz**: La tabla `factura_items` tenía su foreign key `factura_id` apuntando erróneamente a `facturas_compra` en lugar de `facturas`. Esto ocurría porque al crear las tablas se usó un nombre de constraint genérico que apuntaba a la tabla incorrecta.

### Verificar el estado actual

Ejecutar en PostgreSQL:
```sql
SELECT
  tc.constraint_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.constraint_column_usage AS ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name = 'factura_items' AND tc.constraint_type = 'FOREIGN KEY';
```

**Resultado esperado** (después de la corrección):
| constraint_name | foreign_table | foreign_column |
|---|---|---|
| `factura_items_factura_id_fkey` | **facturas** | id |
| `factura_items_venta_item_id_fkey` | venta_items | id |
| `factura_items_ficha_id_fkey` | ficha_transformador | id |
| `factura_items_nueva_materia_prima_id_fkey` | materias_primas | id |

**Resultado incorrecto** (antes de la corrección):
| constraint_name | foreign_table |
|---|---|
| `factura_items_nueva_factura_id_fkey` | **facturas_compra** | ← INCORRECTO |

### Solución aplicada

```sql
-- 1. Eliminar la FK incorrecta
ALTER TABLE factura_items DROP CONSTRAINT factura_items_nueva_factura_id_fkey;

-- 2. Eliminar registros huérfanos (si los hay)
DELETE FROM factura_items 
WHERE id IN (
  SELECT fi.id 
  FROM factura_items fi 
  LEFT JOIN facturas f ON f.id = fi.factura_id 
  WHERE f.id IS NULL
);

-- 3. Crear la FK correcta apuntando a facturas(id)
ALTER TABLE factura_items 
  ADD CONSTRAINT factura_items_factura_id_fkey 
  FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE;
```

---

## Error 4: "La venta ya fue facturada"

**Síntoma**: Al intentar facturar una venta que ya tiene items facturados.

**Causa**: El sistema verifica que ningún `venta_item_id` esté ya registrado en `factura_items`. Si alguno existe, rechaza la operación.

**Solución**: 
- Si la factura anterior fue exitosa, consultarla con `GET /api/facturas/venta/:venta_id`.
- Si la factura anterior falló pero dejó items huérfanos, eliminarlos de `factura_items` (ver Error 3).

---

## Error 5: NULL en precio_unitario al insertar factura_items

**Síntoma**: Error al insertar en `factura_items` porque `precio_unitario` es `NULL`.

**Causa**: El campo `precio_unitario_pesos` en `venta_items` podría ser `NULL` para algún item.

**Solución**: En `facturas.routes.js`, asegurar que se use `item.precio_unitario_pesos` y que ese campo tenga valor. Agregar validación antes del INSERT:

```javascript
if (item.precio_unitario_pesos === null || item.precio_unitario_pesos === undefined) {
  throw new Error(`El item ${item.id} no tiene precio unitario definido`);
}
```

---

## Nota sobre `dias_credito`

El frontend actualmente envía `dias_credito` como string vacío si el usuario no lo completa. El backend convierte `""` a `0` para cumplir con la restricción `NOT NULL` de la tabla `facturas`.

Si se desea un valor por defecto distinto (ej: 30 días), modificar la normalización en `facturas.routes.js`:

```javascript
const DIAS_CREDITO_DEFAULT = 30;
const diasCredito = (dias_credito === undefined || dias_credito === null || dias_credito === '') 
                    ? DIAS_CREDITO_DEFAULT 
                    : Number(dias_credito);
```

---

## Logs típicos en consola del servidor

### Facturación exitosa
```
📥 Body recibido en facturación: { venta_id: 81, numero_factura: '0001-00001234', tipo_factura: 'A', fecha: '2026-05-29', dias_credito: '' }
🔍 dias_credito (original):  tipo: string
✅ diasCredito (normalizado): 0 tipo: number
Item a insertar: { factura_id: 20, venta_item_id: 10, ficha_id: 5, cantidad: 2, precio_unitario_pesos: 150000, sub: 300000, ivaItem: 63000, tot: 363000 }
```

### Facturación con error (FK incorrecta)
```
📥 Body recibido en facturación: { venta_id: 81, ... }
🔍 dias_credito (original): 0 tipo: number
✅ diasCredito (normalizado): 0 tipo: number
Error creando factura: error: inserción o actualización en la tabla «factura_items» viola la llave foránea «factura_items_nueva_factura_id_fkey»
```

---

*Documento generado el 29/05/2026*

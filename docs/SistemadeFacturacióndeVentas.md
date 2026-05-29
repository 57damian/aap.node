
# Sistema de Facturación de Ventas

## 📌 Propósito
Permite generar facturas (A, B, C) a partir de una venta ya registrada.  
La factura se asocia a la venta y a sus ítems, calcula automáticamente el subtotal, IVA y total, y registra el número de factura, tipo, fecha y días de crédito.

## 🔗 Relaciones clave
- `facturas` → tabla cabecera de factura (venta al cliente)
- `factura_items` → detalle de cada ítem facturado (relacionado con `venta_items`)
- `ventas` → tabla de entregas/remitos
- `venta_items` → ítems entregados (con precios en USD y pesos)
- `ficha_transformador` → modelo del producto

### Diagrama de flujo
Venta (ventas) → Botón "Facturar" → Modal con datos de factura → POST /api/facturas
↓
Backend:

Verifica datos obligatorios (venta_id, número, tipo, fecha)

Obtiene ítems de la venta (venta_items)

Calcula subtotal, IVA (desde parámetro iva_general), total

Inserta cabecera en facturas

Inserta cada ítem en factura_items (con precio_unitario, subtotal, iva, total)

COMMIT

text

## 🗄️ Estructura de tablas relevante

### `facturas`
| Columna | Tipo | Nulo | Notas |
|---------|------|------|-------|
| id | serial | NO | PK |
| cliente_id | int | NO | FK → clientes(id) |
| numero_factura | varchar | NO | Debe ser único |
| tipo_factura | varchar | NO | 'A', 'B', 'C' |
| fecha | date | NO | |
| dias_credito | int | NO | Default 0 |
| subtotal_sin_iva | numeric | NO | |
| iva_21 | numeric | NO | Monto de IVA |
| total | numeric | NO | |

### `factura_items`
| Columna | Tipo | Nulo | Notas |
|---------|------|------|-------|
| id | serial | NO | PK |
| factura_id | int | NO | FK → facturas(id) |
| venta_item_id | int | YES | FK → venta_items(id) |
| ficha_id | int | YES | FK → ficha_transformador(id) |
| cantidad | numeric | NO | |
| precio_unitario | numeric | NO | Precio en pesos (sin IVA) |
| subtotal | numeric | NO | Cantidad * precio_unitario |
| iva | numeric | NO | IVA calculado sobre subtotal |
| total | numeric | NO | subtotal + iva |

> ⚠️ **Importante**: La columna `iva` (sin `_21`) y `precio_unitario` (no `precio_unitario_sin_iva`) son las que se usan actualmente.

## ⚙️ Endpoint principal

### `POST /api/facturas`
**Autenticación requerida**: roles `admin`, `control`  
**Body esperado**:
```json
{
  "venta_id": 82,
  "numero_factura": "0001-00001234",
  "tipo_factura": "A",
  "fecha": "2026-05-29",
  "dias_credito": 0  // opcional, se normaliza a 0 si falta
}
Respuesta exitosa (201): objeto de la factura creada.

🧪 Validaciones internas
Datos obligatorios: venta_id, numero_factura, tipo_factura, fecha. Si falta alguno → 400 Datos incompletos.

Venta existe: Se bloquea con FOR UPDATE.

Items de venta: Debe haber al menos uno.

No duplicados: Verifica que los venta_item_id no estén ya en factura_items.

Cálculo de IVA: Se obtiene de parametros clave iva_general (ej. 21 → 0.21). Si no existe, usa 0.21.

Normalización de dias_credito: si el campo es null, undefined o '', se asigna 0. Si es un número negativo o NaN → error.

🔧 Cambios recientes (importantes para mantener contexto)
Fecha	Cambio	Motivo
29/05/2026	Se cambió columna iva_21 por iva en INSERT de factura_items	La tabla no tenía iva_21, solo iva
29/05/2026	Se cambió columna precio_unitario_sin_iva por precio_unitario en INSERT	La tabla exige NOT NULL en precio_unitario
29/05/2026	Se corrigió foreign key de factura_items para que apunte a facturas(id) y no a facturas_compra(id)	Evita error 23503 al insertar items
29/05/2026	Se agregó normalización de dias_credito a 0 cuando no se envía o es nulo	Evita error de NOT NULL en la tabla facturas
🚨 Errores comunes y soluciones
1. Datos incompletos (400)
Causa: Falta venta_id, numero_factura, tipo_factura o fecha en el body.
Solución: Revisar que el frontend envíe todos los campos, especialmente desde el listado de ventas (falta el modal).
Acción preventiva: Implementar modal de facturación también en ventas.html o redirigir a venta_detalle.html.

2. el valor nulo en la columna «precio_unitario» viola la restricción de no nulo
Causa: El INSERT en factura_items no incluye precio_unitario o el valor es undefined.
Solución: Asegurar que se envíe item.precio_unitario_pesos (desde venta_items). En nuestro código ya está corregido.

3. La llave (factura_id)=(X) no está presente en la tabla «facturas_compra»
Causa: Foreign key incorrecta apuntando a facturas_compra.
Solución: Ejecutar:

sql
ALTER TABLE factura_items DROP CONSTRAINT factura_items_nueva_factura_id_fkey;
ALTER TABLE factura_items ADD CONSTRAINT factura_items_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE;
4. dias_credito nulo al insertar en facturas
Causa: El campo dias_credito se envía como null o vacío y la columna es NOT NULL.
Solución: Ya se normaliza a 0 en el backend (ver código en facturas.routes.js).

🧩 Código fuente clave
Archivo: backend/routes/facturas.routes.js

Fragmento de normalización de dias_credito
javascript
const {
  venta_id,
  numero_factura,
  tipo_factura,
  fecha,
  dias_credito
} = req.body;

const diasCredito = (dias_credito === undefined || dias_credito === null || dias_credito === '') 
                    ? 0 
                    : Number(dias_credito);
Fragmento de inserción de items (corregido)
javascript
await client.query(
  `INSERT INTO factura_items
   (factura_id, venta_item_id, ficha_id,
    cantidad, precio_unitario,
    subtotal, iva, total)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [
    factura.id,
    item.id,
    item.ficha_id,
    item.cantidad,
    item.precio_unitario_pesos,
    item.sub,
    item.ivaItem,
    item.tot
  ]
);
📎 Dependencias del sistema
Parámetro iva_general en tabla parametros (clave, valor). Si no existe, se usa 0.21.

Ventas deben tener tipo_cambio y venta_items con precio_unitario_pesos.

Modelos (ficha_transformador) deben tener precios asociados en precios_modelo.

🧪 Prueba manual recomendada
Crear una venta con ítems (desde OC).

Ir a venta_detalle.html?id=XX.

Hacer clic en "Facturar".

Completar número, tipo, fecha (días crédito opcional).

Confirmar.

Verificar en base de datos que se creó la factura y sus items.

Volver al listado de ventas y comprobar que aparece el número de factura.

📝 Mantenimiento de este documento
Actualizar cada vez que se modifique la lógica de facturación.

Registrar aquí cualquier cambio en la estructura de tablas.

Agregar nuevos errores detectados y sus soluciones.

Última actualización: 29 de mayo de 2026
Responsable: Equipo de desarrollo
Versión: 1.0

text

---

## ✅ Cómo guardar este archivo en tu proyecto

1. Abre tu editor (VS Code, etc.).
2. Crea la carpeta `docs` dentro de `backend` (si no existe):
   ```bash
   mkdir backend/docs
Crea un nuevo archivo llamado SISTEMA_FACTURACION_VENTAS.md dentro de backend/docs/.

Copia todo el contenido que te di y pégalo.

Guarda el archivo.
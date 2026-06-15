# SISTEMA DE PAGOS DE CLIENTES (Versión Simplificada)

## Resumen de cambios

Se eliminaron las tablas redundantes `recibos`, `recibo_pagos` y `talonarios`.  
El flujo ahora es **unificado**: al crear un pago se aplica directamente a las facturas seleccionadas.

## Estructura de tablas

### pagos
| Columna           | Tipo          | Descripción                              |
|-------------------|---------------|------------------------------------------|
| id                | SERIAL PK     | ID del pago                              |
| cliente_id        | INT FK        | Cliente que realizó el pago              |
| fecha_recepcion   | DATE          | Fecha en que se recibió el pago          |
| monto_total       | DECIMAL(12,2) | Suma de todos los items del pago         |
| estado            | VARCHAR(20)   | `pendiente`, `parcial` o `aplicado`      |
| numero_talonario  | VARCHAR(50)   | Número de talonario (opcional)           |
| observaciones     | TEXT          | Observaciones                            |
| created_at        | TIMESTAMP     | Fecha de creación                        |

### pago_items
| Columna                      | Tipo          | Descripción                          |
|------------------------------|---------------|--------------------------------------|
| id                           | SERIAL PK     | ID del item                          |
| pago_id                      | INT FK        | Pago al que pertenece                |
| tipo                         | VARCHAR(20)   | `EFECTIVO`, `CHEQUE`, `TRANSFERENCIA`|
| monto                        | DECIMAL(12,2) | Monto del item                       |
| cheque_numero                | VARCHAR(50)   | Número de cheque                     |
| cheque_banco                 | VARCHAR(100)  | Banco del cheque                     |
| cheque_fecha_emision         | DATE          | Fecha de emisión del cheque          |
| cheque_fecha_cobro           | DATE          | Fecha de cobro del cheque            |
| transferencia_banco_origen   | VARCHAR(100)  | Banco origen de la transferencia     |
| transferencia_banco_destino  | VARCHAR(100)  | Banco destino de la transferencia    |
| transferencia_numero_operacion| VARCHAR(100) | Número de operación                  |
| transferencia_fecha          | DATE          | Fecha de la transferencia            |
| observaciones                | TEXT          | Observaciones del item               |

### cheques_propios
| Columna              | Tipo          | Descripción                                    |
|----------------------|---------------|------------------------------------------------|
| id                   | SERIAL PK     | ID del cheque                                  |
| pago_item_id         | INT FK        | Item de pago asociado                          |
| numero_cheque        | VARCHAR(50)   | Número de cheque                               |
| banco                | VARCHAR(100)  | Banco                                          |
| fecha_emision        | DATE          | Fecha de emisión                               |
| fecha_cobro          | DATE          | Fecha de cobro                                 |
| monto                | DECIMAL(12,2) | Monto                                          |
| estado               | VARCHAR(20)   | `pendiente`, `depositado`, `acreditado`, `rechazado` |
| fecha_depositado     | DATE          | Fecha de depósito                              |
| fecha_acreditado     | DATE          | Fecha de acreditación                          |
| fecha_rechazo        | DATE          | Fecha de rechazo                               |
| motivo_rechazo       | TEXT          | Motivo del rechazo                             |
| gasto_comision       | DECIMAL(12,2) | Gasto por comisión                             |
| es_reemplazo         | BOOLEAN       | Indica si es un cheque de reemplazo            |
| cheque_reemplazado_id| INT FK        | ID del cheque reemplazado (self-ref)           |
| created_at           | TIMESTAMP     | Fecha de creación                              |

### aplicacion_pagos
| Columna          | Tipo          | Descripción                          |
|------------------|---------------|--------------------------------------|
| id               | SERIAL PK     | ID de la aplicación                  |
| pago_id          | INT FK        | Pago aplicado                        |
| factura_id       | INT FK        | Factura a la que se aplicó           |
| monto_aplicado   | DECIMAL(12,2) | Monto aplicado a la factura          |
| fecha_aplicacion | TIMESTAMP     | Fecha y hora de la aplicación        |

## API Endpoints

### Pagos

| Método | Ruta                                    | Descripción                                      |
|--------|-----------------------------------------|--------------------------------------------------|
| POST   | `/api/pagos-clientes/pagos`             | Crear pago + aplicar a facturas (flujo unificado)|
| POST   | `/api/pagos-clientes/pagos/:id/aplicar` | Aplicar saldo restante de un pago parcial        |
| GET    | `/api/pagos-clientes/pagos`             | Listar pagos (filtros: cliente_id, desde, hasta, estado) |
| GET    | `/api/pagos-clientes/pagos/:id`         | Detalle básico de un pago                        |
| GET    | `/api/pagos-clientes/pagos/:id/trazabilidad` | Trazabilidad completa del pago              |

### Facturas / Clientes

| Método | Ruta                                                    | Descripción                          |
|--------|---------------------------------------------------------|--------------------------------------|
| GET    | `/api/pagos-clientes/facturas-pendientes/:clienteId`    | Facturas pendientes de un cliente    |
| GET    | `/api/pagos-clientes/estado-cuenta/:clienteId`          | Estado de cuenta del cliente         |

### Cheques

| Método | Ruta                                                  | Descripción                          |
|--------|-------------------------------------------------------|--------------------------------------|
| GET    | `/api/pagos-clientes/cheques`                         | Listar cheques (filtros)             |
| GET    | `/api/pagos-clientes/cheques/:id`                     | Detalle de un cheque                 |
| GET    | `/api/pagos-clientes/cheques/alertas`                 | Alertas de cheques próximos a vencer |
| POST   | `/api/pagos-clientes/cheques/:id/depositar`           | Depositar cheque                     |
| PUT    | `/api/pagos-clientes/cheques/:id/acreditar`           | Acreditar cheque                     |
| POST   | `/api/pagos-clientes/cheques/:id/rechazar`            | Rechazar cheque (con reemplazo opcional) |

## Flujo de uso

### 1. Registrar un pago y aplicarlo a facturas

```javascript
POST /api/pagos-clientes/pagos
{
  "cliente_id": 1,
  "fecha_recepcion": "2026-06-14",
  "numero_talonario": "T-001",
  "observaciones": "Pago de junio",
  "items": [
    {
      "tipo": "EFECTIVO",
      "monto": 5000.00
    },
    {
      "tipo": "CHEQUE",
      "monto": 10000.00,
      "cheque_numero": "12345678",
      "cheque_banco": "Banco Nación",
      "cheque_fecha_emision": "2026-06-01",
      "cheque_fecha_cobro": "2026-07-01"
    }
  ],
  "aplicaciones": [
    { "factura_id": 10, "monto_aplicado": 8000.00 },
    { "factura_id": 11, "monto_aplicado": 7000.00 }
  ]
}
```

**Respuesta:**
```json
{
  "mensaje": "Pago registrado y aplicado correctamente",
  "pago_id": 1,
  "estado": "aplicado",
  "monto_total": 15000.00,
  "total_aplicado": 15000.00,
  "saldo_sin_aplicar": 0.00,
  "items": [...],
  "aplicaciones": [...]
}
```

### 2. Aplicar saldo restante (pagos parciales)

```javascript
POST /api/pagos-clientes/pagos/1/aplicar
{
  "aplicaciones": [
    { "factura_id": 12, "monto_aplicado": 3000.00 }
  ]
}
```

### 3. Ciclo de vida de cheques

```
pendiente → depositar → depositado → acreditar → acreditado
pendiente → rechazar → rechazado (con reemplazo opcional)
```

## Script de migración

Ejecutar `backend/scripts/migracion-pagos-simplificado.sql` en la base de datos.

Este script:
1. Elimina tablas `recibos`, `recibo_pagos`, `talonarios`
2. Agrega columnas `numero_talonario`, `monto_total`, `estado` a `pagos`
3. Crea tabla `cheques_propios` si no existe
4. Agrega `fecha_aplicacion` a `aplicacion_pagos`
5. Recalcula saldos de facturas
6. Crea índices para performance

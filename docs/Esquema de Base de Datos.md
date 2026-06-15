# Esquema de Base de Datos - Proyecto Transformadores ERP

**Última actualización:** 02/06/2026  
**Incluye modificaciones para el sistema de pagos de clientes**

## Tablas relevantes para el módulo de pagos de clientes

(Se listan solo las tablas modificadas o añadidas; el resto del esquema original se mantiene igual)

### clientes (modificada)

Se agregó la columna `activo`.

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('clientes_id_seq'::regclass) |
| nombre | character varying | NO |  |
| telefono | character varying | YES |  |
| observaciones | text | YES |  |
| cuit | character varying | YES |  |
| correo | character varying | YES |  |
| direccion | character varying | YES |  |
| forma_pago | character varying | YES |  |
| dias_max_pago | integer | YES |  |
| **activo** | boolean | YES | true |

### facturas (modificada)

Se agregaron las columnas `saldo`, `estado` y `fecha_vencimiento`.

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('facturas_id_seq'::regclass) |
| cliente_id | integer | NO |  |
| numero_factura | character varying | NO |  |
| tipo_factura | character varying | NO |  |
| fecha | date | NO |  |
| dias_credito | integer | YES | 0 |
| subtotal_sin_iva | numeric | NO |  |
| iva_21 | numeric | NO |  |
| total | numeric | NO |  |
| estado | character varying | YES | 'emitida' |
| created_at | timestamp without time zone | YES | now() |
| punto_venta | integer | YES |  |
| cae | text | YES |  |
| cae_vencimiento | date | YES |  |
| estado_afip | text | YES | 'pendiente' |
| **saldo** | numeric(12,2) | YES | 0 |
| **estado_pago** (renombrada a estado, pero se conserva estado original) | character varying | YES | 'pendiente' |
| **fecha_vencimiento** | date | YES |  |

> **Nota:** La columna `estado` original se refiere al estado AFIP/contable. Para el estado de pago se usa `estado_pago` o se ha unificado. En la implementación se añadió `estado` como estado de pago, y se mantuvo la original. Se recomienda revisar si es necesario renombrar. En los scripts se ha usado `estado` para el estado de pago, por lo que se debe ajustar si hay conflictos.

### recibos (modificada)

Se agregó la columna `total` y se ajustaron algunas columnas.

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('recibos_id_seq'::regclass) |
| numero_recibo | character varying | NO |  |
| talonario_id | integer | YES |  |
| cliente_id | integer | NO |  |
| fecha_emision | date | NO | CURRENT_DATE |
| pago_ids | ARRAY | YES |  |
| total_efectivo | numeric | YES | 0 |
| total_cheques | numeric | YES | 0 |
| total_transferencias | numeric | YES | 0 |
| total_retenciones | numeric | YES | 0 |
| **total** | numeric(12,2) | YES | 0 |
| total_pagado | numeric | YES | 0 |
| observaciones | text | YES |  |
| usuario_id | integer | YES |  |
| pdf_generado | boolean | YES | false |
| pdf_url | text | YES |  |
| created_at | timestamp without time zone | YES | now() |

### talonarios (nueva tabla)

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('talonarios_id_seq'::regclass) |
| numero_talonario | character varying(50) | NO |  |
| activo | boolean | YES | true |

### pagos (nueva tabla)

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('pagos_id_seq'::regclass) |
| cliente_id | integer | NO | REFERENCES clientes(id) |
| fecha_recepcion | date | NO |  |
| monto_total | numeric(12,2) | NO |  |
| estado | character varying(20) | YES | 'pendiente' |
| observaciones | text | YES |  |
| created_at | timestamp without time zone | YES | now() |

### pago_items (nueva tabla)

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('pago_items_id_seq'::regclass) |
| pago_id | integer | NO | REFERENCES pagos(id) ON DELETE CASCADE |
| tipo | character varying(20) | NO |  |
| monto | numeric(12,2) | NO |  |
| cheque_numero | character varying(50) | YES |  |
| cheque_banco | character varying(100) | YES |  |
| cheque_fecha_emision | date | YES |  |
| cheque_fecha_cobro | date | YES |  |
| transferencia_banco_origen | character varying(100) | YES |  |
| transferencia_banco_destino | character varying(100) | YES |  |
| transferencia_numero_operacion | character varying(100) | YES |  |
| transferencia_fecha | date | YES |  |
| observaciones | text | YES |  |

### cheques_propios (nueva tabla)

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('cheques_propios_id_seq'::regclass) |
| pago_item_id | integer | NO | REFERENCES pago_items(id) |
| numero_cheque | character varying(50) | NO |  |
| banco | character varying(100) | NO |  |
| fecha_emision | date | NO |  |
| fecha_cobro | date | NO |  |
| monto | numeric(12,2) | NO |  |
| estado | character varying(20) | YES | 'pendiente' |
| fecha_depositado | date | YES |  |
| fecha_acreditado | date | YES |  |
| fecha_rechazo | date | YES |  |
| motivo_rechazo | text | YES |  |
| gasto_comision | numeric(10,2) | YES | 0 |
| es_reemplazo | boolean | YES | false |
| cheque_reemplazado_id | integer | YES | REFERENCES cheques_propios(id) |

### aplicacion_pagos (nueva tabla)

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('aplicacion_pagos_id_seq'::regclass) |
| pago_id | integer | NO | REFERENCES pagos(id) |
| factura_id | integer | NO | REFERENCES facturas(id) |
| monto_aplicado | numeric(12,2) | NO |  |
| fecha_aplicacion | date | NO |  |

**Nota:** No hay restricción UNIQUE en (pago_id, factura_id) para permitir múltiples aplicaciones del mismo pago a la misma factura (pagos parciales reaplicables).

### recibo_pagos (nueva tabla)

| Columna | Tipo | Nulo | Defecto |
|---------|------|------|---------|
| id | integer | NO | nextval('recibo_pagos_id_seq'::regclass) |
| recibo_id | integer | NO | REFERENCES recibos(id) ON DELETE CASCADE |
| pago_id | integer | NO | REFERENCES pagos(id) ON DELETE CASCADE |

### Índices adicionales

```sql
CREATE INDEX idx_facturas_saldo ON facturas(saldo);
CREATE INDEX idx_facturas_estado_pago ON facturas(estado);
CREATE INDEX idx_facturas_fecha_vencimiento ON facturas(fecha_vencimiento);
CREATE INDEX idx_pagos_cliente_id ON pagos(cliente_id);
CREATE INDEX idx_pagos_estado ON pagos(estado);
CREATE INDEX idx_pago_items_pago_id ON pago_items(pago_id);
CREATE INDEX idx_cheques_propios_estado ON cheques_propios(estado);
CREATE INDEX idx_cheques_propios_fecha_cobro ON cheques_propios(fecha_cobro);
CREATE INDEX idx_aplicacion_pagos_pago_factura ON aplicacion_pagos(pago_id, factura_id);
CREATE INDEX idx_recibos_cliente_id ON recibos(cliente_id);

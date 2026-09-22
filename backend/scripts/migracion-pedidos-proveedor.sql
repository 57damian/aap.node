-- =====================================================================
-- Migración: pedidos a proveedores (22/09/2026)
-- =====================================================================
-- Por qué: quedó anotado como pendiente desde la auditoría de Proveedores
-- (12/09) y de Stock: un documento para pedirle a un proveedor la materia
-- prima que se necesita (con cantidades y precio de referencia), sin que
-- tenga que coincidir con lo que termine facturando. Se genera un PDF con
-- membrete de la empresa para mandarlo por correo.
--
-- Ojo: esto NO es `ordenes_compra` (esa tabla es la orden que manda el
-- CLIENTE). Se llama "pedido a proveedor" para no confundirlas.
--
-- Qué agrega:
--   1. pedidos_proveedor: cabecera (proveedor, número autogenerado
--      PP-000001, fecha, estado, observaciones, quién lo creó).
--   2. pedido_proveedor_items: renglones (materia prima, cantidad
--      pedida, unidad, si la cantidad es aproximada -- p.ej. alambre de
--      cobre, donde el rollo real puede pesar un poco más o menos que lo
--      pedido --, precio de referencia informativo, observaciones).
--   3. Secuencia pedidos_proveedor_numero_seq para el número del punto 1.
--
-- Sin financiero ni stock involucrado (es un pedido, no una compra
-- confirmada), así que no usa el circuito de auditoria_anulaciones de
-- facturas/remitos/OC: anular acá solo cambia el estado y guarda el
-- motivo en la misma fila.
--
-- Es idempotente.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS pedidos_proveedor_numero_seq;

CREATE TABLE IF NOT EXISTS pedidos_proveedor (
  id                serial PRIMARY KEY,
  numero            varchar(20)  NOT NULL UNIQUE,
  proveedor_id      integer      NOT NULL REFERENCES proveedores(id),
  fecha             date         NOT NULL DEFAULT CURRENT_DATE,
  estado            varchar(20)  NOT NULL DEFAULT 'BORRADOR'
                       CHECK (estado IN ('BORRADOR', 'ENVIADO', 'ANULADO')),
  observaciones     text,
  creado_por        integer REFERENCES usuarios(id),
  creado_en         timestamptz  NOT NULL DEFAULT now(),
  enviado_en        timestamptz,
  anulado_en        timestamptz,
  anulado_por       integer REFERENCES usuarios(id),
  motivo_anulacion  text
);

CREATE INDEX IF NOT EXISTS idx_pedidos_proveedor_proveedor ON pedidos_proveedor (proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_proveedor_estado    ON pedidos_proveedor (estado);

CREATE TABLE IF NOT EXISTS pedido_proveedor_items (
  id                serial PRIMARY KEY,
  pedido_id         integer NOT NULL REFERENCES pedidos_proveedor(id) ON DELETE CASCADE,
  materia_prima_id  integer NOT NULL REFERENCES materias_primas(id),
  cantidad          numeric(12,2) NOT NULL CHECK (cantidad > 0),
  unidad_medida     varchar(20) NOT NULL DEFAULT 'UNI',
  -- true cuando la cantidad es de referencia y no tiene que coincidir
  -- exacto (ej.: se pide 500gr de alambre de cobre y el rollo real es de
  -- 540gr). El PDF lo marca como "(aprox.)".
  aproximado        boolean NOT NULL DEFAULT false,
  precio_referencia numeric(12,2),
  observaciones     text,
  orden             integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pedido_proveedor_items_pedido ON pedido_proveedor_items (pedido_id);

COMMIT;

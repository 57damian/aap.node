-- =====================================================================
-- MIGRACIÓN — PAGOS A PROVEEDORES  (13/09/2026)
-- ---------------------------------------------------------------------
-- Espejo de migracion-cobros.sql, para el lado de proveedores.
--
-- Deja el esquema simétrico con el de clientes:
--
--   clientes                      proveedores
--   ------------------------      ---------------------------------
--   pagos                    →    pagos_proveedores
--   pago_items               →    pago_proveedor_items        (NUEVA)
--   aplicacion_pagos         →    aplicacion_pagos_proveedores (RENOMBRE)
--   facturas                 →    facturas_compra
--
-- Cambios:
--   0. Respalda la definición de TODAS las vistas del esquema y elimina
--      las que dependen de las columnas que se tocan. (Lección de la
--      migración de Cobros: la doc del repo no lista todas las vistas.)
--   1. Crea pago_proveedor_items: una fila por forma de pago (efectivo,
--      transferencia, cheque propio, cheque endosado, retención), con
--      estado propio en MAYÚSCULAS y CHECK.
--   2. Renombra pagos_proveedores_items → aplicacion_pagos_proveedores y
--      le agrega pago_item_id: la imputación pasa a ser item→factura.
--   3. pagos_proveedores: elimina `estado` (la columna que tenía dos
--      convenciones incompatibles) y `metodo` (duplicaba forma_pago);
--      agrega `anulado`. La forma de pago vive ahora en los items.
--   4. facturas_compra: ELIMINA neto_pagado y saldo_pendiente. Eran dos
--      de los tres campos de deuda que nunca coincidían. El saldo se
--      calcula en vivo en services/cuenta-proveedor.js.
--   5. Índices y FKs.
--
-- Idempotente y dentro de una transacción: si algo falla hace ROLLBACK y
-- no deja la base a medias.
--
-- Ejecutar:  psql -U postgres -d transformadores -f backend/scripts/migracion-pagos-proveedores.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. RESPALDO DE VISTAS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _vistas_respaldo_pagos_prov (
  nombre      text PRIMARY KEY,
  definicion  text NOT NULL,
  respaldado  timestamp DEFAULT now()
);

INSERT INTO _vistas_respaldo_pagos_prov (nombre, definicion)
SELECT c.relname, pg_get_viewdef(c.oid, true)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v' AND n.nspname = 'public'
ON CONFLICT (nombre) DO UPDATE SET definicion = EXCLUDED.definicion, respaldado = now();

-- Eliminar las vistas que cuelgan de las columnas que vamos a borrar.
-- Se buscan contra la base real, no contra la documentación.
DO $$
DECLARE v record;
BEGIN
  FOR v IN
    SELECT DISTINCT c.relname AS vista
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class   c ON c.oid = r.ev_class
    JOIN pg_class   t ON t.oid = d.refobjid
    WHERE d.classid = 'pg_rewrite'::regclass
      AND c.relkind = 'v'
      AND t.relname IN ('facturas_compra', 'pagos_proveedores', 'pagos_proveedores_items')
      AND c.relname <> t.relname
  LOOP
    RAISE NOTICE 'Eliminando vista dependiente: %', v.vista;
    EXECUTE format('DROP VIEW IF EXISTS %I CASCADE', v.vista);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 1. pago_proveedor_items — las formas de pago
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pago_proveedor_items (
  id                              serial PRIMARY KEY,
  pago_id                         integer NOT NULL
                                    REFERENCES pagos_proveedores(id) ON DELETE CASCADE,
  tipo                            varchar(20) NOT NULL,
  monto                           numeric(15,2) NOT NULL,
  estado                          varchar(20) NOT NULL DEFAULT 'ENTREGADO',
  fecha_debito                    date,
  observaciones                   text,

  -- cheque propio
  cheque_numero                   varchar(50),
  cheque_banco                    varchar(100),
  cheque_fecha_emision            date,
  cheque_fecha_cobro              date,
  cheque_motivo_rechazo           text,
  cheque_gasto_comision           numeric(15,2) DEFAULT 0,

  -- cheque de cliente endosado: apunta al item de cobro original
  pago_item_origen_id             integer REFERENCES pago_items(id),
  endoso_id                       integer REFERENCES endosos_cheques(id),

  -- transferencia
  transferencia_banco_origen      varchar(100),
  transferencia_banco_destino     varchar(100),
  transferencia_numero_operacion  varchar(100),
  transferencia_fecha             date,

  -- retención practicada al proveedor
  retencion_tipo                  varchar(30),
  retencion_certificado           varchar(100),

  created_at                      timestamp DEFAULT now(),
  updated_at                      timestamp DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pago_proveedor_items_tipo_chk') THEN
    ALTER TABLE pago_proveedor_items ADD CONSTRAINT pago_proveedor_items_tipo_chk
      CHECK (tipo IN ('EFECTIVO','TRANSFERENCIA','CHEQUE','CHEQUE_ENDOSADO','RETENCION'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pago_proveedor_items_estado_chk') THEN
    ALTER TABLE pago_proveedor_items ADD CONSTRAINT pago_proveedor_items_estado_chk
      CHECK (estado IN ('ENTREGADO','DEBITADO','RECHAZADO','ANULADO'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pago_proveedor_items_monto_chk') THEN
    ALTER TABLE pago_proveedor_items ADD CONSTRAINT pago_proveedor_items_monto_chk
      CHECK (monto > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ppi_pago        ON pago_proveedor_items(pago_id);
CREATE INDEX IF NOT EXISTS idx_ppi_estado      ON pago_proveedor_items(estado);
CREATE INDEX IF NOT EXISTS idx_ppi_cheque_cobro ON pago_proveedor_items(cheque_fecha_cobro)
  WHERE tipo IN ('CHEQUE','CHEQUE_ENDOSADO');

-- Un cheque de cliente no se puede entregar dos veces a un proveedor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ppi_origen
  ON pago_proveedor_items(pago_item_origen_id)
  WHERE pago_item_origen_id IS NOT NULL AND estado <> 'ANULADO';

-- Un mismo cheque propio no se puede cargar dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ppi_cheque_propio
  ON pago_proveedor_items(upper(btrim(cheque_numero)), upper(btrim(coalesce(cheque_banco,''))))
  WHERE tipo = 'CHEQUE' AND estado <> 'ANULADO';

-- ---------------------------------------------------------------------
-- 2. pagos_proveedores_items → aplicacion_pagos_proveedores
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pagos_proveedores_items')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'aplicacion_pagos_proveedores') THEN
    ALTER TABLE pagos_proveedores_items RENAME TO aplicacion_pagos_proveedores;
    RAISE NOTICE 'pagos_proveedores_items renombrada a aplicacion_pagos_proveedores';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS aplicacion_pagos_proveedores (
  id                 serial PRIMARY KEY,
  pago_id            integer NOT NULL REFERENCES pagos_proveedores(id) ON DELETE CASCADE,
  factura_compra_id  integer NOT NULL REFERENCES facturas_compra(id),
  monto_aplicado     numeric(15,2) NOT NULL CHECK (monto_aplicado > 0),
  created_at         timestamp DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE aplicacion_pagos_proveedores
  ADD COLUMN IF NOT EXISTS pago_item_id integer;

-- Backfill: reasigna las imputaciones viejas al primer item de su pago.
-- (La instalación es de prueba y pagos_proveedores estaba vacía, así que
--  en la práctica esto no toca ninguna fila.)
UPDATE aplicacion_pagos_proveedores ap
SET pago_item_id = (
  SELECT ppi.id FROM pago_proveedor_items ppi
  WHERE ppi.pago_id = ap.pago_id ORDER BY ppi.id LIMIT 1
)
WHERE ap.pago_item_id IS NULL;

DELETE FROM aplicacion_pagos_proveedores WHERE pago_item_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_prov_item_fk') THEN
    ALTER TABLE aplicacion_pagos_proveedores
      ADD CONSTRAINT app_prov_item_fk FOREIGN KEY (pago_item_id)
      REFERENCES pago_proveedor_items(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE aplicacion_pagos_proveedores ALTER COLUMN pago_item_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_app_prov_pago    ON aplicacion_pagos_proveedores(pago_id);
CREATE INDEX IF NOT EXISTS idx_app_prov_item    ON aplicacion_pagos_proveedores(pago_item_id);
CREATE INDEX IF NOT EXISTS idx_app_prov_factura ON aplicacion_pagos_proveedores(factura_compra_id);

-- ---------------------------------------------------------------------
-- 3. pagos_proveedores — un solo criterio
-- ---------------------------------------------------------------------
ALTER TABLE pagos_proveedores ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE pagos_proveedores ADD COLUMN IF NOT EXISTS motivo_anulacion text;

-- `estado` tenía dos convenciones ('CONFIRMADO' que se leía y nunca se
-- escribía, vs 'pendiente'/'aplicado' que se escribían y nadie leía).
-- El estado de un pago ahora se calcula (IMPUTADO / PARCIAL / A_CUENTA /
-- ANULADO), igual que del lado de cobros.
ALTER TABLE pagos_proveedores DROP COLUMN IF EXISTS estado;

-- `metodo` y `forma_pago` eran dos campos de texto libre para lo mismo.
-- La forma de pago vive ahora en pago_proveedor_items.tipo.
ALTER TABLE pagos_proveedores DROP COLUMN IF EXISTS metodo;

-- `factura_id` invitaba a creer que un pago va a una sola factura; la
-- imputación real está en aplicacion_pagos_proveedores.
ALTER TABLE pagos_proveedores DROP COLUMN IF EXISTS factura_id;

ALTER TABLE pagos_proveedores ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_pp_proveedor ON pagos_proveedores(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_pp_fecha     ON pagos_proveedores(fecha);

-- ---------------------------------------------------------------------
-- 4. facturas_compra — fuera los saldos guardados
-- ---------------------------------------------------------------------
-- neto_pagado NUNCA se actualizaba al pagar (pero era el campo que leían
-- casi todos los endpoints) y saldo_pendiente se descontaba al pagar pero
-- nunca se inicializaba al crear la factura (quedaba NULL, y NULL - x es
-- NULL). Se eliminan las dos: el saldo se calcula en vivo.
ALTER TABLE facturas_compra DROP COLUMN IF EXISTS neto_pagado;
ALTER TABLE facturas_compra DROP COLUMN IF EXISTS saldo_pendiente;

-- fecha_vencimiento se mantiene como dato cargable, pero deja de ser
-- obligatoria: cuando está en NULL se deriva de proveedores.dias_credito.
-- hallazgo M1: el script nunca creaba esta columna, solo asumía que ya
-- existía (el CREATE INDEX de abajo se hubiera caído con "column
-- fecha_vencimiento does not exist" y hecho ROLLBACK de TODA la migración
-- en una base donde no exista todavía). Es idempotente, así que agregarla
-- acá no cambia nada si ya está.
ALTER TABLE facturas_compra ADD COLUMN IF NOT EXISTS fecha_vencimiento date;
CREATE INDEX IF NOT EXISTS idx_fc_proveedor   ON facturas_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_fc_vencimiento ON facturas_compra(fecha_vencimiento);

-- hallazgo M2: normalizar a MAYÚSCULAS no alcanza si hay algún estado que
-- no está en la lista del CHECK (por ejemplo 'RECIBIDA', 'PARCIAL', o
-- NULL) — el ALTER de abajo se caería entero. Cualquier estado fuera de
-- la lista se mapea a PENDIENTE antes de agregar el constraint.
UPDATE facturas_compra SET estado = upper(estado) WHERE estado <> upper(estado);
UPDATE facturas_compra SET estado = 'PENDIENTE'
WHERE estado IS NULL OR upper(estado) NOT IN ('PENDIENTE','PAGADA','ANULADA');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facturas_compra_estado_chk') THEN
    ALTER TABLE facturas_compra ADD CONSTRAINT facturas_compra_estado_chk
      CHECK (estado IN ('PENDIENTE','PAGADA','ANULADA'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. endosos_cheques — no endosar dos veces el mismo cheque, y un solo
--    campo de estado (hallazgo D9)
-- ---------------------------------------------------------------------
-- hallazgo D9: cobros.routes.js escribe 'PENDIENTE'; pagos-proveedores.routes.js
-- escribe 'APLICADO'; nadie escribía 'RECHAZADO' desde código pero el
-- índice de abajo ya lo contemplaba. Normalizar y agregar el CHECK que
-- faltaba, mismo criterio "un campo de estado, en MAYÚSCULAS, con CHECK"
-- que ya se aplicó en facturas/facturas_compra.
UPDATE endosos_cheques SET estado = upper(estado) WHERE estado <> upper(estado);
UPDATE endosos_cheques SET estado = 'PENDIENTE'
WHERE estado IS NULL OR upper(estado) NOT IN ('PENDIENTE','APLICADO','RECHAZADO');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'endosos_estado_chk') THEN
    ALTER TABLE endosos_cheques ADD CONSTRAINT endosos_estado_chk
      CHECK (estado IN ('PENDIENTE','APLICADO','RECHAZADO'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_endoso_pago_item
  ON endosos_cheques(pago_item_id)
  WHERE pago_item_id IS NOT NULL AND estado <> 'RECHAZADO';

-- hallazgo M4: migracion-cobros.sql ya crea un índice único equivalente
-- (uq_endosos_cheque_activo) sobre la misma tabla/columna/condición. No
-- rompe nada tener los dos, pero duplica escritura y confunde a cualquiera
-- que mire el esquema — nos quedamos con uq_endoso_pago_item (de acá) y
-- sacamos el otro.
DROP INDEX IF EXISTS uq_endosos_cheque_activo;

COMMIT;

-- Qué quedó respaldado, por si hace falta recrear alguna vista:
--   SELECT nombre FROM _vistas_respaldo_pagos_prov;

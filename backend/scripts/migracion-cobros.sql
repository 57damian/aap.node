-- =====================================================================
-- MIGRACIÓN: circuito de COBROS A CLIENTES  (v2 — 13/09/2026)
-- Proyecto ERP Transformadores — rama `reorganizacion`
--
-- v2: la v1 falló porque tres vistas colgaban de pago_items.cheque_estado
--     (vw_cheques_detalle, vw_cheques_disponibles_endoso y
--     vista_cheques_proveedores, esta última ni siquiera documentada en
--     docs/ESQUEMA_BD.md.txt). Ahora el script las descubre solo, guarda
--     su definición en _vistas_respaldo_cobros y recién ahí las elimina.
--     Ninguna de esas vistas es usada por el código (verificado con grep
--     sobre backend/routes, backend/public/js e index.js), y todas ya
--     estaban en la lista de limpieza del proyecto.
--
-- Qué hace:
--  0. Respalda y elimina las vistas que dependen de las tablas a migrar.
--  1. Unifica el estado de los items de cobro en pago_items.estado y
--     elimina cheque_estado.
--  2. Agrega el tipo RETENCION (retenciones impositivas del cliente).
--  3. Mueve la imputación de pago→factura a item→factura, que es lo que
--     permite que un cheque rechazado devuelva la deuda solo.
--  4. Elimina pagos.estado (era la tercera convención incompatible).
--  5. Vincula recibos ↔ cobros por FK en vez de un array sin integridad.
--
-- Cómo correrlo:
--   psql -U postgres -d transformadores -f backend/scripts/migracion-cobros.sql
--
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- ADVERTENCIA: el paso 3 reasigna las imputaciones viejas al primer item
-- de cada cobro. Es aceptable porque la instalación es de prueba y no hay
-- datos reales; en una base con datos reales habría que repartirlas a mano.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. VISTAS DEPENDIENTES: respaldar definición y eliminar
--    Para recuperar una: SELECT definicion FROM _vistas_respaldo_cobros
--                        WHERE nombre = 'vw_cheques_detalle';
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _vistas_respaldo_cobros (
  nombre        text PRIMARY KEY,
  esquema       text,
  definicion    text,
  respaldada_en timestamp DEFAULT now()
);

-- Primero se respalda la definición de TODAS las vistas del esquema. Es
-- barato (son pocas) y evita perder alguna que caiga por CASCADE al
-- eliminar otra de la que dependía — le pasó a vw_cheques_disponibles_endoso,
-- que cuelga de vw_cheques_detalle y no de la tabla directamente.
INSERT INTO _vistas_respaldo_cobros (nombre, esquema, definicion)
SELECT c.relname, n.nspname,
       pg_get_viewdef(format('%I.%I', n.nspname, c.relname)::regclass, true)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v','m') AND n.nspname = 'public'
ON CONFLICT (nombre) DO UPDATE
  SET definicion = EXCLUDED.definicion, respaldada_en = now();

DO $$
DECLARE v record;
BEGIN
  FOR v IN
    SELECT DISTINCT n.nspname AS esquema, c.relname AS nombre
    FROM pg_depend d
    JOIN pg_rewrite r  ON r.oid = d.objid
    JOIN pg_class   c  ON c.oid = r.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class   t  ON t.oid = d.refobjid
    WHERE d.classid = 'pg_rewrite'::regclass
      AND c.relkind IN ('v','m')
      AND t.relname IN ('pago_items','pagos','recibos')
      AND c.relname <> t.relname
  LOOP
    INSERT INTO _vistas_respaldo_cobros (nombre, esquema, definicion)
    VALUES (v.nombre, v.esquema,
            pg_get_viewdef(format('%I.%I', v.esquema, v.nombre)::regclass, true))
    ON CONFLICT (nombre) DO UPDATE
      SET definicion = EXCLUDED.definicion, respaldada_en = now();

    RAISE NOTICE 'Vista respaldada y eliminada: %.%', v.esquema, v.nombre;
    EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', v.esquema, v.nombre);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 1. ESTADO UNIFICADO DE LOS ITEMS DE COBRO
-- ---------------------------------------------------------------------
ALTER TABLE pago_items ADD COLUMN IF NOT EXISTS estado VARCHAR(20);

-- El mapeo solo corre si todavía existe la columna vieja (idempotencia).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'pago_items' AND column_name = 'cheque_estado') THEN
    EXECUTE $sql$
      UPDATE pago_items
      SET estado = CASE
          WHEN tipo <> 'CHEQUE'                                   THEN 'ACREDITADO'
          WHEN lower(cheque_estado) IN ('pendiente','en_cartera') THEN 'EN_CARTERA'
          WHEN lower(cheque_estado) = 'depositado'                THEN 'DEPOSITADO'
          WHEN lower(cheque_estado) = 'acreditado'                THEN 'ACREDITADO'
          WHEN lower(cheque_estado) = 'rechazado'                 THEN 'RECHAZADO'
          WHEN lower(cheque_estado) = 'anulado'                   THEN 'ANULADO'
          ELSE 'EN_CARTERA'
      END
      WHERE estado IS NULL
    $sql$;
  END IF;
END $$;

-- Red de seguridad por si quedó alguna fila sin mapear.
UPDATE pago_items
SET estado = CASE WHEN tipo = 'CHEQUE' THEN 'EN_CARTERA' ELSE 'ACREDITADO' END
WHERE estado IS NULL;

ALTER TABLE pago_items ALTER COLUMN estado SET DEFAULT 'ACREDITADO';
ALTER TABLE pago_items ALTER COLUMN estado SET NOT NULL;

ALTER TABLE pago_items DROP CONSTRAINT IF EXISTS pago_items_estado_chk;
ALTER TABLE pago_items ADD CONSTRAINT pago_items_estado_chk
  CHECK (estado IN ('EN_CARTERA','DEPOSITADO','ACREDITADO','RECHAZADO','ANULADO'));

-- fecha en que el dinero quedó efectivamente disponible
ALTER TABLE pago_items ADD COLUMN IF NOT EXISTS fecha_acreditacion DATE;
UPDATE pago_items pi
SET fecha_acreditacion = COALESCE(
      pi.transferencia_fecha,
      (SELECT p.fecha_recepcion FROM pagos p WHERE p.id = pi.pago_id))
WHERE pi.estado = 'ACREDITADO' AND pi.fecha_acreditacion IS NULL;

-- la columna vieja ya no se usa: el estado del cheque es pago_items.estado
ALTER TABLE pago_items DROP COLUMN IF EXISTS cheque_estado;

-- ---------------------------------------------------------------------
-- 2. RETENCIONES IMPOSITIVAS COMO FORMA DE COBRO
-- ---------------------------------------------------------------------
ALTER TABLE pago_items ADD COLUMN IF NOT EXISTS retencion_tipo VARCHAR(30);
ALTER TABLE pago_items ADD COLUMN IF NOT EXISTS retencion_certificado VARCHAR(60);

ALTER TABLE pago_items DROP CONSTRAINT IF EXISTS pago_items_tipo_chk;
ALTER TABLE pago_items ADD CONSTRAINT pago_items_tipo_chk
  CHECK (tipo IN ('EFECTIVO','TRANSFERENCIA','CHEQUE','RETENCION'));

ALTER TABLE pago_items DROP CONSTRAINT IF EXISTS pago_items_monto_chk;
ALTER TABLE pago_items ADD CONSTRAINT pago_items_monto_chk CHECK (monto > 0);

-- ---------------------------------------------------------------------
-- 3. IMPUTACIÓN A NIVEL DE ITEM (no de cobro)
--    Esto es lo que hace que un cheque rechazado devuelva la deuda solo.
-- ---------------------------------------------------------------------
ALTER TABLE aplicacion_pagos ADD COLUMN IF NOT EXISTS pago_item_id INTEGER;

UPDATE aplicacion_pagos ap
SET pago_item_id = (
      SELECT MIN(pi.id) FROM pago_items pi WHERE pi.pago_id = ap.pago_id
    )
WHERE ap.pago_item_id IS NULL;

-- imputaciones huérfanas (cobro sin items): no se pueden migrar
DELETE FROM aplicacion_pagos WHERE pago_item_id IS NULL;

ALTER TABLE aplicacion_pagos DROP CONSTRAINT IF EXISTS aplicacion_pagos_pago_item_fk;
ALTER TABLE aplicacion_pagos ADD CONSTRAINT aplicacion_pagos_pago_item_fk
  FOREIGN KEY (pago_item_id) REFERENCES pago_items(id) ON DELETE CASCADE;
ALTER TABLE aplicacion_pagos ALTER COLUMN pago_item_id SET NOT NULL;

ALTER TABLE aplicacion_pagos DROP CONSTRAINT IF EXISTS aplicacion_pagos_monto_chk;
ALTER TABLE aplicacion_pagos ADD CONSTRAINT aplicacion_pagos_monto_chk
  CHECK (monto_aplicado > 0);

ALTER TABLE aplicacion_pagos ALTER COLUMN factura_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aplicacion_pagos_factura ON aplicacion_pagos(factura_id);
CREATE INDEX IF NOT EXISTS idx_aplicacion_pagos_item    ON aplicacion_pagos(pago_item_id);
CREATE INDEX IF NOT EXISTS idx_pago_items_pago          ON pago_items(pago_id);
CREATE INDEX IF NOT EXISTS idx_pago_items_estado        ON pago_items(estado) WHERE tipo = 'CHEQUE';
CREATE INDEX IF NOT EXISTS idx_pagos_cliente            ON pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente         ON facturas(cliente_id);

-- ---------------------------------------------------------------------
-- 4. FUERA pagos.estado (tercera convención incompatible)
--    El estado de un cobro se calcula: monto vs imputado vs acreditado.
-- ---------------------------------------------------------------------
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS anulado BOOLEAN DEFAULT false;
UPDATE pagos SET anulado = false WHERE anulado IS NULL;
ALTER TABLE pagos ALTER COLUMN anulado SET NOT NULL;
ALTER TABLE pagos DROP COLUMN IF EXISTS estado;

ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_monto_chk;
ALTER TABLE pagos ADD CONSTRAINT pagos_monto_chk CHECK (monto_total > 0);

-- ---------------------------------------------------------------------
-- 5. RECIBOS: FK real en vez de array de ids
-- ---------------------------------------------------------------------
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS recibo_id INTEGER;

-- migrar el array viejo, si existía
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'recibos' AND column_name = 'pago_ids') THEN
    EXECUTE '
      UPDATE pagos p SET recibo_id = r.id
      FROM recibos r
      WHERE p.recibo_id IS NULL AND p.id = ANY(r.pago_ids)';
  END IF;
END $$;

ALTER TABLE pagos DROP CONSTRAINT IF EXISTS pagos_recibo_fk;
ALTER TABLE pagos ADD CONSTRAINT pagos_recibo_fk
  FOREIGN KEY (recibo_id) REFERENCES recibos(id) ON DELETE SET NULL;

ALTER TABLE recibos DROP COLUMN IF EXISTS pago_ids;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recibos_numero ON recibos(numero_recibo);
CREATE INDEX IF NOT EXISTS idx_pagos_recibo ON pagos(recibo_id);

-- ---------------------------------------------------------------------
-- 6. ENDOSOS: un cheque no se puede endosar dos veces
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_endosos_cheque_activo
  ON endosos_cheques(pago_item_id)
  WHERE estado <> 'RECHAZADO';

COMMIT;

-- =====================================================================
-- VERIFICACIÓN (corre sola, fuera de la transacción)
-- =====================================================================
\echo ''
\echo '=== Formas de cobro por tipo y estado ==='
SELECT tipo, estado, COUNT(*) AS cantidad, SUM(monto) AS total
FROM pago_items GROUP BY 1,2 ORDER BY 1,2;

\echo ''
\echo '=== Imputaciones sin item (debe dar 0) ==='
SELECT COUNT(*) AS imputaciones_sin_item FROM aplicacion_pagos WHERE pago_item_id IS NULL;

\echo ''
\echo '=== Vistas RESPALDADAS (no necesariamente eliminadas) ==='
\echo '--- Se respalda todo el esquema por precaución. Las que se eliminaron'
\echo '--- son solo las que aparecieron arriba como NOTICE. Esta consulta'
\echo '--- marca cuáles siguen vivas y cuáles no:'
SELECT r.nombre,
       CASE WHEN v.viewname IS NULL THEN 'ELIMINADA' ELSE 'sigue viva' END AS situacion
FROM _vistas_respaldo_cobros r
LEFT JOIN pg_views v ON v.viewname = r.nombre AND v.schemaname = r.esquema
ORDER BY (v.viewname IS NULL) DESC, r.nombre;

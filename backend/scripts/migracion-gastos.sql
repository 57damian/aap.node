-- =====================================================================
-- Migración: gastos varios (07/10/2026)
--
-- Por qué: el sistema solo conocía las compras de materia prima
-- (facturas_compra). No había dónde anotar los demás egresos del negocio
-- (honorarios del contador, sueldos, gastos del banco, caja chica,
-- mantenimiento, impuestos pagados…), así que el balance no se podía armar.
--
-- Qué crea:
--   * categorias_gasto: el rubro de cada gasto. `es_impuesto` separa los
--     impuestos pagados del resto de los gastos en los informes.
--   * gastos: un renglón por gasto, con neto + IVA opcional (el IVA de un
--     gasto con factura suma al crédito fiscal del informe de IVA).
--     Se anulan (no se borran): estado VIGENTE | ANULADO + motivo.
--
-- Es idempotente: se puede correr más de una vez.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS categorias_gasto (
  id           SERIAL PRIMARY KEY,
  nombre       VARCHAR(60) NOT NULL,
  es_impuesto  BOOLEAN NOT NULL DEFAULT false,
  activa       BOOLEAN NOT NULL DEFAULT true,
  creado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_gasto_nombre
  ON categorias_gasto (lower(nombre));

-- Siembra inicial (solo las que todavía no existan)
INSERT INTO categorias_gasto (nombre, es_impuesto)
SELECT v.nombre, v.es_impuesto
FROM (VALUES
  ('Impuestos', true),
  ('Gastos bancarios', false),
  ('Honorarios del contador', false),
  ('Sueldos y cargas sociales', false),
  ('Caja chica', false),
  ('Mantenimiento', false),
  ('Servicios', false),
  ('Alquiler', false),
  ('Otros', false)
) AS v(nombre, es_impuesto)
WHERE NOT EXISTS (
  SELECT 1 FROM categorias_gasto c WHERE lower(c.nombre) = lower(v.nombre)
);

CREATE TABLE IF NOT EXISTS gastos (
  id                SERIAL PRIMARY KEY,
  fecha             DATE NOT NULL,
  categoria_id      INTEGER NOT NULL REFERENCES categorias_gasto(id),
  descripcion       VARCHAR(200) NOT NULL,
  neto              NUMERIC(15,2) NOT NULL CHECK (neto > 0),
  iva               NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
  total             NUMERIC(15,2) NOT NULL,
  forma_pago        VARCHAR(20),
  comprobante       VARCHAR(60),
  estado            VARCHAR(10) NOT NULL DEFAULT 'VIGENTE',
  anulado_en        TIMESTAMP,
  anulado_por       INTEGER,
  motivo_anulacion  TEXT,
  creado_por        INTEGER,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gastos_estado_chk') THEN
    ALTER TABLE gastos ADD CONSTRAINT gastos_estado_chk
      CHECK (estado IN ('VIGENTE','ANULADO'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gastos_forma_pago_chk') THEN
    ALTER TABLE gastos ADD CONSTRAINT gastos_forma_pago_chk
      CHECK (forma_pago IS NULL OR forma_pago IN ('EFECTIVO','TRANSFERENCIA','CHEQUE','DEBITO','OTRO'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gastos_fecha     ON gastos (fecha);
CREATE INDEX IF NOT EXISTS idx_gastos_categoria ON gastos (categoria_id);

COMMIT;

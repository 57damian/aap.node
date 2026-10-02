-- =====================================================================
-- Migración: categoría y proveedor asignado en materias_primas
-- =====================================================================
-- Pedido de Damian (02/10/2026): poder ver el stock filtrado por tipo de
-- material (carreteles, alambres de cobre, otros) y poder asignar cada
-- material a UN proveedor habitual. Un material se le puede seguir comprando
-- a cualquier proveedor: el asignado es solo una referencia (se muestra, se
-- filtra y se ofrece primero al armar un pedido), no bloquea nada.
--
-- - categoria: lista fija, con CHECK. Valores en MAYÚSCULAS como el resto de
--   los estados/enums del sistema. 'OTROS' por defecto.
-- - proveedor_id: FK opcional a proveedores. ON DELETE SET NULL: si un
--   proveedor se borra, el material no se rompe, solo queda sin asignar.
--
-- Backfill (solo filas que quedan en 'OTROS', o sea todas las existentes):
-- se clasifica por el nombre — 'carretel' → CARRETELES, 'alambre' →
-- ALAMBRES_COBRE. Es una ayuda: se puede corregir desde Materias primas.
--
-- Es idempotente: se puede correr más de una vez sin pisar lo que ya se
-- cargó a mano (el backfill solo toca materiales todavía en 'OTROS').

BEGIN;

ALTER TABLE materias_primas
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'OTROS';

ALTER TABLE materias_primas
  ADD COLUMN IF NOT EXISTS proveedor_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materias_primas_categoria_check'
  ) THEN
    ALTER TABLE materias_primas
      ADD CONSTRAINT materias_primas_categoria_check
      CHECK (categoria IN ('CARRETELES', 'ALAMBRES_COBRE', 'OTROS'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'materias_primas_proveedor_id_fkey'
  ) THEN
    ALTER TABLE materias_primas
      ADD CONSTRAINT materias_primas_proveedor_id_fkey
      FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_materias_primas_categoria ON materias_primas(categoria);
CREATE INDEX IF NOT EXISTS idx_materias_primas_proveedor ON materias_primas(proveedor_id);

UPDATE materias_primas
SET categoria = 'CARRETELES'
WHERE categoria = 'OTROS' AND nombre ILIKE '%carretel%';

UPDATE materias_primas
SET categoria = 'ALAMBRES_COBRE'
WHERE categoria = 'OTROS' AND nombre ILIKE '%alambre%';

COMMIT;

-- Verificación:
--   SELECT categoria, COUNT(*) FROM materias_primas GROUP BY categoria;
--   SELECT id, nombre, categoria, proveedor_id FROM materias_primas ORDER BY nombre;

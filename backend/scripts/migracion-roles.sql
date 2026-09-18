-- ============================================================================
-- Dos roles: admin y operario — 17/09/2026
--
-- Hasta acá había cuatro roles declarados (admin, control, operario, empleado)
-- y cada endpoint elegía a mano a quién dejaba pasar: 11 combinaciones
-- distintas en 20 routers. El resultado era que un operario podía leer por API
-- la deuda de los clientes, los cheques y el stock valorizado, aunque el menú
-- no le mostrara esas pantallas.
--
-- Decisión de Damian:
--   admin     — ve y hace todo.
--   operario  — carga producción y ve cantidades de transformadores y de
--               materia prima. Nada contable.
--
-- Mapeo de los usuarios que ya existen:
--   'empleado' -> 'operario'   (gente de planta)
--   'control'  -> 'admin'      (tenía acceso a casi todo)
--   control1 y test_final se borran: son cuentas de prueba que nunca
--   iniciaron sesión (confirmado con Damian el 17/09).
--
-- Ejecutar:
--   psql -U postgres -h localhost -d transformadores -f backend/scripts/migracion-roles.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Sacar las cuentas de prueba
--
-- La condición de "nunca entró" está en la consulta a propósito: si alguna de
-- las dos resultara estar en uso, no se borra y queda para revisar a mano.
-- ----------------------------------------------------------------------------
DELETE FROM usuarios
 WHERE nombre_usuario IN ('control1', 'test_final')
   AND ultimo_acceso IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Mapear los roles viejos
-- ----------------------------------------------------------------------------
UPDATE usuarios SET rol = 'operario' WHERE rol = 'empleado';
UPDATE usuarios SET rol = 'admin'    WHERE rol = 'control';

-- Cualquier otro valor inesperado cae en el rol de menos alcance.
UPDATE usuarios
   SET rol = 'operario'
 WHERE rol IS NULL OR rol NOT IN ('admin', 'operario');

-- ----------------------------------------------------------------------------
-- 3. Que la base no acepte otro rol
-- ----------------------------------------------------------------------------
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_chk;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_chk
  CHECK (rol IN ('admin', 'operario'));

-- ----------------------------------------------------------------------------
-- 4. No quedarse sin administradores
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  admins integer;
BEGIN
  SELECT count(*) INTO admins FROM usuarios WHERE rol = 'admin' AND activo;
  IF admins = 0 THEN
    RAISE EXCEPTION 'La migración dejaría el sistema sin ningún administrador activo. Se cancela.';
  END IF;
END $$;

COMMIT;

\echo ''
\echo '=== USUARIOS DESPUÉS DE LA MIGRACIÓN ==='
SELECT id, nombre_usuario, COALESCE(nombre_completo, '-') AS nombre, rol, activo
  FROM usuarios
 ORDER BY rol, id;

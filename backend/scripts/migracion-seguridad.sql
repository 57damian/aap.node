-- ============================================================================
-- Migración de seguridad de autenticación — 17/09/2026
--
-- Agrega a la tabla usuarios lo que hace falta para:
--   1. obligar a cambiar una contraseña temporal (debe_cambiar_password)
--   2. invalidar las sesiones abiertas cuando cambia la contraseña
--      (password_actualizado_en, que se compara contra el "iat" del token)
--   3. bloquear una cuenta después de varios intentos fallidos
--      (intentos_fallidos, bloqueado_hasta)
--   4. que el rol no pueda tomar un valor inventado (CHECK)
--   5. que no convivan dos usuarios que solo difieren en mayúsculas
--
-- Todo es idempotente: se puede correr dos veces sin romper nada.
--
-- Ejecutar:
--   psql -U postgres -h localhost -d transformadores -f backend/scripts/migracion-seguridad.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Columnas nuevas
-- ----------------------------------------------------------------------------

-- Cuando un admin resetea una contraseña, esto queda en true y el usuario no
-- puede hacer nada más que cambiarla (lo fuerza el middleware exigirPasswordAlDia).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false;

-- Momento del último cambio de contraseña. verificarToken rechaza cualquier
-- token emitido ANTES de esta marca: así, cambiar o resetear la clave cierra
-- todas las sesiones abiertas de esa persona.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_actualizado_en timestamptz NOT NULL DEFAULT now();

-- Intentos fallidos consecutivos; se limpian con cada login exitoso.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS intentos_fallidos smallint NOT NULL DEFAULT 0;

-- Hasta cuándo está bloqueada la cuenta. NULL = no bloqueada.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_hasta timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Rol: normalizar y restringir
--
-- Hasta ahora la única validación de rol era de aplicación, y estaba escrita
-- en tres lugares distintos. Un UPDATE a mano podía dejar un rol inexistente,
-- y un usuario con rol inventado no matchea en ningún authorize(): queda
-- logueado pero sin poder hacer nada.
-- ----------------------------------------------------------------------------

UPDATE usuarios SET rol = lower(trim(rol)) WHERE rol <> lower(trim(rol));

-- Cualquier rol fuera de la lista pasa a 'empleado', que es el de menos
-- permisos. Si esto toca alguna fila, el reporte del final lo muestra.
UPDATE usuarios
   SET rol = 'empleado'
 WHERE rol IS NULL OR rol NOT IN ('admin', 'control', 'operario', 'empleado');

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_chk;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_chk
  CHECK (rol IN ('admin', 'control', 'operario', 'empleado'));

-- ----------------------------------------------------------------------------
-- 3. Nombre de usuario único sin importar mayúsculas
--
-- El login busca con = exacto, así que hoy 'Damian' y 'damian' son dos
-- cuentas distintas y es fácil crear un duplicado sin darse cuenta.
-- ----------------------------------------------------------------------------

-- Si ya hubiera duplicados, el índice no se puede crear: este bloque avisa
-- con un error claro en vez de dejar un mensaje críptico de Postgres.
DO $$
DECLARE
  duplicados text;
BEGIN
  SELECT string_agg(nombre, ', ') INTO duplicados
  FROM (
    SELECT lower(nombre_usuario) AS nombre
    FROM usuarios
    GROUP BY lower(nombre_usuario)
    HAVING count(*) > 1
  ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'Hay usuarios duplicados que solo difieren en mayúsculas: %. Resolvelos a mano antes de correr esta migración.', duplicados;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_nombre_lower ON usuarios (lower(nombre_usuario));

-- Índice para la búsqueda del login (que ahora es case-insensitive).
CREATE INDEX IF NOT EXISTS idx_usuarios_activo ON usuarios (activo);

COMMIT;

-- ----------------------------------------------------------------------------
-- 4. Reporte final
-- ----------------------------------------------------------------------------

\echo ''
\echo '=== COLUMNAS NUEVAS ==='
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'usuarios'
   AND column_name IN ('debe_cambiar_password', 'password_actualizado_en',
                       'intentos_fallidos', 'bloqueado_hasta')
 ORDER BY column_name;

\echo ''
\echo '=== USUARIOS POR ROL (tiene que haber al menos un admin activo) ==='
SELECT rol,
       count(*) FILTER (WHERE activo)     AS activos,
       count(*) FILTER (WHERE NOT activo) AS inactivos
  FROM usuarios
 GROUP BY rol
 ORDER BY rol;

\echo ''
\echo '=== ADMINISTRADORES ACTIVOS ==='
SELECT id, nombre_usuario, ultimo_acceso
  FROM usuarios
 WHERE rol = 'admin' AND activo
 ORDER BY id;

\echo ''
\echo 'Si la lista de administradores activos está vacía, recuperá el acceso con:'
\echo '  cd backend && node scripts/reset-admin-password.js <nombre_usuario>'

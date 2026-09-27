-- =====================================================================
-- Migración: índice único parcial en ordenes_compra (cliente_id, numero_oc)
-- =====================================================================
-- oc.html no bloqueaba el botón "Crear orden" mientras se mandaba el POST:
-- un doble click (o clickear de nuevo por una conexión lenta) mandaba dos
-- veces la misma OC y quedaban dos filas idénticas en ordenes_compra, cada
-- una con sus items. El front ya se corrigió (guarda + botón deshabilitado
-- durante el submit, hallazgo 27/09/2026), pero no hay nada en la base que
-- lo frene si vuelve a pasar (por ejemplo, dos pestañas abiertas a la vez).
--
-- El número de OC lo pone cada CLIENTE al hacer su pedido, no el sistema:
-- dos clientes distintos pueden coincidir en el mismo número sin que sea
-- un error. Por eso el índice es sobre el PAR (cliente_id, numero_oc), no
-- sobre numero_oc solo.
--
-- Parcial (WHERE anulada_en IS NULL) porque el número de una OC anulada se
-- puede reusar (mismo criterio que uq_facturas_numero_vigente en
-- migracion-anulacion-facturas.sql).
--
-- Es idempotente. Si ya hay OC duplicadas cargadas (por el bug del doble
-- submit), el CREATE UNIQUE INDEX de abajo falla a propósito con un mensaje
-- claro en vez de borrar algo solo: a diferencia de orden_compra_items (que
-- son cantidades, se pueden sumar sin pérdida), una OC duplicada puede
-- tener remitos o facturas propias, y fusionarlas a ciegas puede pisar
-- datos reales. Revisar a mano cuál de las dos filas quedarse (o anular la
-- de más) antes de volver a correr esta migración.

BEGIN;

DO $$
DECLARE
  duplicados TEXT;
BEGIN
  SELECT string_agg(format('cliente_id=%s numero_oc=%s (oc.id: %s)', cliente_id, numero_oc, ids), '; ')
  INTO duplicados
  FROM (
    SELECT cliente_id, numero_oc, string_agg(id::text, ',' ORDER BY id) AS ids
    FROM ordenes_compra
    WHERE anulada_en IS NULL
    GROUP BY cliente_id, numero_oc
    HAVING COUNT(*) > 1
  ) sub;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay OC duplicadas (mismo cliente y número) sin anular: %. Revisar a mano en Correcciones (anular la de más, o la vacía si el doble submit no llegó a cargar items) y volver a correr esta migración.',
      duplicados;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oc_cliente_numero_vigente
  ON ordenes_compra(cliente_id, numero_oc)
  WHERE anulada_en IS NULL;

COMMIT;

-- Verificación: crear dos OC con el mismo cliente y el mismo número (por
-- ejemplo repitiendo el POST /api/ordenes-compra a mano) tiene que devolver
-- un error de la base, no crear una segunda fila.

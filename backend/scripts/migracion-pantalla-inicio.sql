-- =====================================================================
-- Migración: pantalla de inicio por usuario (27/09/2026)
-- =====================================================================
-- Por qué: todo admin entraba al Dashboard, que muestra de entrada las
-- deudas, los cheques y el dólar. Hay una persona que usa la app en el
-- taller y en el teléfono delante de los empleados (carga OC, entregas,
-- pedidos): para ella conviene arrancar en Órdenes de compra, sin
-- quitarle acceso a nada. NULL = la pantalla por defecto de su rol
-- (config/roles.js). El valor se valida en el backend contra una lista
-- blanca de pantallas (PANTALLAS_INICIO en config/roles.js).
--
-- Es idempotente.

BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pantalla_inicio VARCHAR(60) NULL;

COMMIT;

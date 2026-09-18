// Envuelve un handler async y manda cualquier rechazo al manejador de
// errores de Express. Express 4 no captura promesas rechazadas (recién
// llega en Express 5): sin esto, un error de base en un handler async
// sale como unhandled rejection y Node 18+ termina el proceso entero.
// Ver claude/auditoria-bugs-2026-09-13.md, hallazgo C1.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };

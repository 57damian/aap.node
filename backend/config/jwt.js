// Único lugar donde se define el secreto de JWT (hallazgo S5 de la
// auditoría). Antes había un fallback hardcodeado duplicado en
// middlewares/auth.js y routes/auth.routes.js: si JWT_SECRET faltaba en
// el .env (un deploy mal configurado, por ejemplo), el sistema arrancaba
// igual con un secreto público y cualquiera podía firmarse un token de
// admin. Ahora, si falta o es muy corto, el server no arranca — es mejor
// que arranque roto a que arranque inseguro.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET no está definido o es demasiado corto (mínimo 32 caracteres). ' +
    'Revisá el .env. Generar uno nuevo con: ' +
    `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  );
}

// La duración de la sesión se puede ajustar por .env (JWT_EXPIRES_IN=8h, 30m,
// 7d…). La variable ya existía en el .env pero no la leía nadie: la expiración
// estaba fija acá y cambiarla en el .env no hacía nada.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

module.exports = { JWT_SECRET, JWT_EXPIRES_IN, JWT_ALGORITHM: 'HS256' };

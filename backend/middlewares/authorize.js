module.exports = function authorize(roles = []) {
  return (req, res, next) => {
    const { rol } = req.headers;

    if (!rol) {
      return res.status(401).json({ error: 'Rol no informado' });
    }

    if (!roles.includes(rol)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    next();
  };
};

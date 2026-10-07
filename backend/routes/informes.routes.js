const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarToken, soloAdmin } = require('../middlewares/auth');
const { resumen } = require('../services/informes');
const { generarPdfInforme } = require('../services/pdf-informe');
const { nombreArchivo } = require('../services/pdf-base');

// Informes contables: plata del negocio, solo administrador.
router.use(verificarToken, soloAdmin);

function pad(n) { return String(n).padStart(2, '0'); }

/** Por defecto, el mes en curso. */
function rangoPorDefecto() {
  const hoy = new Date();
  const a = hoy.getFullYear();
  const m = hoy.getMonth() + 1;
  const ultimo = new Date(a, m, 0).getDate();
  return { desde: `${a}-${pad(m)}-01`, hasta: `${a}-${pad(m)}-${pad(ultimo)}` };
}

function parametros(req) {
  const def = rangoPorDefecto();
  return {
    desde: req.query.desde || def.desde,
    hasta: req.query.hasta || def.hasta,
    criterio: req.query.criterio || 'factura'
  };
}

function responderError(res, err, contexto) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(`Error en ${contexto}:`, err);
  res.status(500).json({ error: err.message });
}

/** GET /api/informes/resumen?desde&hasta&criterio=factura|percibido */
router.get('/resumen', async (req, res) => {
  try {
    res.json(await resumen(pool, parametros(req)));
  } catch (err) {
    responderError(res, err, 'GET /informes/resumen');
  }
});

/** GET /api/informes/resumen/pdf?... */
router.get('/resumen/pdf', async (req, res) => {
  try {
    const p = parametros(req);
    const inf = await resumen(pool, p);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="${nombreArchivo(`informe-${p.criterio}-${p.desde}-a-${p.hasta}`)}.pdf"`);
    generarPdfInforme(inf, res);
  } catch (err) {
    responderError(res, err, 'GET /informes/resumen/pdf');
  }
});

module.exports = router;

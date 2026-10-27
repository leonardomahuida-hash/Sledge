const express = require('express');
const router = express.Router();
const climaController = require('../controllers/climaController');
const auth = require('../middlewares/authMiddleware');
const Refugio = require('../models/Refugio');

router.use(auth.attachUser);
router.get('/', (req, res, next) => {
  Refugio.getClimatico((error, refugio) => {
    if (error) return next(error);
    const puedeConfigurarRefugio = ['Operador de Refugio', 'Admin', 'Super Admin'].includes(req.user.rol);
    res.render('clima', { page: 'clima', refugio: refugio || null, puedeConfigurarRefugio });
  });
});
router.get('/api/tiempo', climaController.consultarClima);
router.get('/api/recomendacion', auth.requirePatrolOrAdminRole, climaController.obtenerUltimaRecomendacion);
router.post('/api/recomendacion', auth.requirePatrolOrAdminRole, climaController.generarRecomendacion);

module.exports = router;

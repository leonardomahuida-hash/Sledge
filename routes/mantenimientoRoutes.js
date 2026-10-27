const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const mantenimientoController = require('../controllers/mantenimientoController');

router.use(auth.attachUser, auth.requireMaintenanceModuleRole);
router.get('/', mantenimientoController.renderMantenimiento);
router.get('/informe.pdf', mantenimientoController.descargarInformePdf);
router.post('/equipos/:id/reporte', mantenimientoController.reportarFalla);
router.post('/:id/alta-taller', mantenimientoController.altaTaller);

module.exports = router;

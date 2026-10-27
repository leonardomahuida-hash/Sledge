const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const usuarioController = require('../controllers/usuarioController');

router.use(authMiddleware.attachUser, authMiddleware.requireTurnosRole);
router.get('/', usuarioController.renderTurnos);
router.get('/historial', usuarioController.renderTurnos);
router.post('/api', usuarioController.guardarTurno);
router.post('/:id/cierre', usuarioController.cerrarTurno);

module.exports = router;
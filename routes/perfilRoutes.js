const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuarioController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/apodo', authMiddleware.attachUser, usuarioController.actualizarApodo);
router.post('/foto', authMiddleware.attachUser, usuarioController.actualizarFoto);
router.post('/medica', authMiddleware.attachUser, usuarioController.actualizarMedica);
router.put('/', authMiddleware.attachUser, usuarioController.actualizarPerfil);
router.put('/datos-personales', authMiddleware.attachUser, usuarioController.actualizarDatosPersonales);
router.post('/pase', authMiddleware.attachUser, usuarioController.asociarPaseMontana);
router.post('/password', authMiddleware.attachUser, usuarioController.actualizarPassword);

module.exports = router;
const express = require('express');
const router = express.Router();
const ajustesController = require('../controllers/ajustesController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/', authMiddleware.attachUser, ajustesController.renderAjustes);
router.put('/preferencias', authMiddleware.attachUser, ajustesController.actualizarPreferencias);

module.exports = router;

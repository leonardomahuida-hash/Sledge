const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const sosController = require('../controllers/sosController');

router.get('/contactos', auth.attachUser, sosController.listarContactosSOS);

module.exports = router;

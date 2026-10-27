const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/', authController.renderLogin);
router.post('/login', authController.handleLogin);

router.get('/registro', authController.renderRegistro);
router.post('/registro', authController.handleRegistro);

router.get('/logout', authController.logout);

module.exports = router;
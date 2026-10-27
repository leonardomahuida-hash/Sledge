const express = require('express');
const router = express.Router();
const mapaController = require('../controllers/mapaController');
const authMiddleware = require('../middlewares/authMiddleware');

router.get('/', authMiddleware.attachUser, mapaController.renderMapa);
router.post('/api/refugios', authMiddleware.attachUser, authMiddleware.requireRefugioManagementRole, mapaController.crearRefugio);
router.post('/api/zonas', authMiddleware.attachUser, authMiddleware.requireRefugioManagementRole, mapaController.crearZona);
router.post('/api/pistas', authMiddleware.attachUser, authMiddleware.requireRefugioManagementRole, mapaController.crearPista);
router.put('/api/pistas/:id/estado', authMiddleware.attachUser, authMiddleware.requireRefugioManagementRole, mapaController.actualizarEstadoPista);
router.put('/api/zonas/:id', authMiddleware.attachUser, authMiddleware.requireRefugioManagementRole, mapaController.actualizarTipoZona);
router.delete('/api/zonas/:id', authMiddleware.attachUser, authMiddleware.requireRefugioManagementRole, mapaController.eliminarZona);
router.delete('/api/pistas/:id', authMiddleware.attachUser, authMiddleware.requireRefugioManagementRole, mapaController.eliminarPista);
router.get('/api/patrulleros-activos', authMiddleware.attachUser, authMiddleware.requireMapViewerRole, mapaController.listarPatrullerosActivos);
router.post('/api/mi-ubicacion', authMiddleware.attachUser, authMiddleware.requirePatrolLocationRole, mapaController.actualizarUbicacionPatrullero);
router.delete('/api/mi-ubicacion', authMiddleware.attachUser, authMiddleware.requirePatrolLocationRole, mapaController.eliminarUbicacionPatrullero);

module.exports = router;
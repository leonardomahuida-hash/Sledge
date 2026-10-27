const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const administracionController = require('../controllers/administracionController');
const sosController = require('../controllers/sosController');

router.use(auth.attachUser, auth.requireNonSkierRole);
router.get('/incidentes', auth.requireIncidentAccessRole, administracionController.renderIncidentes);
router.post('/incidentes', auth.requireIncidentAccessRole, administracionController.reportarIncidente);
router.get('/', auth.requireAdminRole, administracionController.renderAdministracion);
router.get('/refugio', auth.requireEquipmentManagementRole, administracionController.renderConfiguracionRefugio);
router.put('/refugio', auth.requireEquipmentManagementRole, administracionController.actualizarConfiguracionRefugio);

router.get('/auditoria', auth.requireSuperAdminRole, administracionController.renderAuditoria);
router.get('/usuarios', auth.requireSuperAdminRole, administracionController.renderUsuarios);
router.post('/usuarios', auth.requireSuperAdminRole, administracionController.crearUsuarioAdministrativo);
router.put('/usuarios/:id/rol', auth.requireSuperAdminRole, administracionController.actualizarRolUsuario);
router.put('/usuarios/:id', auth.requireSuperAdminRole, administracionController.actualizarRolUsuario);
router.post('/usuarios/:id/baja', auth.requireSuperAdminRole, administracionController.darDeBajaUsuario);
router.delete('/usuarios/:id', auth.requireSuperAdminRole, administracionController.eliminarUsuario);

router.post('/sos/contactos', auth.requireSosManagementRole, sosController.crearContactoSOS);
router.put('/sos/contactos/:id', auth.requireSosManagementRole, sosController.actualizarContactoSOS);
router.delete('/sos/contactos/:id', auth.requireSosManagementRole, sosController.eliminarContactoSOS);
router.post('/sos/contactos/:id/predeterminado', auth.requireSosManagementRole, sosController.definirContactoPredeterminado);

module.exports = router;

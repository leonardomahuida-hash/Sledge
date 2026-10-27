const express = require('express');
const router = express.Router();
const refugioController = require('../controllers/refugioController');
const authMiddleware = require('../middlewares/authMiddleware');
const multer = require('multer');
const mantenimientoController = require('../controllers/mantenimientoController');

const equipmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (/\.(csv|xlsx)$/i.test(file.originalname)) return callback(null, true);
    callback(new Error('Solo se permiten archivos CSV o XLSX.'));
  }
});
const receiveEquipmentFile = (req, res, next) => {
  equipmentUpload.single('archivo')(req, res, error => {
    if (error) return res.status(400).json({ success: false, error: error.message });
    next();
  });
};

router.get('/', authMiddleware.attachUser, refugioController.renderRefugios);
router.get('/api/inventario/resumen', authMiddleware.attachUser, authMiddleware.requireInventoryDashboardRole, refugioController.resumenInventario);
router.get('/api/insumos/caducidad', authMiddleware.attachUser, authMiddleware.requireInventoryDashboardRole, refugioController.alertasCaducidadInsumos);
router.get('/solicitudes', authMiddleware.attachUser, authMiddleware.requireNonSkierRole, refugioController.renderSolicitudes);
router.post('/:id/estado', authMiddleware.attachUser, refugioController.actualizarEstadoRefugio);
router.get('/:id', authMiddleware.attachUser, refugioController.renderRefugioDetalle);
router.post('/:id/equipo', authMiddleware.attachUser, authMiddleware.requireEquipmentManagementRole, refugioController.addEquipamiento);
router.post('/:refugioId/equipos/importar', authMiddleware.attachUser, authMiddleware.requireEquipmentManagementRole, receiveEquipmentFile, mantenimientoController.importarEquipos);
router.post('/:id/equipos/:equipoId/botiquin-insumos', authMiddleware.attachUser, authMiddleware.requireEquipmentManagementRole, refugioController.agregarInsumoBotiquin);
router.delete('/:id/equipos/:equipoId', authMiddleware.attachUser, authMiddleware.requireEquipmentManagementRole, refugioController.archivarEquipamiento);
router.post('/:id/categorias/archivar', authMiddleware.attachUser, authMiddleware.requireEquipmentManagementRole, refugioController.archivarCategoriaEquipamiento);
router.delete('/:id', authMiddleware.attachUser, authMiddleware.requireAdminRole, refugioController.archivarRefugio);
router.post('/:id/solicitudes', authMiddleware.attachUser, authMiddleware.requireNonSkierRole, refugioController.crearSolicitudEquipamiento);
router.post('/:id/solicitudes/:solicitudId', authMiddleware.attachUser, authMiddleware.requireEquipmentManagementRole, refugioController.resolverSolicitudEquipamiento);
router.post('/:id/prestamos/:prestamoId/items/:itemId/devolucion', authMiddleware.attachUser, refugioController.registrarDevolucion);

module.exports = router;
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const SUPER_ADMIN_EMAIL = 'administracion@sledge.cl';
const JWT_SECRET = process.env.JWT_SECRET;

const normalizarRol = (user) => {
  const email = String(user && user.gmail || '').trim().toLowerCase();
  if (email === SUPER_ADMIN_EMAIL) return 'Super Admin';

  const rol = String(user && user.rol || '').trim().toLowerCase();
  const roles = {
    'usuario': 'Usuario / Esquiador',
    'esquiador': 'Usuario / Esquiador',
    'usuario / esquiador': 'Usuario / Esquiador',
    'ski patrol': 'Ski Patrol',
    'operador de refugio': 'Operador de Refugio',
    'administrador de refugio': 'Admin',
    'administrador': 'Admin',
    'admin': 'Admin',
    'mantenimiento': 'Mantenimiento',
    'técnico de mantenimiento': 'Mantenimiento',
    'tecnico de mantenimiento': 'Mantenimiento',
    'operador de mantenimiento': 'Mantenimiento',
    'super admin': 'Usuario / Esquiador'
  };
  return roles[rol] || 'Usuario / Esquiador';
};

const rolesAdmin = ['Admin', 'Super Admin'];
const rolesGestores = ['Operador de Refugio', ...rolesAdmin];
const rolesMantenimiento = ['Mantenimiento', ...rolesGestores];
const rolesInventario = ['Ski Patrol', 'Mantenimiento', ...rolesGestores];

const authMiddleware = {
  normalizarRol,

  attachUser: (req, res, next) => {
    const token = (req.cookies && req.cookies.jwt_token) ||
      (req.headers.authorization && req.headers.authorization.split(' ')[1]);

    if (!token) {
      req.user = null;
      res.locals.user = null;
      return res.redirect('/');
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      User.findById(decoded.id, (err, dbUser) => {
        if (err) return next(err);
        if (!dbUser) {
          res.clearCookie('jwt_token');
          req.user = null;
          res.locals.user = null;
          return res.redirect('/');
        }
        if (Number(dbUser.activo) === 0) {
          res.clearCookie('jwt_token');
          req.user = null;
          res.locals.user = null;
          return res.status(403).send('La cuenta está inactiva. Contacta a un administrador.');
        }
        dbUser.rol = normalizarRol(dbUser);
        try {
          res.locals.userPreferences = JSON.parse(dbUser.preferencias_json || '{}');
        } catch (error) {
          console.error('[AUTH] Preferencias de usuario inválidas:', error.message);
          res.locals.userPreferences = {};
        }
        req.user = dbUser;
        res.locals.user = dbUser;
        next();
      });
    } catch (err) {
      res.clearCookie('jwt_token');
      req.user = null;
      res.locals.user = null;
      return res.redirect('/');
    }
  },

  requireAdminRole: (req, res, next) => {
    if (req.user && rolesAdmin.includes(req.user.rol)) return next();
    return res.status(403).send('Acceso denegado: se requiere rol Admin.');
  },

  requireSuperAdminRole: (req, res, next) => {
    if (req.user && String(req.user.gmail || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL &&
        req.user.rol === 'Super Admin') return next();
    return res.status(403).send('Acceso denegado: esta función es exclusiva de Super Admin.');
  },

  requireEquipmentManagementRole: (req, res, next) => {
    if (req.user && rolesGestores.includes(req.user.rol)) return next();
    return res.status(403).send('Acceso denegado: se requiere administración u operación de refugio.');
  },

  requireMaintenanceRole: (req, res, next) => {
    if (req.user && rolesMantenimiento.includes(req.user.rol)) return next();
    return res.status(403).json({ success: false, error: 'No tienes permiso para gestionar mantenimiento.' });
  },

  requireMaintenanceModuleRole: (req, res, next) => {
    if (req.user && ['Mantenimiento', ...rolesAdmin].includes(req.user.rol)) return next();
    return res.status(403).send('Acceso denegado: este módulo es exclusivo de Mantenimiento y Admin.');
  },

  requireRefugioManagementRole: (req, res, next) => {
    if (req.user && rolesGestores.includes(req.user.rol)) return next();
    return res.status(403).json({ success: false, error: 'No tienes permiso para crear refugios.' });
  },

  requireTurnosRole: (req, res, next) => {
    if (req.user && ['Ski Patrol', 'Operador de Refugio', 'Mantenimiento', 'Admin', 'Super Admin'].includes(req.user.rol)) return next();
    return res.status(403).send('Acceso denegado: los turnos no están disponibles para usuarios esquiadores.');
  },

  requireNonSkierRole: (req, res, next) => {
    if (req.user && req.user.rol !== 'Usuario / Esquiador') return next();
    return res.status(403).json({ success: false, error: 'Esta función no está disponible para usuarios esquiadores.' });
  },

  requirePatrolOrAdminRole: (req, res, next) => {
    if (req.user && ['Ski Patrol', ...rolesGestores, 'Mantenimiento'].includes(req.user.rol)) return next();
    return res.status(403).json({ success: false, error: 'Se requiere Ski Patrol o un rol superior.' });
  },

  requireIncidentAccessRole: (req, res, next) => {
    if (req.user && ['Ski Patrol', ...rolesAdmin].includes(req.user.rol)) return next();
    return res.status(403).send('Acceso denegado: solo Ski Patrol y Admin pueden consultar incidentes.');
  },

  requirePatrolLocationRole: (req, res, next) => {
    if (req.user && req.user.rol === 'Ski Patrol') return next();
    return res.status(403).json({ success: false, error: 'Solo Ski Patrol puede compartir su ubicación activa.' });
  },

  requireMapViewerRole: (req, res, next) => {
    if (req.user && req.user.rol !== 'Usuario / Esquiador') return next();
    return res.status(403).json({ success: false, error: 'No tienes permiso para consultar ubicaciones de patrulleros.' });
  },

  requireInventoryDashboardRole: (req, res, next) => {
    if (req.user && rolesInventario.includes(req.user.rol)) return next();
    return res.status(403).json({ success: false, error: 'No tienes permiso para consultar este panel.' });
  },

  requireEquipmentReportRole: (req, res, next) => {
    if (req.user && ['Ski Patrol', ...rolesMantenimiento].includes(req.user.rol)) return next();
    return res.status(403).json({ success: false, error: 'No tienes permiso para reportar equipos.' });
  },

  requireSosManagementRole: (req, res, next) => {
    if (req.user && ['Operador de Refugio', ...rolesAdmin].includes(req.user.rol)) return next();
    return res.status(403).json({ success: false, error: 'Solo Operador de Refugio o Admin puede configurar contactos SOS.' });
  }
};

module.exports = authMiddleware;
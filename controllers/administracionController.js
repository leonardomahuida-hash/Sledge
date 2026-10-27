const User = require('../models/User');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const ROLES = [
  'Usuario / Esquiador',
  'Ski Patrol',
  'Operador de Refugio',
  'Mantenimiento',
  'Admin',
  'Super Admin'
];
const SUPER_ADMIN_EMAIL = 'administracion@sledge.cl';

exports.renderAdministracion = (req, res) => {
  db.all(
    `SELECT t.id, t.fecha, t.hora_inicio, t.hora_fin, t.estado, t.rol,
            u.nombre AS nombre_usuario,
            CASE WHEN t.hora_inicio IS NOT NULL AND t.hora_fin IS NOT NULL
              THEN ROUND(((CAST(substr(t.hora_fin, 1, 2) AS INTEGER) * 60 + CAST(substr(t.hora_fin, 4, 2) AS INTEGER) -
                           CAST(substr(t.hora_inicio, 1, 2) AS INTEGER) * 60 - CAST(substr(t.hora_inicio, 4, 2) AS INTEGER) + 1440) % 1440) / 60.0, 1)
              ELSE NULL END AS horas_registradas,
            GROUP_CONCAT(e.codigo || ' · ' || e.nombre, ', ') AS recursos
     FROM turnos t
     JOIN usuarios u ON u.id = t.usuario_id
     LEFT JOIN asignacion_recurso a ON a.id_turno = t.id
     LEFT JOIN equipamientos e ON e.id = a.id_equipamiento
     GROUP BY t.id
     ORDER BY t.fecha DESC, t.hora_inicio DESC LIMIT 500`,
    [],
    (error, turnosHistorial) => {
      if (error) return res.status(500).send('No se pudo cargar el historial de turnos y recursos.');
      res.render('administracion', { page: 'administracion', turnosHistorial: turnosHistorial || [] });
    }
  );
};

exports.renderIncidentes = (req, res) => {
  db.all(
    `SELECT i.id, i.tipo, i.descripcion, i.latitud, i.longitud, i.creado_en,
            u.nombre AS reportado_por
     FROM incidentes i JOIN usuarios u ON u.id = i.usuario_id
     ORDER BY datetime(i.creado_en) DESC LIMIT 500`,
    [],
    (error, incidentes) => {
      if (error) return res.status(500).send('No se pudo cargar el historial de incidentes.');
      res.render('administracion-incidentes', { page: 'incidentes', incidentes: incidentes || [] });
    }
  );
};

exports.reportarIncidente = (req, res) => {
  const tipo = String(req.body.tipo || '');
  const descripcion = String(req.body.descripcion || '').trim();
  const latitud = Number(req.body.latitud);
  const longitud = Number(req.body.longitud);
  if (!['Incidente', 'Accidente'].includes(tipo) || descripcion.length < 5 || descripcion.length > 3000 ||
      !Number.isFinite(latitud) || latitud < -90 || latitud > 90 ||
      !Number.isFinite(longitud) || longitud < -180 || longitud > 180) {
    return res.status(400).json({ success: false, error: 'Indica el tipo, una descripción y una ubicación GPS válida.' });
  }
  db.run(
    `INSERT INTO incidentes (usuario_id, tipo, descripcion, latitud, longitud)
     VALUES (?, ?, ?, ?, ?)`,
    [req.user.id, tipo, descripcion, latitud, longitud],
    function(error) {
      if (error) return res.status(500).json({ success: false, error: 'No se pudo registrar el incidente.' });
      res.status(201).json({ success: true, id: this.lastID });
    }
  );
};

exports.renderConfiguracionRefugio = (req, res) => {
  const Refugio = require('../models/Refugio');
  Refugio.getClimatico((error, montana) => {
    if (error) return res.status(500).send('No se pudo cargar la configuración de montaña.');
    res.render('administracion-refugio', { page: 'administracion', montana });
  });
};

exports.actualizarConfiguracionRefugio = (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const latitud = Number(req.body.latitud);
  const longitud = Number(req.body.longitud);
  const altura = Number(req.body.altura);
  if (!nombre || nombre.length > 120 ||
      !Number.isFinite(latitud) || latitud < -90 || latitud > 90 ||
      !Number.isFinite(longitud) || longitud < -180 || longitud > 180 ||
      !Number.isFinite(altura) || altura < 0 || altura > 9000) {
    return res.status(400).json({ success: false, error: 'Revisa el nombre, las coordenadas y la altitud de la montaña.' });
  }
  const settings = {
    montana_nombre: nombre,
    montana_latitud: String(latitud),
    montana_longitud: String(longitud),
    montana_altura: String(altura)
  };
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la configuración de montaña.' });
      const keys = Object.keys(settings);
      let index = 0;
      const saveNext = () => {
        if (index >= keys.length) {
          return db.run('COMMIT', commitError => {
            if (commitError) return db.run('ROLLBACK', () => res.status(500).json({ success: false, error: 'No se pudo confirmar la configuración de montaña.' }));
            res.json({ success: true, montana: { nombre, latitud, longitud, altura } });
          });
        }
        const key = keys[index++];
        db.run(
          `INSERT INTO configuracion (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, settings[key]],
          saveError => {
            if (saveError) return db.run('ROLLBACK', () => res.status(500).json({ success: false, error: 'No se pudo guardar la configuración de montaña.' }));
            saveNext();
          }
        );
      };
      saveNext();
    });
  });
};

exports.renderUsuarios = (req, res) => {
  User.findAll((error, users) => {
    if (error) return res.status(500).send('No se pudo cargar la lista de usuarios.');
    res.render('administracion-usuarios', {
      page: 'administracion',
      users: users || [],
      roles: ROLES,
      superAdminEmail: SUPER_ADMIN_EMAIL
    });
  });
};

exports.renderAuditoria = (req, res) => {
  db.all(
    `SELECT id, creado_en, usuario_id, correo, rol, metodo, recurso, codigo_respuesta, ip
     FROM auditoria_sistema ORDER BY id DESC LIMIT 500`,
    [],
    (error, eventos) => {
      if (error) return res.status(500).send('No se pudo cargar la auditoría del sistema.');
      res.render('administracion-auditoria', { page: 'administracion', eventos: eventos || [] });
    }
  );
};

exports.actualizarRolUsuario = (req, res) => {
  const id = Number(req.params.id);
  const nombre = String(req.body.nombre || '').trim();
  const gmail = String(req.body.gmail || '').trim().toLowerCase();
  const rol = String(req.body.rol || '');
  const activo = req.body.activo === undefined ? 1 : Number(req.body.activo);
  if (!Number.isSafeInteger(id) || id < 1 || !ROLES.includes(rol)) {
    return res.status(400).json({ success: false, error: 'El usuario o rol seleccionado no es válido.' });
  }
  if ((req.body.nombre !== undefined && (!nombre || nombre.length > 120)) ||
      (req.body.gmail !== undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail) || gmail.length > 254)) ||
      ![0, 1].includes(activo)) {
    return res.status(400).json({ success: false, error: 'Revisa el nombre, correo y estado activo del usuario.' });
  }
  if (rol === 'Super Admin') {
    return res.status(403).json({ success: false, error: 'Super Admin está reservado exclusivamente para el correo institucional.' });
  }
  User.findById(id, (lookupError, account) => {
    if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo consultar la cuenta.' });
    if (!account || account.gmail.trim().toLowerCase() === SUPER_ADMIN_EMAIL) {
      return res.status(404).json({ success: false, error: 'El usuario no existe o es la cuenta protegida de Super Admin.' });
    }
    const datos = {
      nombre: req.body.nombre === undefined ? account.nombre : nombre,
      gmail: req.body.gmail === undefined ? account.gmail : gmail,
      rol,
      activo
    };
    User.findByEmail(datos.gmail, (emailError, duplicate) => {
      if (emailError) return res.status(500).json({ success: false, error: 'No se pudo validar el correo.' });
      if (duplicate && duplicate.id !== id) return res.status(409).json({ success: false, error: 'El correo ya pertenece a otra cuenta.' });
      User.updateAdminProfile(id, datos, SUPER_ADMIN_EMAIL, function(error, updated) {
        if (error && error.code === 'SQLITE_CONSTRAINT') {
          return res.status(409).json({ success: false, error: 'El correo ya pertenece a otra cuenta.' });
        }
        if (error) return res.status(500).json({ success: false, error: 'No se pudo guardar el usuario.' });
        if (!updated) return res.status(404).json({ success: false, error: 'El usuario no existe o no puede modificarse.' });
        res.json({ success: true, nombre: datos.nombre, gmail: datos.gmail, rol, activo });
      });
    });
  });
};

exports.darDeBajaUsuario = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'El usuario seleccionado no es válido.' });
  User.updateActiveStatus(id, 0, SUPER_ADMIN_EMAIL, (error, updated) => {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo dar de baja el usuario.' });
    if (!updated) return res.status(404).json({ success: false, error: 'El usuario no existe o es la cuenta protegida.' });
    res.json({ success: true, activo: 0 });
  });
};

exports.eliminarUsuario = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'El usuario seleccionado no es válido.' });
  User.deleteIfUnreferenced(id, SUPER_ADMIN_EMAIL, (error, deleted, reason) => {
    if (error && error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ success: false, error: 'La cuenta tiene registros asociados y no puede eliminarse.' });
    }
    if (error) return res.status(500).json({ success: false, error: 'No se pudo eliminar el usuario.' });
    if (!deleted) return res.status(reason ? 409 : 404).json({ success: false, error: reason || 'El usuario no existe o es la cuenta protegida.' });
    res.json({ success: true });
  });
};

exports.crearUsuarioAdministrativo = (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const rut = String(req.body.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  const gmail = String(req.body.gmail || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const rol = String(req.body.rol || '');
  const nivelExperiencia = String(req.body.nivel_experiencia || '');
  const nivelesValidos = ['Junior', 'Intermedio', 'Senior', 'Especialista'];
  const rolesRegistrables = ['Ski Patrol', 'Operador de Refugio', 'Mantenimiento', 'Admin'];
  if (gmail === SUPER_ADMIN_EMAIL) {
    return res.status(409).json({ success: false, error: 'El correo de Super Admin está reservado.' });
  }
  if (!nombre || nombre.length > 120 || rut.length < 2 || rut.length > 9 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail) || password.length < 8 || !rolesRegistrables.includes(rol) ||
      (rol === 'Ski Patrol' && !nivelesValidos.includes(nivelExperiencia))) {
    return res.status(400).json({ success: false, error: 'Revisa los datos, el rol y el nivel de experiencia requerido para Ski Patrol.' });
  }
  User.findByEmail(gmail, (lookupError, existingUser) => {
    if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo validar el correo.' });
    if (existingUser) return res.status(409).json({ success: false, error: 'El correo ya está registrado.' });
    const rutFormateado = `${rut.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${rut.slice(-1)}`;
    bcrypt.hash(password, 12).then(passwordHash => {
      User.create({
        nombre,
        rut: rutFormateado,
        gmail,
        password: passwordHash,
        rol,
        nivel_experiencia: rol === 'Ski Patrol' ? nivelExperiencia : null
      }, error => {
        if (error) {
          const duplicate = error.code === 'SQLITE_CONSTRAINT';
          return res.status(duplicate ? 409 : 500).json({
            success: false,
            error: duplicate ? 'El RUT o correo ya está registrado.' : 'No se pudo crear la cuenta.'
          });
        }
        res.status(201).json({ success: true });
      });
    }).catch(error => {
      console.error('[ADMINISTRACION] No se pudo hashear la contraseña del patrullero:', error.message);
      res.status(500).json({ success: false, error: 'No se pudo asegurar la contraseña del patrullero.' });
    });
  });
};

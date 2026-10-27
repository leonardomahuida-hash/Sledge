const User = require('../models/User');
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const avatarDirectory = path.join(__dirname, '../public/uploads/avatars');

async function guardarArchivoAvatar(dataUrl) {
  const encoded = dataUrl.slice('data:image/jpeg;base64,'.length);
  const image = Buffer.from(encoded, 'base64');
  if (image.length < 4 || image.length > 2 * 1024 * 1024 ||
      image.toString('base64') !== encoded ||
      image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff ||
      image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
    const error = new Error('La imagen seleccionada no es un JPEG válido de hasta 2 MB.');
    error.code = 'INVALID_AVATAR';
    throw error;
  }
  await fs.mkdir(avatarDirectory, { recursive: true });
  const filename = `${crypto.randomUUID()}.jpg`;
  await fs.writeFile(path.join(avatarDirectory, filename), image, { flag: 'wx' });
  return `/uploads/avatars/${filename}`;
}

function eliminarAvatarAnterior(fotoPerfil) {
  const match = /^\/uploads\/avatars\/([a-f0-9-]{36}\.jpg)$/.exec(String(fotoPerfil || ''));
  if (!match) return;
  fs.unlink(path.join(avatarDirectory, match[1])).catch(error => {
    if (error.code !== 'ENOENT') console.error('[PERFIL] No se pudo retirar el avatar anterior:', error.message);
  });
}

exports.renderUsuario = (req, res) => {
  User.findById(req.user.id, (err, user) => {
    if (err) return res.status(500).send('No se pudo cargar el perfil.');
    if (!user) return res.status(404).send('El perfil ya no existe.');
    db.all(
      `SELECT e.id, e.nombre, e.codigo, e.estado, e.categoria
       FROM asignacion_recurso a
       JOIN turnos t ON t.id = a.id_turno
       JOIN equipamientos e ON e.id = a.id_equipamiento
       WHERE t.usuario_id = ? AND a.fecha_hora_devolucion IS NULL
       ORDER BY e.nombre`,
      [req.user.id],
      (equipmentError, equipment) => {
        if (equipmentError) return res.status(500).send('No se pudo cargar el equipamiento asignado.');
        db.get('SELECT numero_pase, tipo_pase, fecha_expiracion, estado FROM pases_montana WHERE usuario_id = ?', [req.user.id], async (passError, pass) => {
          if (passError) return res.status(500).send('No se pudo cargar el pase de montaña.');
          let passQr = '';
          if (pass) {
            try {
              passQr = await QRCode.toDataURL(`SLEDGE-PASE:${pass.numero_pase}`, {
                errorCorrectionLevel: 'M',
                margin: 1,
                width: 180
              });
            } catch (error) {
              console.error('[PERFIL] No se pudo generar el código QR del pase:', error.message);
              return res.status(500).send('No se pudo generar el código QR del pase.');
            }
          }
          const paseVigente = Boolean(pass && pass.estado === 'Activo' && pass.fecha_expiracion >= new Date().toISOString().slice(0, 10));
          res.render('usuario', {
            page: 'usuario',
            user,
            equipoAsignado: equipment || [],
            contactosEmergencia: res.locals.sosContacts || [],
            paseMontana: pass || null,
            paseQr: passQr,
            paseVigente
          });
        });
      }
    );
  });
};

exports.asociarPaseMontana = (req, res) => {
  const numeroPase = String(req.body.numero_pase || '').trim().toUpperCase();
  const tipoPase = String(req.body.tipo_pase || '').trim();
  const fechaExpiracion = String(req.body.fecha_expiracion || '');
  const tiposPermitidos = ['Diario', 'Temporada', 'Estudiante', 'Residente', 'Otro'];
  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fechaExpiracion) &&
    !Number.isNaN(Date.parse(`${fechaExpiracion}T00:00:00Z`)) &&
    new Date(`${fechaExpiracion}T00:00:00Z`).toISOString().slice(0, 10) === fechaExpiracion;
  if (!/^[A-Z0-9-]{4,40}$/.test(numeroPase) || !tiposPermitidos.includes(tipoPase) || !fechaValida) {
    return res.status(400).json({ success: false, error: 'Revisa el número, tipo y fecha de expiración del pase.' });
  }
  db.run(
    `INSERT INTO pases_montana (usuario_id, numero_pase, tipo_pase, fecha_expiracion, estado)
     VALUES (?, ?, ?, ?, CASE WHEN ? >= date('now') THEN 'Activo' ELSE 'Expirado' END)
     ON CONFLICT(usuario_id) DO UPDATE SET
       numero_pase = excluded.numero_pase,
       tipo_pase = excluded.tipo_pase,
       fecha_expiracion = excluded.fecha_expiracion,
       estado = excluded.estado,
       actualizado_en = CURRENT_TIMESTAMP`,
    [req.user.id, numeroPase, tipoPase, fechaExpiracion, fechaExpiracion],
    function(error) {
      if (error && error.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ success: false, error: 'Ese número de pase ya está asociado a otra cuenta.' });
      }
      if (error) return res.status(500).json({ success: false, error: 'No se pudo asociar el pase de montaña.' });
      res.json({ success: true, pase: { numero_pase: numeroPase, tipo_pase: tipoPase, fecha_expiracion: fechaExpiracion } });
    }
  );
};

exports.actualizarDatosPersonales = (req, res) => {
  const telefono = String(req.body.telefono_contacto || '').trim();
  const contactoNombre = String(req.body.contacto_emergencia_nombre || '').trim();
  const contactoTelefono = String(req.body.contacto_emergencia_telefono || '').trim();
  const grupoSangre = String(req.body.grupo_sangre || '');
  const alergias = String(req.body.alergias || '').trim();
  const enfermedadesCronicas = String(req.body.enfermedades_cronicas || '').trim();
  const medicamentosDiarios = String(req.body.medicamentos_diarios || '').trim();
  const disponibilidad = String(req.body.estado_disponibilidad || '');
  const gruposSanguineos = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'N/A'];
  const disponibilidades = ['Disponible', 'En servicio', 'Descanso', 'No disponible'];
  const telefonoValido = value => !value || /^\+?[0-9 ()-]{6,24}$/.test(value);
  if (telefono.length > 24 || contactoNombre.length > 120 || contactoTelefono.length > 24 ||
      !telefonoValido(telefono) || !telefonoValido(contactoTelefono) ||
      !gruposSanguineos.includes(grupoSangre) || alergias.length > 1000 ||
      enfermedadesCronicas.length > 1000 || medicamentosDiarios.length > 1000 ||
      !disponibilidades.includes(disponibilidad)) {
    return res.status(400).json({ success: false, error: 'Revisa los teléfonos, grupo sanguíneo, alergias y disponibilidad.' });
  }
  User.updatePersonalData(req.user.id, {
    telefono_contacto: telefono,
    contacto_emergencia_nombre: contactoNombre,
    contacto_emergencia_telefono: contactoTelefono,
    grupo_sangre: grupoSangre,
    alergias,
    enfermedades_cronicas: enfermedadesCronicas || 'N/A',
    medicamentos_diarios: medicamentosDiarios || 'N/A',
    estado_disponibilidad: disponibilidad
  }, function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudieron guardar los datos personales.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'El usuario no existe.' });
    res.json({ success: true });
  });
};

exports.renderTurnos = (req, res) => {
  const rolActual = String(req.user.rol || '').trim().toLowerCase();
  const puedeGestionarTurnos = ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'].includes(rolActual);
  const cargarTurnos = (usuarios) => {
    const query = puedeGestionarTurnos
      ? `SELECT t.*, u.nombre AS nombre_usuario, c.desarrollo AS cierre_desarrollo, c.rescate AS cierre_rescate
         FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
         LEFT JOIN cierres_turno c ON c.turno_id = t.id
         ORDER BY t.fecha DESC, t.hora_inicio`
      : `SELECT t.*, u.nombre AS nombre_usuario, c.desarrollo AS cierre_desarrollo, c.rescate AS cierre_rescate
         FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
         LEFT JOIN cierres_turno c ON c.turno_id = t.id
         WHERE t.usuario_id = ? ORDER BY t.fecha DESC, t.hora_inicio`;
    db.all(query, puedeGestionarTurnos ? [] : [req.user.id], (err, turnos) => {
      if (err) return res.status(500).send('No se pudo cargar el historial de turnos.');
      db.all(
        `SELECT e.id, e.codigo, e.nombre, e.estado, bi.id AS insumo_id,
                bi.nombre_insumo, bi.cantidad_disponible, bi.cantidad_critica
         FROM equipamientos e
         LEFT JOIN botiquin_insumos bi ON bi.botiquin_id = e.id
         WHERE e.eliminado = 0 AND lower(e.categoria) LIKE '%botiqu%'
         ORDER BY e.nombre, bi.nombre_insumo`,
        [],
        (kitError, rows) => {
          if (kitError) return res.status(500).send('No se pudo cargar el inventario de botiquines.');
          const kits = new Map();
          (rows || []).forEach(row => {
            if (!kits.has(row.id)) kits.set(row.id, {
              id: row.id,
              codigo: row.codigo,
              nombre: row.nombre,
              estado: row.estado,
              insumos: []
            });
            if (row.insumo_id) kits.get(row.id).insumos.push({
              id: row.insumo_id,
              nombre: row.nombre_insumo,
              disponible: row.cantidad_disponible,
              critica: row.cantidad_critica
            });
          });
          res.render('turnos', {
            page: 'turnos',
            turnos: turnos || [],
            usuarios: usuarios || [],
            puedeGestionarTurnos,
            botiquines: [...kits.values()]
          });
        }
      );
    });
  };
  if (puedeGestionarTurnos) return User.findAll((err, usuarios) => {
    if (err) return res.status(500).send('No se pudo cargar el equipo.');
    cargarTurnos(usuarios);
  });
  cargarTurnos([]);
};

exports.cerrarTurno = (req, res) => {
  const turnoId = Number(req.params.id);
  const desarrollo = String(req.body.desarrollo || '').trim();
  const rescate = String(req.body.rescate || '').trim();
  const botiquinId = Number(req.body.botiquin_id || 0);
  const consumos = req.body.consumos;
  const puedeGestionarTurnos = ['Admin', 'Super Admin', 'Operador de Refugio'].includes(req.user.rol);
  if (!Number.isSafeInteger(turnoId) || turnoId < 1 || desarrollo.length < 10 || desarrollo.length > 3000 ||
      rescate.length > 3000 || !Number.isSafeInteger(botiquinId) || botiquinId < 0 ||
      !Array.isArray(consumos) || consumos.length > 100) {
    return res.status(400).json({ success: false, error: 'Completa el desarrollo del turno y selecciona un botiquín válido.' });
  }
  const items = [];
  const vistos = new Set();
  for (const consumo of consumos) {
    const insumoId = Number(consumo.insumo_id);
    const cantidad = Number(consumo.cantidad);
    if (!Number.isSafeInteger(insumoId) || insumoId < 1 || !Number.isSafeInteger(cantidad) ||
        cantidad < 1 || vistos.has(insumoId)) {
      return res.status(400).json({ success: false, error: 'Revisa las cantidades de insumos marcados como gastados.' });
    }
    vistos.add(insumoId);
    items.push({ insumoId, cantidad });
  }

  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar el cierre del turno.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.get('SELECT id, usuario_id, estado FROM turnos WHERE id = ?', [turnoId], (turnError, turno) => {
        if (turnError) return rollback(500, 'No se pudo consultar el turno.');
        if (!turno) return rollback(404, 'El turno no existe.');
        if (!puedeGestionarTurnos && turno.usuario_id !== req.user.id) return rollback(403, 'No puedes cerrar el turno de otra persona.');
        if (turno.estado === 'Concluido') return rollback(409, 'El turno ya está concluido.');
        const guardarCierre = () => db.run(
          `INSERT INTO cierres_turno (turno_id, usuario_id, desarrollo, rescate)
           VALUES (?, ?, ?, ?)`,
          [turnoId, req.user.id, desarrollo, rescate],
          closureError => {
            if (closureError) return rollback(409, 'El cierre ya existe o no se pudo guardar.');
            db.run("UPDATE turnos SET estado = 'Concluido' WHERE id = ?", [turnoId], updateError => {
              if (updateError) return rollback(500, 'No se pudo marcar el turno como concluido.');
              db.run('COMMIT', commitError => {
                if (commitError) return rollback(500, 'No se pudo confirmar el cierre del turno.');
                res.json({ success: true });
              });
            });
          }
        );
        if (botiquinId === 0) {
          if (items.length) return rollback(400, 'Selecciona un botiquín para descontar los insumos consumidos.');
          return guardarCierre();
        }
        db.get(
          `SELECT id FROM equipamientos
           WHERE id = ? AND eliminado = 0 AND lower(categoria) LIKE '%botiqu%'`,
          [botiquinId],
          (kitError, kit) => {
            if (kitError) return rollback(500, 'No se pudo consultar el botiquín seleccionado.');
            if (!kit) return rollback(404, 'El botiquín seleccionado no existe.');
            let index = 0;
            const descontarSiguiente = () => {
              if (index >= items.length) {
                return db.run(
                  `UPDATE equipamientos
                   SET estado = CASE
                     WHEN EXISTS (
                       SELECT 1 FROM botiquin_insumos
                       WHERE botiquin_id = ? AND cantidad_disponible < cantidad_critica
                     ) THEN 'Incompleto' ELSE 'Operativo' END
                   WHERE id = ? AND estado IN ('Operativo', 'Incompleto')`,
                  [botiquinId, botiquinId],
                  stateError => {
                    if (stateError) return rollback(500, 'No se pudo actualizar el estado del botiquín.');
                    guardarCierre();
                  }
                );
              }
              const item = items[index++];
              db.run(
                `UPDATE botiquin_insumos
                 SET cantidad_disponible = cantidad_disponible - ?
                 WHERE id = ? AND botiquin_id = ? AND cantidad_disponible >= ?`,
                [item.cantidad, item.insumoId, botiquinId, item.cantidad],
                function(updateError) {
                  if (updateError) return rollback(500, 'No se pudo descontar un insumo del botiquín.');
                  if (this.changes !== 1) return rollback(409, 'La cantidad disponible cambió; revisa el botiquín.');
                  descontarSiguiente();
                }
              );
            };
            if (!items.length) return descontarSiguiente();
            db.all(
              `SELECT id FROM botiquin_insumos WHERE botiquin_id = ?`,
              [botiquinId],
              (itemsError, availableItems) => {
                if (itemsError) return rollback(500, 'No se pudo revisar el contenido del botiquín.');
                const registered = new Set((availableItems || []).map(item => item.id));
                if (items.some(item => !registered.has(item.insumoId))) return rollback(400, 'El formulario incluye un insumo que no pertenece al botiquín.');
                descontarSiguiente();
              }
            );
          }
        );
      });
    });
  });
};

exports.guardarTurno = (req, res) => {
  const { usuario_id, fecha, hora_inicio, hora_fin, estado, rol } = req.body;
  const rolActual = String(req.user.rol || '').trim().toLowerCase();
  const puedeGestionarTurnos = ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'].includes(rolActual);
  const esAdministrador = ['administrador de refugio', 'admin', 'administrador', 'super admin'].includes(rolActual);
  if (!puedeGestionarTurnos) return res.status(403).json({ success: false, error: 'No tienes permiso para asignar turnos.' });
  const targetId = Number(usuario_id);
  const estadosValidos = ['Operativo', 'Descanso'];
  const rolesValidos = ['Operador de Refugio', 'Admin', 'Ski Patrol', 'Mantenimiento', 'Usuario / Esquiador'];
  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) && !Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) && new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) === fecha;
  const rolAsignado = rol;
  if (!Number.isInteger(targetId) || !fechaValida || !estadosValidos.includes(estado) || !rolesValidos.includes(rolAsignado)) {
    return res.status(400).json({ success: false, error: 'Revisa la fecha, el estado y el rol seleccionados.' });
  }
  if (!esAdministrador && rolAsignado === 'Admin') {
    return res.status(403).json({ success: false, error: 'Solo Admin o Super Admin puede asignar el rol Admin.' });
  }
  if ((hora_inicio && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora_inicio)) || (hora_fin && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora_fin)) || Boolean(hora_inicio) !== Boolean(hora_fin)) {
    return res.status(400).json({ success: false, error: 'Indica una hora de inicio y fin válidas.' });
  }
  if (hora_inicio && hora_fin && hora_fin === hora_inicio) {
    return res.status(400).json({ success: false, error: 'La duración del turno no puede ser de cero horas.' });
  }
  User.findById(targetId, (lookupError, targetUser) => {
    if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo validar a la persona asignada.' });
    if (!targetUser) return res.status(404).json({ success: false, error: 'La persona asignada no existe.' });
    db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la asignación.' });
      const rollback = error => db.run('ROLLBACK', () => res.status(500).json({ success: false, error }));
      db.run('INSERT INTO turnos (usuario_id, fecha, hora_inicio, hora_fin, estado, rol) VALUES (?, ?, ?, ?, ?, ?)',
        [targetId, fecha, hora_inicio || null, hora_fin || null, estado, rolAsignado], insertError => {
          if (insertError) return rollback('No se pudo guardar el turno.');
          db.run('COMMIT', commitError => {
            if (commitError) return rollback('No se pudo confirmar el turno.');
            res.status(201).json({ success: true });
          });
        });
    });
    });
  });
};

exports.actualizarPerfil = (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const apodo = String(req.body.apodo || '').trim();
  const fotoPerfil = req.body.foto_perfil === undefined ? req.user.foto_perfil : String(req.body.foto_perfil);
  if (!nombre || nombre.length > 120 || apodo.length > 60) {
    return res.status(400).json({ success: false, error: 'El nombre y el apodo deben tener una longitud válida.' });
  }
  if (typeof fotoPerfil !== 'string' || fotoPerfil.length > 2800000 ||
      (fotoPerfil !== req.user.foto_perfil && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(fotoPerfil))) {
    return res.status(400).json({ success: false, error: 'La imagen debe ser JPEG y no superar el límite permitido.' });
  }

  const guardarPerfil = async () => {
    let rutaFoto = fotoPerfil;
    if (fotoPerfil !== req.user.foto_perfil && fotoPerfil.startsWith('data:image/jpeg;base64,')) {
      try {
        rutaFoto = await guardarArchivoAvatar(fotoPerfil);
      } catch (error) {
        if (error.code === 'INVALID_AVATAR') {
          return res.status(400).json({ success: false, error: error.message });
        }
        console.error('[PERFIL] No se pudo guardar el archivo de avatar:', error.message);
        return res.status(500).json({ success: false, error: 'No se pudo guardar la foto de perfil.' });
      }
    }
    User.updateProfile(req.user.id, {
      nombre,
      apodo,
      foto_perfil: rutaFoto
    }, error => {
      if (error) {
        if (rutaFoto !== fotoPerfil) eliminarAvatarAnterior(rutaFoto);
        return res.status(500).json({ success: false, error: 'No se pudo guardar el perfil.' });
      }
      if (rutaFoto !== req.user.foto_perfil) eliminarAvatarAnterior(req.user.foto_perfil);
      res.json({ success: true, nombre, apodo, foto_perfil: rutaFoto });
    });
  };

  if (nombre === req.user.nombre) return guardarPerfil();
  const currentPassword = String(req.body.current_password || '');
  if (!currentPassword) {
    return res.status(400).json({ success: false, error: 'Confirma tu contraseña actual para cambiar el nombre.' });
  }
  User.findById(req.user.id, (lookupError, user) => {
    if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo validar tu contraseña.' });
    if (!user) return res.status(404).json({ success: false, error: 'El usuario no existe.' });
    User.verifyPassword(user.password, currentPassword).then(valid => {
      if (!valid) return res.status(401).json({ success: false, error: 'La contraseña actual es incorrecta.' });
      guardarPerfil();
    }).catch(error => {
      console.error('[PERFIL] Error validando contraseña:', error.message);
      res.status(500).json({ success: false, error: 'No se pudo validar tu contraseña.' });
    });
  });
};

exports.actualizarPassword = (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirmPassword = String(req.body.confirm_password || '');
  if (!currentPassword || newPassword.length < 8 || newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 8 caracteres y coincidir en ambos campos.' });
  }
  User.findById(req.user.id, (lookupError, user) => {
    if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo validar tu contraseña.' });
    if (!user) return res.status(404).json({ success: false, error: 'El usuario no existe.' });
    User.verifyPassword(user.password, currentPassword).then(valid => {
      if (!valid) return res.status(401).json({ success: false, error: 'La contraseña actual es incorrecta.' });
      return bcrypt.hash(newPassword, 12).then(passwordHash => {
        User.updatePassword(req.user.id, passwordHash, error => {
          if (error) return res.status(500).json({ success: false, error: 'No se pudo actualizar la contraseña.' });
          res.json({ success: true });
        });
      });
    }).catch(error => {
      console.error('[PERFIL] Error actualizando contraseña:', error.message);
      res.status(500).json({ success: false, error: 'No se pudo actualizar la contraseña.' });
    });
  });
};

exports.actualizarApodo = (req, res) => {
  const userId = req.user ? req.user.id : null;
  if (!userId) return res.status(401).json({ success: false, error: "Usuario no autenticado" });

  const { apodo } = req.body;
  if (typeof apodo !== 'string' || apodo.trim().length > 60) {
    return res.status(400).json({ success: false, error: 'El apodo no puede superar 60 caracteres.' });
  }
  User.updateApodo(userId, apodo || '', (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, apodo });
  });
};

exports.actualizarFoto = (req, res) => {
  const userId = req.user ? req.user.id : null;
  if (!userId) return res.status(401).json({ success: false, error: "Usuario no autenticado" });

  const { fotoBase64 } = req.body;
  if (typeof fotoBase64 !== 'string' || fotoBase64.length > 2800000 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(fotoBase64)) {
    return res.status(400).json({ success: false, error: "La imagen debe ser JPEG y no superar el límite permitido." });
  }

  guardarArchivoAvatar(fotoBase64).then(rutaFoto => {
    User.updateFoto(userId, rutaFoto, error => {
      if (error) {
        eliminarAvatarAnterior(rutaFoto);
        return res.status(500).json({ success: false, error: 'No se pudo guardar la foto de perfil.' });
      }
      eliminarAvatarAnterior(req.user.foto_perfil);
      res.json({ success: true, foto_perfil: rutaFoto });
    });
  }).catch(error => {
    if (error.code === 'INVALID_AVATAR') return res.status(400).json({ success: false, error: error.message });
    console.error('[PERFIL] No se pudo guardar la foto de perfil:', error.message);
    res.status(500).json({ success: false, error: 'No se pudo guardar la foto de perfil.' });
  });
};

exports.actualizarMedica = (req, res) => {
  const userId = req.user ? req.user.id : null;
  if (!userId) return res.status(401).json({ success: false, error: "Usuario no autenticado" });

  const { campo, valor } = req.body;
  User.updateCampoMedico(userId, campo, valor, (err) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true, campo, valor });
  });
};
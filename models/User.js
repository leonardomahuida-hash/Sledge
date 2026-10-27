const db = require('../config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class User {
  static verifyPassword(password, candidate) {
    if (/^\$2[aby]\$/.test(password)) return bcrypt.compare(candidate, password);
    const storedBuffer = Buffer.from(String(password || ''), 'utf8');
    const candidateBuffer = Buffer.from(String(candidate || ''), 'utf8');
    return Promise.resolve(
      storedBuffer.length === candidateBuffer.length &&
      crypto.timingSafeEqual(storedBuffer, candidateBuffer)
    );
  }

  static findByEmail(gmail, callback) {
    db.get("SELECT * FROM usuarios WHERE lower(gmail) = lower(?)", [gmail], callback);
  }

  static findById(id, callback) {
    db.get("SELECT * FROM usuarios WHERE id = ?", [id], callback);
  }

  static findAll(callback) {
    db.all(
      `SELECT u.id, u.nombre, u.gmail, u.rol, u.activo,
              COUNT(DISTINCT CASE WHEN a.fecha_hora_devolucion IS NULL THEN a.id_asignacion END) AS equipamiento_asignado
       FROM usuarios u
       LEFT JOIN turnos t ON t.usuario_id = u.id
       LEFT JOIN asignacion_recurso a ON a.id_turno = t.id
       GROUP BY u.id
       ORDER BY u.nombre`,
      [],
      callback
    );
  }

  static updateAdminProfile(id, { nombre, gmail, rol, activo }, reservedEmail, callback) {
    db.run(
      `UPDATE usuarios SET nombre = ?, gmail = ?, rol = ?, activo = ?
       WHERE id = ? AND lower(trim(gmail)) <> lower(?)`,
      [nombre, gmail, rol, activo, id, reservedEmail],
      function(error) {
        callback(error, !error && this.changes === 1);
      }
    );
  }

  static updateActiveStatus(id, activo, reservedEmail, callback) {
    db.run(
      'UPDATE usuarios SET activo = ? WHERE id = ? AND lower(trim(gmail)) <> lower(?)',
      [activo, id, reservedEmail],
      function(error) {
        callback(error, !error && this.changes === 1);
      }
    );
  }

  static deleteIfUnreferenced(id, reservedEmail, callback) {
    db.get(
      `SELECT
         (SELECT COUNT(*) FROM turnos WHERE usuario_id = ?) AS turnos,
         (SELECT COUNT(*) FROM solicitudes_equipamiento WHERE usuario_id = ?) AS solicitudes,
         (SELECT COUNT(*) FROM prestamos_equipamiento WHERE usuario_id = ?) AS prestamos,
         (SELECT COUNT(*) FROM mantenimiento_equipamiento WHERE usuario_id = ?) AS mantenimientos,
         (SELECT COUNT(*) FROM devoluciones_equipamiento WHERE usuario_id = ?) AS devoluciones,
         (SELECT COUNT(*) FROM solicitudes_equipamiento WHERE confirmado_por = ?) AS decisiones`,
      [id, id, id, id, id, id],
      (lookupError, refs) => {
        if (lookupError) return callback(lookupError);
        if (refs.turnos || refs.solicitudes || refs.prestamos || refs.mantenimientos || refs.devoluciones || refs.decisiones) {
          return callback(null, false, 'El usuario tiene historial asociado. Usa "Dar de baja" para conservarlo.');
        }
        db.run(
          'DELETE FROM usuarios WHERE id = ? AND lower(trim(gmail)) <> lower(?)',
          [id, reservedEmail],
          function(error) {
            callback(error, !error && this.changes === 1);
          }
        );
      }
    );
  }

  static create(userData, callback) {
    const {
      gmail, password, nombre, rol, rut, grupo_sangre, alergias, nivel_experiencia,
      apodo, foto_perfil, enfermedades_cronicas, medicamentos_diarios, dias_trabajados
    } = userData;
    db.run(
      `INSERT INTO usuarios
       (gmail, password, nombre, apodo, foto_perfil, rol, rut, grupo_sangre, enfermedades_cronicas, medicamentos_diarios, alergias, dias_trabajados, nivel_experiencia)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(gmail).trim().toLowerCase(),
        password,
        nombre,
        apodo || '',
        foto_perfil || 'https://definicion.de/wp-content/uploads/2019/07/perfil-de-usuario.png',
        rol || 'Usuario / Esquiador',
        rut || 'Pendiente',
        grupo_sangre || 'N/A',
        enfermedades_cronicas || 'N/A',
        medicamentos_diarios || 'N/A',
        alergias || 'N/A',
        Array.isArray(dias_trabajados) ? JSON.stringify(dias_trabajados) : (dias_trabajados || '[]'),
        nivel_experiencia || null
      ],
      function(error) {
        callback(error, this);
      }
    );
  }

  static updateApodo(id, apodo, callback) {
    db.run("UPDATE usuarios SET apodo = ? WHERE id = ?", [apodo, id], function(err) {
      if (err) console.error("[User.updateApodo Error]:", err.message);
      callback(err, this);
    });
  }

  static updateFoto(id, fotoBase64, callback) {
    db.run("UPDATE usuarios SET foto_perfil = ? WHERE id = ?", [fotoBase64, id], function(err) {
      if (err) console.error("[User.updateFoto Error]:", err.message);
      callback(err, this);
    });
  }

  static updateProfile(id, { nombre, apodo, foto_perfil }, callback) {
    db.run(
      `UPDATE usuarios
       SET nombre = ?, apodo = ?, foto_perfil = ?
       WHERE id = ?`,
      [nombre, apodo, foto_perfil, id],
      callback
    );
  }

  static updatePersonalData(id, { telefono_contacto, contacto_emergencia_nombre, contacto_emergencia_telefono, grupo_sangre, alergias, enfermedades_cronicas, medicamentos_diarios, estado_disponibilidad }, callback) {
    db.run(
      `UPDATE usuarios
       SET telefono_contacto = ?, contacto_emergencia_nombre = ?, contacto_emergencia_telefono = ?,
           contacto_emergencia_personal = ?, grupo_sangre = ?, alergias = ?,
           enfermedades_cronicas = ?, medicamentos_diarios = ?, estado_disponibilidad = ?
       WHERE id = ?`,
      [
        telefono_contacto,
        contacto_emergencia_nombre,
        contacto_emergencia_telefono,
        [contacto_emergencia_nombre, contacto_emergencia_telefono].filter(Boolean).join(' · '),
        grupo_sangre,
        alergias,
        enfermedades_cronicas,
        medicamentos_diarios,
        estado_disponibilidad,
        id
      ],
      callback
    );
  }

  static updatePassword(id, passwordHash, callback) {
    db.run('UPDATE usuarios SET password = ? WHERE id = ?', [passwordHash, id], callback);
  }

  static updateDiasTrabajados(id, diasTrabajados, callback) {
    db.run("UPDATE usuarios SET dias_trabajados = ? WHERE id = ?", [JSON.stringify(diasTrabajados), id], function(err) {
      if (err) console.error("[User.updateDiasTrabajados Error]:", err.message);
      callback(err, this);
    });
  }

  static updateCampoMedico(id, campo, valor, callback) {
    const camposValidos = ['grupo_sangre', 'enfermedades_cronicas', 'medicamentos_diarios', 'alergias'];
    if (!camposValidos.includes(campo)) return callback(new Error("Campo médico no válido"));

    const query = `UPDATE usuarios SET ${campo} = ? WHERE id = ?`;
    db.run(query, [valor, id], function(err) {
      if (err) console.error("[User.updateCampoMedico Error]:", err.message);
      callback(err, this);
    });
  }
}

module.exports = User;
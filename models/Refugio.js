const db = require('../config/database');

class Refugio {
  static getClimatico(callback) {
    db.get("SELECT value FROM configuracion WHERE key = 'refugio_climatico_id'", [], (settingError, setting) => {
      if (settingError) return callback(settingError);
      const selectedId = Number(setting && setting.value);
      const fallback = () => db.get(
        `SELECT id, codigo, nombre, zona, latitud, longitud, altura
         FROM refugios
         WHERE eliminado = 0
         ORDER BY CASE WHEN estado = 'Operativo' THEN 0 ELSE 1 END, id
         LIMIT 1`,
        [],
        finish
      );
      const finish = (error, refugio) => {
        if (error) return callback(error);
        db.all(
          `SELECT key, value FROM configuracion
           WHERE key IN ('montana_nombre', 'montana_latitud', 'montana_longitud', 'montana_altura')`,
          [],
          (configError, values) => {
            if (configError) return callback(configError);
            const settings = Object.fromEntries((values || []).map(item => [item.key, item.value]));
            const location = refugio || (settings.montana_nombre ? {
              id: null, codigo: '', nombre: settings.montana_nombre, zona: '',
              latitud: null, longitud: null, altura: null
            } : null);
            if (!location) return callback(null, null);
            if (settings.montana_nombre) location.nombre = settings.montana_nombre;
            if (settings.montana_latitud !== undefined) location.latitud = Number(settings.montana_latitud);
            if (settings.montana_longitud !== undefined) location.longitud = Number(settings.montana_longitud);
            if (settings.montana_altura !== undefined) location.altura = Number(settings.montana_altura);
            if (!settings.montana_latitud && /farellones/i.test(`${location.nombre || ''} ${location.zona || ''}`)) {
              location.latitud = -33.352;
              location.longitud = -70.325;
              location.altura = 2340;
            }
            callback(null, location);
          }
        );
      };
      if (!Number.isSafeInteger(selectedId) || selectedId < 1) return fallback();
      db.get(
        `SELECT id, codigo, nombre, zona, latitud, longitud, altura
         FROM refugios WHERE id = ? AND eliminado = 0`,
        [selectedId],
        (error, refugio) => {
          if (error) return callback(error);
          if (!refugio) return fallback();
          finish(null, refugio);
        }
      );
    });
  }

  static getAll(callback) {
    const query = `
      SELECT r.*, 
      COALESCE(SUM(e.disponibles), 0) as total_disponible,
      COALESCE(SUM(e.totales), 0) as total_capacidad
      FROM refugios r
      LEFT JOIN equipamientos e ON r.id = e.refugio_id AND e.eliminado = 0
      WHERE r.eliminado = 0
      GROUP BY r.id
    `;
    db.all(query, [], callback);
  }

  static getById(id, callback) {
    db.get("SELECT * FROM refugios WHERE id = ? AND eliminado = 0", [id], callback);
  }

  static getImportTarget(reference, callback) {
    const id = /^\d+$/.test(reference) ? Number(reference) : null;
    db.all(
      `SELECT id FROM refugios
       WHERE eliminado = 0 AND (
         (? IS NOT NULL AND id = ?) OR
         lower(trim(COALESCE(codigo, ''))) = lower(trim(?)) OR
         lower(trim(nombre)) = lower(trim(?))
       )
       ORDER BY CASE
         WHEN lower(trim(COALESCE(codigo, ''))) = lower(trim(?)) THEN 0
         WHEN ? IS NOT NULL AND id = ? THEN 1
         ELSE 2
       END
       LIMIT 2`,
      [id, id, reference, reference, reference, id, id],
      (error, matches) => {
        if (error) return callback(error);
        if (matches.length) return callback(null, matches);
        db.get(
          `SELECT id FROM refugios
           WHERE eliminado = 0 AND estado = 'Operativo'
           ORDER BY id
           LIMIT 1`,
          [],
          (fallbackError, refuge) => callback(fallbackError, refuge ? [refuge] : [])
        );
      }
    );
  }

  static create(refugio, callback) {
    db.run(
      `INSERT INTO refugios
       (nombre, zona, estado, capacidad_maxima, lat, lng, latitud, longitud, altura)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        refugio.nombre,
        refugio.zona,
        refugio.estado,
        refugio.capacidad_maxima,
        refugio.lat,
        refugio.lng,
        refugio.latitud === undefined ? refugio.lat : refugio.latitud,
        refugio.longitud === undefined ? refugio.lng : refugio.longitud,
        refugio.altura || 0
      ],
      function(err) {
        callback(err, this.lastID);
      }
    );
  }
}

module.exports = Refugio;
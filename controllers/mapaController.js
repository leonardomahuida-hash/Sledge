const Refugio = require('../models/Refugio');
const db = require('../config/database');

exports.renderMapa = (req, res) => {
  Refugio.getAll((err, refugios) => {
    if (err) return res.status(500).send("Error al cargar mapa.");
    const rolesPermitidos = ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'];
    const rol = String(req.user && req.user.rol || '').trim().toLowerCase();
    db.all('SELECT refugio_id, categoria, SUM(disponibles) AS disponibles, SUM(totales) AS totales FROM equipamientos GROUP BY refugio_id, categoria', [], (inventoryError, inventory) => {
      const porRefugio = new Map();
      (inventory || []).forEach(item => {
        if (!porRefugio.has(item.refugio_id)) porRefugio.set(item.refugio_id, []);
        porRefugio.get(item.refugio_id).push({
          categoria: item.categoria,
          porcentaje: item.totales > 0 ? Math.round(item.disponibles / item.totales * 100) : 0
        });
      });
      db.all('SELECT id, nombre, tipo, coordenadas FROM zonas_mapa WHERE activo = 1 ORDER BY nombre', [], (zoneError, zonas) => {
        if (zoneError) return res.status(500).send('No se pudieron cargar las zonas del mapa.');
        db.all('SELECT id, nombre, estado, coordenadas FROM pistas ORDER BY nombre', [], (trailError, pistas) => {
          if (trailError) return res.status(500).send('No se pudieron cargar las pistas del mapa.');
          const parseCoordinates = rows => (rows || []).map(row => {
            try {
              return { ...row, coordenadas: JSON.parse(row.coordenadas) };
            } catch (error) {
              console.error('[MAPA] Geometría inválida guardada:', error.message);
              return null;
            }
          }).filter(Boolean);
          res.render('mapa', {
            page: 'mapa',
            refugios: (refugios || []).map(refugio => ({
              ...refugio,
              porcentajeInventario: refugio.total_capacidad > 0 ? Math.round(refugio.total_disponible / refugio.total_capacidad * 100) : 0,
              categoriasInventario: porRefugio.get(refugio.id) || []
            })),
            zonas: parseCoordinates(zonas),
            pistas: parseCoordinates(pistas),
            puedeCrearRefugios: rolesPermitidos.includes(rol)
          });
        });
      });
    });
  });
};

function validarGeometria(coordinates, minimum) {
  return Array.isArray(coordinates) && coordinates.length >= minimum && coordinates.length <= 500 &&
    coordinates.every(point => Array.isArray(point) && point.length === 2 &&
      typeof point[0] === 'number' && Number.isFinite(point[0]) && point[0] >= -90 && point[0] <= 90 &&
      typeof point[1] === 'number' && Number.isFinite(point[1]) && point[1] >= -180 && point[1] <= 180);
}

exports.crearZona = (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const tipo = String(req.body.tipo || '');
  let coordenadas;
  try {
    coordenadas = typeof req.body.coordenadas === 'string' ? JSON.parse(req.body.coordenadas) : req.body.coordenadas;
  } catch (error) {
    return res.status(400).json({ success: false, error: 'Las coordenadas deben ser JSON válido.' });
  }
  if (!nombre || nombre.length > 100 || !['Riesgo de avalancha', 'Grietas', 'Zona segura'].includes(tipo) ||
      !validarGeometria(coordenadas, 3)) {
    return res.status(400).json({ success: false, error: 'Revisa el nombre, tipo y polígono (mínimo tres puntos GPS válidos).' });
  }
  db.run(
    'INSERT INTO zonas_mapa (nombre, tipo, coordenadas) VALUES (?, ?, ?)',
    [nombre, tipo, JSON.stringify(coordenadas)],
    function(error) {
      if (error) return res.status(500).json({ success: false, error: 'No se pudo guardar la zona.' });
      res.status(201).json({ success: true, zona: { id: this.lastID, nombre, tipo, coordenadas } });
    }
  );
};

exports.crearPista = (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const estado = String(req.body.estado || '');
  let coordenadas;
  try {
    coordenadas = typeof req.body.coordenadas === 'string' ? JSON.parse(req.body.coordenadas || '[]') : (req.body.coordenadas || []);
  } catch (error) {
    return res.status(400).json({ success: false, error: 'Las coordenadas deben ser JSON válido.' });
  }
  if (!nombre || nombre.length > 100 || !['Abierta', 'Cerrada', 'Mantenimiento'].includes(estado) ||
      !Array.isArray(coordenadas) || (coordenadas.length && !validarGeometria(coordenadas, 2))) {
    return res.status(400).json({ success: false, error: 'Revisa el nombre, estado y recorrido de la pista.' });
  }
  db.run(
    'INSERT INTO pistas (nombre, estado, coordenadas) VALUES (?, ?, ?)',
    [nombre, estado, JSON.stringify(coordenadas)],
    function(error) {
      if (error && error.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ success: false, error: 'Ya existe una pista con ese nombre.' });
      }
      if (error) return res.status(500).json({ success: false, error: 'No se pudo guardar la pista.' });
      res.status(201).json({ success: true, pista: { id: this.lastID, nombre, estado, coordenadas } });
    }
  );
};

exports.actualizarEstadoPista = (req, res) => {
  const id = Number(req.params.id);
  const estado = String(req.body.estado || '');
  if (!Number.isSafeInteger(id) || id < 1 || !['Abierta', 'Cerrada', 'Mantenimiento'].includes(estado)) {
    return res.status(400).json({ success: false, error: 'La pista o el estado seleccionado no es válido.' });
  }
  db.run('UPDATE pistas SET estado = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ?', [estado, id], function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo actualizar el estado de la pista.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'La pista no existe.' });
    res.json({ success: true, estado });
  });
};

exports.actualizarTipoZona = (req, res) => {
  const id = Number(req.params.id);
  const tipo = String(req.body.tipo || '');
  if (!Number.isSafeInteger(id) || id < 1 || !['Riesgo de avalancha', 'Grietas', 'Zona segura'].includes(tipo)) {
    return res.status(400).json({ success: false, error: 'La zona o el tipo seleccionado no es válido.' });
  }
  db.run('UPDATE zonas_mapa SET tipo = ?, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? AND activo = 1', [tipo, id], function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo actualizar la zona.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'La zona no existe.' });
    res.json({ success: true, tipo });
  });
};

exports.eliminarZona = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'La zona seleccionada no es válida.' });
  db.run('UPDATE zonas_mapa SET activo = 0, actualizado_en = CURRENT_TIMESTAMP WHERE id = ? AND activo = 1', [id], function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo retirar la zona.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'La zona no existe.' });
    res.json({ success: true });
  });
};

exports.eliminarPista = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'La pista seleccionada no es válida.' });
  db.run('DELETE FROM pistas WHERE id = ?', [id], function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo eliminar la pista.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'La pista no existe.' });
    res.json({ success: true });
  });
};

exports.listarPatrullerosActivos = (req, res) => {
  db.all(
    `SELECT u.id, u.nombre, u.apodo, l.lat, l.lng, l.actualizado_en
     FROM ubicaciones_patrulleros l
     JOIN usuarios u ON u.id = l.usuario_id
     WHERE u.rol = 'Ski Patrol'
       AND datetime(l.actualizado_en) >= datetime('now', '-10 minutes')
     ORDER BY u.nombre`,
    [],
    (error, patrols) => {
      if (error) return res.status(500).json({ success: false, error: 'No se pudieron cargar las ubicaciones activas.' });
      res.json({ success: true, patrulleros: patrols || [] });
    }
  );
};

exports.actualizarUbicacionPatrullero = (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, error: 'La ubicación GPS no es válida.' });
  }
  db.run(
    `INSERT INTO ubicaciones_patrulleros (usuario_id, lat, lng, actualizado_en)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(usuario_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, actualizado_en = CURRENT_TIMESTAMP`,
    [req.user.id, lat, lng],
    error => {
      if (error) return res.status(500).json({ success: false, error: 'No se pudo publicar la ubicación.' });
      res.json({ success: true });
    }
  );
};

exports.eliminarUbicacionPatrullero = (req, res) => {
  db.run('DELETE FROM ubicaciones_patrulleros WHERE usuario_id = ?', [req.user.id], error => {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo retirar la ubicación compartida.' });
    res.json({ success: true });
  });
};

exports.crearRefugio = (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const zona = String(req.body.zona || '').trim();
  const estado = String(req.body.estado || 'Operativo').trim();
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);

  if (!nombre || nombre.length > 120) {
    return res.status(400).json({ success: false, error: 'El nombre es obligatorio y debe tener como máximo 120 caracteres.' });
  }
  if (!zona || zona.length > 80) {
    return res.status(400).json({ success: false, error: 'La zona es obligatoria y debe tener como máximo 80 caracteres.' });
  }
  if (!['Operativo', 'Fuera de servicio'].includes(estado)) {
    return res.status(400).json({ success: false, error: 'El estado operativo no es válido.' });
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, error: 'La ubicación del refugio no es válida.' });
  }

  Refugio.create({ nombre, zona, estado: estado || 'Operativo', capacidad_maxima: 0, lat, lng, latitud: lat, longitud: lng }, (err, id) => {
    if (err) return res.status(500).json({ success: false, error: 'No se pudo guardar el refugio.' });
    res.status(201).json({
      success: true,
      refugio: { id, nombre, zona, estado: estado || 'Operativo', capacidad_maxima: 0, total_disponible: 0, total_capacidad: 0, porcentajeInventario: 0, categoriasInventario: [], lat, lng, latitud: lat, longitud: lng, altura: 0 }
    });
  });
};
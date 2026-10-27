const db = require('../config/database');

function normalizarContacto(nombreRaw, telefonoRaw) {
  const nombre = String(nombreRaw || '').trim();
  const telefono = String(telefonoRaw || '').trim();
  const digitos = (telefono.match(/\d/g) || []).length;
  if (!nombre || nombre.length > 100 || !/^\+?[0-9 ()-]{6,24}$/.test(telefono) || digitos < 6 || digitos > 15) {
    return null;
  }
  return {
    nombre,
    telefono: `${telefono.startsWith('+') ? '+' : ''}${telefono.replace(/\D/g, '')}`
  };
}

exports.listarContactosSOS = (req, res) => {
  db.all(
    'SELECT id, nombre, telefono, es_predeterminado FROM contactos_emergencia ORDER BY es_predeterminado DESC, nombre',
    [],
    (error, contactos) => {
      if (error) return res.status(500).json({ success: false, error: 'No se pudieron cargar los contactos SOS.' });
      res.json({ success: true, contactos: contactos || [] });
    }
  );
};

exports.crearContactoSOS = (req, res) => {
  const contacto = normalizarContacto(req.body.nombre, req.body.telefono);
  if (!contacto) return res.status(400).json({ success: false, error: 'Ingresa un nombre y un teléfono válido.' });
  db.run(
    'INSERT INTO contactos_emergencia (nombre, telefono, es_predeterminado) VALUES (?, ?, 0)',
    [contacto.nombre, contacto.telefono],
    function(error) {
      if (error) return res.status(500).json({ success: false, error: 'No se pudo agregar el contacto SOS.' });
      res.status(201).json({ success: true, contacto: { id: this.lastID, ...contacto, es_predeterminado: 0 } });
    }
  );
};

exports.actualizarContactoSOS = (req, res) => {
  const id = Number(req.params.id);
  const contacto = normalizarContacto(req.body.nombre, req.body.telefono);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'El contacto seleccionado no es válido.' });
  if (!contacto) return res.status(400).json({ success: false, error: 'Ingresa un nombre y un teléfono válido.' });
  db.run('UPDATE contactos_emergencia SET nombre = ?, telefono = ? WHERE id = ?', [contacto.nombre, contacto.telefono, id], function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo actualizar el contacto SOS.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'El contacto SOS no existe.' });
    res.json({ success: true, contacto: { id, ...contacto } });
  });
};

exports.eliminarContactoSOS = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'El contacto seleccionado no es válido.' });
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la eliminación.' });
      const rollback = message => db.run('ROLLBACK', () => res.status(500).json({ success: false, error: message }));
      db.get('SELECT es_predeterminado FROM contactos_emergencia WHERE id = ?', [id], (lookupError, target) => {
        if (lookupError) return rollback('No se pudo validar el contacto.');
        if (!target) return db.run('ROLLBACK', () => res.status(404).json({ success: false, error: 'El contacto SOS no existe.' }));
        db.run('DELETE FROM contactos_emergencia WHERE id = ?', [id], deleteError => {
          if (deleteError) return rollback('No se pudo eliminar el contacto SOS.');
          const confirm = () => db.run('COMMIT', commitError => {
            if (commitError) return rollback('No se pudo confirmar la eliminación.');
            res.json({ success: true });
          });
          if (!target.es_predeterminado) return confirm();
          db.run(
            `UPDATE contactos_emergencia
             SET es_predeterminado = 1
             WHERE id = (SELECT id FROM (SELECT id FROM contactos_emergencia ORDER BY id LIMIT 1) AS siguiente)`,
            [],
            defaultError => defaultError ? rollback('No se pudo asignar el contacto predeterminado.') : confirm()
          );
        });
      });
    });
  });
};

exports.definirContactoPredeterminado = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ success: false, error: 'El contacto seleccionado no es válido.' });
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la actualización.' });
      const rollback = message => db.run('ROLLBACK', () => res.status(500).json({ success: false, error: message }));
      db.get('SELECT id FROM contactos_emergencia WHERE id = ?', [id], (lookupError, contact) => {
        if (lookupError) return rollback('No se pudo validar el contacto.');
        if (!contact) return db.run('ROLLBACK', () => res.status(404).json({ success: false, error: 'El contacto SOS no existe.' }));
        db.run('UPDATE contactos_emergencia SET es_predeterminado = 0', [], clearError => {
          if (clearError) return rollback('No se pudo actualizar el contacto predeterminado.');
          db.run('UPDATE contactos_emergencia SET es_predeterminado = 1 WHERE id = ?', [id], setError => {
            if (setError) return rollback('No se pudo actualizar el contacto predeterminado.');
            db.run('COMMIT', commitError => {
              if (commitError) return rollback('No se pudo confirmar la actualización.');
              res.json({ success: true });
            });
          });
        });
      });
    });
  });
};

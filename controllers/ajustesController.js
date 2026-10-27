const db = require('../config/database');

exports.renderAjustes = (req, res) => {
  res.render('ajustes', { page: 'usuario' });
};

exports.actualizarPreferencias = (req, res) => {
  const input = req.body && req.body.preferencias;
  const temas = ['cumbre', 'roca', 'nieve-nocturna', 'sombra-alpina', 'tormenta-nocturna'];
  const idiomas = ['es', 'en', 'pt'];
  const unidades = ['km', 'mi'];
  const booleanKeys = ['highContrast', 'largeText', 'voiceGuidance', 'vibration', 'alertsEnabled', 'incognito', 'shareLocation'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !temas.includes(input.theme || 'nieve-nocturna') ||
      !idiomas.includes(input.language || 'es') ||
      !unidades.includes(input.units || 'km') ||
      booleanKeys.some(key => input[key] !== undefined && typeof input[key] !== 'boolean')) {
    return res.status(400).json({ success: false, error: 'Las preferencias enviadas no son válidas.' });
  }
  const preferencias = {
    theme: input.theme || 'nieve-nocturna',
    language: input.language || 'es',
    units: input.units || 'km'
  };
  booleanKeys.forEach(key => {
    if (input[key] !== undefined) preferencias[key] = input[key];
  });
  db.run('UPDATE usuarios SET preferencias_json = ? WHERE id = ?', [JSON.stringify(preferencias), req.user.id], function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudieron guardar las preferencias.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'El usuario no existe.' });
    res.json({ success: true, preferencias });
  });
};

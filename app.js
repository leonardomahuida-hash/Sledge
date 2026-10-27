const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/authRoutes');
const mapaRoutes = require('./routes/mapaRoutes');
const climaRoutes = require('./routes/climaRoutes');
const refugioRoutes = require('./routes/refugioRoutes');
const perfilRoutes = require('./routes/perfilRoutes');
const ajustesRoutes = require('./routes/ajustesRoutes');
const administracionRoutes = require('./routes/administracionRoutes');
const sosRoutes = require('./routes/sosRoutes');
const turnosRoutes = require('./routes/turnosRoutes');
const mantenimientoRoutes = require('./routes/mantenimientoRoutes');
const usuarioController = require('./controllers/usuarioController');
const authMiddleware = require('./middlewares/authMiddleware');
const db = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET es obligatorio en .env para iniciar Sledge.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares (Configuración del peso MÁXIMO antes de cualquier lectura)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.once('finish', () => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.user) return;
    db.run(
      `INSERT INTO auditoria_sistema
       (usuario_id, correo, rol, metodo, recurso, codigo_respuesta, ip, agente_usuario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        req.user.gmail || '',
        req.user.rol || '',
        req.method,
        req.path,
        res.statusCode,
        req.ip || '',
        String(req.get('user-agent') || '').slice(0, 500)
      ],
      error => {
        if (error) console.error('[AUDITORIA] No se pudo registrar la operación:', error.message);
      }
    );
  });
  next();
});
app.use((req, res, next) => {
  db.all('SELECT id, nombre, telefono, es_predeterminado FROM contactos_emergencia ORDER BY es_predeterminado DESC, nombre', [], (err, contacts) => {
    if (err) return next(err);
    res.locals.sosContacts = contacts || [];
    const direct = res.locals.sosContacts.find(contact => Number(contact.es_predeterminado) === 1);
    res.locals.sosPhone = direct ? direct.telefono : '';
    next();
  });
});

// Rutas
app.use('/', authRoutes);
app.use('/mapa', mapaRoutes);
app.use('/clima', climaRoutes);
app.use('/refugio', refugioRoutes);
app.get('/usuario', authMiddleware.attachUser, usuarioController.renderUsuario);
app.get('/datos-personales', authMiddleware.attachUser, (req, res) => res.redirect('/usuario'));
app.use('/api/perfil', perfilRoutes);
app.use('/turnos', turnosRoutes);
app.use('/mantenimiento', mantenimientoRoutes);
app.use('/ajustes', ajustesRoutes);
app.use('/administracion', administracionRoutes);
app.use('/api/sos', sosRoutes);

const cerrarTurnosInactivos = () => {
  const partesHoraChile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const obtenerParte = tipo => partesHoraChile.find(parte => parte.type === tipo).value;
  if (Number(obtenerParte('hour')) < 18) return;
  const fechaChile = `${obtenerParte('year')}-${obtenerParte('month')}-${obtenerParte('day')}`;
  db.run(`UPDATE turnos
          SET estado = 'Pendiente de cierre'
          WHERE estado <> 'Concluido'
            AND fecha = ?
            AND estado <> 'Pendiente de cierre'
            AND datetime(ultima_actividad) <= datetime('now', '-4 hours')`, [fechaChile], function(error) {
    if (error) return console.error('[TURNOS] No se pudieron marcar los turnos pendientes de cierre:', error.message);
    if (this.changes > 0) console.log(`[TURNOS] ${this.changes} turno(s) requieren completar el formulario de cierre.`);
  });
};

app.use((req, res) => {
  res.status(404).render('login', { error: 'Página no encontrada' });
});

db.ready.then(() => {
  cerrarTurnosInactivos();
  const turnoScheduler = setInterval(cerrarTurnosInactivos, 60 * 1000);
  turnoScheduler.unref();
  app.listen(PORT, () => {
    console.log(`[SLEDGE SERVER] Servidor corriendo en http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error('[SLEDGE SERVER] No se pudo inicializar la base de datos:', error.message);
  process.exitCode = 1;
});
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET;

// Función auxiliar para limpiar y formatear RUT al estilo chileno (XX.XXX.XXX-X)
function formatearRut(rutRaw) {
  if (!rutRaw) return 'Pendiente';
  let limpio = String(rutRaw).replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
  if (limpio.length < 2) return limpio;
  const dv = limpio.slice(-1);
  let cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cuerpo}-${dv}`;
}

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      gmail: user.gmail,
      nombre: user.nombre,
      rol: user.rol,
      rut: user.rut,
      grupo_sangre: user.grupo_sangre,
      alergias: user.alergias
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
};

const setJwtCookie = (res, token) => {
  res.cookie('jwt_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  });
};

exports.renderLogin = (req, res) => {
  res.render('login', { error: null });
};

exports.handleLogin = (req, res) => {
  const gmail = String(req.body.gmail || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  User.findByEmail(gmail, (err, user) => {
    if (err) return res.status(500).render('login', { error: 'No se pudo validar la cuenta.' });
    if (!user) {
      return res.render('login', { error: "El correo electrónico no se encuentra registrado." });
    }
    if (Number(user.activo) === 0) {
      return res.status(403).render('login', { error: 'La cuenta está inactiva. Contacta a un administrador.' });
    }

    const esHashBcrypt = /^\$2[aby]\$/.test(user.password);
    User.verifyPassword(user.password, password).then(esValida => {
      if (!esValida) return res.status(401).render('login', { error: "Contraseña incorrecta." });
      const emitirSesion = () => {
        const token = generateToken(user);
        setJwtCookie(res, token);
        res.redirect('/mapa');
      };
      if (esHashBcrypt) return emitirSesion();
      bcrypt.hash(password, 12).then(hash => {
        User.updatePassword(user.id, hash, hashError => {
          if (hashError) return res.status(500).render('login', { error: 'No se pudo asegurar la contraseña de esta cuenta.' });
          emitirSesion();
        });
      }).catch(hashError => {
        console.error('[AUTH] No se pudo hashear una contraseña heredada:', hashError.message);
        res.status(500).render('login', { error: 'No se pudo iniciar sesión.' });
      });
    }).catch(validationError => {
      console.error('[AUTH] Error al validar contraseña:', validationError.message);
      res.status(500).render('login', { error: 'No se pudo validar la contraseña.' });
    });
  });
};

exports.renderRegistro = (req, res) => {
  res.render('registro', { error: null });
};

exports.handleRegistro = (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const rut = String(req.body.rut || '').trim();
  const gmail = String(req.body.gmail || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!nombre || nombre.length > 120 || !rut || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail) || password.length < 8) {
    return res.status(400).render('registro', { error: "Completa los campos obligatorios y usa una contraseña de al menos 8 caracteres." });
  }
  if (String(gmail).trim().toLowerCase() === 'administracion@sledge.cl') {
    return res.render('registro', { error: "Esta cuenta está reservada para la dirección de Sledge." });
  }

  User.findByEmail(gmail, (err, existingUser) => {
    if (err) return res.status(500).render('registro', { error: 'No se pudo validar el correo.' });
    if (existingUser) {
      return res.render('registro', { error: "El correo ya está registrado en el sistema." });
    }

    const rutFormateado = formatearRut(rut);
    const rolPorDefecto = 'Usuario / Esquiador';

    bcrypt.hash(password, 12).then(passwordHash => {
      User.create({ nombre, rut: rutFormateado, gmail, password: passwordHash, rol: rolPorDefecto }, function(createError) {
        if (createError) {
          console.error('[AUTH] No se pudo registrar la cuenta:', createError.message);
          return res.status(500).render('registro', { error: "Error al crear la cuenta." });
        }

      User.findByEmail(gmail, (findError, newUser) => {
        if (findError) return res.status(500).render('registro', { error: 'La cuenta fue creada, pero no se pudo iniciar sesión.' });
        if (newUser) {
          const token = generateToken(newUser);
          setJwtCookie(res, token);
          return res.redirect('/mapa');
        }
        res.redirect('/');
      });
    });
    }).catch(hashError => {
      console.error('[AUTH] No se pudo hashear la contraseña:', hashError.message);
      res.status(500).render('registro', { error: 'No se pudo crear la cuenta.' });
    });
  });
};

exports.logout = (req, res) => {
  res.clearCookie('jwt_token');
  res.redirect('/');
};
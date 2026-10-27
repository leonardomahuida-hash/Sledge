const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const jwt = require('jsonwebtoken');

const testDbPath = path.join(os.tmpdir(), `sledge-passes-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.JWT_SECRET = 'profile-pass-test-secret';

const db = require('../config/database');
const auth = require('../middlewares/authMiddleware');
const usuarioController = require('../controllers/usuarioController');

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(error) {
    if (error) return reject(error);
    resolve(this);
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});

after(async () => {
  await db.ready;
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${testDbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('asocia pases por cuenta, rechaza duplicados y muestra estado y QR generado', async () => {
  await db.ready;
  const first = await run(
    'INSERT INTO usuarios (gmail, password, nombre, rut, rol) VALUES (?, ?, ?, ?, ?)',
    ['pase-uno@sledge.test', 'unused', 'Persona Uno', '11111-1', 'Usuario / Esquiador']
  );
  const second = await run(
    'INSERT INTO usuarios (gmail, password, nombre, rut, rol) VALUES (?, ?, ?, ?, ?)',
    ['pase-dos@sledge.test', 'unused', 'Persona Dos', '22222-2', 'Usuario / Esquiador']
  );

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.sosContacts = [];
    next();
  });
  app.post('/api/perfil/pase', auth.attachUser, usuarioController.asociarPaseMontana);
  app.put('/api/perfil', auth.attachUser, usuarioController.actualizarPerfil);
  app.get('/usuario', auth.attachUser, usuarioController.renderUsuario);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headersFor = id => ({
    Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`
  });
  const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let avatarPath;

  try {
    const associated = await fetch(`${baseUrl}/api/perfil/pase`, {
      method: 'POST',
      headers: { ...headersFor(first.lastID), 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero_pase: 'SKI-2026-1234', tipo_pase: 'Temporada', fecha_expiracion: expiry })
    });
    assert.equal(associated.status, 200);

    const avatarUpdate = await fetch(`${baseUrl}/api/perfil`, {
      method: 'PUT',
      headers: { ...headersFor(first.lastID), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Persona Uno', apodo: 'Nieve', foto_perfil: 'data:image/jpeg;base64,/9j/2Q==' })
    });
    assert.equal(avatarUpdate.status, 200);
    const avatarResult = await avatarUpdate.json();
    assert.match(avatarResult.foto_perfil, /^\/uploads\/avatars\/[a-f0-9-]{36}\.jpg$/);
    avatarPath = path.join(__dirname, '../public', avatarResult.foto_perfil.slice(1));
    assert.equal(fs.existsSync(avatarPath), true);
    assert.equal((await get('SELECT foto_perfil FROM usuarios WHERE id = ?', [first.lastID])).foto_perfil, avatarResult.foto_perfil);

    const duplicate = await fetch(`${baseUrl}/api/perfil/pase`, {
      method: 'POST',
      headers: { ...headersFor(second.lastID), 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero_pase: 'SKI-2026-1234', tipo_pase: 'Temporada', fecha_expiracion: expiry })
    });
    assert.equal(duplicate.status, 409);

    const profile = await fetch(`${baseUrl}/usuario`, { headers: headersFor(first.lastID) });
    assert.equal(profile.status, 200);
    const html = await profile.text();
    assert.match(html, /Activo \/ Válido/);
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /Editar información personal y de salud/);
    assert.match(html, /id="mountainPassForm"/);
    assert.match(html, /id="personalSettingsDialog"/);
    assert.doesNotMatch(html, /<details class="user-personal-data/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (avatarPath && fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
  }
});

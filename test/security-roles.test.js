const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
const os = require('os');
const testDbPath = path.join(os.tmpdir(), `sledge-roles-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.JWT_SECRET = 'test-secret-only';
const auth = require('../middlewares/authMiddleware');
const database = require('../config/database');

after(async () => {
  await database.ready;
  await new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${testDbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

const roles = [
  'Usuario / Esquiador',
  'Ski Patrol',
  'Operador de Refugio',
  'Mantenimiento',
  'Admin',
  'Super Admin'
];

function invoke(middleware, role) {
  const response = {
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; }
  };
  let nextCalled = false;
  middleware({ user: { rol: role } }, response, () => { nextCalled = true; });
  return { response, nextCalled };
}

test('Turnos rechaza al esquiador y permite a los otros cinco roles', () => {
  for (const role of roles) {
    const { response, nextCalled } = invoke(auth.requireTurnosRole, role);
    assert.equal(nextCalled, role !== 'Usuario / Esquiador', role);
    assert.equal(response.code, role === 'Usuario / Esquiador' ? 403 : 200, role);
  }
});

test('La administración de SOS solo admite Operador de Refugio, Admin y Super Admin', () => {
  const allowed = new Set(['Operador de Refugio', 'Admin', 'Super Admin']);
  for (const role of roles) {
    const { response, nextCalled } = invoke(auth.requireSosManagementRole, role);
    assert.equal(nextCalled, allowed.has(role), role);
    assert.equal(response.code, allowed.has(role) ? 200 : 403, role);
  }
});

test('La gestión administrativa solo admite Admin y Super Admin', () => {
  const allowed = new Set(['Admin', 'Super Admin']);
  for (const role of roles) {
    const { response, nextCalled } = invoke(auth.requireAdminRole, role);
    assert.equal(nextCalled, allowed.has(role), role);
    assert.equal(response.code, allowed.has(role) ? 200 : 403, role);
  }
});

test('La gestión de usuarios es exclusiva del correo de Super Admin', () => {
  const cases = [
    [{ gmail: 'administracion@sledge.cl', rol: 'Super Admin' }, true],
    [{ gmail: 'administracion@sledge.cl', rol: 'Admin' }, false],
    [{ gmail: 'admin@sledge.cl', rol: 'Super Admin' }, false],
    [{ gmail: 'admin@sledge.cl', rol: 'Admin' }, false]
  ];
  for (const [user, allowed] of cases) {
    const response = {
      code: 200,
      status(code) { this.code = code; return this; },
      send() {}
    };
    let nextCalled = false;
    auth.requireSuperAdminRole({ user }, response, () => { nextCalled = true; });
    assert.equal(nextCalled, allowed, user.gmail);
    assert.equal(response.code, allowed ? 200 : 403, user.gmail);
  }
});

test('Las rutas protegidas devuelven 403 a roles sin permiso y persisten cambios de Super Admin', async () => {
  await database.ready;
  const insertUser = (gmail, rol, rut) => new Promise((resolve, reject) => {
    database.run(
      'INSERT INTO usuarios (gmail, password, nombre, rut, rol) VALUES (?, ?, ?, ?, ?)',
      [gmail, 'not-used', gmail.split('@')[0], rut, rol],
      function(error) { error ? reject(error) : resolve(this.lastID); }
    );
  });
  const skierId = await insertUser('esquiador-test@sledge.cl', 'Usuario / Esquiador', '11111-1');
  const adminId = await insertUser('admin-test@sledge.cl', 'Admin', '22222-2');
  const superId = await insertUser('administracion@sledge.cl', 'Admin', '33333-3');
  const patrolId = await insertUser('patrol-test@sledge.cl', 'Ski Patrol', '44444-4');
  const operatorId = await insertUser('operador-test@sledge.cl', 'Operador de Refugio', '55555-5');
  const mapSkierId = await insertUser('esquiador-mapa-test@sledge.cl', 'Usuario / Esquiador', '66666-6');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const turnoRoutes = require('../routes/turnosRoutes');
  const administracionRoutes = require('../routes/administracionRoutes');
  const mapaRoutes = require('../routes/mapaRoutes');
  const ajustesRoutes = require('../routes/ajustesRoutes');
  const perfilRoutes = require('../routes/perfilRoutes');
  const sosRoutes = require('../routes/sosRoutes');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(express.json());
  app.use('/turnos', turnoRoutes);
  app.use('/administracion', administracionRoutes);
  app.use('/mapa', mapaRoutes);
  app.use('/ajustes', ajustesRoutes);
  app.use('/api/perfil', perfilRoutes);
  app.use('/api/sos', sosRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headersFor = id => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}` });
  try {
    for (const route of ['/turnos', '/turnos/historial', '/turnos/api/no-existe']) {
      const response = await fetch(`${baseUrl}${route}`, { headers: headersFor(skierId) });
      assert.equal(response.status, 403, route);
    }
    const blockedRoleChange = await fetch(`${baseUrl}/administracion/usuarios/${skierId}/rol`, {
      method: 'PUT',
      headers: { ...headersFor(adminId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: 'Ski Patrol' })
    });
    assert.equal(blockedRoleChange.status, 403);
    const blockedAdministrationNamespace = await fetch(`${baseUrl}/administracion/sos/contactos`, {
      headers: headersFor(skierId)
    });
    assert.equal(blockedAdministrationNamespace.status, 403);
    const publicSosContacts = await fetch(`${baseUrl}/api/sos/contactos`, { headers: headersFor(skierId) });
    assert.equal(publicSosContacts.status, 200);
    const blockedAdminPanel = await fetch(`${baseUrl}/administracion`, { headers: headersFor(operatorId) });
    assert.equal(blockedAdminPanel.status, 403);
    const blockedAudit = await fetch(`${baseUrl}/administracion/auditoria`, { headers: headersFor(adminId) });
    assert.equal(blockedAudit.status, 403);
    const auditPage = await fetch(`${baseUrl}/administracion/auditoria`, { headers: headersFor(superId) });
    assert.equal(auditPage.status, 200);
    assert.match(await auditPage.text(), /Auditoría global/);
    const blockedSosChange = await fetch(`${baseUrl}/administracion/sos/contactos`, {
      method: 'POST',
      headers: { ...headersFor(skierId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Rescate test', telefono: '+56912345678' })
    });
    assert.equal(blockedSosChange.status, 403);
    const newSosContact = await fetch(`${baseUrl}/administracion/sos/contactos`, {
      method: 'POST',
      headers: { ...headersFor(operatorId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Rescate test', telefono: '+56912345678' })
    });
    assert.equal(newSosContact.status, 201);
    const sosContactResult = await newSosContact.json();
    const setSosDefault = await fetch(`${baseUrl}/administracion/sos/contactos/${sosContactResult.contacto.id}/predeterminado`, {
      method: 'POST',
      headers: headersFor(operatorId)
    });
    assert.equal(setSosDefault.status, 200);

    const usersPage = await fetch(`${baseUrl}/administracion/usuarios`, { headers: headersFor(superId) });
    assert.equal(usersPage.status, 200);
    assert.match(await usersPage.text(), /Gestión de usuarios/);
    const blockedUserCreation = await fetch(`${baseUrl}/administracion/usuarios`, {
      method: 'POST',
      headers: { ...headersFor(adminId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Nuevo operador', rut: '77777-7', gmail: 'nuevo-operador@sledge.cl', password: 'temporary-pass', rol: 'Operador de Refugio' })
    });
    assert.equal(blockedUserCreation.status, 403);
    const createdAccount = await fetch(`${baseUrl}/administracion/usuarios`, {
      method: 'POST',
      headers: { ...headersFor(superId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Nuevo operador', rut: '77777-7', gmail: 'nuevo-operador@sledge.cl', password: 'temporary-pass', rol: 'Operador de Refugio' })
    });
    assert.equal(createdAccount.status, 201);
    const personalSettings = await fetch(`${baseUrl}/ajustes`, { headers: headersFor(adminId) });
    assert.equal(personalSettings.status, 200);
    const settingsHtml = await personalSettings.text();
    assert.match(settingsHtml, /Nieve Nocturna/);
    const savePreferences = await fetch(`${baseUrl}/ajustes/preferencias`, {
      method: 'PUT',
      headers: { ...headersFor(adminId), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferencias: {
          theme: 'roca',
          language: 'es',
          units: 'km',
          highContrast: true,
          largeText: true,
          vibration: true,
          alertsEnabled: true,
          incognito: true,
          shareLocation: false
        }
      })
    });
    assert.equal(savePreferences.status, 200);
    const savedPreferences = await new Promise((resolve, reject) => database.get(
      'SELECT preferencias_json FROM usuarios WHERE id = ?', [adminId], (error, row) => error ? reject(error) : resolve(row)
    ));
    assert.equal(JSON.parse(savedPreferences.preferencias_json).theme, 'roca');
    assert.equal(JSON.parse(savedPreferences.preferencias_json).largeText, true);
    assert.equal(JSON.parse(savedPreferences.preferencias_json).shareLocation, false);
    const savePersonalData = await fetch(`${baseUrl}/api/perfil/datos-personales`, {
      method: 'PUT',
      headers: { ...headersFor(adminId), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telefono_contacto: '+56912345678',
        contacto_emergencia_nombre: 'Contacto prueba',
        contacto_emergencia_telefono: '+56987654321',
        grupo_sangre: 'O+',
        alergias: 'Polen',
        estado_disponibilidad: 'Disponible'
      })
    });
    assert.equal(savePersonalData.status, 200);
    const savedPersonalData = await new Promise((resolve, reject) => database.get(
      'SELECT telefono_contacto, contacto_emergencia_nombre, contacto_emergencia_telefono, grupo_sangre, alergias, estado_disponibilidad FROM usuarios WHERE id = ?',
      [adminId],
      (error, row) => error ? reject(error) : resolve(row)
    ));
    assert.equal(savedPersonalData.contacto_emergencia_nombre, 'Contacto prueba');
    assert.equal(savedPersonalData.contacto_emergencia_telefono, '+56987654321');
    assert.equal(savedPersonalData.alergias, 'Polen');
    assert.equal(savedPersonalData.estado_disponibilidad, 'Disponible');
    assert.equal(settingsHtml.includes('name="telefono_contacto"'), false);
    assert.equal(settingsHtml.includes('passwordChangeForm'), false);
    const mapPage = await fetch(`${baseUrl}/mapa`, { headers: headersFor(operatorId) });
    assert.equal(mapPage.status, 200);
    const mapHtml = await mapPage.text();
    assert.match(mapHtml, /Capas y pistas/);
    assert.match(mapHtml, /id="mapPanelToggle"/);

    const changedRole = await fetch(`${baseUrl}/administracion/usuarios/${skierId}/rol`, {
      method: 'PUT',
      headers: { ...headersFor(superId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: 'Ski Patrol' })
    });
    assert.equal(changedRole.status, 200);
    const stored = await new Promise((resolve, reject) => database.get(
      'SELECT rol FROM usuarios WHERE id = ?', [skierId], (error, row) => error ? reject(error) : resolve(row)
    ));
    assert.equal(stored.rol, 'Ski Patrol');

    const protectedAccount = await fetch(`${baseUrl}/administracion/usuarios/${superId}/rol`, {
      method: 'PUT',
      headers: { ...headersFor(superId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rol: 'Admin' })
    });
    assert.equal(protectedAccount.status, 404);

    const updateAccount = await fetch(`${baseUrl}/administracion/usuarios/${patrolId}`, {
      method: 'PUT',
      headers: { ...headersFor(superId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Patrullero Editado', gmail: 'patrol-updated@sledge.cl', rol: 'Ski Patrol', activo: 1 })
    });
    assert.equal(updateAccount.status, 200);
    const accountEditResult = await updateAccount.json();
    assert.equal(accountEditResult.nombre, 'Patrullero Editado');
    assert.equal(accountEditResult.gmail, 'patrol-updated@sledge.cl');

    const deniedLocations = await fetch(`${baseUrl}/mapa/api/patrulleros-activos`, { headers: headersFor(mapSkierId) });
    assert.equal(deniedLocations.status, 403);
    const shareLocation = await fetch(`${baseUrl}/mapa/api/mi-ubicacion`, {
      method: 'POST',
      headers: { ...headersFor(patrolId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: -33.45, lng: -70.66 })
    });
    assert.equal(shareLocation.status, 200);
    const activePatrols = await fetch(`${baseUrl}/mapa/api/patrulleros-activos`, { headers: headersFor(operatorId) });
    assert.equal(activePatrols.status, 200);
    assert.match(await activePatrols.text(), /Patrullero Editado/);
    const removeLocation = await fetch(`${baseUrl}/mapa/api/mi-ubicacion`, {
      method: 'DELETE',
      headers: headersFor(patrolId)
    });
    assert.equal(removeLocation.status, 200);
    const deleteAccount = await fetch(`${baseUrl}/administracion/usuarios/${patrolId}`, {
      method: 'DELETE',
      headers: headersFor(superId)
    });
    assert.equal(deleteAccount.status, 200);

    const deactivateAccount = await fetch(`${baseUrl}/administracion/usuarios/${mapSkierId}/baja`, {
      method: 'POST',
      headers: headersFor(superId)
    });
    assert.equal(deactivateAccount.status, 200);
    const inactiveAccountRequest = await fetch(`${baseUrl}/turnos`, { headers: headersFor(mapSkierId) });
    assert.equal(inactiveAccountRequest.status, 403);

    const newZone = await fetch(`${baseUrl}/mapa/api/zonas`, {
      method: 'POST',
      headers: { ...headersFor(adminId), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Zona de prueba',
        tipo: 'Grietas',
        coordenadas: [[1, 2], [1.1, 2.1], [1.2, 2]]
      })
    });
    assert.equal(newZone.status, 201);
    const zoneResult = await newZone.json();
    const updateZone = await fetch(`${baseUrl}/mapa/api/zonas/${zoneResult.zona.id}`, {
      method: 'PUT',
      headers: { ...headersFor(operatorId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'Zona segura' })
    });
    assert.equal(updateZone.status, 200);
    const deniedZoneDelete = await fetch(`${baseUrl}/mapa/api/zonas/${zoneResult.zona.id}`, {
      method: 'DELETE',
      headers: headersFor(skierId)
    });
    assert.equal(deniedZoneDelete.status, 403);
    const newTrail = await fetch(`${baseUrl}/mapa/api/pistas`, {
      method: 'POST',
      headers: { ...headersFor(operatorId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Pista de prueba', estado: 'Cerrada', coordenadas: [[1, 2], [1.1, 2.1]] })
    });
    assert.equal(newTrail.status, 201);
    const trailResult = await newTrail.json();
    const updatedTrail = await fetch(`${baseUrl}/mapa/api/pistas/${trailResult.pista.id}/estado`, {
      method: 'PUT',
      headers: { ...headersFor(operatorId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'Abierta' })
    });
    assert.equal(updatedTrail.status, 200);
    const deleteTrail = await fetch(`${baseUrl}/mapa/api/pistas/${trailResult.pista.id}`, {
      method: 'DELETE',
      headers: headersFor(adminId)
    });
    assert.equal(deleteTrail.status, 200);
    const deleteZone = await fetch(`${baseUrl}/mapa/api/zonas/${zoneResult.zona.id}`, {
      method: 'DELETE',
      headers: headersFor(adminId)
    });
    assert.equal(deleteZone.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('La matriz de refugio, mantenimiento e inventario respeta cada rol', () => {
  const expectations = [
    ['requireEquipmentManagementRole', new Set(['Operador de Refugio', 'Admin', 'Super Admin'])],
    ['requireMaintenanceRole', new Set(['Operador de Refugio', 'Mantenimiento', 'Admin', 'Super Admin'])],
    ['requireRefugioManagementRole', new Set(['Operador de Refugio', 'Admin', 'Super Admin'])],
    ['requireNonSkierRole', new Set(roles.filter(role => role !== 'Usuario / Esquiador'))],
    ['requireInventoryDashboardRole', new Set(['Ski Patrol', 'Operador de Refugio', 'Mantenimiento', 'Admin', 'Super Admin'])],
    ['requireEquipmentReportRole', new Set(['Ski Patrol', 'Operador de Refugio', 'Mantenimiento', 'Admin', 'Super Admin'])]
  ];
  for (const [middlewareName, allowed] of expectations) {
    for (const role of roles) {
      const { response, nextCalled } = invoke(auth[middlewareName], role);
      assert.equal(nextCalled, allowed.has(role), `${middlewareName}: ${role}`);
      assert.equal(response.code, allowed.has(role) ? 200 : 403, `${middlewareName}: ${role}`);
    }
  }
});

test('Super Admin se asigna exclusivamente al correo institucional reservado', () => {
  assert.equal(auth.normalizarRol({ gmail: 'administracion@sledge.cl', rol: 'Admin' }), 'Super Admin');
  assert.equal(auth.normalizarRol({ gmail: 'otro@sledge.cl', rol: 'Super Admin' }), 'Usuario / Esquiador');
});

test('La navegación mantiene el acceso a Turnos bajo Administración para los roles autorizados', async () => {
  const navbarPath = path.join(__dirname, '../views/partials/navbar.ejs');
  for (const role of roles) {
    const html = await ejs.renderFile(navbarPath, {
      user: { rol: role },
      page: 'mapa',
      sosContacts: [],
      sosPhone: ''
    });
    assert.equal(html.includes('href="/turnos"'), ['Ski Patrol', 'Operador de Refugio', 'Mantenimiento', 'Admin', 'Super Admin'].includes(role), role);
    assert.equal(html.includes('Configurar contactos de emergencia'), ['Operador de Refugio', 'Admin', 'Super Admin'].includes(role), role);
    assert.equal(html.includes('href="/administracion"'), ['Admin', 'Super Admin'].includes(role), role);
    assert.ok(html.includes('id="globalWeatherWidget"'), role);
  }
});

test('El panel global de inventario es invisible para esquiadores y visible para trabajadores', async () => {
  const refugePath = path.join(__dirname, '../views/refugio.ejs');
  const workers = new Set(['Ski Patrol', 'Operador de Refugio', 'Mantenimiento', 'Admin', 'Super Admin']);
  for (const role of roles) {
    const html = await ejs.renderFile(refugePath, {
      user: { id: 1, nombre: 'Test', rol: role },
      page: 'refugio',
      refugios: [],
      puedeGestionarSolicitudes: false,
      puedeSolicitarEquipamiento: false,
      puedeCrearRefugios: false,
      puedeCambiarEstado: false,
      puedeArchivarRefugio: false,
      puedeVerPanelInventario: workers.has(role),
      cantidadSolicitudesPendientes: 0,
      cantidadSolicitudesResueltas: 0,
      sosContacts: []
    });
    assert.equal(html.includes('inventoryStatusChart'), workers.has(role), role);
    assert.equal(html.includes('medicalExpiryList'), workers.has(role), role);
  }
});

test('El perfil centraliza los datos personales y separa los modales de perfil y contraseña', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../views/usuario.ejs'), {
    user: {
      id: 12,
      nombre: 'Patrullera Test',
      apodo: 'Nieve',
      foto_perfil: '/img/avatar.jpg',
      rol: 'Ski Patrol',
      nivel_experiencia: 'Senior',
      grupo_sangre: 'O+',
      alergias: 'Polen',
      estado_disponibilidad: 'Disponible'
    },
    page: 'usuario',
    sosContacts: [],
    sosPhone: '',
    contactosEmergencia: [],
    equipoAsignado: [],
    paseMontana: null,
    paseQr: '',
    paseVigente: false
  });
  for (const marker of ['id="userProfileDialog"', 'id="profileNicknameInput"', 'id="profilePhotoInput"',
    'id="nameConfirmationField"', 'Nivel de experiencia:', 'Senior']) {
    assert.ok(html.includes(marker), marker);
  }
  assert.ok(html.includes('id="passwordChangeForm"'));
  assert.ok(html.includes('id="personalSettingsDialog"'));
  assert.ok(html.includes('name="contacto_emergencia_nombre"'));
  assert.ok(html.includes('name="estado_disponibilidad"'));
  assert.ok(html.includes('name="alergias"'));
  assert.ok(html.includes('id="mountainPassDialog"'));
  assert.ok(html.includes('Editar información personal y de salud'));
  assert.equal(html.includes('<details class="user-personal-data'), false);
  assert.equal(html.includes('id="passwordChangeDialog"'), false);
  const settingsHtml = await ejs.renderFile(path.join(__dirname, '../views/ajustes.ejs'), {
    user: { rol: 'Usuario / Esquiador' },
    page: 'usuario',
    sosContacts: [],
    sosPhone: '',
    preferencias: { theme: 'cumbre' },
    ajustesPersonales: { telefono_contacto: '', contacto_emergencia_personal: '' }
  });
  assert.equal(settingsHtml.includes('id="passwordChangeForm"'), false);
  assert.ok(settingsHtml.includes('name="themePalette"'));
  assert.equal(settingsHtml.includes('id="sosPhoneForm"'), false);
  assert.equal(settingsHtml.includes('id="patrolRegistrationForm"'), false);
  assert.equal(settingsHtml.includes('Perfil y contacto'), false);
  assert.ok(settingsHtml.includes('Apariencia'));
  assert.ok(settingsHtml.includes('Preferencias'));
  assert.ok(settingsHtml.includes('Privacidad y Seguridad'));
  const skierProfile = await ejs.renderFile(path.join(__dirname, '../views/usuario.ejs'), {
    user: { id: 1, nombre: 'Esquiador', rol: 'Usuario / Esquiador' },
    page: 'usuario',
    sosContacts: [],
    sosPhone: '',
    contactosEmergencia: [],
    equipoAsignado: [],
    paseMontana: null,
    paseQr: '',
    paseVigente: false
  });
  assert.equal(skierProfile.includes('Historial de turnos'), false);
});

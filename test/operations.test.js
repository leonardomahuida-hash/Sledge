const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PassThrough } = require('stream');
const ejs = require('ejs');

const testDbPath = path.join(os.tmpdir(), `sledge-operations-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.JWT_SECRET = 'operations-test-secret';

const db = require('../config/database');
const usuarioController = require('../controllers/usuarioController');
const administracionController = require('../controllers/administracionController');
const mantenimientoController = require('../controllers/mantenimientoController');

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(error) {
    if (error) return reject(error);
    resolve(this);
  });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});

function invoke(controller, req, render = false) {
  return new Promise(resolve => {
    const res = {
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        resolve({ code: this.code, body });
      },
      render(view, locals) {
        resolve({ code: this.code, view, locals });
      }
    };
    controller(req, res);
    if (render) return;
  });
}

after(async () => {
  await db.ready;
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${testDbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('cierre de turno descuenta botiquín, marca incompleto y registra incidentes', async () => {
  await db.ready;
  const user = await run(
    'INSERT INTO usuarios (gmail, password, nombre, rut, rol) VALUES (?, ?, ?, ?, ?)',
    ['patrol-operations@sledge.test', 'unused', 'Patrullero', '90001-1', 'Ski Patrol']
  );
  const refuge = await run(
    `INSERT INTO refugios (nombre, zona, estado, lat, lng, latitud, longitud)
     VALUES ('Refugio Ops', 'Norte', 'Operativo', -33, -70, -33, -70)`
  );
  const medkit = await run(
    `INSERT INTO equipamientos (codigo, refugio_id, categoria, nombre, disponibles, totales, estado)
     VALUES ('KIT-OPS', ?, 'Botiquines', 'Botiquín de rescate', 1, 1, 'Operativo')`,
    [refuge.lastID]
  );
  const supply = await run(
    `INSERT INTO botiquin_insumos (botiquin_id, nombre_insumo, cantidad_disponible, cantidad_critica)
     VALUES (?, 'Gasa estéril', 2, 1)`,
    [medkit.lastID]
  );
  const shift = await run(
    `INSERT INTO turnos (usuario_id, fecha, hora_inicio, hora_fin, estado, rol)
     VALUES (?, date('now'), '08:00', '16:00', 'Operativo', 'Ski Patrol')`,
    [user.lastID]
  );
  const closeRequest = {
    params: { id: String(shift.lastID) },
    user: { id: user.lastID, rol: 'Ski Patrol' },
    body: {
      desarrollo: 'Se completó la patrulla de cierre sin incidentes adicionales.',
      rescate: 'Atención preventiva en pista norte.',
      botiquin_id: String(medkit.lastID),
      consumos: [{ insumo_id: supply.lastID, cantidad: 2 }]
    }
  };
  const closed = await invoke(usuarioController.cerrarTurno, closeRequest);
  assert.equal(closed.code, 200);
  assert.equal(closed.body.success, true);
  assert.equal((await get('SELECT cantidad_disponible FROM botiquin_insumos WHERE id = ?', [supply.lastID])).cantidad_disponible, 0);
  assert.equal((await get('SELECT estado FROM equipamientos WHERE id = ?', [medkit.lastID])).estado, 'Incompleto');
  assert.equal((await get('SELECT estado FROM turnos WHERE id = ?', [shift.lastID])).estado, 'Concluido');

  const incident = await invoke(administracionController.reportarIncidente, {
    user: { id: user.lastID },
    body: { tipo: 'Accidente', descripcion: 'Caída en pista norte.', latitud: -33.4, longitud: -70.6 }
  });
  assert.equal(incident.code, 201);
  const storedIncident = await get('SELECT tipo, latitud, longitud FROM incidentes WHERE id = ?', [incident.body.id]);
  assert.deepEqual(storedIncident, { tipo: 'Accidente', latitud: -33.4, longitud: -70.6 });
});

test('mantenimiento registra falla, cierra el reporte y genera el historial de la UI', async () => {
  await db.ready;
  const user = await run(
    'INSERT INTO usuarios (gmail, password, nombre, rut, rol) VALUES (?, ?, ?, ?, ?)',
    ['maintenance-operations@sledge.test', 'unused', 'Técnica', '90002-2', 'Mantenimiento']
  );
  const refuge = await run(
    `INSERT INTO refugios (nombre, zona, estado, lat, lng, latitud, longitud)
     VALUES ('Taller Ops', 'Sur', 'Operativo', -34, -71, -34, -71)`
  );
  const equipment = await run(
    `INSERT INTO equipamientos (codigo, refugio_id, categoria, nombre, disponibles, totales, estado)
     VALUES ('RES-OPS', ?, 'Rescate', 'Trineo de rescate', 2, 2, 'Operativo')`,
    [refuge.lastID]
  );
  const reported = await invoke(mantenimientoController.reportarFalla, {
    params: { id: String(equipment.lastID) },
    user: { id: user.lastID },
    body: { cantidad: '2', observaciones: 'Revisión de fijaciones.' }
  });
  assert.equal(reported.code, 201);
  assert.equal((await get('SELECT estado, mantenimiento FROM equipamientos WHERE id = ?', [equipment.lastID])).estado, 'Mantenimiento');

  const workshop = await invoke(mantenimientoController.altaTaller, {
    params: { id: String(equipment.lastID) },
    body: { fecha_salida: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(workshop.code, 200);
  assert.deepEqual(await get('SELECT estado, disponibles, mantenimiento FROM equipamientos WHERE id = ?', [equipment.lastID]), {
    estado: 'Operativo', disponibles: 2, mantenimiento: 0
  });
  assert.equal((await get("SELECT estado_reporte FROM mantenimiento_equipamiento WHERE equipamiento_id = ?", [equipment.lastID])).estado_reporte, 'Cerrado');

  const page = await invoke(mantenimientoController.renderMantenimiento, {}, true);
  assert.equal(page.view, 'mantenimiento');
  assert.equal(page.locals.equiposOperativos.length, 1);
  assert.equal(page.locals.reportes.length, 1);
  const preselectedMaintenancePage = await invoke(mantenimientoController.renderMantenimiento, {
    query: { refugio_id: String(refuge.lastID), equipo_id: String(equipment.lastID) }
  }, true);
  assert.equal(preselectedMaintenancePage.locals.selectedRefugeId, refuge.lastID);
  assert.equal(preselectedMaintenancePage.locals.selectedEquipmentId, equipment.lastID);

  const request = await invoke(require('../controllers/refugioController').crearSolicitudEquipamiento, {
    params: { id: String(refuge.lastID) },
    user: { id: user.lastID, rol: 'Mantenimiento' },
    body: { items: [{ equipamiento_id: String(equipment.lastID), cantidad: '1' }] }
  });
  assert.equal(request.code, 201);
  const pendingRequest = await get('SELECT refugio_id, usuario_id, estado FROM solicitudes_equipamiento WHERE id = ?', [request.body.solicitud_id]);
  assert.deepEqual(pendingRequest, { refugio_id: refuge.lastID, usuario_id: user.lastID, estado: 'Pendiente' });

  const pdfResponse = new PassThrough();
  const pdfChunks = [];
  pdfResponse.setHeader = () => {};
  pdfResponse.on('data', chunk => pdfChunks.push(chunk));
  const pdfEnded = new Promise((resolve, reject) => {
    pdfResponse.on('end', resolve);
    pdfResponse.on('error', reject);
  });
  await mantenimientoController.descargarInformePdf({}, pdfResponse);
  await pdfEnded;
  assert.match(Buffer.concat(pdfChunks).toString('ascii', 0, 5), /%PDF-/);
});

test('importación masiva limpia BOM y resuelve refugios por código, nombre e ID', async () => {
  await db.ready;
  const refuge = await run(
    `INSERT INTO refugios (codigo, nombre, zona, estado, lat, lng, latitud, longitud)
     VALUES ('REF-OPS-01', 'Refugio Import', 'Norte', 'Operativo', -33, -70, -33, -70)`
  );
  const csv = [
    '\uFEFF codigo , tipo , estado , refugio_id , nombre , cantidad',
    `IMP-CODE,Rescate,En Mantenimiento,REF-OPS-01,Equipo por código,2`,
    `IMP-NAME,Rescate,Operativo,Refugio Import,Equipo por nombre,1`,
    `IMP-ID,Rescate,Operativo,${refuge.lastID},Equipo por ID,3`,
    'IMP-FALLBACK,Rescate,Operativo,CODIGO-ANTIGUO,Equipo con refugio de respaldo,1'
  ].join('\n');
  const result = await invoke(mantenimientoController.importarEquipos, {
    params: { refugioId: String(refuge.lastID) },
    file: { originalname: 'equipos.csv', size: Buffer.byteLength(csv), buffer: Buffer.from(csv, 'utf8') }
  });
  assert.equal(result.code, 200);
  assert.deepEqual(
    { success: result.body.success, procesados: result.body.procesados, fallidos: result.body.fallidos },
    { success: true, procesados: 4, fallidos: 0 },
    JSON.stringify(result.body)
  );
  assert.equal((await get("SELECT estado FROM equipamientos WHERE codigo = 'IMP-CODE'")).estado, 'Mantenimiento');
  const fallbackRefuge = await get("SELECT id FROM refugios WHERE eliminado = 0 AND estado = 'Operativo' ORDER BY id LIMIT 1");
  assert.equal((await get("SELECT refugio_id FROM equipamientos WHERE codigo = 'IMP-FALLBACK'")).refugio_id, fallbackRefuge.id);
});

test('las vistas nuevas renderizan turnos, incidentes y mantenimiento', async () => {
  const views = path.join(__dirname, '..', 'views');
  const shared = { user: { rol: 'Ski Patrol' }, userPreferences: {}, page: 'turnos' };
  const turnos = await ejs.renderFile(path.join(views, 'turnos.ejs'), {
    ...shared,
    turnos: [{
      id: 1,
      nombre_usuario: 'Patrullero',
      fecha: '2026-10-23',
      rol: 'Ski Patrol',
      estado: 'Operativo',
      hora_inicio: '08:00',
      hora_fin: '16:00'
    }],
    usuarios: [],
    botiquines: [],
    puedeGestionarTurnos: false
  });
  assert.match(turnos, /Fin de jornada/);

  const incidentes = await ejs.renderFile(path.join(views, 'administracion-incidentes.ejs'), {
    ...shared,
    page: 'administracion',
    incidentes: []
  });
  assert.match(incidentes, /incidentForm/);

  const maintenance = await ejs.renderFile(path.join(views, 'mantenimiento.ejs'), {
    ...shared,
    page: 'mantenimiento',
    equipos: [],
    equiposOperativos: [{
      id: 1,
      refugio_id: 1,
      codigo: 'TEST-1',
      nombre: 'Equipo de prueba',
      disponibles: 1,
      refugio: 'Refugio de prueba'
    }],
    reportes: []
  });
  assert.match(maintenance, /Descargar Informe de Mantenciones \(PDF\)/);
  assert.match(maintenance, /maintenanceRefugeSelect/);
  assert.match(maintenance, /maintenanceEquipmentSearch/);
});

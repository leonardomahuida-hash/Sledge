const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../config/database');

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(error) {
      if (error) return reject(error);
      resolve(this);
    });
  });
}

async function seed() {
  await db.ready;
  const adminEmail = String(process.env.DEFAULT_ADMIN_GMAIL || '').trim().toLowerCase();
  const adminPassword = String(process.env.DEFAULT_ADMIN_PASSWORD || '');
  if (!adminEmail || !adminPassword) {
    throw new Error('Faltan DEFAULT_ADMIN_GMAIL o DEFAULT_ADMIN_PASSWORD en .env.');
  }
  const adminHash = await bcrypt.hash(adminPassword, 12);
  const adminRole = adminEmail === 'administracion@sledge.cl' ? 'Super Admin' : 'Admin';
  const existingAdmin = await get('SELECT id FROM usuarios WHERE lower(gmail) = lower(?) LIMIT 1', [adminEmail]);
  if (existingAdmin) {
    await run('UPDATE usuarios SET gmail = ?, password = ?, rol = ? WHERE id = ?', [
      adminEmail, adminHash, adminRole, existingAdmin.id
    ]);
  } else {
    await run(`INSERT INTO usuarios
      (gmail, password, nombre, rol, rut, grupo_sangre, alergias)
      VALUES (?, ?, 'Administrador Sledge', ?, '15.420.192-K', 'O+', 'Ninguna')`, [
      adminEmail, adminHash, adminRole
    ]);
  }

  const refugioCount = await get('SELECT COUNT(*) AS count FROM refugios');
  if (Number(refugioCount.count) === 0) {
    const refugios = [
      ['REF-LV-01', 'Refugio 1', 'Sur', 'Operativo', 100, -33.352, -70.325],
      ['REF-SB-02', 'Refugio 2', 'Norte', 'Operativo', 0, -33.340, -70.310],
      ['REF-TM-04', 'Refugio 3', 'Este', 'Fuera de servicio', 0, -33.360, -70.290],
      ['REF-CM-03', 'Refugio 4', 'Oeste', 'Operativo', 120, -33.370, -70.340]
    ];
    for (const refugio of refugios) {
      await run(`INSERT INTO refugios
        (codigo, nombre, zona, estado, capacidad_maxima, lat, lng, latitud, longitud, altura)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [...refugio, refugio[5], refugio[6]]);
    }
    const equipment = [
      ['SEED-RADIO-001', 1, 'Radios', 'Radio portátil VHF', 'Radio portátil para comunicaciones de rescate.', 12, 15, 'Operativo', 100, null, null, null],
      ['SEED-SLED-001', 1, 'Trineos', 'Trineo de rescate Akja', 'Trineo de rescate con arnés.', 2, 2, 'Operativo', 100, null, 'Arnés de rescate', null],
      ['SEED-KIT-001', 2, 'Botiquines', 'Botiquín de trauma avanzado', 'Kit de atención para rescate.', 1, 4, 'Operativo', 100, '2027-12-31', null, null]
    ];
    for (const item of equipment) {
      await run(`INSERT INTO equipamientos
        (codigo, refugio_id, categoria, nombre, descripcion, disponibles, totales, estado, bateria, fecha_vencimiento, tipo_fijacion, imagen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, item);
    }
  }
  const testCodes = [
    ['REF-LV-01', 'Refugio La Virgen'],
    ['REF-SB-02', 'Refugio Santa Barbara'],
    ['REF-TM-04', 'Refugio Tres Puntas'],
    ['REF-CM-03', 'Refugio Cerro Manchón']
  ];
  for (const [code, name] of testCodes) {
    const existing = await get('SELECT id FROM refugios WHERE lower(trim(COALESCE(codigo, \'\'))) = lower(?) LIMIT 1', [code]);
    if (existing) continue;
    const emptyCodeRefuge = await get(
      `SELECT id FROM refugios
       WHERE eliminado = 0 AND trim(COALESCE(codigo, '')) = ''
       ORDER BY CASE WHEN estado = 'Operativo' THEN 0 ELSE 1 END, id
       LIMIT 1`
    );
    if (emptyCodeRefuge) {
      await run('UPDATE refugios SET codigo = ? WHERE id = ?', [code, emptyCodeRefuge.id]);
    } else {
      await run(
        `INSERT INTO refugios
         (codigo, nombre, zona, estado, capacidad_maxima, lat, lng, latitud, longitud, altura)
         VALUES (?, ?, 'Montaña', 'Operativo', 0, -33.352, -70.325, -33.352, -70.325, 2340)`,
        [code, name]
      );
    }
  }
  console.log('[SEEDER] Esquema SQLite y datos iniciales listos.');
}

seed().catch(error => {
  console.error('[SEEDER] No se pudo inicializar SQLite:', error.message);
  process.exitCode = 1;
});

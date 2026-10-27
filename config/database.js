const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

const dbPath = process.env.DB_PATH
  ? path.resolve(__dirname, '..', process.env.DB_PATH)
  : path.join(__dirname, 'sledge.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath, error => {
  if (error) console.error('[SQLite] Error abriendo la base de datos:', error.message);
  else console.log(`[SQLite] Conectado a ${dbPath}`);
});
db.configure('busyTimeout', Number(process.env.DB_BUSY_TIMEOUT || 5000));
const transactionContext = new AsyncLocalStorage();

function normalizeArguments(params, callback) {
  if (typeof params === 'function') return { params: [], callback: params };
  return { params: params || [], callback };
}

function execute(method, sql, params, callback) {
  const connection = transactionContext.getStore() || db;
  const actualParams = typeof params === 'function' ? [] : params;
  const actualCallback = typeof params === 'function' ? params : callback;
  const store = transactionContext.getStore();
  const wrappedCallback = store && actualCallback
    ? function(...args) {
      return transactionContext.run(store, () => actualCallback.apply(this, args));
    }
    : actualCallback;
  connection[method](sql, actualParams, wrappedCallback);
}

function run(sql, params, callback) {
  const args = normalizeArguments(params, callback);
  const connection = transactionContext.getStore() || db;
  connection.run(sql, args.params, function(error) {
    const statement = this;
    const invokeCallback = () => args.callback && args.callback.call(statement, error);
    if (connection !== db) transactionContext.run(connection, invokeCallback);
    else invokeCallback();
    if (connection !== db && /^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) {
      connection.close(closeError => {
        if (closeError) console.error('[SQLite] Error cerrando la conexión transaccional:', closeError.message);
      });
    } else if (connection !== db && error && /^\s*BEGIN(?:\s+IMMEDIATE)?\s*;?\s*$/i.test(sql)) {
      connection.close(closeError => {
        if (closeError) console.error('[SQLite] Error cerrando la conexión transaccional:', closeError.message);
      });
    }
  });
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

async function ensureColumn(table, column, definition) {
  const columns = await query(`PRAGMA table_info("${table}")`);
  if (!columns.some(item => item.name === column)) {
    await new Promise((resolve, reject) => {
      db.run(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`, error => error ? reject(error) : resolve());
    });
  }
}

async function initialize() {
  await new Promise((resolve, reject) => db.run('PRAGMA foreign_keys = ON', error => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => db.run('PRAGMA journal_mode = WAL', error => error ? reject(error) : resolve()));
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await new Promise((resolve, reject) => db.exec(schema, error => error ? reject(error) : resolve()));

  await ensureColumn('usuarios', 'apodo', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('usuarios', 'foto_perfil', "TEXT NOT NULL DEFAULT 'https://definicion.de/wp-content/uploads/2019/07/perfil-de-usuario.png'");
  await ensureColumn('usuarios', 'enfermedades_cronicas', "TEXT NOT NULL DEFAULT 'N/A'");
  await ensureColumn('usuarios', 'medicamentos_diarios', "TEXT NOT NULL DEFAULT 'N/A'");
  await ensureColumn('usuarios', 'dias_trabajados', "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn('usuarios', 'nivel_experiencia', 'TEXT');
  await ensureColumn('usuarios', 'telefono_contacto', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('usuarios', 'contacto_emergencia_personal', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('usuarios', 'contacto_emergencia_nombre', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('usuarios', 'contacto_emergencia_telefono', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('usuarios', 'estado_disponibilidad', "TEXT NOT NULL DEFAULT 'Disponible'");
  await ensureColumn('usuarios', 'preferencias_json', `TEXT NOT NULL DEFAULT '{"theme":"nieve-nocturna","language":"es","units":"km"}'`);
  await ensureColumn('usuarios', 'activo', 'INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1))');
  await ensureColumn('turnos', 'ultima_actividad', 'TEXT');
  await ensureColumn('mantenimiento_equipamiento', 'fecha_salida', 'TEXT');
  await ensureColumn('mantenimiento_equipamiento', 'estado_reporte', "TEXT NOT NULL DEFAULT 'Abierto'");
  await ensureColumn('refugios', 'latitud', 'REAL');
  await ensureColumn('refugios', 'longitud', 'REAL');
  await ensureColumn('refugios', 'altura', 'REAL NOT NULL DEFAULT 0');
  await ensureColumn('refugios', 'codigo', 'TEXT');

  await new Promise((resolve, reject) => db.run(
    `UPDATE refugios
     SET latitud = COALESCE(latitud, lat),
         longitud = COALESCE(longitud, lng)`,
    error => error ? reject(error) : resolve()
  ));

  await new Promise((resolve, reject) => db.run(
    `UPDATE usuarios
     SET contacto_emergencia_nombre = contacto_emergencia_personal
     WHERE trim(contacto_emergencia_nombre) = ''
       AND trim(contacto_emergencia_personal) <> ''`,
    error => error ? reject(error) : resolve()
  ));

  await new Promise((resolve, reject) => db.run(
    `UPDATE usuarios
     SET rol = CASE
       WHEN lower(trim(gmail)) = 'administracion@sledge.cl' THEN 'Super Admin'
       WHEN lower(trim(rol)) IN ('administrador de refugio', 'administrador', 'admin') THEN 'Admin'
       WHEN lower(trim(rol)) IN ('usuario', 'esquiador', 'usuario / esquiador') THEN 'Usuario / Esquiador'
       WHEN lower(trim(rol)) = 'operador de refugio' THEN 'Operador de Refugio'
       WHEN lower(trim(rol)) IN ('mantenimiento', 'técnico de mantenimiento', 'tecnico de mantenimiento', 'operador de mantenimiento') THEN 'Mantenimiento'
       WHEN lower(trim(rol)) = 'super admin' THEN 'Usuario / Esquiador'
       ELSE rol
     END`,
    error => error ? reject(error) : resolve()
  ));
  await new Promise((resolve, reject) => db.run(
    "UPDATE turnos SET ultima_actividad = CURRENT_TIMESTAMP WHERE ultima_actividad IS NULL",
    error => error ? reject(error) : resolve()
  ));
  await new Promise((resolve, reject) => db.run(
    `UPDATE usuarios
     SET preferencias_json = '{"theme":"nieve-nocturna","language":"es","units":"km"}'
     WHERE preferencias_json IS NULL OR trim(preferencias_json) = '' OR preferencias_json = '{}'`,
    error => error ? reject(error) : resolve()
  ));
  await new Promise((resolve, reject) => db.run(
    `UPDATE usuarios
     SET preferencias_json = '{"theme":"nieve-nocturna","language":"es","units":"km"}'
     WHERE preferencias_json = '{"theme":"cumbre","language":"es","units":"km"}'`,
    error => error ? reject(error) : resolve()
  ));
  await new Promise((resolve, reject) => db.run(
    `UPDATE contactos_emergencia
     SET es_predeterminado = CASE WHEN id = (SELECT MIN(id) FROM contactos_emergencia WHERE es_predeterminado = 1) THEN 1 ELSE 0 END`,
    error => error ? reject(error) : resolve()
  ));
  await new Promise((resolve, reject) => db.run(
    `INSERT INTO contactos_emergencia (nombre, telefono, es_predeterminado)
     SELECT 'Ski Patrol', value, 1
     FROM configuracion
     WHERE key = 'telefono_ski_patrol' AND trim(value) <> ''
       AND NOT EXISTS (SELECT 1 FROM contactos_emergencia)`,
    error => error ? reject(error) : resolve()
  ));
}

const ready = initialize().catch(error => {
  console.error('[SQLite] No se pudo inicializar el esquema:', error.message);
  throw error;
});

module.exports = {
  get(sql, params, callback) {
    const args = normalizeArguments(params, callback);
    execute('get', sql, args.params, args.callback);
  },
  all(sql, params, callback) {
    const args = normalizeArguments(params, callback);
    execute('all', sql, args.params, args.callback);
  },
  run,
  exec(sql, callback) {
    const connection = transactionContext.getStore() || db;
    connection.exec(sql, callback);
  },
  serialize(callback) {
    const connection = new sqlite3.Database(dbPath, error => {
      if (error) {
        console.error('[SQLite] No se pudo abrir una conexión transaccional:', error.message);
        return;
      }
      connection.configure('busyTimeout', Number(process.env.DB_BUSY_TIMEOUT || 5000));
      connection.run('PRAGMA foreign_keys = ON', pragmaError => {
        if (pragmaError) {
          console.error('[SQLite] No se pudieron activar las claves foráneas:', pragmaError.message);
          return connection.close();
        }
        connection.serialize(() => transactionContext.run(connection, callback));
      });
    });
  },
  close(callback) {
    db.close(callback);
  },
  ready,
  dbPath
};

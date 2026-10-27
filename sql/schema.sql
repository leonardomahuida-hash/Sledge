PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  nombre TEXT NOT NULL,
  apodo TEXT NOT NULL DEFAULT '',
  foto_perfil TEXT NOT NULL DEFAULT 'https://definicion.de/wp-content/uploads/2019/07/perfil-de-usuario.png',
  rol TEXT NOT NULL DEFAULT 'Usuario / Esquiador',
  nivel_experiencia TEXT CHECK (
    nivel_experiencia IS NULL OR
    nivel_experiencia IN ('Junior', 'Intermedio', 'Senior', 'Especialista', 'Avanzado/Especialista')
  ),
  rut TEXT UNIQUE NOT NULL,
  grupo_sangre TEXT NOT NULL DEFAULT 'N/A',
  enfermedades_cronicas TEXT NOT NULL DEFAULT 'N/A',
  medicamentos_diarios TEXT NOT NULL DEFAULT 'N/A',
  alergias TEXT NOT NULL DEFAULT 'N/A',
  dias_trabajados TEXT NOT NULL DEFAULT '[]',
  telefono_contacto TEXT NOT NULL DEFAULT '',
  contacto_emergencia_personal TEXT NOT NULL DEFAULT '',
  contacto_emergencia_nombre TEXT NOT NULL DEFAULT '',
  contacto_emergencia_telefono TEXT NOT NULL DEFAULT '',
  estado_disponibilidad TEXT NOT NULL DEFAULT 'Disponible' CHECK(estado_disponibilidad IN ('Disponible', 'En servicio', 'Descanso', 'No disponible')),
  preferencias_json TEXT NOT NULL DEFAULT '{"theme":"nieve-nocturna","language":"es","units":"km"}',
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1))
);

CREATE TABLE IF NOT EXISTS refugios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  zona TEXT NOT NULL,
  estado TEXT NOT NULL,
  capacidad_maxima INTEGER NOT NULL DEFAULT 100,
  eliminado INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  latitud REAL NOT NULL,
  longitud REAL NOT NULL,
  altura REAL NOT NULL DEFAULT 0,
  codigo TEXT
);

CREATE TABLE IF NOT EXISTS equipamientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE NOT NULL,
  refugio_id INTEGER NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'General',
  nombre TEXT NOT NULL,
  descripcion TEXT,
  disponibles INTEGER NOT NULL DEFAULT 0,
  totales INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'Operativo',
  bateria INTEGER NOT NULL DEFAULT 100,
  fecha_vencimiento TEXT,
  estado_sello TEXT NOT NULL DEFAULT 'Intacto',
  tipo_fijacion TEXT,
  imagen TEXT,
  mantenimiento INTEGER NOT NULL DEFAULT 0,
  modelo TEXT,
  eliminado INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(refugio_id) REFERENCES refugios(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS turnos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  hora_inicio TEXT,
  hora_fin TEXT,
  estado TEXT NOT NULL DEFAULT 'Operativo',
  rol TEXT NOT NULL DEFAULT 'Operador de Refugio',
  ultima_actividad TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS asignacion_recurso (
  id_asignacion INTEGER PRIMARY KEY AUTOINCREMENT,
  id_turno INTEGER NOT NULL,
  id_equipamiento INTEGER NOT NULL,
  fecha_hora_asignacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_hora_devolucion TEXT,
  estado_entrega TEXT NOT NULL DEFAULT 'Entregado',
  FOREIGN KEY(id_turno) REFERENCES turnos(id) ON DELETE RESTRICT,
  FOREIGN KEY(id_equipamiento) REFERENCES equipamientos(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS solicitudes_equipamiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refugio_id INTEGER NOT NULL,
  usuario_id INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por INTEGER,
  confirmado_en TEXT,
  FOREIGN KEY(refugio_id) REFERENCES refugios(id) ON DELETE CASCADE,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  FOREIGN KEY(confirmado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS solicitud_equipamiento_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  equipamiento_id INTEGER NOT NULL,
  cantidad INTEGER NOT NULL CHECK(cantidad > 0),
  FOREIGN KEY(solicitud_id) REFERENCES solicitudes_equipamiento(id) ON DELETE CASCADE,
  FOREIGN KEY(equipamiento_id) REFERENCES equipamientos(id) ON DELETE RESTRICT,
  UNIQUE(solicitud_id, equipamiento_id)
);

CREATE TABLE IF NOT EXISTS prestamos_equipamiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL UNIQUE,
  refugio_id INTEGER NOT NULL,
  usuario_id INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'En uso',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  devuelto_en TEXT,
  FOREIGN KEY(solicitud_id) REFERENCES solicitudes_equipamiento(id) ON DELETE CASCADE,
  FOREIGN KEY(refugio_id) REFERENCES refugios(id) ON DELETE CASCADE,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prestamo_equipamiento_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prestamo_id INTEGER NOT NULL,
  equipamiento_id INTEGER NOT NULL,
  cantidad_entregada INTEGER NOT NULL CHECK(cantidad_entregada > 0),
  cantidad_devuelta INTEGER NOT NULL DEFAULT 0 CHECK(cantidad_devuelta >= 0),
  FOREIGN KEY(prestamo_id) REFERENCES prestamos_equipamiento(id) ON DELETE CASCADE,
  FOREIGN KEY(equipamiento_id) REFERENCES equipamientos(id) ON DELETE RESTRICT,
  UNIQUE(prestamo_id, equipamiento_id)
);

CREATE TABLE IF NOT EXISTS devoluciones_equipamiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prestamo_item_id INTEGER NOT NULL,
  usuario_id INTEGER NOT NULL,
  cantidad INTEGER NOT NULL CHECK(cantidad > 0),
  cantidad_danada INTEGER NOT NULL DEFAULT 0 CHECK(cantidad_danada >= 0),
  bateria INTEGER,
  botiquin_usado INTEGER NOT NULL DEFAULT 0,
  observaciones TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(prestamo_item_id) REFERENCES prestamo_equipamiento_items(id) ON DELETE CASCADE,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS mantenimiento_equipamiento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipamiento_id INTEGER NOT NULL,
  usuario_id INTEGER NOT NULL,
  accion TEXT NOT NULL,
  cantidad INTEGER NOT NULL CHECK(cantidad > 0),
  observaciones TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_salida TEXT,
  estado_reporte TEXT NOT NULL DEFAULT 'Abierto',
  FOREIGN KEY(equipamiento_id) REFERENCES equipamientos(id) ON DELETE RESTRICT,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS botiquin_insumos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  botiquin_id INTEGER NOT NULL,
  nombre_insumo TEXT NOT NULL,
  cantidad_disponible INTEGER NOT NULL DEFAULT 0 CHECK(cantidad_disponible >= 0),
  cantidad_critica INTEGER NOT NULL DEFAULT 0 CHECK(cantidad_critica >= 0),
  FOREIGN KEY(botiquin_id) REFERENCES equipamientos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cierres_turno (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id INTEGER NOT NULL UNIQUE,
  usuario_id INTEGER NOT NULL,
  desarrollo TEXT NOT NULL,
  rescate TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(turno_id) REFERENCES turnos(id) ON DELETE CASCADE,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS incidentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('Incidente', 'Accidente')),
  descripcion TEXT NOT NULL,
  latitud REAL NOT NULL CHECK(latitud BETWEEN -90 AND 90),
  longitud REAL NOT NULL CHECK(longitud BETWEEN -180 AND 180),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
);

CREATE VIEW IF NOT EXISTS vw_EquiposInoperativos AS
  SELECT e.id, e.codigo, e.refugio_id, r.nombre AS refugio, e.categoria AS tipo,
         e.nombre, e.estado, e.disponibles, e.mantenimiento,
         e.modelo, e.descripcion, e.eliminado
  FROM equipamientos e
  JOIN refugios r ON r.id = e.refugio_id
  WHERE e.estado IN ('Mantenimiento', 'Descartado') AND e.eliminado = 0;

CREATE TABLE IF NOT EXISTS configuracion (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO configuracion (key, value) VALUES ('telefono_ski_patrol', '');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('refugio_climatico_id', '');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('montana_nombre', 'Centro de Montaña Farellones');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('montana_latitud', '-33.352');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('montana_longitud', '-70.325');
INSERT OR IGNORE INTO configuracion (key, value) VALUES ('montana_altura', '2340');

CREATE TABLE IF NOT EXISTS bitacora_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refugio_id INTEGER NOT NULL,
  condiciones_hash TEXT NOT NULL,
  condiciones_json TEXT NOT NULL,
  recomendacion TEXT NOT NULL,
  modelo TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(refugio_id) REFERENCES refugios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bitacora_ia_refugio_condiciones_fecha
  ON bitacora_ia(refugio_id, condiciones_hash, creado_en DESC);

CREATE TABLE IF NOT EXISTS ia_cuota_diaria (
  fecha TEXT PRIMARY KEY,
  peticiones INTEGER NOT NULL DEFAULT 0 CHECK(peticiones >= 0)
);

CREATE TABLE IF NOT EXISTS pases_montana (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL UNIQUE,
  numero_pase TEXT NOT NULL UNIQUE,
  tipo_pase TEXT NOT NULL,
  fecha_expiracion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'Activo' CHECK(estado IN ('Activo', 'Expirado', 'Revocado')),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contactos_emergencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  telefono TEXT NOT NULL,
  es_predeterminado INTEGER NOT NULL DEFAULT 0 CHECK(es_predeterminado IN (0, 1)),
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zonas_mapa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('Riesgo de avalancha', 'Grietas', 'Zona segura')),
  coordenadas TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pistas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL CHECK(estado IN ('Abierta', 'Cerrada', 'Mantenimiento')),
  coordenadas TEXT NOT NULL DEFAULT '[]',
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ubicaciones_patrulleros (
  usuario_id INTEGER PRIMARY KEY,
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  actualizado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auditoria_sistema (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creado_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INTEGER,
  correo TEXT NOT NULL DEFAULT '',
  rol TEXT NOT NULL DEFAULT '',
  metodo TEXT NOT NULL,
  recurso TEXT NOT NULL,
  codigo_respuesta INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  agente_usuario TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacto_sos_unico_predeterminado
  ON contactos_emergencia(es_predeterminado) WHERE es_predeterminado = 1;
CREATE INDEX IF NOT EXISTS idx_asignacion_recurso_turno ON asignacion_recurso(id_turno);
CREATE INDEX IF NOT EXISTS idx_asignacion_recurso_equipamiento ON asignacion_recurso(id_equipamiento);
CREATE INDEX IF NOT EXISTS idx_asignacion_recurso_turno_equipo ON asignacion_recurso(id_turno, id_equipamiento);
CREATE INDEX IF NOT EXISTS idx_solicitudes_refugio_estado ON solicitudes_equipamiento(refugio_id, estado);
CREATE INDEX IF NOT EXISTS idx_prestamos_refugio_estado ON prestamos_equipamiento(refugio_id, estado);
CREATE INDEX IF NOT EXISTS idx_turnos_fecha_estado_actividad ON turnos(fecha, estado, ultima_actividad);

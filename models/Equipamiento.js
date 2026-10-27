const db = require('../config/database');

class CodigoRequeridoError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodigoRequeridoError";
  }
}

// HUP-001: Clase base Equipamiento
class Equipamiento {
  constructor(codigo, nombre, descripcion, estado = "Operativo", imagen = "") {
    if (!codigo || !String(codigo).trim()) {
      throw new CodigoRequeridoError("El código único del equipamiento es obligatorio.");
    }
    this.codigo = String(codigo).trim();
    this.nombre = nombre;
    this.descripcion = descripcion;
    this.estado = estado;
    this.imagen = imagen;
  }

  // HUP-002: Método base para verificación con polimorfismo
  verificarEstado() {
    return this.estado === "Operativo";
  }

  static getDisponiblesParaMantenimiento(callback) {
    db.all(
      `SELECT e.id, e.refugio_id, e.codigo, e.categoria, e.nombre, e.disponibles, r.nombre AS refugio
       FROM equipamientos e JOIN refugios r ON r.id = e.refugio_id
       WHERE e.eliminado = 0 AND e.estado = 'Operativo' AND e.disponibles > 0
       ORDER BY r.nombre, e.nombre`,
      [],
      callback
    );
  }

  static getInventarioPorCategoria(callback) {
    db.all(
      `SELECT refugio_id, categoria, SUM(disponibles) AS disponibles, SUM(totales) AS totales
       FROM equipamientos
       WHERE eliminado = 0
       GROUP BY refugio_id, categoria`,
      [],
      callback
    );
  }

  static getByRefugio(refugioId, callback) {
    db.all(
      `SELECT e.*,
              COALESCE((SELECT SUM(pi.cantidad_entregada - pi.cantidad_devuelta)
                        FROM prestamo_equipamiento_items pi
                        JOIN prestamos_equipamiento p ON p.id = pi.prestamo_id
                        WHERE pi.equipamiento_id = e.id AND p.estado = 'En uso'), 0) AS en_uso
       FROM equipamientos e
       WHERE e.refugio_id = ? AND e.eliminado = 0
       ORDER BY e.categoria, e.nombre, e.modelo, e.fecha_vencimiento`,
      [refugioId],
      callback
    );
  }

  static getInoperativos(callback) {
    db.all('SELECT * FROM vw_EquiposInoperativos ORDER BY estado, refugio, nombre', [], callback);
  }

  static getReportesMantenimientoDelMes(callback) {
    db.all(
      `SELECT m.id, m.equipamiento_id, m.accion, m.cantidad, m.observaciones,
              m.creado_en, m.fecha_salida, m.estado_reporte,
              e.codigo, e.nombre AS equipo, r.nombre AS refugio, u.nombre AS tecnico
       FROM mantenimiento_equipamiento m
       JOIN equipamientos e ON e.id = m.equipamiento_id
       JOIN refugios r ON r.id = e.refugio_id
       JOIN usuarios u ON u.id = m.usuario_id
       WHERE date(m.creado_en) >= date('now', 'start of month')
       ORDER BY datetime(m.creado_en) DESC`,
      [],
      callback
    );
  }

  static getSolicitudItems(refugioId, equipmentIds, callback) {
    if (!equipmentIds.length) return callback(null, []);
    const placeholders = equipmentIds.map(() => '?').join(',');
    db.all(
      `SELECT id, categoria, estado, disponibles, fecha_vencimiento
       FROM equipamientos
       WHERE refugio_id = ? AND eliminado = 0 AND id IN (${placeholders})`,
      [refugioId, ...equipmentIds],
      callback
    );
  }
}

// HUP-025: Subclase para Radiocomunicación
class Radiocomunicacion extends Equipamiento {
  constructor(codigo, nombre, descripcion, canalFrecuencia, porcentajeBateria, estado, imagen) {
    super(codigo, nombre, descripcion, estado, imagen);
    this.canalFrecuencia = canalFrecuencia;
    this.porcentajeBateria = Number(porcentajeBateria) || 100;
  }

  // Criterio HUP-025 / HUP-032: Operativo si batería > 20%
  verificarEstado() {
    return super.verificarEstado() && this.porcentajeBateria > 20;
  }
}

// HUP-026: Subclase para Insumos Médicos
class InsumoMedico extends Equipamiento {
  constructor(codigo, nombre, descripcion, fechaVencimiento, estadoSello, estado, imagen) {
    super(codigo, nombre, descripcion, estado, imagen);
    this.fechaVencimiento = new Date(fechaVencimiento);
    this.estadoSello = estadoSello || 'Intacto';
  }

  // Criterio HUP-026: Sello 'Intacto' y no vencido respecto al servidor
  verificarEstado() {
    const hoy = new Date();
    const noVencido = this.fechaVencimiento >= hoy;
    return super.verificarEstado() && this.estadoSello === 'Intacto' && noVencido;
  }
}

// HUP-027: Subclase para Medios de Traslado (Camillas/Trineos)
class MedioTraslado extends Equipamiento {
  constructor(codigo, nombre, descripcion, tipoFijacion, estadoCorreas, estado, imagen) {
    super(codigo, nombre, descripcion, estado, imagen);
    this.tipoFijacion = tipoFijacion;
    this.estadoCorreas = estadoCorreas || 'Seguro';
  }

  // Criterio HUP-027: Tipo de fijación no nulo y correas seguras
  verificarEstado() {
    return super.verificarEstado() && Boolean(this.tipoFijacion) && this.estadoCorreas === 'Seguro';
  }
}

module.exports = {
  Equipamiento,
  Radiocomunicacion,
  InsumoMedico,
  MedioTraslado,
  CodigoRequeridoError
};
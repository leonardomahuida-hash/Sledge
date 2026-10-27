class RegistroMantenimiento {
  constructor({ equipamientoId, usuarioId, cantidad, observaciones }) {
    this.equipamientoId = equipamientoId;
    this.usuarioId = usuarioId;
    this.cantidad = cantidad;
    this.observaciones = observaciones;
    this.accion = 'Reportado';
  }
}

module.exports = RegistroMantenimiento;

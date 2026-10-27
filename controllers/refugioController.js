const Refugio = require('../models/Refugio');
const { Equipamiento } = require('../models/Equipamiento');
const RegistroMantenimiento = require('../models/RegistroMantenimiento');
const db = require('../config/database');
const crypto = require('crypto');

const rolesGestorInventario = ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'];
const esGestorInventario = (user) => rolesGestorInventario.includes(String(user && user.rol || '').trim().toLowerCase());
const rolesTecnicoMantenimiento = ['mantenimiento', 'técnico de mantenimiento', 'tecnico de mantenimiento', 'operador de mantenimiento'];
const esTecnicoMantenimiento = (user) => rolesTecnicoMantenimiento.includes(String(user && user.rol || '').trim().toLowerCase());

exports.renderRefugios = (req, res) => {
  const rol = String(req.user && req.user.rol || '').trim().toLowerCase();
  const rolesPermitidos = ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'];
  Refugio.getAll((err, refugios) => {
    if (err) return res.status(500).send("Error al cargar lista de refugios.");
    Equipamiento.getInventarioPorCategoria((inventoryError, inventory) => {
      const porRefugio = new Map();
      (inventory || []).forEach(item => {
        if (!porRefugio.has(item.refugio_id)) porRefugio.set(item.refugio_id, []);
        porRefugio.get(item.refugio_id).push({
          categoria: item.categoria,
          porcentaje: item.totales > 0 ? Math.round(item.disponibles / item.totales * 100) : 0
        });
      });
      const listaRefugios = (refugios || []).map(r => ({
        ...r,
        porcentajeCalculado: r.total_capacidad > 0 ? Math.round(r.total_disponible / r.total_capacidad * 100) : 0,
        categoriasInventario: porRefugio.get(r.id) || [],
        alertaStockBajo: r.total_capacidad === 0 || (r.total_disponible / r.total_capacidad) <= 0.25
      }));
      const puedeGestionarSolicitudes = ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'].includes(rol);
      const puedeVerPanelInventario = ['ski patrol', 'operador de refugio', 'mantenimiento', 'admin', 'administrador', 'administrador de refugio', 'super admin'].includes(rol);
      db.get("SELECT COUNT(*) AS cantidad FROM solicitudes_equipamiento WHERE estado = 'Pendiente'", [], (pendingError, pendientes) => {
        if (pendingError) return res.status(500).send('No se pudieron contar las solicitudes.');
        db.get("SELECT COUNT(*) AS cantidad FROM solicitudes_equipamiento WHERE usuario_id = ? AND estado IN ('Aprobada', 'Rechazada')", [req.user.id], (historyError, historial) => {
          if (historyError) return res.status(500).send('No se pudo contar el historial.');
          res.render('refugio', {
            page: 'refugio',
            refugios: listaRefugios,
            puedeCrearRefugios: rolesPermitidos.includes(rol),
            puedeCambiarEstado: ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'].includes(rol),
            puedeArchivarRefugio: ['administrador de refugio', 'admin', 'administrador', 'super admin'].includes(rol),
            puedeGestionarSolicitudes,
            puedeVerPanelInventario,
            puedeSolicitarEquipamiento: req.user.rol !== 'Usuario / Esquiador',
            puedeVerRecomendacionIA: ['Ski Patrol', 'Operador de Refugio', 'Mantenimiento', 'Admin', 'Super Admin'].includes(req.user.rol),
            cantidadSolicitudesPendientes: puedeGestionarSolicitudes ? pendientes.cantidad : 0,
            cantidadSolicitudesResueltas: historial.cantidad
          });
        });
      });
    });
  });
};

exports.resumenInventario = (req, res) => {
  db.get(`SELECT
            COALESCE(SUM(e.disponibles), 0) AS listas,
            COALESCE(SUM(e.mantenimiento), 0) AS rotas,
            COALESCE((SELECT SUM(pi.cantidad_entregada - pi.cantidad_devuelta)
                      FROM prestamo_equipamiento_items pi
                      JOIN prestamos_equipamiento p ON p.id = pi.prestamo_id
                      JOIN equipamientos active_equipment ON active_equipment.id = pi.equipamiento_id
                      WHERE p.estado = 'En uso' AND active_equipment.eliminado = 0), 0) AS en_uso
          FROM equipamientos e
          WHERE e.eliminado = 0`, [], (error, resumen) => {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo consultar el inventario.' });
    res.json({
      success: true,
      data: { Listas: resumen.listas, Rotas: resumen.rotas, 'En Uso': resumen.en_uso }
    });
  });
};

exports.alertasCaducidadInsumos = (req, res) => {
  db.all(`SELECT id, nombre, fecha_vencimiento,
                 CAST(julianday(fecha_vencimiento) - julianday(date('now')) AS INTEGER) AS dias_para_vencer
          FROM equipamientos
          WHERE eliminado = 0
            AND lower(categoria) IN ('botiquines', 'insumos médicos', 'insumos medicos')
            AND fecha_vencimiento IS NOT NULL
            AND date(fecha_vencimiento) <= date('now', '+30 days')
          ORDER BY date(fecha_vencimiento) ASC`, [], (error, insumos) => {
    if (error) return res.status(500).json({ success: false, error: 'No se pudieron consultar los vencimientos.' });
    res.json({ success: true, data: insumos || [] });
  });
};

exports.renderSolicitudes = (req, res) => {
  if (req.user.rol === 'Usuario / Esquiador') return res.status(403).send('El módulo de solicitudes de equipamiento no está disponible para esquiadores.');
  const rol = String(req.user && req.user.rol || '').trim().toLowerCase();
  const puedeGestionarSolicitudes = ['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'].includes(rol);
  const filtro = puedeGestionarSolicitudes ? "(s.estado = 'Pendiente' OR s.usuario_id = ?)" : 's.usuario_id = ?';
  db.all(`SELECT s.id, s.refugio_id, s.usuario_id, s.estado, s.creado_en,
                 u.nombre AS solicitante, r.nombre AS nombre_refugio
          FROM solicitudes_equipamiento s
          JOIN usuarios u ON u.id = s.usuario_id
          JOIN refugios r ON r.id = s.refugio_id
          WHERE ${filtro} ORDER BY CASE WHEN s.estado = 'Pendiente' THEN 0 ELSE 1 END, s.creado_en DESC LIMIT 100`,
    [req.user.id], (error, solicitudes) => {
      if (error) return res.status(500).send('No se pudieron cargar las solicitudes.');
      Promise.all((solicitudes || []).map(solicitud => new Promise(resolve => {
        db.all(`SELECT si.cantidad, e.nombre, e.categoria, e.modelo, e.fecha_vencimiento
                FROM solicitud_equipamiento_items si JOIN equipamientos e ON e.id = si.equipamiento_id
                WHERE si.solicitud_id = ?`, [solicitud.id], (itemsError, items) => {
          resolve({ ...solicitud, items: itemsError ? [] : items || [] });
        });
      }))).then(solicitudes => res.render('refugio-solicitudes', {
        page: 'refugio',
        solicitudes,
        puedeGestionarSolicitudes,
        cantidadPendientes: solicitudes.filter(solicitud => solicitud.estado === 'Pendiente').length
      }));
    });
};

exports.actualizarEstadoRefugio = (req, res) => {
  const rol = String(req.user && req.user.rol || '').trim().toLowerCase();
  if (!['administrador de refugio', 'admin', 'administrador', 'super admin', 'operador de refugio'].includes(rol)) {
    return res.status(403).json({ success: false, error: 'No tienes permiso para cambiar el estado del refugio.' });
  }
  const refugioId = Number(req.params.id);
  const estado = req.body.estado;
  if (!Number.isInteger(refugioId) || !['Operativo', 'Fuera de servicio'].includes(estado)) {
    return res.status(400).json({ success: false, error: 'El estado seleccionado no es válido.' });
  }
  db.run('UPDATE refugios SET estado = ? WHERE id = ?', [estado, refugioId], function(error) {
    if (error) return res.status(500).json({ success: false, error: 'No se pudo actualizar el refugio.' });
    if (!this.changes) return res.status(404).json({ success: false, error: 'El refugio no existe.' });
    res.json({ success: true, estado });
  });
};

exports.renderRefugioDetalle = (req, res) => {
  const refugioId = req.params.id;

  Refugio.getById(refugioId, (err, refugio) => {
    if (err || !refugio) return res.redirect('/refugio');

    Equipamiento.getByRefugio(refugioId, (equipmentError, equipos) => {
      if (equipmentError) return res.status(500).send('No se pudo cargar el inventario.');
      db.all(
        `SELECT bi.id, bi.botiquin_id, bi.nombre_insumo, bi.cantidad_disponible, bi.cantidad_critica
         FROM botiquin_insumos bi
         JOIN equipamientos e ON e.id = bi.botiquin_id
         WHERE e.refugio_id = ? AND e.eliminado = 0
         ORDER BY bi.nombre_insumo`,
        [refugioId],
        (contentsError, contents) => {
      if (contentsError) return res.status(500).send('No se pudo cargar el contenido de los botiquines.');
      const contentsByKit = new Map();
      (contents || []).forEach(item => {
        if (!contentsByKit.has(item.botiquin_id)) contentsByKit.set(item.botiquin_id, []);
        contentsByKit.get(item.botiquin_id).push(item);
      });
      const grupos = new Map();
      const hoy = new Date().toISOString().slice(0, 10);
      (equipos || []).forEach(equipo => {
        const clave = `${equipo.categoria.toLocaleLowerCase()}\u0000${equipo.nombre.trim().toLocaleLowerCase()}\u0000${String(equipo.modelo || '').trim().toLocaleLowerCase()}`;
        if (!grupos.has(clave)) grupos.set(clave, {
          categoria: equipo.categoria,
          nombre: equipo.nombre,
          modelo: equipo.modelo || '',
          descripcion: equipo.descripcion,
          lotes: [],
          disponibles: 0,
          enUso: 0,
          mantenimiento: 0,
          totales: 0
        });
        const grupo = grupos.get(clave);
        const necesitaVencimiento = ['botiquines', 'insumos médicos'].includes(String(equipo.categoria).toLowerCase());
        const vencido = Boolean(equipo.fecha_vencimiento && equipo.fecha_vencimiento < hoy);
        const lote = {
          ...equipo,
          insumosBotiquin: contentsByKit.get(equipo.id) || [],
          imagenVisible: equipo.imagen && !equipo.imagen.includes('photo-1544620347-c4fd4a3d5957'),
          disponibleSolicitud: refugio.estado === 'Operativo' && equipo.estado === 'Operativo' && equipo.disponibles > 0 && !vencido && (!necesitaVencimiento || Boolean(equipo.fecha_vencimiento)),
          vencido
        };
        grupo.lotes.push(lote);
        if (lote.disponibleSolicitud) grupo.disponibles += Number(equipo.disponibles) || 0;
        grupo.enUso += Number(equipo.en_uso) || 0;
        grupo.mantenimiento += Number(equipo.mantenimiento) || 0;
        grupo.totales += Number(equipo.totales) || 0;
      });
      const puedeGestionarEquipamiento = esGestorInventario(req.user);
      const puedeArchivarRefugio = ['administrador de refugio', 'admin', 'administrador', 'super admin'].includes(String(req.user && req.user.rol || '').trim().toLowerCase());
      grupos.forEach(grupo => {
        grupo.noDisponible = Math.max(0, grupo.totales - grupo.disponibles - grupo.enUso - grupo.mantenimiento);
      });
      const categorias = new Map();
      [...grupos.values()].forEach(grupo => {
        if (!categorias.has(grupo.categoria)) categorias.set(grupo.categoria, { nombre: grupo.categoria, productos: [] });
        categorias.get(grupo.categoria).productos.push(grupo);
      });
      const render = prestamosActivos => res.render('refugio-detalle', {
        page: 'refugio',
        refugio,
        categoriasEquipamiento: [...categorias.values()],
        prestamosActivos: prestamosActivos || [],
        puedeGestionarEquipamiento,
        puedeSolicitarEquipamiento: req.user.rol !== 'Usuario / Esquiador',
        puedeArchivarRefugio
      });
      const filtroPrestamo = puedeGestionarEquipamiento ? 'p.refugio_id = ?' : 'p.refugio_id = ? AND p.usuario_id = ?';
      const parametrosPrestamo = puedeGestionarEquipamiento ? [refugioId] : [refugioId, req.user.id];
      db.all(`SELECT p.id, p.usuario_id, p.creado_en, u.nombre AS solicitante
              FROM prestamos_equipamiento p JOIN usuarios u ON u.id = p.usuario_id
              WHERE ${filtroPrestamo} AND p.estado = 'En uso' ORDER BY p.creado_en`, parametrosPrestamo, (loanError, loans) => {
        if (loanError) return res.status(500).send('No se pudieron cargar las devoluciones pendientes.');
        Promise.all((loans || []).map(prestamo => new Promise((resolve, reject) => {
          db.all(`SELECT pi.id, pi.cantidad_entregada, pi.cantidad_devuelta,
                         e.nombre, e.categoria, e.bateria, e.tipo_fijacion
                  FROM prestamo_equipamiento_items pi JOIN equipamientos e ON e.id = pi.equipamiento_id
                  WHERE pi.prestamo_id = ? AND pi.cantidad_devuelta < pi.cantidad_entregada`, [prestamo.id], (itemError, lineas) => {
            if (itemError) return reject(itemError);
            resolve({ ...prestamo, items: lineas || [] });
          });
        }))).then(render).catch(error => {
          console.error('[REFUGIO] No se pudieron cargar los préstamos activos:', error.message);
          res.status(500).send('No se pudieron cargar las devoluciones pendientes.');
        });
          }
        );
      });
    });
  });
};

// HUP-011: Reportar equipo averiado
exports.reportarAveria = (req, res) => {
  const refugioId = Number(req.params.id);
  const equipoId = Number(req.params.equipoId);
  const cantidad = Number(req.body.cantidad);
  const observaciones = String(req.body.detalle_falla || '').trim().slice(0, 500);
  if (!Number.isInteger(refugioId) || !Number.isInteger(equipoId) || !Number.isInteger(cantidad) ||
      cantidad < 1 || !observaciones) {
    return res.status(400).json({ success: false, error: 'Indica una cantidad y describe la falla.' });
  }
  const registro = new RegistroMantenimiento({
    equipamientoId: equipoId,
    usuarioId: req.user.id,
    cantidad,
    observaciones
  });
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar el reporte.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.run(`UPDATE equipamientos
              SET disponibles = disponibles - ?,
                  mantenimiento = mantenimiento + ?,
                  estado = CASE WHEN disponibles = ? THEN 'Mantenimiento' ELSE estado END
              WHERE id = ? AND refugio_id = ? AND eliminado = 0 AND disponibles >= ?`,
        [registro.cantidad, registro.cantidad, registro.cantidad, registro.equipamientoId, refugioId, registro.cantidad],
        function(updateError) {
          if (updateError) return rollback(500, 'No se pudo actualizar el estado del equipo.');
          if (this.changes !== 1) return rollback(409, 'No hay unidades disponibles o el equipo no existe.');
          db.run(`INSERT INTO mantenimiento_equipamiento
                  (equipamiento_id, usuario_id, accion, cantidad, observaciones)
                  VALUES (?, ?, ?, ?, ?)`,
            [registro.equipamientoId, registro.usuarioId, registro.accion, registro.cantidad, registro.observaciones],
            insertError => {
              if (insertError) return rollback(500, 'No se pudo guardar el registro de mantenimiento.');
              db.run('COMMIT', commitError => {
                if (commitError) return rollback(500, 'No se pudo confirmar el reporte.');
                res.status(201).json({ success: true, message: 'Falla reportada; el equipo pasó a mantenimiento.' });
              });
            });
        });
    });
  });
};

// HUP-014: Dar de baja un equipo destruido
exports.darDeBaja = (req, res) => {
  const { equipamiento_id } = req.body;
  db.run("UPDATE equipamientos SET estado = 'Descartado' WHERE id = ?", [equipamiento_id], (err) => {
    res.json({ success: !err, msg: "Equipo dado de baja definitivamente." });
  });
};

// HUP-036: Alta de taller técnico
exports.altaTaller = (req, res) => {
  const { equipamiento_id } = req.body;
  db.run("UPDATE equipamientos SET estado = 'Operativo' WHERE id = ?", [equipamiento_id], (err) => {
    res.json({ success: !err, msg: "Equipo reinstalado como Operativo." });
  });
};

// HUP-028: Formulario dinámico de creación
exports.addEquipamiento = (req, res) => {
  const refugioId = req.params.id;
  const { nombre, modelo, categoria, descripcion, cantidad, bateria, fecha_vencimiento, tipo_fijacion, imagen } = req.body;
  const cantidadNumero = Number(cantidad);
  const categoriasValidas = ['General', 'Radiocomunicación', 'Insumos Médicos', 'Medios de Traslado', 'Radios', 'Botiquines', 'Trineos', 'Camillas'];
  if (!String(nombre || '').trim() || String(nombre).trim().length > 120 || !categoriasValidas.includes(categoria) ||
      !Number.isInteger(cantidadNumero) || cantidadNumero < 1 || cantidadNumero > 100000) {
    return res.status(400).send('Revisa el nombre, la categoría y la cantidad del equipamiento.');
  }
  const requiereVencimiento = ['Botiquines', 'Insumos Médicos'].includes(categoria);
  if (requiereVencimiento && !fecha_vencimiento) {
    return res.status(400).send('Los botiquines y suministros médicos requieren fecha de vencimiento.');
  }
  if (fecha_vencimiento && (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_vencimiento) || Number.isNaN(Date.parse(`${fecha_vencimiento}T00:00:00Z`)) || new Date(`${fecha_vencimiento}T00:00:00Z`).toISOString().slice(0, 10) !== fecha_vencimiento || fecha_vencimiento < new Date().toISOString().slice(0, 10))) {
    return res.status(400).send('La fecha de vencimiento no es válida.');
  }
  const bateriaNumero = bateria === '' || bateria === undefined ? 100 : Number(bateria);
  if (!Number.isInteger(bateriaNumero) || bateriaNumero < 0 || bateriaNumero > 100) {
    return res.status(400).send('La batería debe ser un porcentaje entre 0 y 100.');
  }
  let imagenSegura = null;
  if (imagen) {
    try {
      const urlImagen = new URL(imagen);
      if (!['http:', 'https:'].includes(urlImagen.protocol)) throw new Error('Invalid image URL protocol');
      imagenSegura = urlImagen.toString();
    } catch (error) {
      return res.status(400).send('La URL de imagen debe usar HTTP o HTTPS.');
    }
  }
  const codigo = `EQ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  db.run(
    `INSERT INTO equipamientos (codigo, refugio_id, categoria, nombre, modelo, descripcion, disponibles, totales, bateria, fecha_vencimiento, tipo_fijacion, estado, imagen) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Operativo', ?)`,
    [codigo, refugioId, categoria, String(nombre).trim(), String(modelo || '').trim() || null, descripcion || '', cantidadNumero, cantidadNumero, bateriaNumero, fecha_vencimiento || null, tipo_fijacion || null, imagenSegura],
    function(err) {
      if (err) {
        console.error('Error al insertar equipo:', err);
        return res.status(500).send('No se pudo guardar el equipamiento.');
      }
      res.redirect(`/refugio/${refugioId}`);
    }
  );
};

exports.crearSolicitudEquipamiento = (req, res) => {
  const refugioId = Number(req.params.id);
  const itemsEntrada = req.body.items;
  if (!Number.isInteger(refugioId) || !Array.isArray(itemsEntrada) || itemsEntrada.length < 1 || itemsEntrada.length > 100) {
    return res.status(400).json({ success: false, error: 'La solicitud debe incluir equipamiento válido.' });
  }
  const itemsMap = new Map();
  for (const item of itemsEntrada) {
    const equipamientoId = Number(item.equipamiento_id);
    const cantidad = Number(item.cantidad);
    if (!Number.isInteger(equipamientoId) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 1000) {
      return res.status(400).json({ success: false, error: 'Revisa las cantidades solicitadas.' });
    }
    itemsMap.set(equipamientoId, (itemsMap.get(equipamientoId) || 0) + cantidad);
  }
  const items = [...itemsMap].map(([equipamiento_id, cantidad]) => ({ equipamiento_id, cantidad }));
  Refugio.getById(refugioId, (shelterError, refugio) => {
    if (shelterError || !refugio) return res.status(404).json({ success: false, error: 'El refugio no existe.' });
    if (refugio.estado !== 'Operativo') return res.status(409).json({ success: false, error: 'El refugio está fuera de servicio.' });
    Equipamiento.getSolicitudItems(refugioId, items.map(item => item.equipamiento_id), (err, equipos) => {
      if (err) return res.status(500).json({ success: false, error: 'No se pudo revisar el inventario.' });
      const porId = new Map((equipos || []).map(equipo => [equipo.id, equipo]));
      const hoy = new Date().toISOString().slice(0, 10);
      for (const item of items) {
        const equipo = porId.get(item.equipamiento_id);
        const requiereVencimiento = equipo && ['Botiquines', 'Insumos Médicos'].includes(equipo.categoria);
        if (!equipo || equipo.estado !== 'Operativo' || item.cantidad > equipo.disponibles ||
            (requiereVencimiento && (!equipo.fecha_vencimiento || equipo.fecha_vencimiento < hoy))) {
          return res.status(409).json({ success: false, error: 'La disponibilidad cambió o el equipo no se puede solicitar.' });
        }
      }
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE', beginError => {
          if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la solicitud.' });
          db.run("INSERT INTO solicitudes_equipamiento (refugio_id, usuario_id, estado) VALUES (?, ?, 'Pendiente')",
            [refugioId, req.user.id], function(insertError) {
              if (insertError) return db.run('ROLLBACK', () => res.status(500).json({ success: false, error: 'No se pudo crear la solicitud.' }));
              const solicitudId = this.lastID;
              let indice = 0;
              const guardarLinea = () => {
                if (indice >= items.length) {
                  return db.run('COMMIT', commitError => {
                    if (commitError) return db.run('ROLLBACK', () => res.status(500).json({ success: false, error: 'No se pudo confirmar la solicitud.' }));
                    res.status(201).json({ success: true, solicitud_id: solicitudId });
                  });
                }
                const item = items[indice++];
                db.run('INSERT INTO solicitud_equipamiento_items (solicitud_id, equipamiento_id, cantidad) VALUES (?, ?, ?)',
                  [solicitudId, item.equipamiento_id, item.cantidad], lineError => {
                    if (lineError) return db.run('ROLLBACK', () => res.status(500).json({ success: false, error: 'No se pudieron guardar los artículos.' }));
                    guardarLinea();
                  });
              };
              guardarLinea();
            });
        });
      });
      });
  });
};

exports.resolverSolicitudEquipamiento = (req, res) => {
  const refugioId = Number(req.params.id);
  const solicitudId = Number(req.params.solicitudId);
  const decision = req.body.decision;
  if (!['Aprobada', 'Rechazada'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'La decisión no es válida.' });
  }
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la confirmación.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.get("SELECT id, usuario_id, estado FROM solicitudes_equipamiento WHERE id = ? AND refugio_id = ?", [solicitudId, refugioId], (requestError, solicitud) => {
        if (requestError) return rollback(500, 'No se pudo consultar la solicitud.');
        if (!solicitud || solicitud.estado !== 'Pendiente') return rollback(409, 'La solicitud ya fue resuelta o no existe.');
        const actualizarSolicitud = () => db.run(
          'UPDATE solicitudes_equipamiento SET estado = ?, confirmado_por = ?, confirmado_en = CURRENT_TIMESTAMP WHERE id = ? AND estado = \'Pendiente\'',
          [decision, req.user.id, solicitudId], function(updateError) {
            if (updateError || this.changes !== 1) return rollback(409, 'No se pudo actualizar la solicitud.');
            db.run('COMMIT', commitError => {
              if (commitError) return rollback(500, 'No se pudo guardar la decisión.');
              res.json({ success: true, estado: decision });
            });
          });
        if (decision === 'Rechazada') return actualizarSolicitud();
        db.all(`SELECT si.equipamiento_id, si.cantidad, e.categoria, e.estado AS estado_equipo,
                       e.disponibles, e.fecha_vencimiento
                FROM solicitud_equipamiento_items si JOIN equipamientos e ON e.id = si.equipamiento_id
                WHERE si.solicitud_id = ? AND e.refugio_id = ?`, [solicitudId, refugioId], (itemsError, items) => {
          if (itemsError || !items || !items.length) return rollback(500, 'No se pudieron revisar los artículos solicitados.');
          const hoy = new Date().toISOString().slice(0, 10);
          if (items.some(item => item.estado_equipo !== 'Operativo' || item.cantidad > item.disponibles ||
              (['Botiquines', 'Insumos Médicos'].includes(item.categoria) && (!item.fecha_vencimiento || item.fecha_vencimiento < hoy)))) {
            return rollback(409, 'No hay existencias suficientes o algún lote venció.');
          }
          let indice = 0;
          const descontarSiguiente = () => {
            if (indice >= items.length) {
              return db.run('INSERT INTO prestamos_equipamiento (solicitud_id, refugio_id, usuario_id) VALUES (?, ?, ?)',
                [solicitudId, refugioId, solicitud.usuario_id], function(loanError) {
                  if (loanError) return rollback(500, 'No se pudo registrar la salida del equipo.');
                  const prestamoId = this.lastID;
                  let loanIndex = 0;
                  const saveLoanItem = () => {
                    if (loanIndex >= items.length) return actualizarSolicitud();
                    const itemEntregado = items[loanIndex++];
                    db.run(`INSERT INTO prestamo_equipamiento_items (prestamo_id, equipamiento_id, cantidad_entregada)
                            VALUES (?, ?, ?)`, [prestamoId, itemEntregado.equipamiento_id, itemEntregado.cantidad], lineError => {
                      if (lineError) return rollback(500, 'No se pudo registrar todo el equipo entregado.');
                      saveLoanItem();
                    });
                  };
                  saveLoanItem();
                });
            }
            const item = items[indice++];
            db.run(`UPDATE equipamientos SET disponibles = disponibles - ?
                    WHERE id = ? AND refugio_id = ? AND estado = 'Operativo' AND disponibles >= ?`,
              [item.cantidad, item.equipamiento_id, refugioId, item.cantidad], function(stockError) {
                if (stockError || this.changes !== 1) return rollback(409, 'El inventario cambió; no se descontó la solicitud.');
                descontarSiguiente();
              });
          };
          descontarSiguiente();
        });
      });
    });
  });
};

exports.registrarDevolucion = (req, res) => {
  const refugioId = Number(req.params.id);
  const prestamoId = Number(req.params.prestamoId);
  const itemId = Number(req.params.itemId);
  const cantidad = Number(req.body.cantidad);
  const cantidadDanada = Number(req.body.cantidad_danada || 0);
  const bateria = req.body.bateria === '' || req.body.bateria === undefined ? null : Number(req.body.bateria);
  const botiquinUsado = req.body.botiquin_usado === true || req.body.botiquin_usado === 'on' || req.body.botiquin_usado === 'true';
  const observaciones = String(req.body.observaciones || '').trim().slice(0, 500);
  if (!Number.isInteger(cantidad) || cantidad < 1 || !Number.isInteger(cantidadDanada) || cantidadDanada < 0 || cantidadDanada > cantidad) {
    return res.status(400).json({ success: false, error: 'Revisa la cantidad recibida y la cantidad dañada.' });
  }
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la devolución.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.get(`SELECT pi.id, pi.cantidad_entregada, pi.cantidad_devuelta, e.id AS equipo_id,
                     e.categoria, e.bateria, p.usuario_id, p.estado AS estado_prestamo
              FROM prestamo_equipamiento_items pi
              JOIN prestamos_equipamiento p ON p.id = pi.prestamo_id
              JOIN equipamientos e ON e.id = pi.equipamiento_id
              WHERE pi.id = ? AND p.id = ? AND p.refugio_id = ?`,
        [itemId, prestamoId, refugioId], (lookupError, item) => {
          if (lookupError) return rollback(500, 'No se pudo consultar el préstamo.');
          if (!item || item.estado_prestamo !== 'En uso') return rollback(404, 'El préstamo ya está cerrado o no existe.');
          if (item.usuario_id !== req.user.id && !esGestorInventario(req.user)) return rollback(403, 'No puedes devolver un préstamo asignado a otra persona.');
          const pendiente = item.cantidad_entregada - item.cantidad_devuelta;
          if (cantidad > pendiente) return rollback(400, 'La cantidad supera lo que está pendiente de devolver.');
          const categoria = String(item.categoria || '').toLowerCase();
          const esRadio = categoria.includes('radio');
          const esBotiquin = categoria.includes('botiqu') || categoria.includes('insumos médicos');
          if (esRadio && (!Number.isInteger(bateria) || bateria < 0 || bateria > 100)) {
            return rollback(400, 'Indica la carga actual de la radio entre 0 y 100%.');
          }
          if (esBotiquin && cantidadDanada > 0) return rollback(400, 'Los botiquines usados se registran como consumidos, no como dañados.');
          const cantidadDisponible = esBotiquin && botiquinUsado ? 0 : cantidad - cantidadDanada;
          const cantidadConsumida = esBotiquin && botiquinUsado ? cantidad : 0;
          db.run(`INSERT INTO devoluciones_equipamiento
                  (prestamo_item_id, usuario_id, cantidad, cantidad_danada, bateria, botiquin_usado, observaciones)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [itemId, req.user.id, cantidad, cantidadDanada, bateria, botiquinUsado ? 1 : 0, observaciones], insertError => {
              if (insertError) return rollback(500, 'No se pudo guardar el informe de devolución.');
              db.run(`UPDATE equipamientos SET
                        disponibles = disponibles + ?,
                        totales = MAX(0, totales - ?),
                        mantenimiento = mantenimiento + ?,
                        bateria = COALESCE(?, bateria)
                      WHERE id = ? AND refugio_id = ?`,
                [cantidadDisponible, cantidadConsumida, cantidadDanada, bateria, item.equipo_id, refugioId], function(stockError) {
                  if (stockError || this.changes !== 1) return rollback(500, 'No se pudo actualizar el inventario.');
                  db.run(`UPDATE prestamo_equipamiento_items
                          SET cantidad_devuelta = cantidad_devuelta + ?
                          WHERE id = ? AND cantidad_devuelta + ? <= cantidad_entregada`,
                    [cantidad, itemId, cantidad], function(returnError) {
                      if (returnError || this.changes !== 1) return rollback(409, 'La cantidad pendiente cambió; vuelve a cargar el refugio.');
                      db.get(`SELECT COUNT(*) AS pendientes FROM prestamo_equipamiento_items
                              WHERE prestamo_id = ? AND cantidad_devuelta < cantidad_entregada`, [prestamoId], (pendingError, result) => {
                        if (pendingError) return rollback(500, 'No se pudo cerrar el préstamo.');
                        const cerrarPrestamo = result.pendientes === 0;
                        const guardarPrestamo = cerrarPrestamo
                          ? db.run("UPDATE prestamos_equipamiento SET estado = 'Devuelto', devuelto_en = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'En uso'", [prestamoId], finishError => {
                            if (finishError) return rollback(500, 'No se pudo cerrar el préstamo.');
                            db.run('COMMIT', commitError => {
                              if (commitError) return rollback(500, 'No se pudo guardar la devolución.');
                              res.json({ success: true, cerrado: true });
                            });
                          })
                          : db.run('COMMIT', commitError => {
                            if (commitError) return rollback(500, 'No se pudo guardar la devolución.');
                            res.json({ success: true, cerrado: false });
                          });
                        return guardarPrestamo;
                      });
                    });
                });
            });
        });
    });
  });
};

exports.actualizarMantenimiento = (req, res) => {
  if (!esGestorInventario(req.user) && !esTecnicoMantenimiento(req.user)) {
    return res.status(403).json({ success: false, error: 'Se requiere el rol de mantenimiento o gestión del refugio.' });
  }
  const refugioId = Number(req.params.id);
  const equipoId = Number(req.params.equipoId);
  const cantidad = Number(req.body.cantidad);
  const accion = req.body.accion;
  const observaciones = String(req.body.observaciones || '').trim().slice(0, 500);
  if (!Number.isInteger(cantidad) || cantidad < 1 || !['Enviar', 'Reintegrar'].includes(accion)) {
    return res.status(400).json({ success: false, error: 'Indica una acción y cantidad válidas.' });
  }
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar el movimiento de mantenimiento.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.get('SELECT id, disponibles, mantenimiento, eliminado FROM equipamientos WHERE id = ? AND refugio_id = ?', [equipoId, refugioId], (lookupError, equipo) => {
        if (lookupError) return rollback(500, 'No se pudo consultar el equipo.');
        if (!equipo || equipo.eliminado) return rollback(404, 'El equipo no existe.');
        const enviar = accion === 'Enviar';
        if (enviar && cantidad > equipo.disponibles) return rollback(409, 'La cantidad supera el stock disponible.');
        if (!enviar && cantidad > equipo.mantenimiento) return rollback(409, 'La cantidad supera el equipo pendiente en mantenimiento.');
        const update = enviar
          ? `UPDATE equipamientos SET disponibles = disponibles - ?, mantenimiento = mantenimiento + ?,
               estado = CASE WHEN disponibles = ? THEN 'Mantenimiento' ELSE estado END
             WHERE id = ? AND disponibles >= ?`
          : `UPDATE equipamientos SET disponibles = disponibles + ?, mantenimiento = mantenimiento - ?,
               estado = CASE WHEN mantenimiento = ? THEN 'Operativo' ELSE estado END
             WHERE id = ? AND mantenimiento >= ?`;
        db.run(update, enviar
          ? [cantidad, cantidad, cantidad, equipoId, cantidad]
          : [cantidad, cantidad, cantidad, equipoId, cantidad], function(updateError) {
          if (updateError || this.changes !== 1) return rollback(409, 'El inventario cambió; vuelve a intentarlo.');
          db.run(`INSERT INTO mantenimiento_equipamiento
                  (equipamiento_id, usuario_id, accion, cantidad, observaciones, fecha_salida, estado_reporte)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [equipoId, req.user.id, enviar ? 'Enviado' : 'Reintegrado', cantidad, observaciones,
              enviar ? null : new Date().toISOString().slice(0, 10), enviar ? 'Abierto' : 'Cerrado'], logError => {
              if (logError) return rollback(500, 'No se pudo guardar el registro de mantenimiento.');
              db.run('COMMIT', commitError => {
                if (commitError) return rollback(500, 'No se pudo guardar el movimiento.');
                res.json({ success: true, accion: enviar ? 'Enviado' : 'Reintegrado' });
              });
            });
        });
      });
    });
  });
};

exports.agregarInsumoBotiquin = (req, res) => {
  const refugioId = Number(req.params.id);
  const botiquinId = Number(req.params.equipoId);
  const nombre = String(req.body.nombre_insumo || '').trim();
  const cantidad = Number(req.body.cantidad_disponible);
  const critica = Number(req.body.cantidad_critica);
  if (!Number.isSafeInteger(refugioId) || !Number.isSafeInteger(botiquinId) ||
      !nombre || nombre.length > 120 || !Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > 100000 ||
      !Number.isSafeInteger(critica) || critica < 0 || critica > 100000) {
    return res.status(400).json({ success: false, error: 'Revisa el nombre y las cantidades del insumo.' });
  }
  db.get(
    `SELECT id FROM equipamientos
     WHERE id = ? AND refugio_id = ? AND eliminado = 0
       AND lower(categoria) LIKE '%botiqu%'`,
    [botiquinId, refugioId],
    (lookupError, botiquin) => {
      if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo consultar el botiquín.' });
      if (!botiquin) return res.status(404).json({ success: false, error: 'El botiquín no existe en este refugio.' });
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE', beginError => {
          if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar el registro del insumo.' });
          const rollback = () => db.run('ROLLBACK', () => res.status(500).json({ success: false, error: 'No se pudo guardar el insumo del botiquín.' }));
          db.run(
            `INSERT INTO botiquin_insumos (botiquin_id, nombre_insumo, cantidad_disponible, cantidad_critica)
             VALUES (?, ?, ?, ?)`,
            [botiquinId, nombre, cantidad, critica],
            function(insertError) {
              if (insertError) return rollback();
              const insumoId = this.lastID;
              db.run(
                `UPDATE equipamientos
                 SET estado = CASE
                   WHEN EXISTS (
                     SELECT 1 FROM botiquin_insumos
                     WHERE botiquin_id = ? AND cantidad_disponible < cantidad_critica
                   ) THEN 'Incompleto' ELSE 'Operativo' END
                 WHERE id = ? AND estado IN ('Operativo', 'Incompleto')`,
                [botiquinId, botiquinId],
                stateError => {
                  if (stateError) return rollback();
                  db.run('COMMIT', commitError => {
                    if (commitError) return rollback();
                    res.status(201).json({ success: true, id: insumoId });
                  });
                }
              );
            }
          );
        });
      });
    }
  );
};

exports.archivarEquipamiento = (req, res) => {
  if (!esGestorInventario(req.user)) return res.status(403).json({ success: false, error: 'No tienes permiso para retirar inventario.' });
  const refugioId = Number(req.params.id);
  const equipoId = Number(req.params.equipoId);
  db.get(`SELECT e.id, e.mantenimiento,
                 (SELECT COUNT(*) FROM solicitud_equipamiento_items si JOIN solicitudes_equipamiento s ON s.id = si.solicitud_id WHERE si.equipamiento_id = e.id AND s.estado = 'Pendiente') AS solicitudes,
                 (SELECT COALESCE(SUM(pi.cantidad_entregada - pi.cantidad_devuelta), 0) FROM prestamo_equipamiento_items pi JOIN prestamos_equipamiento p ON p.id = pi.prestamo_id WHERE pi.equipamiento_id = e.id AND p.estado = 'En uso') AS en_uso
          FROM equipamientos e WHERE e.id = ? AND e.refugio_id = ? AND e.eliminado = 0`, [equipoId, refugioId], (lookupError, equipo) => {
    if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo consultar el equipo.' });
    if (!equipo) return res.status(404).json({ success: false, error: 'El equipo no existe.' });
    if (equipo.solicitudes || equipo.en_uso || equipo.mantenimiento) return res.status(409).json({ success: false, error: 'No se puede retirar: hay solicitudes, unidades prestadas o mantenimiento pendiente.' });
    db.run('UPDATE equipamientos SET eliminado = 1, disponibles = 0 WHERE id = ? AND refugio_id = ? AND eliminado = 0', [equipoId, refugioId], function(error) {
      if (error) return res.status(500).json({ success: false, error: 'No se pudo retirar el equipo.' });
      res.json({ success: true });
    });
  });
};

exports.archivarCategoriaEquipamiento = (req, res) => {
  if (!esGestorInventario(req.user)) return res.status(403).json({ success: false, error: 'No tienes permiso para retirar categorías.' });
  const refugioId = Number(req.params.id);
  const categoria = String(req.body.categoria || '').trim();
  if (!categoria || categoria.length > 80) return res.status(400).json({ success: false, error: 'La categoría no es válida.' });
  db.get(`SELECT COUNT(*) AS equipos,
                 SUM(CASE WHEN e.mantenimiento > 0 OR EXISTS (
                   SELECT 1 FROM prestamo_equipamiento_items pi JOIN prestamos_equipamiento p ON p.id = pi.prestamo_id
                   WHERE pi.equipamiento_id = e.id AND p.estado = 'En uso'
                 ) OR EXISTS (
                   SELECT 1 FROM solicitud_equipamiento_items si JOIN solicitudes_equipamiento s ON s.id = si.solicitud_id
                   WHERE si.equipamiento_id = e.id AND s.estado = 'Pendiente'
                 ) THEN 1 ELSE 0 END) AS bloqueados
          FROM equipamientos e WHERE e.refugio_id = ? AND e.categoria = ? AND e.eliminado = 0`, [refugioId, categoria], (lookupError, result) => {
    if (lookupError) return res.status(500).json({ success: false, error: 'No se pudo consultar la categoría.' });
    if (!result || !result.equipos) return res.status(404).json({ success: false, error: 'La categoría no tiene equipamiento activo.' });
    if (result.bloqueados) return res.status(409).json({ success: false, error: 'No se puede retirar una categoría con solicitudes, préstamos o mantenimiento pendientes.' });
    db.run('UPDATE equipamientos SET eliminado = 1, disponibles = 0 WHERE refugio_id = ? AND categoria = ? AND eliminado = 0', [refugioId, categoria], function(error) {
      if (error) return res.status(500).json({ success: false, error: 'No se pudo retirar la categoría.' });
      res.json({ success: true, retirados: this.changes });
    });
  });
};

exports.archivarRefugio = (req, res) => {
  const rolesAdmin = ['administrador de refugio', 'admin', 'administrador', 'super admin'];
  if (!rolesAdmin.includes(String(req.user && req.user.rol || '').trim().toLowerCase())) {
    return res.status(403).json({ success: false, error: 'Solo administración puede retirar refugios.' });
  }
  const refugioId = Number(req.params.id);
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar el retiro del refugio.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.get(`SELECT r.id,
                     (SELECT COUNT(*) FROM solicitudes_equipamiento s WHERE s.refugio_id = r.id AND s.estado = 'Pendiente') AS solicitudes,
                     (SELECT COUNT(*) FROM prestamos_equipamiento p WHERE p.refugio_id = r.id AND p.estado = 'En uso') AS prestamos,
                     (SELECT COUNT(*) FROM equipamientos e WHERE e.refugio_id = r.id AND e.eliminado = 0 AND e.mantenimiento > 0) AS mantenimientos
              FROM refugios r WHERE r.id = ? AND r.eliminado = 0`, [refugioId], (lookupError, refugio) => {
        if (lookupError) return rollback(500, 'No se pudo consultar el refugio.');
        if (!refugio) return rollback(404, 'El refugio no existe.');
        if (refugio.solicitudes || refugio.prestamos || refugio.mantenimientos) return rollback(409, 'No se puede retirar el refugio con solicitudes, préstamos o mantenimientos pendientes.');
        db.run('UPDATE equipamientos SET eliminado = 1, disponibles = 0 WHERE refugio_id = ? AND eliminado = 0', [refugioId], equipmentError => {
          if (equipmentError) return rollback(500, 'No se pudo archivar el inventario del refugio.');
          db.run('UPDATE refugios SET eliminado = 1, estado = ? WHERE id = ? AND eliminado = 0', ['Fuera de servicio', refugioId], function(updateError) {
            if (updateError || this.changes !== 1) return rollback(500, 'No se pudo retirar el refugio.');
            db.run('COMMIT', commitError => {
              if (commitError) return rollback(500, 'No se pudo guardar el retiro del refugio.');
              res.json({ success: true });
            });
          });
        });
      });
    });
  });
};
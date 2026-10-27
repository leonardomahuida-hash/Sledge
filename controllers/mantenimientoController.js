const PDFDocument = require('pdfkit');
const { inflateRawSync } = require('zlib');
const db = require('../config/database');
const { Equipamiento } = require('../models/Equipamiento');
const Refugio = require('../models/Refugio');

const ESTADOS = ['Operativo', 'Incompleto', 'Mantenimiento', 'Descartado'];
const CAMPOS_REQUERIDOS = ['codigo', 'tipo', 'estado', 'refugio_id', 'nombre', 'cantidad'];

exports.renderMantenimiento = async (req, res) => {
  try {
    const equipos = await new Promise((resolve, reject) => {
      Equipamiento.getInoperativos((error, rows) => error ? reject(error) : resolve(rows));
    });
    const equiposOperativos = await new Promise((resolve, reject) => {
      Equipamiento.getDisponiblesParaMantenimiento((error, rows) => error ? reject(error) : resolve(rows));
    });
    const reportes = await new Promise((resolve, reject) => {
      Equipamiento.getReportesMantenimientoDelMes((error, rows) => error ? reject(error) : resolve(rows));
    });
    const selectedRefugeId = Number((req.query || {}).refugio_id);
    const selectedEquipmentId = Number((req.query || {}).equipo_id);
    const selectedEquipment = equiposOperativos.find(equipo =>
      equipo.id === selectedEquipmentId && equipo.refugio_id === selectedRefugeId
    );
    res.render('mantenimiento', {
      page: 'mantenimiento',
      equipos,
      equiposOperativos,
      reportes,
      selectedRefugeId: selectedEquipment ? selectedRefugeId : null,
      selectedEquipmentId: selectedEquipment ? selectedEquipmentId : null
    });
  } catch (error) {
    console.error('[MANTENIMIENTO] No se pudo cargar el módulo:', error.message);
    res.status(500).send('No se pudo cargar el módulo de mantenimiento.');
  }
};

exports.reportarFalla = (req, res) => {
  const equipmentId = Number(req.params.id);
  const cantidad = Number(req.body.cantidad);
  const observaciones = String(req.body.observaciones || '').trim();
  if (!Number.isSafeInteger(equipmentId) || equipmentId < 1 ||
      !Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > 100000 ||
      !observaciones || observaciones.length > 500) {
    return res.status(400).json({ success: false, error: 'Indica unidades y describe la falla.' });
  }
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar el reporte de falla.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.run(
        `UPDATE equipamientos
         SET disponibles = disponibles - ?,
             mantenimiento = mantenimiento + ?,
             estado = CASE WHEN disponibles = ? THEN 'Mantenimiento' ELSE estado END
         WHERE id = ? AND eliminado = 0 AND estado = 'Operativo' AND disponibles >= ?`,
        [cantidad, cantidad, cantidad, equipmentId, cantidad],
        function(updateError) {
          if (updateError) return rollback(500, 'No se pudo actualizar el inventario.');
          if (this.changes !== 1) return rollback(409, 'El equipo no está operativo o no tiene unidades disponibles suficientes.');
          db.run(
            `INSERT INTO mantenimiento_equipamiento
             (equipamiento_id, usuario_id, accion, cantidad, observaciones, estado_reporte)
             VALUES (?, ?, 'Reportado', ?, ?, 'Abierto')`,
            [equipmentId, req.user.id, cantidad, observaciones],
            insertError => {
              if (insertError) return rollback(500, 'No se pudo registrar el reporte.');
              db.run('COMMIT', commitError => {
                if (commitError) return rollback(500, 'No se pudo confirmar el reporte.');
                res.status(201).json({ success: true });
              });
            }
          );
        }
      );
    });
  });
};

exports.altaTaller = (req, res) => {
  const equipmentId = Number(req.params.id);
  const fechaSalida = String(req.body.fecha_salida || '');
  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fechaSalida) &&
    !Number.isNaN(Date.parse(`${fechaSalida}T00:00:00Z`)) &&
    new Date(`${fechaSalida}T00:00:00Z`).toISOString().slice(0, 10) === fechaSalida &&
    fechaSalida <= new Date().toISOString().slice(0, 10);
  if (!Number.isSafeInteger(equipmentId) || equipmentId < 1 || !fechaValida) {
    return res.status(400).json({ success: false, error: 'Indica un equipo y una fecha de salida válida.' });
  }

  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar el alta de taller.' });
      const rollback = (status, error) => db.run('ROLLBACK', () => res.status(status).json({ success: false, error }));
      db.get(
        `SELECT id, cantidad FROM mantenimiento_equipamiento
         WHERE equipamiento_id = ? AND estado_reporte = 'Abierto'
         ORDER BY id DESC LIMIT 1`,
        [equipmentId],
        (reportError, report) => {
          if (reportError) return rollback(500, 'No se pudo consultar el reporte de falla.');
          if (!report) return rollback(409, 'El equipo no tiene un reporte de falla abierto.');
          db.run(
            `UPDATE mantenimiento_equipamiento
             SET fecha_salida = ?, estado_reporte = 'Cerrado'
             WHERE id = ? AND estado_reporte = 'Abierto'`,
            [fechaSalida, report.id],
            function(closeError) {
              if (closeError || this.changes !== 1) return rollback(409, 'El reporte ya fue cerrado o no pudo actualizarse.');
              db.run(
                `UPDATE equipamientos
                 SET disponibles = disponibles + ?,
                     mantenimiento = MAX(0, mantenimiento - ?),
                     estado = CASE
                       WHEN estado = 'Descartado' THEN estado
                       WHEN mantenimiento - ? > 0 THEN 'Mantenimiento'
                       ELSE 'Operativo'
                     END
                 WHERE id = ? AND estado <> 'Descartado'`,
                [report.cantidad, report.cantidad, report.cantidad, equipmentId],
                function(updateError) {
                  if (updateError || this.changes !== 1) return rollback(409, 'No se pudo reintegrar el equipo al inventario.');
                  db.run('COMMIT', commitError => {
                    if (commitError) return rollback(500, 'No se pudo confirmar el alta de taller.');
                    res.json({ success: true, fecha_salida: fechaSalida });
                  });
                }
              );
            }
          );
        }
      );
    });
  });
};

exports.descargarInformePdf = async (req, res) => {
  try {
    const reportes = await new Promise((resolve, reject) => {
      Equipamiento.getReportesMantenimientoDelMes((error, rows) => error ? reject(error) : resolve(rows));
    });
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="informe-mantenciones.pdf"');
    doc.pipe(res);
    doc.fontSize(18).text('Informe de mantenciones', { align: 'center' });
    doc.moveDown(0.4).fontSize(10).text(`Período: ${new Date().toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}`);
    doc.moveDown();
    if (!reportes.length) {
      doc.fontSize(11).text('No hay reparaciones registradas durante el mes actual.');
    } else {
      reportes.forEach((item, index) => {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(12).text(`${index + 1}. ${item.equipo} (${item.codigo})`, { continued: false });
        doc.fontSize(9)
          .text(`Centro: ${item.refugio} · Acción: ${item.accion} · Unidades: ${item.cantidad}`)
          .text(`Reportado: ${item.creado_en} · Técnico: ${item.tecnico} · Estado: ${item.estado_reporte}`)
          .text(`Salida de taller: ${item.fecha_salida || 'Pendiente'}`)
          .text(`Detalle: ${item.observaciones || 'Sin observaciones'}`);
        doc.moveDown(0.8);
      });
    }
    doc.end();
  } catch (error) {
    console.error('[MANTENIMIENTO] No se pudo generar el informe PDF:', error.message);
    if (!res.headersSent) res.status(500).send('No se pudo generar el informe de mantenciones.');
    else res.destroy(error);
  }
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('El CSV contiene un campo entre comillas sin cerrar.');
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readZipEntries(buffer) {
  if (buffer.length < 22 || buffer.toString('ascii', 0, 2) !== 'PK') throw new Error('El archivo XLSX no es un ZIP válido.');
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const minimumOffset = Math.max(0, buffer.length - 65557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === endSignature.readUInt32LE(0)) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('El archivo XLSX está incompleto.');
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount > 1000 || directoryOffset >= buffer.length) throw new Error('El XLSX tiene una estructura no válida.');
  const entries = new Map();
  let offset = directoryOffset;
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('El XLSX contiene un directorio ZIP inválido.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    totalSize += uncompressedSize;
    if (totalSize > 20 * 1024 * 1024 || compressedSize > buffer.length || localOffset + 30 > buffer.length) {
      throw new Error('El contenido del XLSX supera el límite permitido.');
    }
    if (!name.startsWith('xl/') || name.includes('\\') || name.split('/').includes('..')) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('El XLSX contiene una entrada ZIP inválida.');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > buffer.length) throw new Error('El XLSX contiene una entrada truncada.');
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = inflateRawSync(compressed, { maxOutputLength: 20 * 1024 * 1024 });
    else continue;
    if (content.length !== uncompressedSize) throw new Error('No se pudo verificar el tamaño de un elemento XLSX.');
    entries.set(name, content.toString('utf8'));
  }
  return entries;
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlAttribute(tag, attribute) {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escapedAttribute}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]) : '';
}

function parseXlsx(buffer) {
  const entries = readZipEntries(buffer);
  const workbook = entries.get('xl/workbook.xml');
  const relationships = entries.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) throw new Error('No se encontró la estructura de libro XLSX.');
  const sheetTag = /<sheet\b[^>]*\/?>/.exec(workbook);
  if (!sheetTag) throw new Error('El XLSX no contiene hojas de cálculo.');
  const relationId = xmlAttribute(sheetTag[0], 'r:id');
  const relationTag = [...relationships.matchAll(/<Relationship\b[^>]*\/?>/g)]
    .map(match => match[0])
    .find(tag => xmlAttribute(tag, 'Id') === relationId);
  if (!relationTag) throw new Error('No se pudo identificar la primera hoja XLSX.');
  const target = xmlAttribute(relationTag, 'Target');
  const sheetPath = target.startsWith('/')
    ? target.slice(1)
    : require('path').posix.normalize(require('path').posix.join('xl', target));
  if (!sheetPath.startsWith('xl/')) throw new Error('La ruta de la hoja XLSX no es válida.');
  const sheet = entries.get(sheetPath);
  if (!sheet) throw new Error('No se encontró la primera hoja del XLSX.');
  const sharedStringsXml = entries.get('xl/sharedStrings.xml') || '';
  const sharedStrings = [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map(match => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(text => decodeXml(text[1]))
      .join(''));
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(xmlAttribute(rowMatch[1], 'r')) || rows.length + 1;
    const row = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = xmlAttribute(cellMatch[1], 'r');
      const columnName = /^[A-Z]+/i.exec(reference);
      if (!columnName) continue;
      const column = [...columnName[0].toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const type = xmlAttribute(cellMatch[1], 't');
      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cellMatch[2]);
      const inlineString = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cellMatch[2]);
      let cellValue = value ? decodeXml(value[1]) : '';
      if (type === 's') cellValue = sharedStrings[Number(cellValue)] || '';
      else if (type === 'inlineStr' && inlineString) {
        cellValue = [...inlineString[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
          .map(text => decodeXml(text[1]))
          .join('');
      }
      row[column] = cellValue;
    }
    rows[rowNumber - 1] = row;
  }
  return rows;
}

async function readImportRows(file) {
  let rows;
  if (/\.csv$/i.test(file.originalname)) {
    rows = parseCsv(file.buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } else {
    rows = parseXlsx(file.buffer);
  }
  if (!rows.length) throw new Error('El archivo está vacío.');
  rows = rows.map(row => row || []);
  const headers = rows[0].map(value => String(value).replace(/\uFEFF/g, '').trim().toLowerCase());
  const missing = CAMPOS_REQUERIDOS.filter(field => !headers.includes(field));
  if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.join(', ')}.`);
  const indexes = Object.fromEntries(CAMPOS_REQUERIDOS.map(field => [field, headers.indexOf(field)]));
  return rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    codigo: String(row[indexes.codigo] || '').trim(),
    tipo: String(row[indexes.tipo] || '').trim(),
    estado: String(row[indexes.estado] || '').replace(/\uFEFF/g, '').trim()
      .replace(/^en\s+mantenimiento$/i, 'Mantenimiento'),
    refugio_id: String(row[indexes.refugio_id] || '').replace(/\uFEFF/g, '').trim(),
    nombre: String(row[indexes.nombre] || '').trim(),
    cantidad: Number(row[indexes.cantidad])
  })).filter(row => row.codigo || row.tipo || row.estado || row.refugio_id || row.nombre || row.cantidad);
}

exports.importarEquipos = (req, res) => {
  if (!req.file || req.file.size > 5 * 1024 * 1024) {
    return res.status(400).json({ success: false, error: 'Adjunta un archivo CSV o XLSX de hasta 5 MB.' });
  }
  readImportRows(req.file).then(rows => {
    importarFilas(rows, req, res);
  }).catch(error => {
    res.status(400).json({ success: false, error: error.message });
  });
  return;
};

function importarFilas(rows, req, res) {
  if (rows.length > 1000) return res.status(400).json({ success: false, error: 'El archivo no puede superar 1.000 registros.' });
  if (!rows.length) return res.status(400).json({ success: false, error: 'No hay registros para importar.' });

  const resumen = { procesados: 0, fallidos: 0, errores: [] };
  let index = 0;
  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', beginError => {
      if (beginError) return res.status(500).json({ success: false, error: 'No se pudo iniciar la importación.' });
      const rollback = error => db.run('ROLLBACK', () => res.status(500).json({ success: false, error }));
      const next = () => {
        if (index >= rows.length) {
          return db.run('COMMIT', commitError => {
            if (commitError) return rollback('No se pudo confirmar la importación.');
            res.json({ success: true, ...resumen });
          });
        }
        const row = rows[index++];
        const fail = message => {
          resumen.fallidos += 1;
          resumen.errores.push(`Fila ${row.rowNumber}: ${message}`);
          next();
        };
        if (!row.codigo || row.codigo.length > 100 || !row.tipo || row.tipo.length > 120 ||
            !ESTADOS.includes(row.estado) || !row.refugio_id || row.refugio_id.length > 120 ||
            !row.nombre || row.nombre.length > 120 ||
            !Number.isSafeInteger(row.cantidad) || row.cantidad < 1 || row.cantidad > 100000) {
          return fail('Revisa código, tipo, estado, refugio, nombre y cantidad.');
        }
        Refugio.getImportTarget(row.refugio_id, (refugeError, refuges) => {
             if (refugeError) return rollback('No se pudo validar el refugio del archivo.');
             if (!refuges.length) return fail('El refugio indicado no existe.');
             if (refuges.length > 1) return fail('El refugio indicado es ambiguo; revisa su ID, código o nombre.');
             db.run(
               `INSERT INTO equipamientos
                (codigo, refugio_id, categoria, nombre, disponibles, totales, estado)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(codigo) DO UPDATE SET
                  refugio_id = excluded.refugio_id,
                  categoria = excluded.categoria,
                  nombre = excluded.nombre,
                  disponibles = excluded.disponibles,
                  totales = excluded.totales,
                  estado = excluded.estado`,
               [row.codigo, refuges[0].id, row.tipo, row.nombre, row.cantidad, row.cantidad, row.estado],
               error => {
                 if (error) {
                   console.error('[MANTENIMIENTO] No se pudo guardar equipo importado:', error.message);
                   return fail('No se pudo guardar el equipo.');
                 }
                 resumen.procesados += 1;
                 next();
               }
             );
           }
        );
      };
      next();
    });
  });
};

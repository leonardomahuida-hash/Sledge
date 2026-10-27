const crypto = require('crypto');
const Groq = require('groq-sdk');
const db = require('../config/database');
const Refugio = require('../models/Refugio');

const configuredDailyLimit = Number(process.env.AI_DAILY_LIMIT);
const DAILY_LIMIT = Number.isInteger(configuredDailyLimit) && configuredDailyLimit >= 30 && configuredDailyLimit <= 50
  ? configuredDailyLimit
  : 40;
const MODEL = 'llama-3.1-8b-instant';
const STRONG_WIND_KMH = 50;
const MOUNTAIN_TIME_ZONE = 'America/Santiago';

function zoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const part = type => parts.find(value => value.type === type).value;
  const wallClock = Date.UTC(
    Number(part('year')),
    Number(part('month')) - 1,
    Number(part('day')),
    Number(part('hour')),
    Number(part('minute')),
    Number(part('second'))
  );
  return (wallClock - date.getTime()) / 60000;
}

function mountainDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOUNTAIN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const part = type => parts.find(value => value.type === type).value;
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const startWallClock = Date.UTC(year, month - 1, day);
  const endWallClock = Date.UTC(year, month - 1, day + 1);
  const startOffset = zoneOffsetMinutes(new Date(Date.UTC(year, month - 1, day, 12)), MOUNTAIN_TIME_ZONE);
  const endOffset = zoneOffsetMinutes(new Date(Date.UTC(year, month - 1, day + 1, 12)), MOUNTAIN_TIME_ZONE);
  const start = new Date(startWallClock - startOffset * 60000);
  const end = new Date(endWallClock - endOffset * 60000);
  const sqliteDateTime = value => value.toISOString().slice(0, 19).replace('T', ' ');
  return { date, start: sqliteDateTime(start), end: sqliteDateTime(end) };
}

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

async function getActiveRefugio() {
  return new Promise((resolve, reject) => {
    Refugio.getClimatico((error, refugio) => error ? reject(error) : resolve(refugio));
  });
}

async function consultarTiempo(refugio) {
  const parametros = new URLSearchParams({
    latitude: String(refugio.latitud),
    longitude: String(refugio.longitud),
    elevation: String(refugio.altura),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    hourly: 'weather_code,temperature_2m,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum,wind_speed_10m_max',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
    timezone: 'auto'
  });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 12000);
  timeout.unref();
  let data;
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${parametros}`, {
      signal: abortController.signal
    });
    if (!response.ok) throw new Error(`Open-Meteo respondió con HTTP ${response.status}.`);
    data = await response.json();
  } finally {
    clearTimeout(timeout);
  }
  if (!data.current || !data.daily || !data.hourly) throw new Error('Open-Meteo no devolvió las condiciones actuales y el pronóstico extendido.');
  return {
    current: data.current,
    current_units: data.current_units || {},
    hourly: data.hourly,
    hourly_units: data.hourly_units || {},
    daily: data.daily,
    daily_units: data.daily_units || {}
  };
}

function validarCoordenadas(refugio) {
  return refugio &&
    Number.isFinite(Number(refugio.latitud)) && Number(refugio.latitud) >= -90 && Number(refugio.latitud) <= 90 &&
    Number.isFinite(Number(refugio.longitud)) && Number(refugio.longitud) >= -180 && Number(refugio.longitud) <= 180;
}

function manejarError(res, etiqueta, error) {
  console.error(`[CLIMA] ${etiqueta}:`, error.message);
  res.status(502).json({ success: false, error: 'No se pudo consultar el servicio de clima. Inténtalo nuevamente más tarde.' });
}

exports.consultarClima = async (req, res) => {
  try {
    const refugio = await getActiveRefugio();
    if (!refugio) return res.status(404).json({ success: false, error: 'No hay centros de esquí configurados.' });
    if (!validarCoordenadas(refugio)) {
      return res.status(409).json({ success: false, error: 'Configura coordenadas válidas para el centro de esquí antes de consultar el clima.' });
    }
    const weather = await consultarTiempo(refugio);
    res.json({ success: true, refugio, weather });
  } catch (error) {
    manejarError(res, 'No se pudo obtener el pronóstico', error);
  }
};

exports.obtenerUltimaRecomendacion = async (req, res) => {
  try {
    const refugio = await getActiveRefugio();
    if (!refugio) return res.json({ success: true, recomendacion: null });
    const recommendation = await get(
      `SELECT recomendacion, creado_en FROM bitacora_ia
       WHERE refugio_id = ? ORDER BY datetime(creado_en) DESC LIMIT 1`,
      [refugio.id]
    );
    res.json({
      success: true,
      recomendacion: recommendation ? recommendation.recomendacion : null,
      creado_en: recommendation ? recommendation.creado_en : null
    });
  } catch (error) {
    manejarError(res, 'No se pudo recuperar la recomendación guardada', error);
  }
};

exports.generarRecomendacion = async (req, res) => {
  try {
    const refugio = await getActiveRefugio();
    if (!refugio) return res.status(404).json({ success: false, error: 'No hay centros de esquí configurados.' });
    if (!validarCoordenadas(refugio)) {
      return res.status(409).json({ success: false, error: 'Configura coordenadas válidas para el centro de esquí antes de solicitar una recomendación.' });
    }
    const weather = await consultarTiempo(refugio);
    const mountainDay = mountainDayBounds();
    const conditions = JSON.stringify({
      refugio: { id: refugio.id, latitud: refugio.latitud, longitud: refugio.longitud, altura: refugio.altura },
      weather
    });
    const conditionsHash = crypto.createHash('sha256').update(conditions).digest('hex');
    const cached = await get(
      `SELECT recomendacion, creado_en, condiciones_json FROM bitacora_ia
       WHERE refugio_id = ? AND datetime(creado_en) >= datetime(?) AND datetime(creado_en) < datetime(?)
       ORDER BY datetime(creado_en) DESC LIMIT 1`,
      [refugio.id, mountainDay.start, mountainDay.end]
    );
    const current = weather.current || {};
    const previousWeather = cached ? (() => {
      try {
        return JSON.parse(cached.condiciones_json).weather;
      } catch (error) {
        console.error('[CLIMA] No se pudieron leer las condiciones de la recomendación guardada:', error.message);
        return null;
      }
    })() : null;
    const previousCurrent = previousWeather && previousWeather.current || {};
    const temperatureDrop = Number.isFinite(Number(current.temperature_2m)) &&
      Number.isFinite(Number(previousCurrent.temperature_2m)) &&
      Number(previousCurrent.temperature_2m) - Number(current.temperature_2m) > 5;
    const strongWindNow = Number(current.wind_speed_10m) >= STRONG_WIND_KMH;
    const strongWindBefore = Number(previousCurrent.wind_speed_10m) >= STRONG_WIND_KMH;
    const climateChangedDrastically = Boolean(cached && (
      temperatureDrop || (strongWindNow && !strongWindBefore)
    ));
    if (cached && !climateChangedDrastically) {
      return res.json({
        success: true,
        status: 'cache',
        recomendacion: cached.recomendacion,
        creado_en: cached.creado_en,
        refugio,
        weather
      });
    }

    const ultima = async () => get(
      `SELECT recomendacion, creado_en FROM bitacora_ia
       WHERE refugio_id = ? ORDER BY datetime(creado_en) DESC LIMIT 1`,
      [refugio.id]
    );
    const responderCuota = async () => {
      const last = await ultima();
      return res.json({
        success: true,
        status: 'quota',
        recomendacion: last ? last.recomendacion : 'Se alcanzó el límite diario y todavía no hay recomendaciones guardadas para este centro.',
        creado_en: last ? last.creado_en : null,
        aviso: 'Modo de ahorro de cuota activo: mostrando última recomendación del turno.',
        refugio,
        weather
      });
    };
    const currentUsage = await get('SELECT peticiones FROM ia_cuota_diaria WHERE fecha = ?', [mountainDay.date]);
    if (currentUsage && currentUsage.peticiones >= DAILY_LIMIT) return responderCuota();
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ success: false, error: 'La integración de IA no está configurada: falta GROQ_API_KEY.' });
    }

    const reservation = await run(
      `INSERT INTO ia_cuota_diaria (fecha, peticiones) VALUES (?, 1)
       ON CONFLICT(fecha) DO UPDATE SET peticiones = peticiones + 1
       WHERE peticiones < ?`,
      [mountainDay.date, DAILY_LIMIT]
    );
    if (!reservation.changes) return responderCuota();

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente de seguridad para montaña. En español, sugiere equipamiento adecuado para el turno basándote únicamente en las condiciones entregadas. Sé conciso, destaca riesgos climáticos relevantes y recuerda que la sugerencia no reemplaza la evaluación del personal ni los protocolos locales.'
        },
        {
          role: 'user',
          content: `Centro: ${refugio.nombre}. Altura: ${refugio.altura} m. Condiciones meteorológicas actuales y pronóstico del día: ${JSON.stringify(weather)}`
        }
      ]
    });
    const recommendation = completion.choices[0] && completion.choices[0].message &&
      String(completion.choices[0].message.content || '').trim();
    if (!recommendation) throw new Error('Groq devolvió una respuesta vacía.');

    const record = await run(
      `INSERT INTO bitacora_ia
       (refugio_id, condiciones_hash, condiciones_json, recomendacion, modelo)
       VALUES (?, ?, ?, ?, ?)`,
      [refugio.id, conditionsHash, conditions, recommendation, MODEL]
    );
    const saved = await get('SELECT creado_en FROM bitacora_ia WHERE id = ?', [record.lastID]);
    res.json({
      success: true,
      status: 'fresh',
      recomendacion: recommendation,
      creado_en: saved.creado_en,
      refugio,
      weather
    });
  } catch (error) {
    manejarError(res, 'No se pudo generar la recomendación', error);
  }
};

exports.validarCoordenadas = validarCoordenadas;

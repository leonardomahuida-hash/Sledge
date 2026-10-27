const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testDbPath = path.join(os.tmpdir(), `sledge-clima-${process.pid}.db`);
process.env.DB_PATH = testDbPath;
process.env.JWT_SECRET = 'climate-test-secret';
process.env.GROQ_API_KEY = 'test-groq-key';

const database = require('../config/database');
const auth = require('../middlewares/authMiddleware');
const climaController = require('../controllers/climaController');
const climaRoutes = require('../routes/climaRoutes');
const administracionRoutes = require('../routes/administracionRoutes');
const jwt = require('jsonwebtoken');
const express = require('express');

const get = (sql, params = []) => new Promise((resolve, reject) => {
  database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});
const run = (sql, params = []) => new Promise((resolve, reject) => {
  database.run(sql, params, function(error) {
    if (error) return reject(error);
    resolve(this);
  });
});
const mountainDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}-${parts.find(part => part.type === 'day').value}`;
};

after(async () => {
  await database.ready;
  await new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${testDbPath}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('configura clima extendido y reutiliza la recomendación diaria salvo cambios drásticos', async () => {
  await database.ready;
  const operator = await run(
    'INSERT INTO usuarios (gmail, password, nombre, rut, rol) VALUES (?, ?, ?, ?, ?)',
    ['clima-operador@sledge.test', 'unused', 'Operador Clima', '77777-7', 'Operador de Refugio']
  );
  const skier = await run(
    'INSERT INTO usuarios (gmail, password, nombre, rut, rol) VALUES (?, ?, ?, ?, ?)',
    ['clima-esquiador@sledge.test', 'unused', 'Esquiador Clima', '88888-8', 'Usuario / Esquiador']
  );
  const refuge = await run(
    `INSERT INTO refugios (nombre, zona, estado, lat, lng, latitud, longitud, altura)
     VALUES ('Centro Clima', 'Norte', 'Operativo', -33.4, -70.6, -33.4, -70.6, 2400)`
  );

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.use(express.json());
  app.use('/administracion', administracionRoutes);
  app.use('/clima', climaRoutes);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headersFor = id => ({
    Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`
  });
  const fetchOriginal = global.fetch;
  let expectFarellones = false;
  try {
    const settingsPage = await fetch(`${baseUrl}/administracion/refugio`, { headers: headersFor(operator.lastID) });
    assert.equal(settingsPage.status, 200);
    const settingsHtml = await settingsPage.text();
    assert.match(settingsHtml, /Altitud sobre el nivel del mar/);
    assert.doesNotMatch(settingsHtml, /Centro o refugio|Código del centro/);

    const deniedSettings = await fetch(`${baseUrl}/administracion/refugio`, { headers: headersFor(skier.lastID) });
    assert.equal(deniedSettings.status, 403);

    const update = await fetch(`${baseUrl}/administracion/refugio`, {
      method: 'PUT',
      headers: { ...headersFor(operator.lastID), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Centro Actualizado', latitud: -34.2, longitud: -71.5, altura: 1850 })
    });
    assert.equal(update.status, 200);
    assert.equal((await get("SELECT value FROM configuracion WHERE key = 'montana_nombre'")).value, 'Centro Actualizado');
    assert.equal((await get("SELECT value FROM configuracion WHERE key = 'montana_latitud'")).value, '-34.2');
    assert.equal((await get("SELECT value FROM configuracion WHERE key = 'montana_longitud'")).value, '-71.5');
    assert.equal((await get("SELECT value FROM configuracion WHERE key = 'montana_altura'")).value, '1850');

    const invalid = await fetch(`${baseUrl}/administracion/refugio`, {
      method: 'PUT',
      headers: { ...headersFor(operator.lastID), 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Centro Actualizado', latitud: 91, longitud: -71.5, altura: 1850 })
    });
    assert.equal(invalid.status, 400);

    const climatePage = await fetch(`${baseUrl}/clima`, { headers: headersFor(operator.lastID) });
    assert.equal(climatePage.status, 200);
    const climateHtml = await climatePage.text();
    assert.match(climateHtml, /Centro Actualizado/);
    assert.match(climateHtml, /hourlyForecast/);
    assert.match(climateHtml, /dailyForecast/);
    assert.doesNotMatch(climateHtml, /generateRecommendation/);

    const deniedRecommendation = await fetch(`${baseUrl}/clima/api/recomendacion`, {
      method: 'POST',
      headers: headersFor(skier.lastID)
    });
    assert.equal(deniedRecommendation.status, 403);

    let weather = {
      current: {
        time: '2026-10-22T08:00',
        temperature_2m: 2,
        relative_humidity_2m: 70,
        apparent_temperature: -1,
        precipitation: 0,
        rain: 0,
        showers: 0,
        snowfall: 0,
        weather_code: 1,
        cloud_cover: 20,
        wind_speed_10m: 10,
        wind_direction_10m: 180,
        wind_gusts_10m: 18
      },
      current_units: {},
      daily: {
        time: ['2026-10-22'],
        temperature_2m_max: [4],
        temperature_2m_min: [-2],
        precipitation_probability_max: [10],
        snowfall_sum: [0],
        wind_speed_10m_max: [20]
      },
      daily_units: {},
      hourly: {
        time: ['2026-10-22T14:00'],
        temperature_2m: [2],
        precipitation_probability: [10],
        precipitation: [0],
        snowfall: [0],
        wind_speed_10m: [10],
        wind_gusts_10m: [18]
      },
      hourly_units: {}
    };
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.open-meteo.com/')) {
        const parameters = new URL(String(url)).searchParams;
        if (expectFarellones) {
          assert.equal(parameters.get('latitude'), '-33.352');
          assert.equal(parameters.get('longitude'), '-70.325');
          assert.equal(parameters.get('elevation'), '2340');
          assert.equal(parameters.get('current'), 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m');
          assert.equal(parameters.get('wind_speed_unit'), 'kmh');
        } else {
          assert.equal(parameters.get('latitude'), '-34.2');
          assert.equal(parameters.get('longitude'), '-71.5');
        }
        return { ok: true, json: async () => weather };
      }
      if (String(url).startsWith('https://api.groq.com/')) {
        const request = JSON.parse(options.body);
        assert.equal(request.model, 'llama-3.1-8b-instant');
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Revisa el clima y el equipo.' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return fetchOriginal(url, options);
    };
    const freeWeather = await fetch(`${baseUrl}/clima/api/tiempo`, { headers: headersFor(operator.lastID) });
    assert.equal(freeWeather.status, 200);
    assert.equal((await freeWeather.json()).weather.current.temperature_2m, 2);
    assert.equal((await get('SELECT COUNT(*) AS total FROM ia_cuota_diaria')).total, 0);
    const conditions = JSON.stringify({
      refugio: { id: refuge.lastID, latitud: -34.2, longitud: -71.5, altura: 1850 },
      weather
    });
    const conditionsHash = crypto.createHash('sha256').update(conditions).digest('hex');
    await run(
      `INSERT INTO bitacora_ia (refugio_id, condiciones_hash, condiciones_json, recomendacion, modelo)
       VALUES (?, ?, ?, ?, ?)`,
      [refuge.lastID, conditionsHash, conditions, 'Recomendación en caché', 'test-model']
    );
    await run('UPDATE bitacora_ia SET creado_en = ? WHERE refugio_id = ?', [`${mountainDate()} 12:00:00`, refuge.lastID]);
    const cached = await fetch(`${baseUrl}/clima/api/recomendacion`, {
      method: 'POST',
      headers: headersFor(operator.lastID)
    });
    assert.equal(cached.status, 200);
    const cachedResult = await cached.json();
    assert.equal(cachedResult.status, 'cache');
    assert.equal(cachedResult.recomendacion, 'Recomendación en caché');
    assert.equal((await get('SELECT COUNT(*) AS total FROM ia_cuota_diaria')).total, 0);

    weather = { ...weather, current: { ...weather.current, temperature_2m: -4 } };
    const temperatureDrop = await fetch(`${baseUrl}/clima/api/recomendacion`, {
      method: 'POST',
      headers: headersFor(operator.lastID)
    });
    assert.equal((await temperatureDrop.json()).status, 'fresh');
    weather = { ...weather, current: { ...weather.current, wind_speed_10m: 51 } };
    const strongWind = await fetch(`${baseUrl}/clima/api/recomendacion`, {
      method: 'POST',
      headers: headersFor(operator.lastID)
    });
    assert.equal((await strongWind.json()).status, 'fresh');
    const stableWeather = await fetch(`${baseUrl}/clima/api/recomendacion`, {
      method: 'POST',
      headers: headersFor(operator.lastID)
    });
    assert.equal((await stableWeather.json()).status, 'cache');
    assert.equal((await get('SELECT peticiones FROM ia_cuota_diaria WHERE fecha = ?', [mountainDate()])).peticiones, 2);

    await run(
      `INSERT INTO ia_cuota_diaria (fecha, peticiones) VALUES (?, 40)
       ON CONFLICT(fecha) DO UPDATE SET peticiones = excluded.peticiones`,
      [mountainDate()]
    );
    await run(
      `INSERT INTO bitacora_ia (refugio_id, condiciones_hash, condiciones_json, recomendacion, modelo)
       VALUES (?, 'previous-weather', '{}', 'Última recomendación guardada', 'test-model')`,
      [refuge.lastID]
    );
    weather = {
      ...weather,
      current: { ...weather.current, temperature_2m: 3 }
    };
    await run(`UPDATE bitacora_ia SET creado_en = '2000-01-01 00:00:00' WHERE refugio_id = ?`, [refuge.lastID]);
    await run(`UPDATE bitacora_ia SET creado_en = '2000-01-01 01:00:00' WHERE condiciones_hash = 'previous-weather'`);
    const limited = await fetch(`${baseUrl}/clima/api/recomendacion`, {
      method: 'POST',
      headers: headersFor(operator.lastID)
    });
    assert.equal(limited.status, 200);
    const limitedResult = await limited.json();
    assert.equal(limitedResult.status, 'quota');
    assert.equal(limitedResult.recomendacion, 'Última recomendación guardada');
    assert.equal(limitedResult.aviso, 'Modo de ahorro de cuota activo: mostrando última recomendación del turno.');
    assert.equal((await get('SELECT peticiones FROM ia_cuota_diaria WHERE fecha = ?', [mountainDate()])).peticiones, 40);
    const farellones = await run(
      `INSERT INTO refugios (nombre, zona, estado, lat, lng, latitud, longitud, altura)
       VALUES ('Centro de Montaña Farellones', 'Farellones', 'Operativo', -33.3, -70.3, -33.3, -70.3, 1800)`
    );
    await run(
      `INSERT INTO configuracion (key, value) VALUES ('refugio_climatico_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(farellones.lastID)]
    );
    await run(
      `INSERT INTO configuracion (key, value) VALUES
       ('montana_nombre', 'Centro de Montaña Farellones'),
       ('montana_latitud', '-33.352'),
       ('montana_longitud', '-70.325'),
       ('montana_altura', '2340')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    expectFarellones = true;
    weather = { ...weather, current: { ...weather.current, temperature_2m: 2.25 } };
    const farellonesWeather = await fetch(`${baseUrl}/clima/api/tiempo`, { headers: headersFor(operator.lastID) });
    assert.equal(farellonesWeather.status, 200);
    assert.equal((await farellonesWeather.json()).weather.current.temperature_2m, 2.25);
    const farellonesPage = await fetch(`${baseUrl}/clima`, { headers: headersFor(operator.lastID) });
    assert.match(await farellonesPage.text(), /-33\.352.*-70\.325.*2340/);
    assert.equal(climaController.validarCoordenadas({ latitud: -90, longitud: 180 }), true);
    assert.equal(climaController.validarCoordenadas({ latitud: 91, longitud: 0 }), false);
  } finally {
    global.fetch = fetchOriginal;
    await new Promise(resolve => server.close(resolve));
  }
});

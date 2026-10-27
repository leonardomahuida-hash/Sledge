let fotoPerfilPendiente = null;
let currentWeatherCache = null;
let currentWeatherCacheAt = 0;
let currentWeatherRequest = null;

function mountainLocationName(refugio) {
  const area = String(refugio.zona || '').trim();
  if (!area) return refugio.nombre;
  return /^centro de montaña/i.test(area) ? area : `Centro de Montaña ${area}`;
}

function weatherPresentation(code) {
  const value = Number(code);
  if (value === 0) return { label: 'Despejado', icon: 'sunny' };
  if ([1, 2].includes(value)) return { label: 'Parcialmente nublado', icon: 'partly_cloudy_day' };
  if (value === 3 || [45, 48].includes(value)) return { label: 'Nublado', icon: 'cloud' };
  if (value >= 71 && value <= 86 || value === 77) return { label: 'Nieve', icon: 'weather_snowy' };
  if (value >= 51 && value <= 67 || value >= 80 && value <= 82) return { label: 'Lluvia', icon: 'rainy' };
  if (value >= 95) return { label: 'Tormenta', icon: 'thunderstorm' };
  return { label: 'Condiciones variables', icon: 'cloud' };
}

function getCurrentWeather() {
  if (currentWeatherCache && Date.now() - currentWeatherCacheAt < 5 * 60 * 1000) {
    return Promise.resolve(currentWeatherCache);
  }
  if (currentWeatherRequest) return currentWeatherRequest;
  try {
    const cached = JSON.parse(localStorage.getItem('sledgeCurrentWeather') || 'null');
    if (cached && Date.now() - cached.savedAt < 5 * 60 * 1000 && cached.result && cached.result.success) {
      currentWeatherCache = cached.result;
      currentWeatherCacheAt = cached.savedAt;
      return Promise.resolve(currentWeatherCache);
    }
  } catch (error) {
    console.warn('[CLIMA] No se pudo leer la caché gratuita del widget:', error.message);
  }
  currentWeatherRequest = fetch('/clima/api/tiempo')
    .then(async response => {
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar el clima.');
      currentWeatherCache = result;
      currentWeatherCacheAt = Date.now();
      try {
        localStorage.setItem('sledgeCurrentWeather', JSON.stringify({
          savedAt: currentWeatherCacheAt,
          result
        }));
      } catch (error) {
        console.warn('[CLIMA] No se pudo guardar la caché gratuita del widget:', error.message);
      }
      return result;
    })
    .finally(() => { currentWeatherRequest = null; });
  return currentWeatherRequest;
}

function initializeWeatherWidget() {
  const widget = document.getElementById('globalWeatherWidget');
  if (!widget) return;
  const header = document.querySelector('.top-app-bar');
  if (header) header.append(widget);
  const update = async () => {
    const details = widget.querySelector('.weather-widget-details');
    try {
      const result = await getCurrentWeather();
      const { current, current_units: units } = result.weather;
      widget.querySelector('.weather-widget-location').textContent = mountainLocationName(result.refugio);
      widget.querySelector('.weather-widget-temperature').textContent = `${current.temperature_2m}${units.temperature_2m || '°C'}`;
      details.textContent = `Viento ${current.wind_speed_10m} ${units.wind_speed_10m} · Humedad ${current.relative_humidity_2m}${units.relative_humidity_2m || '%'}`;
      widget.title = `Sensación térmica: ${current.apparent_temperature} ${units.apparent_temperature || '°C'} · Actualizado ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      details.textContent = 'Clima no disponible';
      console.warn('[CLIMA] No se pudo actualizar el widget gratuito:', error.message);
    }
  };
  update();
  window.setInterval(update, 30 * 60 * 1000);
}

function initializeClimatePage() {
  const weatherSummary = document.getElementById('weatherSummary');
  const climateStatus = document.getElementById('climateStatus');
  if (!weatherSummary || !climateStatus) return;
  const hourlyForecast = document.getElementById('hourlyForecast');
  const dailyForecast = document.getElementById('dailyForecast');
  const formatDay = date => new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00`));
  const createForecastIcon = code => {
    const presentation = weatherPresentation(code);
    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = presentation.icon;
    return { icon, label: presentation.label };
  };
  const renderWeather = weather => {
    const current = weather.current;
    const units = weather.current_units;
    const daily = weather.daily;
    const hourly = weather.hourly || {};
    const currentPresentation = weatherPresentation(current.weather_code);
    document.getElementById('climateIcon').textContent = currentPresentation.icon;
    document.getElementById('climateCondition').textContent = currentPresentation.label;
    document.getElementById('climateTemperature').textContent = `${current.temperature_2m}${units.temperature_2m || '°C'}`;
    document.getElementById('climateFeelsLike').textContent =
      `Sensación térmica ${Math.round(current.apparent_temperature)}${units.apparent_temperature || '°C'}`;
    document.getElementById('climateWind').textContent =
      `Viento ${current.wind_speed_10m} ${units.wind_speed_10m || 'km/h'}`;
    document.getElementById('climateHumidity').textContent =
      `Humedad ${current.relative_humidity_2m}${units.relative_humidity_2m || '%'}`;
    document.getElementById('climateElevation').textContent =
      `${document.getElementById('climateAltitude').textContent} m de altitud`;
    weatherSummary.hidden = false;
    if (hourlyForecast) {
      const times = hourly.time || [];
      let startIndex = times.findIndex(time => time >= current.time);
      if (startIndex < 0) startIndex = 0;
      const cards = times.slice(startIndex, startIndex + 12).map((time, offset) => {
        const index = startIndex + offset;
        const card = document.createElement('article');
        card.className = 'hourly-forecast-card';
        const hour = document.createElement('strong');
        hour.textContent = time.slice(11, 16);
        const presentation = createForecastIcon((hourly.weather_code || [])[index]);
        card.append(hour, presentation.icon);
        const condition = document.createElement('span');
        condition.className = 'forecast-condition';
        condition.textContent = presentation.label;
        const temperature = document.createElement('span');
        temperature.className = 'forecast-temperature';
        temperature.textContent = `${Math.round(hourly.temperature_2m[index])}°`;
        const precipitation = document.createElement('small');
        precipitation.textContent = `${(hourly.precipitation_probability || [])[index] || 0}% precip.`;
        card.append(condition, temperature, precipitation);
        return card;
      });
      hourlyForecast.replaceChildren(...cards);
    }
    if (dailyForecast) {
      const cards = (daily.time || []).map((date, index) => {
        const card = document.createElement('article');
        card.className = 'daily-forecast-card';
        const day = document.createElement('strong');
        day.textContent = index === 0 ? 'Hoy' : index === 1 ? 'Mañana' : formatDay(date);
        const presentation = createForecastIcon((daily.weather_code || [])[index]);
        const condition = document.createElement('span');
        condition.className = 'forecast-condition';
        condition.textContent = presentation.label;
        const temperatures = document.createElement('span');
        temperatures.className = 'daily-temperatures';
        const maximum = document.createElement('strong');
        maximum.textContent = `${Math.round(daily.temperature_2m_max[index])}°`;
        const minimum = document.createElement('span');
        minimum.textContent = `${Math.round(daily.temperature_2m_min[index])}°`;
        temperatures.append(maximum, minimum);
        const precipitation = document.createElement('small');
        precipitation.textContent = `${daily.precipitation_probability_max[index] || 0}% precipitación`;
        card.append(day, presentation.icon, condition, temperatures, precipitation);
        return card;
      });
      dailyForecast.replaceChildren(...cards);
    }
  };
  const updateWeather = async () => {
    try {
      const result = await getCurrentWeather();
      renderWeather(result.weather);
      climateStatus.textContent = `Clima actualizado para ${mountainLocationName(result.refugio)}.`;
    } catch (error) {
      climateStatus.textContent = error.message;
    }
  };
  updateWeather();
}

function initializeMountainRecommendation() {
  const openButton = document.getElementById('openMountainRecommendation');
  const dialog = document.getElementById('mountainRecommendationDialog');
  const button = document.getElementById('generateRecommendation');
  if (!openButton || !dialog || !button) return;
  const status = document.getElementById('recommendationStatus');
  const recommendationText = document.getElementById('recommendationText');
  const quotaNotice = document.getElementById('quotaNotice');
  const checkboxes = [...dialog.querySelectorAll('.pack-checklist input[type="checkbox"]')];
  const updateChecklist = () => {
    checkboxes.forEach(input => {
      const row = input.closest('label');
      row.classList.toggle('item-ok', input.checked);
      row.classList.toggle('item-pending', !input.checked);
    });
    document.getElementById('packWarning').hidden =
      !checkboxes.some(input => input.dataset.critical === 'true' && !input.checked);
  };
  checkboxes.forEach(input => input.addEventListener('change', updateChecklist));
  updateChecklist();
  dialog.querySelector('[data-close-ai-dialog]').addEventListener('click', () => dialog.close());
  const renderRecommendation = result => {
    recommendationText.textContent = result.recomendacion || 'Todavía no hay una recomendación guardada.';
    status.textContent = result.status === 'fresh'
      ? 'Sugerencia actualizada con IA.'
      : result.status === 'quota'
        ? 'Límite diario alcanzado; se muestra la última recomendación guardada.'
        : result.status === 'cache'
          ? 'Recomendación de hoy reutilizada.'
          : result.creado_en
            ? `Última sugerencia guardada · ${result.creado_en}`
            : 'Genera una sugerencia cuando la necesites.';
    quotaNotice.hidden = result.status !== 'quota';
    if (result.status === 'quota') {
      quotaNotice.textContent = result.aviso || 'Modo de ahorro de cuota activo: mostrando última recomendación del turno.';
    }
  };
  const generateRecommendation = async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'Consultando las condiciones y preparando la sugerencia…';
    quotaNotice.hidden = true;
    try {
      const response = await fetch('/clima/api/recomendacion', { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo generar la sugerencia.');
      renderRecommendation(result);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', generateRecommendation);
  openButton.addEventListener('click', () => {
    dialog.showModal();
    generateRecommendation();
  });
}

function abrirAsociacionPase() {
  const dialog = document.getElementById('mountainPassDialog');
  if (!dialog) return;
  document.getElementById('mountainPassStatus').textContent = '';
  if (!dialog.open) dialog.showModal();
}

function cerrarAsociacionPase() {
  const dialog = document.getElementById('mountainPassDialog');
  if (dialog && dialog.open) dialog.close();
}

function initializeMountainPassForm() {
  const form = document.getElementById('mountainPassForm');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('mountainPassStatus');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Asociando pase...';
    try {
      const response = await fetch('/api/perfil/pase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo asociar el pase.');
      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function abrirEditorPerfil() {
  const dialog = document.getElementById('userProfileDialog');
  if (!dialog) return;
  document.getElementById('profileEditorStatus').textContent = '';
  dialog.showModal();
}

function cerrarEditorPerfil() {
  const dialog = document.getElementById('userProfileDialog');
  if (dialog && dialog.open) dialog.close();
}

function abrirEditorContrasena() {
  const dialog = document.getElementById('personalSettingsDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function cerrarEditorContrasena() {
  const form = document.getElementById('passwordChangeForm');
  if (form) form.reset();
}

function abrirConfiguracionPersonal() {
  const dialog = document.getElementById('personalSettingsDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function cerrarConfiguracionPersonal() {
  const dialog = document.getElementById('personalSettingsDialog');
  if (dialog && dialog.open) dialog.close();
}

function procesarFotoPerfil(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Selecciona un archivo de imagen.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('El archivo seleccionado no es una imagen válida.'));
      image.onload = () => {
        const maxDim = 600;
        const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return reject(new Error('No se pudo procesar la imagen.'));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function initializeProfileEditor() {
  const form = document.getElementById('userProfileForm');
  if (!form) return;
  const nameInput = document.getElementById('profileNameInput');
  let currentName = nameInput.value;
  const confirmField = document.getElementById('nameConfirmationField');
  const currentPassword = document.getElementById('profileCurrentPassword');
  const status = document.getElementById('profileEditorStatus');
  const photoInput = document.getElementById('profilePhotoInput');

  nameInput.addEventListener('input', () => {
    const nameChanged = nameInput.value.trim() !== currentName;
    confirmField.hidden = !nameChanged;
    currentPassword.required = nameChanged;
    if (!nameChanged) currentPassword.value = '';
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    status.textContent = 'Procesando imagen...';
    try {
      fotoPerfilPendiente = await procesarFotoPerfil(file);
      document.getElementById('profileEditorAvatar').src = fotoPerfilPendiente;
      status.textContent = '';
    } catch (error) {
      fotoPerfilPendiente = null;
      status.textContent = error.message;
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Guardando perfil...';
    const body = {
      nombre: nameInput.value.trim(),
      apodo: document.getElementById('profileNicknameInput').value.trim(),
      current_password: currentPassword.value
    };
    if (fotoPerfilPendiente) body.foto_perfil = fotoPerfilPendiente;
    try {
      const response = await fetch('/api/perfil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo guardar el perfil.');
      document.getElementById('profileDisplayName').textContent = result.nombre;
      document.getElementById('displayApodo').textContent = result.apodo || 'Sin apodo';
      document.getElementById('userAvatarImg').src = result.foto_perfil;
      nameInput.defaultValue = result.nombre;
      document.getElementById('profileNicknameInput').defaultValue = result.apodo;
      currentName = result.nombre;
      currentPassword.value = '';
      currentPassword.required = false;
      confirmField.hidden = true;
      photoInput.value = '';
      fotoPerfilPendiente = null;
      status.textContent = 'Perfil actualizado.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  document.getElementById('userProfileDialog').addEventListener('close', () => {
    form.reset();
    document.getElementById('profileEditorAvatar').src = document.getElementById('userAvatarImg').src;
    currentPassword.required = false;
    confirmField.hidden = true;
    photoInput.value = '';
    fotoPerfilPendiente = null;
  });

}

function initializePasswordChangeForm() {
  const passwordForm = document.getElementById('passwordChangeForm');
  if (!passwordForm) return;
  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const passwordStatus = document.getElementById('passwordChangeStatus');
    const submit = passwordForm.querySelector('[type="submit"]');
    submit.disabled = true;
    passwordStatus.textContent = 'Actualizando contraseña...';
    try {
      const response = await fetch('/api/perfil/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(passwordForm).entries()))
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar la contraseña.');
      passwordForm.reset();
      passwordStatus.textContent = 'Contraseña actualizada correctamente.';
    } catch (error) {
      passwordStatus.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

// 3. EDITOR BOTTOM SHEET MÉDICO ("Selecciona")
let campoActualMedico = "";
const opcionesCatalogo = {
  grupo_sangre: ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'],
  enfermedades_cronicas: ['Enfermedades cardiovasculares', 'Hipertensión arterial', 'Diabetes Tipo 1', 'Diabetes Tipo 2', 'Asma bronquial', 'Epilepsia', 'Ninguna'],
  medicamentos_diarios: ['Aspirina 100mg', 'Insulina', 'Inhalador Salbutamol', 'Enalapril', 'Ninguno'],
  alergias: ['Alergia a la Penicilina', 'Alergia a AINEs / Ibuprofeno', 'Alergia al Látex', 'Alergia a Frutos Secos', 'Ninguna']
};

function abrirEditorMedico(campo, titulo) {
  campoActualMedico = campo;
  const container = document.getElementById('sheetOptionsContainer');
  const valorActual = document.getElementById(`desc-${campo}`).innerText.trim();
  const valoresActuales = valorActual === 'N/A' || valorActual === 'Ninguna' || valorActual === 'Ninguno'
    ? []
    : valorActual.split(',').map(valor => valor.trim());
  const esGrupoSangre = campo === 'grupo_sangre';
  const tipoControl = esGrupoSangre ? 'radio' : 'checkbox';
  const opciones = opcionesCatalogo[campo] || [];

  document.getElementById('medicalDialogTitle').textContent = titulo;
  document.getElementById('medicalDialogHint').textContent = esGrupoSangre
    ? 'Selecciona tu tipo de sangre.'
    : 'Puedes seleccionar varias opciones.';
  document.getElementById('inputSearchSheet').value = '';
  container.innerHTML = opciones.map((opcion, indice) => {
    const marcada = valoresActuales.includes(opcion);
    return `
      <label class="medical-option" for="opcionMedica${indice}">
        <span>${opcion}</span>
        <input id="opcionMedica${indice}" type="${tipoControl}" name="opcionMedica" value="${opcion}" onchange="actualizarOpcionSinDato(this)" ${marcada ? 'checked' : ''}>
      </label>
    `;
  }).join('');

  const modal = document.getElementById('bottomSheet');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.getElementById('inputSearchSheet').focus();
}

function actualizarOpcionSinDato(input) {
  if (campoActualMedico === 'grupo_sangre' || !input.checked) return;

  const opcionSinDato = campoActualMedico === 'medicamentos_diarios' ? 'Ninguno' : 'Ninguna';
  document.querySelectorAll('input[name="opcionMedica"]').forEach(opcion => {
    if (input.value === opcionSinDato) {
      if (opcion !== input) opcion.checked = false;
    } else if (opcion.value === opcionSinDato) {
      opcion.checked = false;
    }
  });
}

function cerrarBottomSheet(event) {
  if (event && event.target.id !== 'bottomSheet') return;
  document.getElementById('bottomSheet').style.display = 'none';
  document.getElementById('bottomSheet').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function filtrarOpcionesSheet(query) {
  const items = document.querySelectorAll('.medical-option');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query.toLowerCase()) ? 'flex' : 'none';
  });
}

function confirmarSeleccionSheet() {
  const checkboxes = document.querySelectorAll('input[name="opcionMedica"]:checked');
  const seleccionados = Array.from(checkboxes).map(c => c.value);
  const opcionSinDato = campoActualMedico === 'medicamentos_diarios' ? 'Ninguno' : 'Ninguna';
  const valorFinal = seleccionados.length > 0 ? seleccionados.join(', ') : 'N/A';
  const valorGuardado = seleccionados.includes(opcionSinDato) ? opcionSinDato : valorFinal;

  if (seleccionados.includes(opcionSinDato)) {
    document.querySelectorAll('input[name="opcionMedica"]').forEach(input => {
      if (input.value !== opcionSinDato) input.checked = false;
    });
  }

  fetch('/api/perfil/medica', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campo: campoActualMedico, valor: valorGuardado })
  })
  .then(res => {
    if (!res.ok) throw new Error('No se pudo guardar la información médica.');
    return res.json();
  })
  .then(data => {
    if (data.success) {
      document.getElementById(`desc-${campoActualMedico}`).innerText = data.valor;
      cerrarBottomSheet();
    }
  })
  .catch(error => alert(error.message));
}

let mapaRefugiosInstance = null;
let modoColocacionRefugio = false;
let marcadorRefugioPendiente = null;
let modoDibujoMapa = false;
let puntosDibujoMapa = [];
let capaDibujoMapa = null;

function crearMarcadorRefugio(mapa, refugio) {
  const marcador = L.circleMarker([Number(refugio.lat), Number(refugio.lng)], {
    radius: 9,
    color: '#FFFFFF',
    weight: 2,
    fillColor: refugio.estado === 'Operativo' ? '#287A55' : '#B65332',
    fillOpacity: 1,
    className: 'refugio-waypoint'
  });

  const contenido = document.createElement('div');
  contenido.className = 'refugio-popup';
  const nombre = document.createElement('strong');
  nombre.textContent = refugio.nombre;
  const zonaEstado = document.createElement('p');
  zonaEstado.textContent = `${refugio.zona} · ${refugio.estado}`;
  const capacidad = document.createElement('p');
  capacidad.textContent = `Inventario disponible: ${refugio.porcentajeInventario || 0}%`;
  const detalle = document.createElement('a');
  detalle.href = `/refugio/${encodeURIComponent(refugio.id)}`;
  detalle.textContent = 'Ver refugio';
  contenido.append(nombre, zonaEstado, capacidad);
  (refugio.categoriasInventario || []).forEach(item => {
    const categoria = document.createElement('p');
    categoria.textContent = `${item.categoria}: ${item.porcentaje}%`;
    contenido.append(categoria);
  });
  contenido.append(detalle);

  marcador.bindPopup(contenido);
  return marcador;
}

function activarModoColocacionRefugio() {
  if (!window.puedeCrearRefugios || !mapaRefugiosInstance) return;
  modoColocacionRefugio = true;
  mapaRefugiosInstance.getContainer().classList.add('is-placing-refugio');
  document.getElementById('map-placement-hint').hidden = false;
}

function cancelarColocacionRefugio() {
  modoColocacionRefugio = false;
  if (mapaRefugiosInstance) mapaRefugiosInstance.getContainer().classList.remove('is-placing-refugio');
  const aviso = document.getElementById('map-placement-hint');
  const modal = document.getElementById('modalCrearRefugio');
  const error = document.getElementById('errorCrearRefugio');
  if (aviso) aviso.hidden = true;
  if (modal) {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  }
  if (error) error.textContent = '';
  document.body.style.overflow = '';
  if (marcadorRefugioPendiente) {
    marcadorRefugioPendiente.remove();
    marcadorRefugioPendiente = null;
  }
}

function inicializarMapaRefugios() {
  const contenedor = document.getElementById('map');
  if (!contenedor) return;
  if (typeof L === 'undefined') {
    contenedor.textContent = 'No se pudo cargar el mapa. Comprueba tu conexión e inténtalo de nuevo.';
    return;
  }

  const refugios = Array.isArray(window.refugiosData) ? window.refugiosData : [];
  const ubicacionesValidas = refugios.filter(refugio => {
    const lat = Number(refugio.lat);
    const lng = Number(refugio.lng);
    return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  });
  const centroInicial = ubicacionesValidas.length
    ? [Number(ubicacionesValidas[0].lat), Number(ubicacionesValidas[0].lng)]
    : [-33.45, -70.66];

  mapaRefugiosInstance = L.map(contenedor, { zoomControl: true })
    .setView(centroInicial, ubicacionesValidas.length ? 11 : 5);
  let preferenciasMapa = {};
  try {
    preferenciasMapa = JSON.parse(localStorage.getItem('sledgeSettings') || '{}');
  } catch (error) {
    localStorage.removeItem('sledgeSettings');
  }
  L.control.scale({ metric: preferenciasMapa.units !== 'mi', imperial: preferenciasMapa.units === 'mi' }).addTo(mapaRefugiosInstance);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(mapaRefugiosInstance);

  const refugiosLayer = L.layerGroup();
  const marcadores = ubicacionesValidas.map(refugio => crearMarcadorRefugio(mapaRefugiosInstance, refugio).addTo(refugiosLayer));
  refugiosLayer.addTo(mapaRefugiosInstance);
  if (marcadores.length > 1) {
    mapaRefugiosInstance.fitBounds(L.featureGroup(marcadores).getBounds(), { padding: [32, 32], maxZoom: 13 });
  } else if (marcadores.length === 1) {
    mapaRefugiosInstance.setView(marcadores[0].getLatLng(), 12);
  }

  const zonas = Array.isArray(window.zonasMapaData) ? window.zonasMapaData : [];
  const pistas = Array.isArray(window.pistasMapaData) ? window.pistasMapaData : [];
  const zoneLayers = zonas.map(zone => {
    if (!Array.isArray(zone.coordenadas) || zone.coordenadas.length < 3) return null;
    const safe = zone.tipo === 'Zona segura';
    const polygon = L.polygon(zone.coordenadas, {
      color: safe ? '#16804A' : '#C62828',
      fillColor: safe ? '#22A05A' : '#E53935',
      fillOpacity: 0.28,
      weight: 2
    }).bindPopup(`${zone.nombre} · ${zone.tipo}`);
    polygon._sledgeType = zone.tipo;
    return polygon;
  }).filter(Boolean);
  const trailLayers = pistas.map(trail => {
    if (!Array.isArray(trail.coordenadas) || trail.coordenadas.length < 2) return null;
    const colors = { Abierta: '#16804A', Cerrada: '#C62828', Mantenimiento: '#DD6B20' };
    const line = L.polyline(trail.coordenadas, { color: colors[trail.estado], weight: 5, opacity: 0.8 })
      .bindPopup(`${trail.nombre} · ${trail.estado}`);
    line._sledgeStatus = trail.estado;
    return line;
  }).filter(Boolean);
  const zoneLayerGroup = L.layerGroup(zoneLayers).addTo(mapaRefugiosInstance);
  const trailLayerGroup = L.layerGroup(trailLayers).addTo(mapaRefugiosInstance);
  const activePatrolLayer = L.layerGroup();
  const zoneFilter = document.getElementById('mapZoneFilter');
  const trailFilter = document.getElementById('mapTrailFilter');
  const sortOrder = document.getElementById('mapSortOrder');
  const panel = document.getElementById('mapLayersPanel');
  const panelToggle = document.getElementById('mapPanelToggle');
  const shelterToggle = document.getElementById('showSheltersLayer');
  const patrolToggle = document.getElementById('showPatrolLayer');
  const mapPreferencesKey = 'sledgeMapPreferences';
  let mapPreferences = {};
  try {
    mapPreferences = JSON.parse(localStorage.getItem(mapPreferencesKey) || '{}');
  } catch (error) {
    localStorage.removeItem(mapPreferencesKey);
  }
  const saveMapPreferences = () => {
    try {
      localStorage.setItem(mapPreferencesKey, JSON.stringify({
        zone: zoneFilter ? zoneFilter.value : '',
        trail: trailFilter ? trailFilter.value : '',
        sort: sortOrder ? sortOrder.value : 'nombre',
        shelters: shelterToggle ? shelterToggle.checked : true,
        patrol: patrolToggle ? patrolToggle.checked : false,
        panelCollapsed: Boolean(panel && panel.hidden)
      }));
    } catch (error) {
      console.warn('[MAPA] No se pudieron guardar las preferencias del mapa:', error.message);
    }
  };
  if (zoneFilter && [...zoneFilter.options].some(option => option.value === mapPreferences.zone)) zoneFilter.value = mapPreferences.zone;
  if (trailFilter && [...trailFilter.options].some(option => option.value === mapPreferences.trail)) trailFilter.value = mapPreferences.trail;
  if (sortOrder && ['nombre', 'estado'].includes(mapPreferences.sort)) sortOrder.value = mapPreferences.sort;
  if (shelterToggle && typeof mapPreferences.shelters === 'boolean') shelterToggle.checked = mapPreferences.shelters;
  if (patrolToggle && typeof mapPreferences.patrol === 'boolean') patrolToggle.checked = mapPreferences.patrol;
  if (panel && panelToggle) {
    panel.hidden = Boolean(mapPreferences.panelCollapsed);
    panelToggle.setAttribute('aria-expanded', String(!panel.hidden));
    panelToggle.querySelector('.material-symbols-rounded').textContent = panel.hidden ? 'visibility' : 'visibility_off';
    panelToggle.querySelector('.map-panel-toggle-label').textContent = panel.hidden ? 'Mostrar filtros' : 'Ocultar filtros';
    panelToggle.title = panel.hidden ? 'Mostrar filtros del mapa' : 'Ocultar filtros del mapa';
    panelToggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      panelToggle.setAttribute('aria-expanded', String(!panel.hidden));
      panelToggle.querySelector('.material-symbols-rounded').textContent = panel.hidden ? 'visibility' : 'visibility_off';
      panelToggle.querySelector('.map-panel-toggle-label').textContent = panel.hidden ? 'Mostrar filtros' : 'Ocultar filtros';
      panelToggle.title = panel.hidden ? 'Mostrar filtros del mapa' : 'Ocultar filtros del mapa';
      saveMapPreferences();
      window.setTimeout(() => mapaRefugiosInstance.invalidateSize(), 180);
    });
  }
  const trailsList = document.getElementById('mapTrailsList');
  const zonesList = document.getElementById('mapZonesList');
  const mapAdminStatus = document.getElementById('mapAdminStatus');
  const submitMapAdminAction = async (url, method, body, confirmation) => {
    if (confirmation && !window.confirm(confirmation)) return;
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar el elemento del mapa.');
      window.location.reload();
    } catch (error) {
      if (mapAdminStatus) mapAdminStatus.textContent = error.message;
    }
  };
  const applyMapFilters = () => {
    const zoneType = zoneFilter ? zoneFilter.value : '';
    const trailStatus = trailFilter ? trailFilter.value : '';
    zoneLayerGroup.clearLayers();
    zoneLayers.filter(layer => !zoneType || layer._sledgeType === zoneType).forEach(layer => zoneLayerGroup.addLayer(layer));
    if (zonesList) {
      zonesList.replaceChildren();
      const visibleZones = zonas.filter(zone => !zoneType || zone.tipo === zoneType);
      visibleZones.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      if (!visibleZones.length) {
        const empty = document.createElement('li');
        empty.textContent = 'No hay zonas delimitadas.';
        zonesList.append(empty);
      }
      visibleZones.forEach(zone => {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = zone.nombre;
        const type = document.createElement('select');
        type.setAttribute('aria-label', `Cambiar tipo de ${zone.nombre}`);
        ['Riesgo de avalancha', 'Grietas', 'Zona segura'].forEach(value => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          option.selected = value === zone.tipo;
          type.append(option);
        });
        type.addEventListener('change', () => submitMapAdminAction(
          `/mapa/api/zonas/${encodeURIComponent(zone.id)}`, 'PUT', { tipo: type.value }
        ));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Eliminar';
        remove.addEventListener('click', () => submitMapAdminAction(
          `/mapa/api/zonas/${encodeURIComponent(zone.id)}`, 'DELETE', null,
          `¿Retirar la zona ${zone.nombre} del mapa?`
        ));
        item.append(name, type, remove);
        zonesList.append(item);
      });
    }
    trailLayerGroup.clearLayers();
    trailLayers.filter(layer => !trailStatus || layer._sledgeStatus === trailStatus).forEach(layer => trailLayerGroup.addLayer(layer));
    if (!trailsList) return;
    trailsList.replaceChildren();
    const visibleTrails = pistas.filter(trail => !trailStatus || trail.estado === trailStatus);
    visibleTrails.sort((a, b) => sortOrder && sortOrder.value === 'estado'
      ? a.estado.localeCompare(b.estado, 'es') || a.nombre.localeCompare(b.nombre, 'es')
      : a.nombre.localeCompare(b.nombre, 'es'));
    if (!visibleTrails.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No hay pistas que coincidan con el filtro.';
      trailsList.append(empty);
    }
    visibleTrails.forEach(trail => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${trail.nombre}: ${trail.estado}`;
      item.append(label);
      if (window.puedeCrearRefugios) {
        const state = document.createElement('select');
        state.setAttribute('aria-label', `Cambiar estado de ${trail.nombre}`);
        ['Abierta', 'Cerrada', 'Mantenimiento'].forEach(value => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          option.selected = value === trail.estado;
          state.append(option);
        });
        state.addEventListener('change', async () => {
          try {
            const response = await fetch(`/mapa/api/pistas/${encodeURIComponent(trail.id)}/estado`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ estado: state.value })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar la pista.');
            window.location.reload();
          } catch (error) {
            window.alert(error.message);
            state.value = trail.estado;
          }
        });
        item.append(state);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Eliminar pista';
        remove.addEventListener('click', () => submitMapAdminAction(
          `/mapa/api/pistas/${encodeURIComponent(trail.id)}`, 'DELETE', null,
          `¿Eliminar la pista ${trail.nombre}?`
        ));
        item.append(remove);
      }
      trailsList.append(item);
    });
  };
  [zoneFilter, trailFilter, sortOrder].filter(Boolean).forEach(input => input.addEventListener('change', () => {
    applyMapFilters();
    saveMapPreferences();
  }));
  applyMapFilters();

  if (shelterToggle && !shelterToggle.checked) mapaRefugiosInstance.removeLayer(refugiosLayer);
  if (shelterToggle) shelterToggle.addEventListener('change', () => {
    if (shelterToggle.checked) refugiosLayer.addTo(mapaRefugiosInstance);
    else mapaRefugiosInstance.removeLayer(refugiosLayer);
    saveMapPreferences();
  });
  let patrolRefreshTimer = null;
  const refreshPatrolLocations = async () => {
    try {
      const response = await fetch('/mapa/api/patrulleros-activos');
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudieron cargar los patrulleros activos.');
      activePatrolLayer.clearLayers();
      result.patrulleros.forEach(patrol => {
        const marker = L.circleMarker([patrol.lat, patrol.lng], {
          radius: 8, color: '#FFFFFF', weight: 2, fillColor: '#3182CE', fillOpacity: 1
        });
        const label = patrol.apodo || patrol.nombre;
        marker.bindPopup(`${label} · Ubicación compartida`);
        activePatrolLayer.addLayer(marker);
      });
      if (patrolToggle.checked) activePatrolLayer.addTo(mapaRefugiosInstance);
    } catch (error) {
      console.error('[MAPA] Error consultando patrulleros activos:', error.message);
    }
  };
  if (patrolToggle) {
    if (patrolToggle.checked) {
      refreshPatrolLocations();
      patrolRefreshTimer = window.setInterval(refreshPatrolLocations, 60 * 1000);
    }
    patrolToggle.addEventListener('change', () => {
      if (patrolToggle.checked) {
        refreshPatrolLocations();
        patrolRefreshTimer = window.setInterval(refreshPatrolLocations, 60 * 1000);
      } else {
        if (patrolRefreshTimer) window.clearInterval(patrolRefreshTimer);
        mapaRefugiosInstance.removeLayer(activePatrolLayer);
      }
      saveMapPreferences();
    });
  }
  const shareToggle = document.getElementById('sharePatrolLocation');
  if (shareToggle && navigator.geolocation) {
    let watchId = null;
    let lastSentAt = 0;
    const status = document.getElementById('patrolLocationStatus');
    shareToggle.addEventListener('change', () => {
      if (!shareToggle.checked) {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        fetch('/mapa/api/mi-ubicacion', { method: 'DELETE' })
          .then(response => response.json().then(result => {
            if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo retirar la ubicación.');
          }))
          .then(() => {
            status.textContent = 'Ubicación compartida desactivada.';
            if (patrolToggle && patrolToggle.checked) refreshPatrolLocations();
          })
          .catch(error => { status.textContent = error.message; });
        return;
      }
      status.textContent = 'Solicitando ubicación GPS...';
      watchId = navigator.geolocation.watchPosition(async position => {
        const now = Date.now();
        if (now - lastSentAt < 30000) return;
        lastSentAt = now;
        try {
          const response = await fetch('/mapa/api/mi-ubicacion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude })
          });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo compartir la ubicación.');
          status.textContent = 'Ubicación compartida con el equipo durante 10 minutos desde la última actualización.';
          if (patrolToggle && patrolToggle.checked) refreshPatrolLocations();
        } catch (error) {
          status.textContent = error.message;
        }
      }, error => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        shareToggle.checked = false;
        status.textContent = `No se pudo obtener la ubicación: ${error.message}`;
      }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
    });
  } else if (shareToggle) {
    shareToggle.disabled = true;
    document.getElementById('patrolLocationStatus').textContent = 'Este navegador no permite geolocalización.';
  }

  const drawType = document.getElementById('mapDrawType');
  const drawName = document.getElementById('mapDrawName');
  const drawTrailField = document.getElementById('mapDrawTrailStateField');
  const drawState = document.getElementById('mapDrawTrailState');
  const drawStart = document.getElementById('startMapDrawing');
  const drawSave = document.getElementById('saveMapDrawing');
  const drawCancel = document.getElementById('cancelMapDrawing');
  const drawStatus = document.getElementById('mapDrawingStatus');
  if (drawType) {
    const updateDrawingType = () => {
      drawTrailField.hidden = drawType.value !== 'Pista';
    };
    drawType.addEventListener('change', updateDrawingType);
    updateDrawingType();
    drawStart.addEventListener('click', () => {
      if (!drawName.value.trim()) {
        drawStatus.textContent = 'Escribe un nombre antes de dibujar.';
        drawName.focus();
        return;
      }
      modoDibujoMapa = true;
      puntosDibujoMapa = [];
      if (capaDibujoMapa) capaDibujoMapa.remove();
      capaDibujoMapa = L.layerGroup().addTo(mapaRefugiosInstance);
      drawStart.disabled = true;
      drawSave.disabled = true;
      drawCancel.disabled = false;
      mapaRefugiosInstance.getContainer().classList.add('is-drawing-map-feature');
      drawStatus.textContent = 'Haz clic en el mapa para añadir puntos. Marca al menos 3 para una zona o 2 para una pista.';
    });
    const cancelDrawing = () => {
      modoDibujoMapa = false;
      puntosDibujoMapa = [];
      if (capaDibujoMapa) capaDibujoMapa.remove();
      capaDibujoMapa = null;
      drawStart.disabled = false;
      drawSave.disabled = true;
      drawCancel.disabled = true;
      mapaRefugiosInstance.getContainer().classList.remove('is-drawing-map-feature');
      drawStatus.textContent = 'Dibujo cancelado. Selecciona un tipo y marca puntos sobre el mapa.';
    };
    drawCancel.addEventListener('click', cancelDrawing);
    drawSave.addEventListener('click', async () => {
      const isTrail = drawType.value === 'Pista';
      const minimum = isTrail ? 2 : 3;
      if (puntosDibujoMapa.length < minimum) {
        drawStatus.textContent = `Añade al menos ${minimum} puntos para guardar.`;
        return;
      }
      drawSave.disabled = true;
      drawStatus.textContent = 'Guardando geometría...';
      try {
        const response = await fetch(`/mapa/api/${isTrail ? 'pistas' : 'zonas'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isTrail
            ? { nombre: drawName.value.trim(), estado: drawState.value, coordenadas: puntosDibujoMapa }
            : { nombre: drawName.value.trim(), tipo: drawType.value, coordenadas: puntosDibujoMapa })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo guardar el trazado.');
        window.location.reload();
      } catch (error) {
        drawStatus.textContent = error.message;
        drawSave.disabled = false;
      }
    });
  }

  mapaRefugiosInstance.on('click', event => {
    if (modoDibujoMapa) {
      puntosDibujoMapa.push([Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))]);
      const isTrail = drawType.value === 'Pista';
      if (capaDibujoMapa) capaDibujoMapa.clearLayers();
      puntosDibujoMapa.forEach(point => L.circleMarker(point, {
        radius: 5, color: '#FFFFFF', weight: 2,
        fillColor: isTrail ? '#3182CE' : '#E65100',
        fillOpacity: 1
      }).addTo(capaDibujoMapa));
      if (puntosDibujoMapa.length > 1) {
        L.polyline(puntosDibujoMapa, {
          color: isTrail ? '#3182CE' : drawType.value === 'Zona segura' ? '#16804A' : '#C62828',
          weight: 4,
          dashArray: isTrail ? '' : '8 5'
        }).addTo(capaDibujoMapa);
      }
      const minimum = isTrail ? 2 : 3;
      drawSave.disabled = puntosDibujoMapa.length < minimum;
      drawStatus.textContent = `${puntosDibujoMapa.length} punto(s) marcados${isTrail ? '' : ` · ${minimum} puntos mínimos para cerrar el polígono`}.`;
      return;
    }
    if (!modoColocacionRefugio) return;
    modoColocacionRefugio = false;
    mapaRefugiosInstance.getContainer().classList.remove('is-placing-refugio');
    document.getElementById('map-placement-hint').hidden = true;

    if (marcadorRefugioPendiente) marcadorRefugioPendiente.remove();
    marcadorRefugioPendiente = L.circleMarker(event.latlng, {
      radius: 10,
      color: '#FFFFFF',
      weight: 2,
      fillColor: '#B65332',
      fillOpacity: 0.8,
      className: 'refugio-placement-preview'
    }).addTo(mapaRefugiosInstance);

    const form = document.getElementById('formCrearRefugio');
    form.reset();
    form.elements.lat.value = event.latlng.lat.toFixed(6);
    form.elements.lng.value = event.latlng.lng.toFixed(6);
    document.getElementById('errorCrearRefugio').textContent = '';
    const modal = document.getElementById('modalCrearRefugio');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    form.elements.nombre.focus();
  });

  if (window.puedeCrearRefugios) {
    document.getElementById('formCrearRefugio').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const botonGuardar = form.querySelector('[type="submit"]');
      const error = document.getElementById('errorCrearRefugio');
      botonGuardar.disabled = true;
      error.textContent = '';

      const datos = Object.fromEntries(new FormData(form).entries());
      datos.lat = Number(datos.lat);
      datos.lng = Number(datos.lng);

      try {
        const respuesta = await fetch('/mapa/api/refugios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datos)
        });
        const resultado = await respuesta.json();
        if (!respuesta.ok || !resultado.success) {
          throw new Error(resultado.error || 'No se pudo guardar el refugio.');
        }

        cancelarColocacionRefugio();
        crearMarcadorRefugio(mapaRefugiosInstance, resultado.refugio).addTo(mapaRefugiosInstance).openPopup();
        mapaRefugiosInstance.setView([resultado.refugio.lat, resultado.refugio.lng], Math.max(mapaRefugiosInstance.getZoom(), 12));
      } catch (err) {
        error.textContent = err.message;
      } finally {
        botonGuardar.disabled = false;
      }
    });
  }

  window.setTimeout(() => mapaRefugiosInstance.invalidateSize(), 100);
}

inicializarMapaRefugios();

if (document.getElementById('map') && new URLSearchParams(window.location.search).get('crearRefugio') === '1') {
  activarModoColocacionRefugio();
}

const traducciones = {
  es: { 'Settings': 'Ajustes' },
  en: {
    'Mapa': 'Map', 'Refugio': 'Shelters', 'Clima': 'Weather', 'Mantenimiento': 'Maintenance',
    'Incidentes': 'Incidents', 'Administración': 'Administration', 'Usuario': 'User', 'Turnos': 'Shifts', 'Ajustes': 'Settings',
    'Inicio de Sesión': 'Sign in', 'Inicio de sesión': 'Sign in', 'Contraseña': 'Password', '¿No tienes cuenta?': "Don't have an account?",
    'Crea una aquí': 'Create one here', 'Crear Cuenta Sledge': 'Create a Sledge account', 'Nombres y Apellidos completos': 'Full name',
    'RUT sin puntos ni guión (ej: 15420192K)': 'National ID without punctuation', 'Correo electrónico': 'Email address',
    'Contraseña segura': 'Secure password', 'Registrarse': 'Register', '¿Ya tienes cuenta?': 'Already have an account?', 'Inicia sesión aquí': 'Sign in here',
    'Mapa de Refugios': 'Shelter map', 'Agregar refugio': 'Add shelter', 'Haz clic en el mapa para colocar el refugio': 'Click the map to place the shelter',
    'Nuevo refugio': 'New shelter', 'Confirma los datos de la ubicación seleccionada.': 'Confirm the selected location details.', 'Nombre': 'Name', 'Zona': 'Area', 'Guardar refugio': 'Save shelter',
    'Buscar Refugio': 'Search shelters', 'Buscar por nombre o código de barra...': 'Search by name or barcode...', 'Agregar Equipamiento': 'Add equipment',
    'Código Único (Obligatorio)': 'Unique code (required)', 'Disponibles': 'Available', 'Totales': 'Total', 'Descripción': 'Description',
    'Inventario disponible:': 'Available inventory:', 'Capacidad:': 'Capacity:', 'Alerta de Stock Bajo': 'Low stock alert', 'Cerrado por temporal': 'Closed due to storm',
    'INFORMACIÓN MÉDICA CRÍTICA': 'CRITICAL MEDICAL INFORMATION', 'Tipo de Sangre': 'Blood type', 'Enfermedades crónicas': 'Chronic conditions',
    'Medicamentos de uso diario': 'Daily medication', 'Alergias': 'Allergies',
    'Categoría General': 'General category', 'Radiocomunicación': 'Radio communication', 'Insumos Médicos': 'Medical supplies', 'Medios de Traslado': 'Transport equipment',
    'Buscar opción': 'Search options', 'Editar información': 'Edit information', 'Selecciona una o más opciones.': 'Select one or more options.',
    'Selecciona tu tipo de sangre.': 'Select your blood type.', 'Puedes seleccionar varias opciones.': 'You can select multiple options.',
    'Guardar': 'Save', 'Cancelar': 'Cancel', 'Cerrar': 'Close', 'Ver refugio': 'View shelter', 'Código:': 'Code:', 'Estado:': 'Status:',
    'Guardando...': 'Saving...', 'Sin horas registradas': 'No hours recorded',
    'Idioma y región': 'Language and region', 'Idioma de la aplicación': 'Application language',
    'Cambia el idioma de la interfaz y los mapas.': 'Change the interface and map language.',
    'Unidades de medida': 'Measurement units', 'Mostrar distancias en kilómetros (km) o millas (mi).': 'Show distances in kilometers (km) or miles (mi).',
    'Accesibilidad': 'Accessibility', 'Texto grande / Alto contraste': 'Large text / High contrast',
    'Optimiza la lectura de nombres de refugios y alertas.': 'Improve readability of shelter names and alerts.',
    'Guiado por voz en mapa': 'Voice guidance on map', 'Dicta las instrucciones de llegada en voz alta.': 'Read arrival directions aloud.',
    'Alertas por vibración intensa': 'Strong vibration alerts', 'Emite vibraciones fuertes al recibir alertas críticas.': 'Vibrate strongly for critical alerts.',
    'Privacidad y Seguridad': 'Privacy and security', 'Modo incógnito en mapa': 'Incognito map mode',
    'No guardar el historial de los refugios buscados.': 'Do not save searched shelter history.',
    'Compartir ubicación de emergencia': 'Share emergency location', 'Envía tu posición a tus contactos si estás en peligro.': 'Share your location with contacts when in danger.',
    'Datos personales': 'Personal details', 'Turnos e historial': 'Shifts and history', 'Registrar o asignar turno': 'Record or assign a shift',
    'Horas operativas registradas': 'Operational hours recorded', 'Registros de turno': 'Shift records', 'Calendario e historial': 'Calendar and history',
    'Turno registrado': 'Shift recorded', 'Persona': 'Person', 'Fecha': 'Date', 'Inicio': 'Start', 'Fin': 'End',
    'Estado': 'Status', 'Rol': 'Role', 'Operativo': 'On duty', 'Descanso': 'Off duty',
    'Operador de Refugio': 'Shelter Operator', 'Administrador de Refugio': 'Shelter Administrator', 'Ski Patrol': 'Ski Patrol',
    'Guardar turno': 'Save shift', 'Historial': 'History', 'Todavía no hay turnos registrados.': 'No shifts have been recorded yet.',
    'La capacidad se calculará automáticamente al agregar equipamiento.': 'Capacity is calculated automatically as equipment is added.',
    'Información personal y de salud': 'Personal and health information',
    'Editar información personal y de salud': 'Edit personal and health information',
    'Los datos de contacto y salud se muestran solo al abrir la configuración.': 'Contact and health data are only shown when settings are opened.',
    'Nombre': 'Name', 'Teléfono de contacto': 'Contact phone', 'Contacto de emergencia · nombre': 'Emergency contact · name',
    'Contacto de emergencia · teléfono': 'Emergency contact · phone', 'Grupo sanguíneo': 'Blood type',
    'Estado / disponibilidad': 'Status / availability', 'Disponible': 'Available', 'En servicio': 'On duty',
    'No disponible': 'Unavailable', 'Guardar datos personales': 'Save personal information',
    'Seguridad de la cuenta': 'Account security', 'Contraseña actual': 'Current password',
    'Nueva contraseña': 'New password', 'Repetir nueva contraseña': 'Repeat new password',
    'Cambiar contraseña': 'Change password', 'Actualizar contraseña': 'Update password',
    'Centro de Montaña Farellones': 'Farellones Mountain Center',
    'Configuración de montaña': 'Mountain settings', 'Ubicación global de la montaña': 'Global mountain location',
    'Nombre de la Montaña / Centro': 'Mountain / Center name', 'Latitud': 'Latitude', 'Longitud': 'Longitude',
    'Altitud sobre el nivel del mar (m)': 'Altitude above sea level (m)',
    'Sombra Alpina': 'Alpine Shadow', 'Azul y gris oscuro': 'Dark blue and gray',
    'Tormenta Nocturna': 'Night Storm', 'Negro AMOLED': 'AMOLED black',
    'Pendiente': 'Pending', 'Aprobado': 'Approved', 'Rechazado': 'Rejected',
    'Mantenimiento': 'Maintenance', 'Fuera de servicio': 'Out of service', 'Operativo': 'Operational',
    'Inventario': 'Inventory', 'Equipamiento': 'Equipment', 'Categoría': 'Category', 'Código': 'Code',
    'Cantidad': 'Quantity', 'Guardar configuración de montaña': 'Save mountain settings',
    'Mantenimiento y Taller': 'Maintenance and Workshop', 'Gestionar mantenciones': 'Manage maintenance',
    'Reportar Falla': 'Report a failure', 'Solicitar': 'Request', 'Aprobar': 'Approve', 'Rechazar': 'Reject',
    'En mantenimiento:': 'Under maintenance:', 'Disponibles': 'Available', 'Totales': 'Total',
    'Unidades afectadas': 'Affected units', 'Detalle de la falla': 'Failure details',
    'Centro configurado:': 'Configured center:', 'Guardar cambios': 'Save changes',
    'Sin equipamiento registrado': 'No equipment registered', 'Sin refugios registrados': 'No shelters registered',
    'Actualizando…': 'Updating…', 'No hay datos disponibles.': 'No data available.',
    'Usuario / Esquiador': 'User / Skier', 'Operador de Refugio': 'Shelter Operator',
    'Administrador de Refugio': 'Shelter Administrator', 'Ski Patrol': 'Ski Patrol'
  },
  pt: {
    'Mapa': 'Mapa', 'Refugio': 'Refúgios', 'Clima': 'Clima', 'Mantenimiento': 'Manutenção',
    'Incidentes': 'Incidentes', 'Administración': 'Administração', 'Usuario': 'Usuário', 'Turnos': 'Turnos', 'Ajustes': 'Configurações',
    'Inicio de Sesión': 'Entrar', 'Inicio de sesión': 'Entrar', 'Contraseña': 'Senha', '¿No tienes cuenta?': 'Ainda não tem uma conta?',
    'Crea una aquí': 'Crie uma aqui', 'Crear Cuenta Sledge': 'Criar conta Sledge', 'Nombres y Apellidos completos': 'Nome completo',
    'RUT sin puntos ni guión (ej: 15420192K)': 'Documento de identidade sem pontuação', 'Correo electrónico': 'E-mail',
    'Contraseña segura': 'Senha segura', 'Registrarse': 'Cadastrar-se', '¿Ya tienes cuenta?': 'Já tem uma conta?', 'Inicia sesión aquí': 'Entre aqui',
    'Mapa de Refugios': 'Mapa de refúgios', 'Agregar refugio': 'Adicionar refúgio', 'Haz clic en el mapa para colocar el refugio': 'Clique no mapa para posicionar o refúgio',
    'Nuevo refugio': 'Novo refúgio', 'Confirma los datos de la ubicación seleccionada.': 'Confirme os dados do local selecionado.', 'Nombre': 'Nome', 'Zona': 'Área', 'Guardar refugio': 'Salvar refúgio',
    'Buscar Refugio': 'Buscar refúgios', 'Buscar por nombre o código de barra...': 'Buscar por nome ou código de barras...', 'Agregar Equipamiento': 'Adicionar equipamento',
    'Código Único (Obligatorio)': 'Código único (obrigatório)', 'Disponibles': 'Disponíveis', 'Totales': 'Total', 'Descripción': 'Descrição',
    'Inventario disponible:': 'Inventário disponível:', 'Capacidad:': 'Capacidade:', 'Alerta de Stock Bajo': 'Alerta de estoque baixo', 'Cerrado por temporal': 'Fechado devido à tempestade',
    'INFORMACIÓN MÉDICA CRÍTICA': 'INFORMAÇÕES MÉDICAS CRÍTICAS', 'Tipo de Sangre': 'Tipo sanguíneo', 'Enfermedades crónicas': 'Doenças crônicas',
    'Medicamentos de uso diario': 'Medicamentos de uso diário', 'Alergias': 'Alergias',
    'Categoría General': 'Categoria geral', 'Radiocomunicación': 'Radiocomunicação', 'Insumos Médicos': 'Suprimentos médicos', 'Medios de Traslado': 'Equipamentos de transporte',
    'Buscar opción': 'Buscar opção', 'Editar información': 'Editar informações', 'Selecciona una o más opciones.': 'Selecione uma ou mais opções.',
    'Selecciona tu tipo de sangre.': 'Selecione seu tipo sanguíneo.', 'Puedes seleccionar varias opciones.': 'Você pode selecionar várias opções.',
    'Guardar': 'Salvar', 'Cancelar': 'Cancelar', 'Cerrar': 'Fechar', 'Ver refugio': 'Ver refúgio', 'Código:': 'Código:', 'Estado:': 'Status:',
    'Guardando...': 'Salvando...', 'Sin horas registradas': 'Sem horas registradas',
    'Idioma y región': 'Idioma e região', 'Idioma de la aplicación': 'Idioma do aplicativo',
    'Cambia el idioma de la interfaz y los mapas.': 'Altere o idioma da interface e dos mapas.',
    'Unidades de medida': 'Unidades de medida', 'Mostrar distancias en kilómetros (km) o millas (mi).': 'Exibir distâncias em quilômetros (km) ou milhas (mi).',
    'Accesibilidad': 'Acessibilidade', 'Texto grande / Alto contraste': 'Texto grande / Alto contraste',
    'Optimiza la lectura de nombres de refugios y alertas.': 'Melhora a leitura dos nomes dos refúgios e alertas.',
    'Guiado por voz en mapa': 'Orientação por voz no mapa', 'Dicta las instrucciones de llegada en voz alta.': 'Leia as instruções de chegada em voz alta.',
    'Alertas por vibración intensa': 'Alertas por vibração intensa', 'Emite vibraciones fuertes al recibir alertas críticas.': 'Vibra intensamente ao receber alertas críticos.',
    'Privacidad y Seguridad': 'Privacidade e segurança', 'Modo incógnito en mapa': 'Modo anônimo no mapa',
    'No guardar el historial de los refugios buscados.': 'Não salvar o histórico de refúgios pesquisados.',
    'Compartir ubicación de emergencia': 'Compartilhar localização de emergência', 'Envía tu posición a tus contactos si estás en peligro.': 'Compartilhe sua localização com contatos em caso de perigo.',
    'Datos personales': 'Dados pessoais', 'Turnos e historial': 'Turnos e histórico', 'Registrar o asignar turno': 'Registrar ou atribuir turno',
    'Horas operativas registradas': 'Horas operacionais registradas', 'Registros de turno': 'Registros de turno', 'Calendario e historial': 'Calendário e histórico',
    'Turno registrado': 'Turno registrado', 'Persona': 'Pessoa', 'Fecha': 'Data', 'Inicio': 'Início', 'Fin': 'Fim',
    'Estado': 'Status', 'Rol': 'Função', 'Operativo': 'Em serviço', 'Descanso': 'Folga',
    'Operador de Refugio': 'Operador de refúgio', 'Administrador de Refugio': 'Administrador de refúgio', 'Ski Patrol': 'Patrulha de esqui',
    'Guardar turno': 'Salvar turno', 'Historial': 'Histórico', 'Todavía no hay turnos registrados.': 'Ainda não há turnos registrados.',
    'La capacidad se calculará automáticamente al agregar equipamiento.': 'A capacidade será calculada automaticamente ao adicionar equipamentos.',
    'Información personal y de salud': 'Informações pessoais e de saúde',
    'Editar información personal y de salud': 'Editar informações pessoais e de saúde',
    'Los datos de contacto y salud se muestran solo al abrir la configuración.': 'Os dados de contato e saúde são exibidos somente ao abrir as configurações.',
    'Nombre': 'Nome', 'Teléfono de contacto': 'Telefone de contato', 'Contacto de emergencia · nombre': 'Contato de emergência · nome',
    'Contacto de emergencia · teléfono': 'Contato de emergência · telefone', 'Grupo sanguíneo': 'Tipo sanguíneo',
    'Estado / disponibilidad': 'Status / disponibilidade', 'Disponible': 'Disponível', 'En servicio': 'Em serviço',
    'No disponible': 'Indisponível', 'Guardar datos personales': 'Salvar dados pessoais',
    'Seguridad de la cuenta': 'Segurança da conta', 'Contraseña actual': 'Senha atual',
    'Nueva contraseña': 'Nova senha', 'Repetir nueva contraseña': 'Repetir nova senha',
    'Cambiar contraseña': 'Alterar senha', 'Actualizar contraseña': 'Atualizar senha',
    'Centro de Montaña Farellones': 'Centro de Montanha Farellones',
    'Configuración de montaña': 'Configurações da montanha', 'Ubicación global de la montaña': 'Localização global da montanha',
    'Nombre de la Montaña / Centro': 'Nome da Montanha / Centro', 'Latitud': 'Latitude', 'Longitud': 'Longitude',
    'Altitud sobre el nivel del mar (m)': 'Altitude acima do nível do mar (m)',
    'Sombra Alpina': 'Sombra Alpina', 'Azul y gris oscuro': 'Azul e cinza escuro',
    'Tormenta Nocturna': 'Tempestade Noturna', 'Negro AMOLED': 'Preto AMOLED',
    'Pendiente': 'Pendente', 'Aprobado': 'Aprovado', 'Rechazado': 'Rejeitado',
    'Mantenimiento': 'Manutenção', 'Fuera de servicio': 'Fora de serviço', 'Operativo': 'Operacional',
    'Inventario': 'Inventário', 'Equipamiento': 'Equipamento', 'Categoría': 'Categoria', 'Código': 'Código',
    'Cantidad': 'Quantidade', 'Guardar configuración de montaña': 'Salvar configurações da montanha',
    'Mantenimiento y Taller': 'Manutenção e Oficina', 'Gestionar mantenciones': 'Gerenciar manutenções',
    'Reportar Falla': 'Relatar falha', 'Solicitar': 'Solicitar', 'Aprobar': 'Aprovar', 'Rechazar': 'Rejeitar',
    'En mantenimiento:': 'Em manutenção:', 'Disponibles': 'Disponíveis', 'Totales': 'Total',
    'Unidades afectadas': 'Unidades afetadas', 'Detalle de la falla': 'Detalhes da falha',
    'Centro configurado:': 'Centro configurado:', 'Guardar cambios': 'Salvar alterações',
    'Sin equipamiento registrado': 'Nenhum equipamento registrado', 'Sin refugios registrados': 'Nenhum refúgio registrado',
    'Actualizando…': 'Atualizando…', 'No hay datos disponibles.': 'Não há dados disponíveis.',
    'Usuario / Esquiador': 'Usuário / Esquiador', 'Operador de Refugio': 'Operador de refúgio',
    'Administrador de Refugio': 'Administrador de refúgio', 'Ski Patrol': 'Patrulha de esqui'
  }
};

const languageOriginalText = new WeakMap();
const languageOriginalAttributes = new WeakMap();
let activeLanguage = 'es';
let languageObserver;

function applyLanguage(language) {
  const dictionary = traducciones[language] || {};
  activeLanguage = language;
  document.documentElement.lang = language;
  const translateNode = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      let state = languageOriginalText.get(node);
      if (!state) {
        state = { original: node.nodeValue, rendered: node.nodeValue };
        languageOriginalText.set(node, state);
      } else if (node.nodeValue !== state.rendered) {
        state.original = node.nodeValue;
      } else {
        return;
      }
      const original = state.original;
      const key = original.trim();
      let translated = original;
      if (dictionary[key]) translated = original.replace(key, dictionary[key]);
      else {
        const label = Object.keys(dictionary).find(phrase => phrase.endsWith(':') && key.startsWith(phrase));
        if (label) translated = original.replace(label, dictionary[label]);
      }
      if (node.nodeValue !== translated) node.nodeValue = translated;
      state.rendered = translated;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (!languageOriginalAttributes.has(node)) languageOriginalAttributes.set(node, new Map());
    const originals = languageOriginalAttributes.get(node);
    ['placeholder', 'title', 'aria-label', 'value'].forEach(attribute => {
      if (!node.hasAttribute(attribute)) return;
      let state = originals.get(attribute);
      if (!state) {
        state = { original: node.getAttribute(attribute), rendered: node.getAttribute(attribute) };
        originals.set(attribute, state);
      } else if (node.getAttribute(attribute) !== state.rendered) {
        state.original = node.getAttribute(attribute);
      }
      const original = state.original;
      if (dictionary[original]) node.setAttribute(attribute, dictionary[original]);
      else if (attribute === 'placeholder' || attribute === 'title' || attribute === 'aria-label') node.setAttribute(attribute, original);
      state.rendered = node.getAttribute(attribute);
    });
    Array.from(node.childNodes).forEach(translateNode);
  };
  translateNode(document.body);
  const title = document.querySelector('h1');
  if (title && dictionary[title.textContent.trim()]) document.title = `Sledge - ${dictionary[title.textContent.trim()]}`;
  if (!languageObserver && document.body) {
    languageObserver = new MutationObserver(records => {
      records.forEach(record => {
        if (record.type === 'childList') record.addedNodes.forEach(translateNode);
        else if (record.type === 'characterData') translateNode(record.target);
      });
    });
    languageObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
  }
}

function initializeApplicationSettings() {
  let storedSettings = {};
  try {
    storedSettings = JSON.parse(localStorage.getItem('sledgeSettings') || '{}');
  } catch (error) {
    localStorage.removeItem('sledgeSettings');
  }
  const settings = {
    theme: 'nieve-nocturna',
    language: 'es',
    units: 'km',
    ...(storedSettings || {}),
    ...(window.serverUserPreferences || {})
  };
  if (!['cumbre', 'roca', 'nieve-nocturna', 'sombra-alpina', 'tormenta-nocturna'].includes(settings.theme)) settings.theme = 'nieve-nocturna';
  const themeChoices = document.querySelectorAll('[name="themePalette"]');
  if (themeChoices.length && window.serverUserPreferences && window.serverUserPreferences.theme) {
    settings.theme = window.serverUserPreferences.theme;
  }
  const applyTheme = () => {
    document.documentElement.dataset.theme = settings.theme;
    document.body.classList.remove('light-theme');
    document.body.classList.toggle('high-contrast', Boolean(settings.highContrast));
    document.body.classList.toggle('large-text', Boolean(settings.largeText));
  };
  const saveSettings = async () => {
    const status = document.getElementById('themeSaveStatus');
    try {
      const response = await fetch('/ajustes/preferencias', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferencias: settings })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudieron guardar las preferencias.');
      localStorage.setItem('sledgeSettings', JSON.stringify(settings));
      if (status) status.textContent = 'Preferencias guardadas.';
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  };
  applyTheme();
  document.querySelectorAll('[data-setting]').forEach(input => {
    input.checked = Boolean(settings[input.dataset.setting]);
    input.addEventListener('change', () => {
      settings[input.dataset.setting] = input.checked;
      applyTheme();
      saveSettings();
    });
  });
  themeChoices.forEach(choice => {
    choice.checked = choice.value === settings.theme;
    choice.addEventListener('change', () => {
      if (!choice.checked) return;
      settings.theme = choice.value;
      applyTheme();
      saveSettings();
    });
  });
  const languageSelect = document.getElementById('selectIdioma');
  if (languageSelect) {
    languageSelect.value = settings.language || 'es';
    languageSelect.addEventListener('change', () => {
      settings.language = languageSelect.value;
      saveSettings().then(() => window.location.reload());
    });
  }
  const unitSelect = document.getElementById('selectUnidad');
  if (unitSelect) {
    unitSelect.value = settings.units || 'km';
    unitSelect.addEventListener('change', () => {
      settings.units = unitSelect.value;
      saveSettings();
    });
  }
  applyLanguage(settings.language || 'es');
}

function initializePersonalSettings() {
  const form = document.getElementById('personalSettingsForm');
  if (!form) return;
  const status = document.getElementById('personalSettingsStatus');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Guardando...';
    try {
      const response = await fetch('/api/perfil/datos-personales', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudieron guardar los datos.');
      status.textContent = 'Datos personales guardados.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  const dialog = document.getElementById('personalSettingsDialog');
  if (dialog) dialog.addEventListener('close', () => {
    form.reset();
    const passwordForm = document.getElementById('passwordChangeForm');
    if (passwordForm) passwordForm.reset();
    status.textContent = '';
  });
}

function initializeSidebarToggle() {
  const layout = document.querySelector('.app-layout');
  const toggle = document.getElementById('sidebarToggle');
  if (!layout || !toggle) return;
  let collapsed = false;
  try {
    collapsed = localStorage.getItem('sledgeSidebarCollapsed') === 'true';
  } catch (error) {
    console.warn('[UI] No se pudo leer la preferencia del sidebar:', error.message);
  }
  const applyState = () => {
    layout.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral');
    toggle.title = collapsed ? 'Expandir menú' : 'Colapsar menú';
    toggle.querySelector('.material-symbols-rounded').textContent = collapsed ? 'left_panel_open' : 'left_panel_close';
  };
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    applyState();
    try {
      localStorage.setItem('sledgeSidebarCollapsed', String(collapsed));
    } catch (error) {
      console.warn('[UI] No se pudo guardar la preferencia del sidebar:', error.message);
    }
  });
  applyState();
}

function initializeUserRoleForms() {
  const rows = Array.from(document.querySelectorAll('[data-user-row]'));
  if (!rows.length) return;
  const search = document.getElementById('adminUserSearch');
  const roleFilter = document.getElementById('adminUserRoleFilter');
  const equipmentFilter = document.getElementById('adminUserEquipmentFilter');
  const resultCount = document.getElementById('adminUserResultCount');
  const emptyMessage = document.getElementById('adminUsersEmptyFilter');
  const applyFilters = () => {
    const query = (search.value || '').trim().toLocaleLowerCase();
    const role = roleFilter.value;
    let visible = 0;
    rows.forEach(row => {
      if (!row.isConnected) return;
      const matches = (!query || row.dataset.userName.includes(query) || row.dataset.userEmail.includes(query)) &&
        (!role || row.dataset.userRole === role) &&
        (!equipmentFilter.checked || Number(row.dataset.userEquipment) > 0);
      row.hidden = !matches;
      if (matches) visible++;
    });
    resultCount.textContent = `${visible} usuario(s)`;
    emptyMessage.hidden = visible !== 0;
  };
  [search, roleFilter, equipmentFilter].forEach(control => control.addEventListener('input', applyFilters));
  rows.forEach(row => {
    const saveButton = row.querySelector('[data-save-user]');
    if (saveButton) saveButton.addEventListener('click', async () => {
      const status = row.querySelector('.user-role-status');
      saveButton.disabled = true;
      status.textContent = 'Guardando...';
      try {
        const response = await fetch(`/administracion/usuarios/${encodeURIComponent(row.dataset.userRow)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: row.querySelector('.admin-user-name').value,
            gmail: row.querySelector('.admin-user-email').value,
            rol: row.querySelector('.admin-user-role').value,
            activo: Number(row.querySelector('.admin-user-active').value)
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar el usuario.');
        row.dataset.userName = result.nombre.toLocaleLowerCase();
        row.dataset.userEmail = result.gmail.toLocaleLowerCase();
        row.dataset.userRole = result.rol;
        row.classList.toggle('is-user-inactive', result.activo === 0);
        status.textContent = 'Cambios guardados.';
        applyFilters();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        saveButton.disabled = false;
      }
    });
    const deleteButton = row.querySelector('[data-delete-user]');
    if (deleteButton) deleteButton.addEventListener('click', async () => {
      if (!window.confirm('¿Eliminar esta cuenta definitivamente? Si tiene historial, se ofrecerá darla de baja sin borrar sus registros.')) return;
      deleteButton.disabled = true;
      const status = row.querySelector('.user-role-status');
      try {
        const response = await fetch(`/administracion/usuarios/${encodeURIComponent(row.dataset.userRow)}`, { method: 'DELETE' });
        const result = await response.json();
        if (response.status === 409 && window.confirm(`${result.error}\n¿Dar de baja la cuenta y conservar su historial?`)) {
          const disableResponse = await fetch(`/administracion/usuarios/${encodeURIComponent(row.dataset.userRow)}/baja`, { method: 'POST' });
          const disabled = await disableResponse.json();
          if (!disableResponse.ok || !disabled.success) throw new Error(disabled.error || 'No se pudo dar de baja el usuario.');
          row.querySelector('.admin-user-active').value = '0';
          row.classList.add('is-user-inactive');
          status.textContent = 'Cuenta dada de baja; historial conservado.';
          return;
        }
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo eliminar el usuario.');
        row.remove();
        applyFilters();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        deleteButton.disabled = false;
      }
    });
    const disableButton = row.querySelector('[data-disable-user]');
    if (disableButton) disableButton.addEventListener('click', async () => {
      const activeSelect = row.querySelector('.admin-user-active');
      if (activeSelect.value === '0') return;
      if (!window.confirm('¿Dar de baja esta cuenta? Se conservarán los registros históricos.')) return;
      disableButton.disabled = true;
      const status = row.querySelector('.user-role-status');
      try {
        const response = await fetch(`/administracion/usuarios/${encodeURIComponent(row.dataset.userRow)}/baja`, { method: 'POST' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo dar de baja el usuario.');
        activeSelect.value = '0';
        row.classList.add('is-user-inactive');
        status.textContent = 'Cuenta inactiva; historial conservado.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        disableButton.disabled = false;
      }
    });
  });
  applyFilters();
}

function initializeShiftScreen() {
  const calendar = document.querySelector('.shift-calendar[data-turnos]');
  if (!calendar) return;
  const shifts = JSON.parse(calendar.dataset.turnos || '[]');
  const workedDays = new Set(shifts.map(shift => shift.fecha));
  const daysContainer = document.getElementById('shiftCalendarDays');
  const monthLabel = document.getElementById('shiftMonthLabel');
  const dayCount = document.getElementById('shiftDaysCount');
  const currentDate = new Date();
  let year = currentDate.getFullYear();
  let month = currentDate.getMonth();
  const render = () => {
    const monthName = new Intl.DateTimeFormat(document.documentElement.lang, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
    monthLabel.textContent = monthName;
    daysContainer.replaceChildren();
    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    for (let index = 0; index < firstDay; index += 1) daysContainer.append(document.createElement('span'));
    for (let day = 1; day <= count; day += 1) {
      const button = document.createElement('button');
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      button.type = 'button';
      button.className = `shift-calendar-day${workedDays.has(key) ? ' is-worked' : ''}`;
      button.textContent = day;
      const turnoRegistrado = document.documentElement.lang === 'en' ? 'shift recorded' : document.documentElement.lang === 'pt' ? 'turno registrado' : 'turno registrado';
      button.setAttribute('aria-label', `${key}${workedDays.has(key) ? `, ${turnoRegistrado}` : ''}`);
      daysContainer.append(button);
    }
    const etiquetaTurno = document.documentElement.lang === 'en'
      ? (workedDays.size === 1 ? 'shift' : 'shifts')
      : document.documentElement.lang === 'pt' ? 'turnos' : 'turnos';
    dayCount.textContent = `${workedDays.size} ${etiquetaTurno}`;
  };
  document.getElementById('previousShiftMonth').addEventListener('click', () => { month -= 1; if (month < 0) { month = 11; year -= 1; } render(); });
  document.getElementById('nextShiftMonth').addEventListener('click', () => { month += 1; if (month > 11) { month = 0; year += 1; } render(); });
  render();

  const form = document.getElementById('shiftForm');
  if (form) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const status = document.getElementById('shiftFormStatus');
      const values = Object.fromEntries(new FormData(form).entries());
      status.textContent = 'Guardando...';
      try {
        const response = await fetch('/turnos/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo guardar el turno.');
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }

  document.querySelectorAll('.shift-close-form').forEach(closeForm => {
    const kitSelect = closeForm.querySelector('[data-medkit-select]');
    const itemsContainer = closeForm.querySelector('[data-medkit-consumables]');
    const renderItems = () => {
      if (!kitSelect || !itemsContainer) return;
      let supplies = [];
      try {
        supplies = JSON.parse(kitSelect.selectedOptions[0].dataset.insumos || '[]');
      } catch (error) {
        closeForm.querySelector('.shift-close-status').textContent = 'No se pudo cargar el detalle del botiquín.';
        return;
      }
      itemsContainer.replaceChildren();
      supplies.forEach(supply => {
        const row = document.createElement('label');
        row.className = 'medkit-consumption-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.supplyId = supply.id;
        const text = document.createElement('span');
        text.textContent = `${supply.nombre} · disponible ${supply.disponible} · crítico ${supply.critica}`;
        const quantity = document.createElement('input');
        quantity.type = 'number';
        quantity.min = '1';
        quantity.max = String(supply.disponible);
        quantity.value = '1';
        quantity.disabled = true;
        quantity.setAttribute('aria-label', `Cantidad gastada de ${supply.nombre}`);
        checkbox.addEventListener('change', () => { quantity.disabled = !checkbox.checked; });
        row.append(checkbox, text, quantity);
        itemsContainer.append(row);
      });
      if (!supplies.length) itemsContainer.textContent = 'Este botiquín no tiene insumos registrados.';
    };
    if (kitSelect) {
      kitSelect.addEventListener('change', renderItems);
      renderItems();
    }
    closeForm.addEventListener('submit', async event => {
      event.preventDefault();
      const status = closeForm.querySelector('.shift-close-status');
      const submit = closeForm.querySelector('[type="submit"]');
      const values = Object.fromEntries(new FormData(closeForm).entries());
      values.consumos = [...closeForm.querySelectorAll('[data-supply-id]:checked')].map(checkbox => ({
        insumo_id: Number(checkbox.dataset.supplyId),
        cantidad: Number(checkbox.closest('label').querySelector('input[type="number"]').value)
      }));
      status.textContent = 'Guardando cierre y actualizando inventario…';
      submit.disabled = true;
      try {
        const response = await fetch(`/turnos/${encodeURIComponent(closeForm.dataset.turnId)}/cierre`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo cerrar el turno.');
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        submit.disabled = false;
      }
    });
  });
}

function abrirCatalogoEquipamiento() {
  const modal = document.getElementById('modalEquipo');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('equipmentCatalog').hidden = false;
  document.getElementById('equipmentForm').hidden = true;
  document.getElementById('equipmentDialogTitle').textContent = 'Agregar equipamiento';
}

function cerrarModalEquipamiento() {
  const modal = document.getElementById('modalEquipo');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  document.getElementById('equipmentForm').reset();
}

function volverCatalogoEquipamiento() {
  const form = document.getElementById('equipmentForm');
  if (!form) return;
  form.hidden = true;
  document.getElementById('equipmentCatalog').hidden = false;
  document.getElementById('equipmentDialogTitle').textContent = 'Agregar equipamiento';
}

function configurarEquipamiento(option) {
  const form = document.getElementById('equipmentForm');
  const esPersonalizado = option.dataset.equipmentKind === 'custom';
  const kind = option.dataset.equipmentKind;
  form.reset();
  form.hidden = false;
  document.getElementById('equipmentCatalog').hidden = true;
  document.getElementById('equipmentDialogTitle').textContent = esPersonalizado ? 'Nuevo equipamiento' : option.querySelector('strong').textContent;
  document.getElementById('equipmentName').value = option.dataset.equipmentName || '';
  document.getElementById('equipmentCategory').value = option.dataset.equipmentCategory || 'General';
  document.getElementById('customCategoryField').hidden = !esPersonalizado;
  document.getElementById('equipmentImageField').hidden = !esPersonalizado;
  document.getElementById('equipmentExpiryField').hidden = kind !== 'medical';
  document.getElementById('equipmentBatteryField').hidden = kind !== 'radio';
  document.getElementById('equipmentFixingField').hidden = kind !== 'sled' && kind !== 'stretcher';
  const expiryInput = document.querySelector('[name="fecha_vencimiento"]');
  expiryInput.required = kind === 'medical';
  expiryInput.min = new Date().toISOString().slice(0, 10);
  form.dataset.custom = String(esPersonalizado);
  document.getElementById('equipmentName').focus();
}

function initializeEquipmentCatalog() {
  const modal = document.getElementById('modalEquipo');
  const form = document.getElementById('equipmentForm');
  if (!modal || !form) return;
  document.querySelectorAll('.equipment-option').forEach(option => {
    option.addEventListener('click', () => configurarEquipamiento(option));
  });
  document.getElementById('customEquipmentCategory').addEventListener('change', event => {
    const requiereVencimiento = ['Botiquines', 'Insumos Médicos'].includes(event.target.value);
    const expiryField = document.getElementById('equipmentExpiryField');
    const expiryInput = expiryField.querySelector('input');
    expiryField.hidden = !requiereVencimiento;
    expiryInput.required = requiereVencimiento;
    expiryInput.min = new Date().toISOString().slice(0, 10);
  });
  form.addEventListener('submit', () => {
    if (form.dataset.custom === 'true') {
      document.getElementById('equipmentCategory').value = document.getElementById('customEquipmentCategory').value;
    }
  });
  modal.addEventListener('click', event => {
    if (event.target === modal) cerrarModalEquipamiento();
  });
}

function initializeEquipmentReturns() {
  document.querySelectorAll('.equipment-return-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const formButton = form.querySelector('[type="submit"]');
      const returnStatus = document.getElementById('equipmentReturnStatus');
      formButton.disabled = true;
      returnStatus.textContent = 'Guardando devolución...';
      try {
        const response = await fetch(form.dataset.returnUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo guardar la devolución.');
        window.location.reload();
      } catch (error) {
        returnStatus.textContent = error.message;
        formButton.disabled = false;
      }
    });
  });
}

function initializeRequestDecisions() {
  document.querySelectorAll('[data-request-decision]').forEach(button => {
    button.addEventListener('click', async () => {
      const request = button.closest('[data-request-id]');
      const status = document.getElementById('requestInboxStatus') || document.getElementById('equipmentRequestStatus');
      request.querySelectorAll('button').forEach(control => { control.disabled = true; });
      try {
        const refugeId = button.dataset.refugeId;
        const response = await fetch(`/refugio/${encodeURIComponent(refugeId)}/solicitudes/${encodeURIComponent(request.dataset.requestId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: button.dataset.requestDecision })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo resolver la solicitud.');
        window.location.reload();
      } catch (error) {
        if (status) status.textContent = error.message;
        request.querySelectorAll('button').forEach(control => { control.disabled = false; });
      }
    });
  });
}

function initializeEquipmentRequests() {
  document.querySelectorAll('.equipment-request-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      const status = document.getElementById('equipmentActionStatus');
      button.disabled = true;
      if (status) status.textContent = `Enviando solicitud de ${form.dataset.equipmentName}…`;
      try {
        const values = Object.fromEntries(new FormData(form).entries());
        const response = await fetch(form.dataset.requestUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ equipamiento_id: values.equipamiento_id, cantidad: values.cantidad }] })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo enviar la solicitud.');
        if (status) status.textContent = `Solicitud de ${form.dataset.equipmentName} enviada y pendiente de confirmación.`;
        button.textContent = 'Solicitud pendiente';
        form.querySelector('[name="cantidad"]').disabled = true;
      } catch (error) {
        if (status) status.textContent = error.message;
        button.disabled = false;
      }
    });
  });
}

function initializeRefugeStateButtons() {
  document.querySelectorAll('[data-refuge-toggle]').forEach(button => {
    button.addEventListener('click', async () => {
      const nextState = button.dataset.state === 'Operativo' ? 'Fuera de servicio' : 'Operativo';
      button.disabled = true;
      try {
        const response = await fetch(`/refugio/${encodeURIComponent(button.dataset.refugeToggle)}/estado`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: nextState })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo cambiar el estado.');
        window.location.reload();
      } catch (error) {
        button.disabled = false;
        button.title = error.message;
      }
    });
  });
}

function initializeInventoryActions() {
  const status = document.getElementById('equipmentActionStatus');
  document.querySelectorAll('.equipment-maintenance-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const response = await fetch(form.dataset.maintenanceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar mantenimiento.');
        window.location.reload();
      } catch (error) {
        if (status) status.textContent = error.message;
        submit.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-archive-equipment]').forEach(button => {
    button.addEventListener('click', async () => {
      if (!window.confirm(`¿Retirar el lote de ${button.dataset.equipmentName}? No se eliminará su historial.`)) return;
      button.disabled = true;
      try {
        const response = await fetch(`/refugio/${encodeURIComponent(window.location.pathname.split('/')[2])}/equipos/${encodeURIComponent(button.dataset.archiveEquipment)}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo retirar el lote.');
        window.location.reload();
      } catch (error) {
        if (status) status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-archive-category]').forEach(button => {
    button.addEventListener('click', async () => {
      const category = button.dataset.archiveCategory;
      if (!window.confirm(`¿Retirar toda la categoría ${category}? Se conservará el historial.`)) return;
      button.disabled = true;
      try {
        const refugeId = window.location.pathname.split('/')[2];
        const response = await fetch(`/refugio/${encodeURIComponent(refugeId)}/categorias/archivar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoria: category })
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo retirar la categoría.');
        window.location.reload();
      } catch (error) {
        if (status) status.textContent = error.message;
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll('[data-archive-refuge]').forEach(button => {
    button.addEventListener('click', async () => {
      if (!window.confirm(`¿Retirar el refugio ${button.dataset.refugeName}? Se conservarán sus registros.`)) return;
      button.disabled = true;
      try {
        const response = await fetch(`/refugio/${encodeURIComponent(button.dataset.archiveRefuge)}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo retirar el refugio.');
        window.location.reload();
      } catch (error) {
        if (status) status.textContent = error.message;
        button.disabled = false;
      }
    });
  });
}

function initializeSosSettings() {
  const contactForm = document.getElementById('sosContactForm');
  if (!contactForm) return;
  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('sosConfigStatus');
    const submit = contactForm.querySelector('[type="submit"]');
    const contactId = contactForm.elements.id.value;
    const method = contactId ? 'PUT' : 'POST';
    const url = contactId ? `/administracion/sos/contactos/${encodeURIComponent(contactId)}` : '/administracion/sos/contactos';
    submit.disabled = true;
    status.textContent = 'Guardando contacto...';
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: contactForm.elements.nombre.value,
          telefono: contactForm.elements.telefono.value
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo guardar el contacto.');
      contactForm.reset();
      await cargarContactosSOS();
      status.textContent = 'Contacto guardado.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

async function cargarContactosSOS() {
  const response = await fetch('/api/sos/contactos');
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'No se pudieron cargar los contactos SOS.');
  renderContactosSOS(result.contactos);
}

function renderContactosSOS(contacts) {
  const contactList = document.getElementById('sosContactList');
  const manageList = document.getElementById('sosManageList');
  if (contactList) {
    contactList.replaceChildren();
    if (!contacts.length) {
      const empty = document.createElement('p');
      empty.className = 'sos-empty-state';
      empty.textContent = 'Aún no hay contactos configurados. Si estás en peligro inmediato, contacta los servicios de emergencia locales.';
      contactList.append(empty);
    }
    contacts.forEach(contact => {
      const link = document.createElement('a');
      link.href = `tel:${contact.telefono}`;
      if (Number(contact.es_predeterminado) === 1) link.className = 'is-sos-default';
      const label = document.createElement('span');
      label.textContent = contact.nombre;
      if (Number(contact.es_predeterminado) === 1) {
        const badge = document.createElement('small');
        badge.textContent = 'Predeterminado';
        label.append(badge);
      }
      const phone = document.createElement('strong');
      phone.textContent = contact.telefono;
      link.append(label, phone);
      contactList.append(link);
    });
  }
  if (!manageList) return;
  manageList.replaceChildren();
  contacts.forEach(contact => {
    const item = document.createElement('div');
    item.className = 'sos-manage-item';
    const details = document.createElement('div');
    const name = document.createElement('p');
    name.textContent = contact.nombre;
    const phone = document.createElement('small');
    phone.textContent = contact.telefono;
    details.append(name, phone);
    const actions = document.createElement('div');
    actions.className = 'sos-manage-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Editar';
    edit.addEventListener('click', () => {
      const form = document.getElementById('sosContactForm');
      form.elements.id.value = contact.id;
      form.elements.nombre.value = contact.nombre;
      form.elements.telefono.value = contact.telefono;
      form.elements.nombre.focus();
    });
    const setDefault = document.createElement('button');
    setDefault.type = 'button';
    setDefault.textContent = Number(contact.es_predeterminado) === 1 ? 'Predeterminado' : 'Hacer predeterminado';
    setDefault.disabled = Number(contact.es_predeterminado) === 1;
    setDefault.addEventListener('click', () => ejecutarAccionContactoSOS(
      `/administracion/sos/contactos/${encodeURIComponent(contact.id)}/predeterminado`, 'POST'
    ));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Eliminar';
    remove.addEventListener('click', () => {
      if (window.confirm(`¿Eliminar el contacto ${contact.nombre}?`)) {
        ejecutarAccionContactoSOS(`/administracion/sos/contactos/${encodeURIComponent(contact.id)}`, 'DELETE');
      }
    });
    actions.append(edit, setDefault, remove);
    item.append(details, actions);
    manageList.append(item);
  });
}

async function ejecutarAccionContactoSOS(url, method) {
  const status = document.getElementById('sosConfigStatus');
  try {
    const response = await fetch(url, { method });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo actualizar el contacto.');
    await cargarContactosSOS();
    if (status) status.textContent = 'Contactos actualizados.';
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

function alternarConfiguracionSOS() {
  const panel = document.getElementById('sosConfigPanel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  if (!panel.hidden) cargarContactosSOS().catch(error => {
    document.getElementById('sosConfigStatus').textContent = error.message;
  });
}

function limpiarFormularioSOS() {
  const form = document.getElementById('sosContactForm');
  if (form) form.reset();
}
function initializeAdminUserCreation() {
  const form = document.getElementById('adminUserCreateForm');
  if (!form) return;
  const status = document.getElementById('adminUserCreateStatus');
  const role = document.getElementById('adminNewUserRole');
  const experienceField = document.getElementById('adminNewUserExperienceField');
  const experience = form.elements.nivel_experiencia;
  const syncExperience = () => {
    experienceField.hidden = role.value !== 'Ski Patrol';
    experience.required = role.value === 'Ski Patrol';
  };
  role.addEventListener('change', syncExperience);
  syncExperience();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Creando cuenta...';
    try {
      const response = await fetch('/administracion/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo crear la cuenta.');
      form.reset();
      status.textContent = 'Cuenta creada correctamente.';
      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function initializeEquipmentFailureReports() {
  const status = document.getElementById('equipmentActionStatus');
  document.querySelectorAll('.equipment-failure-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const response = await fetch(form.dataset.reportUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo registrar la falla.');
        window.location.reload();
      } catch (error) {
        if (status) status.textContent = error.message;
        submit.disabled = false;
      }
    });
  });
}

function initializeBulkEquipmentImport() {
  const dialog = document.getElementById('bulkEquipmentDialog');
  const form = document.getElementById('bulkEquipmentForm');
  if (!dialog || !form) return;
  window.abrirCargaMasiva = () => dialog.showModal();
  dialog.querySelector('[data-close-bulk-upload]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('bulkEquipmentStatus');
    const submit = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    submit.disabled = true;
    status.textContent = 'Procesando el archivo…';
    try {
      const response = await fetch(form.dataset.uploadUrl, { method: 'POST', body: values });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo importar el archivo.');
      status.textContent = `Importación finalizada: ${result.procesados} procesados, ${result.fallidos} fallidos.` +
        (result.errores && result.errores.length ? ` ${result.errores.slice(0, 5).join(' ')}` : '');
      if (result.procesados > 0 && result.fallidos === 0) window.setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

function initializeMedkitSupplyForms() {
  document.querySelectorAll('.medkit-supply-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const response = await fetch(form.dataset.supplyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo registrar el insumo.');
        window.location.reload();
      } catch (error) {
        const status = document.getElementById('equipmentActionStatus');
        if (status) status.textContent = error.message;
        submit.disabled = false;
      }
    });
  });
}

function initializeIncidentForm() {
  const form = document.getElementById('incidentForm');
  if (!form) return;
  const locationStatus = document.getElementById('incidentLocationStatus');
  const status = document.getElementById('incidentFormStatus');
  const latitude = form.elements.latitud;
  const longitude = form.elements.longitud;
  const captureLocation = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este dispositivo no ofrece geolocalización.'));
    locationStatus.textContent = 'Solicitando ubicación GPS…';
    navigator.geolocation.getCurrentPosition(position => {
      latitude.value = position.coords.latitude.toFixed(7);
      longitude.value = position.coords.longitude.toFixed(7);
      locationStatus.textContent = `Ubicación GPS lista: ${latitude.value}, ${longitude.value}`;
      resolve();
    }, error => {
      locationStatus.textContent = 'No se pudo obtener el GPS. Permite el acceso a la ubicación y vuelve a intentarlo.';
      reject(new Error(error.message || 'No se pudo obtener la ubicación GPS.'));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  captureLocation().catch(error => console.warn('[INCIDENTES] Ubicación GPS pendiente:', error.message));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = '';
    try {
      if (!latitude.value || !longitude.value) await captureLocation();
      const response = await fetch('/administracion/incidentes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo registrar el suceso.');
      status.textContent = 'Incidente registrado con su ubicación GPS.';
      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
      submit.disabled = false;
    }
  });
}

function initializeMaintenanceForms() {
  document.querySelectorAll('.maintenance-failure-form, .maintenance-workshop-form').forEach(form => {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const status = document.getElementById('maintenanceStatus');
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const response = await fetch(form.dataset.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo guardar la operación de mantenimiento.');
        window.location.reload();
      } catch (error) {
        status.textContent = error.message;
        submit.disabled = false;
      }
    });
  });
}

function initializeMaintenanceEquipmentSelector() {
  const refugeSelect = document.getElementById('maintenanceRefugeSelect');
  const searchInput = document.getElementById('maintenanceEquipmentSearch');
  const equipmentSelect = document.getElementById('maintenanceEquipmentSelect');
  const form = document.querySelector('.maintenance-failure-form');
  const summary = document.getElementById('maintenanceSelectedEquipment');
  if (!refugeSelect || !searchInput || !equipmentSelect || !form || !summary) return;
  const options = [...equipmentSelect.querySelectorAll('option[data-refuge-id]')];
  const updateOptions = () => {
    const refugeId = refugeSelect.value;
    const query = searchInput.value.trim().toLocaleLowerCase();
    options.forEach(option => {
      const visible = option.dataset.refugeId === refugeId && option.dataset.search.includes(query);
      option.hidden = !visible;
      option.disabled = !visible;
    });
  };
  const clearSelection = () => {
    equipmentSelect.value = '';
    form.hidden = true;
    form.dataset.url = '';
    summary.textContent = '';
  };
  const selectEquipment = () => {
    const option = equipmentSelect.selectedOptions[0];
    if (!option || !option.dataset.refugeId) return clearSelection();
    form.dataset.url = `/mantenimiento/equipos/${encodeURIComponent(option.value)}/reporte`;
    const quantity = form.elements.cantidad;
    quantity.max = option.dataset.available;
    quantity.value = '1';
    summary.textContent = `${option.dataset.name} · ${option.dataset.code} · ${option.dataset.available} disponible(s)`;
    form.hidden = false;
  };
  refugeSelect.addEventListener('change', () => {
    searchInput.disabled = !refugeSelect.value;
    equipmentSelect.disabled = !refugeSelect.value;
    searchInput.value = '';
    clearSelection();
    updateOptions();
  });
  searchInput.addEventListener('input', () => {
    clearSelection();
    updateOptions();
  });
  equipmentSelect.addEventListener('change', () => {
    selectEquipment();
  });
  if (refugeSelect.value) {
    searchInput.disabled = false;
    equipmentSelect.disabled = false;
    updateOptions();
    if (equipmentSelect.value) selectEquipment();
  }
}

function initializeInventoryDashboard() {
  const canvas = document.getElementById('inventoryStatusChart');
  if (!canvas) return;
  const status = document.getElementById('inventoryChartStatus');
  const expiryList = document.getElementById('medicalExpiryList');
  const dashboard = canvas.closest('.inventory-dashboard');
  let inventoryChart = null;
  const renderExpiry = async () => {
    const response = await fetch('/refugio/api/insumos/caducidad');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'No se pudieron consultar los vencimientos.');
    expiryList.replaceChildren();
    if (!result.data.length) {
      const item = document.createElement('li');
      item.textContent = 'No hay insumos que venzan en los próximos 30 días.';
      expiryList.append(item);
      return;
    }
    result.data.forEach(insumo => {
      const item = document.createElement('li');
      item.className = insumo.dias_para_vencer < 0 ? 'is-expired' : 'is-expiring';
      const estado = insumo.dias_para_vencer < 0
        ? `vencido hace ${Math.abs(insumo.dias_para_vencer)} día(s)`
        : `vence en ${insumo.dias_para_vencer} día(s)`;
      item.textContent = `${insumo.nombre} · ${insumo.fecha_vencimiento} · ${estado}`;
      expiryList.append(item);
    });
  };
  fetch('/refugio/api/inventario/resumen')
    .then(response => response.json().then(result => {
      if (!response.ok || !result.success) throw new Error(result.error || 'No se pudo cargar el inventario.');
      return result.data;
    }))
    .then(data => {
      if (typeof Chart === 'undefined') throw new Error('No se pudo cargar la librería del gráfico.');
      inventoryChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: ['Listas', 'Rotas', 'En Uso'],
          datasets: [{ data: [data.Listas, data.Rotas, data['En Uso']], backgroundColor: ['#287A55', '#B65332', '#D6A342'] }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });
      if (dashboard) dashboard.addEventListener('toggle', () => {
        if (dashboard.open && inventoryChart) inventoryChart.resize();
      });
    })
    .catch(error => { status.textContent = error.message; });
  renderExpiry().catch(error => {
    expiryList.replaceChildren();
    const item = document.createElement('li');
    item.textContent = error.message;
    expiryList.append(item);
  });
}

function abrirPanelSOS() {
  const dialog = document.getElementById('sosDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function cerrarPanelSOS() {
  const dialog = document.getElementById('sosDialog');
  if (dialog && dialog.open) dialog.close();
}

initializeApplicationSettings();
initializeWeatherWidget();
initializeClimatePage();
initializeMountainRecommendation();
initializeShiftScreen();
initializeEquipmentCatalog();
initializeEquipmentReturns();
initializeRequestDecisions();
initializeEquipmentRequests();
initializeRefugeStateButtons();
initializeInventoryActions();
initializeSosSettings();
initializeEquipmentFailureReports();
initializeBulkEquipmentImport();
initializeMedkitSupplyForms();
initializeIncidentForm();
initializeMaintenanceForms();
initializeMaintenanceEquipmentSelector();
initializeInventoryDashboard();
initializeAdminUserCreation();
initializeProfileEditor();
initializeMountainPassForm();
initializePasswordChangeForm();
initializePersonalSettings();
initializeSidebarToggle();
initializeUserRoleForms();
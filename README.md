<div align="center">

# 🏔️ SLEDGE
### Sistema Logístico de Equipos de Rescate y Geolocalización en Montaña

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite3](https://img.shields.io/badge/SQLite-3-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Architecture](https://img.shields.io/badge/Architecture-MVC-FF6F00?style=for-the-badge)](https://en.wikipedia.org/wiki/Model%E2%80%93view%E2%80%93controller)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge)](#-licencia-y-propiedad)

<p align="center">
Plataforma web centralizada de gestión logística, monitoreo telemétrico y soporte a patrulleros de montaña (*Ski Patrol*) para la optimización de tiempos de respuesta en emergencias de alta montaña.
</p>

---

</div>

> 🔒 **AVISO DE CONFIDENCIALIDAD:** Este repositorio es de carácter estrictamente **privado y confidencial**. El acceso, reproducción, distribución o modificación no autorizada del código fuente está prohibido por los términos de propiedad intelectual.

---

## 📌 Visión General

**SLEDGE** resuelve la problemática de trazabilidad y gestión crítica de equipamiento de rescate en centros invernales. El sistema permite el seguimiento en tiempo real de recursos físicos (camillas Akja, tablas espinales, radios de radiocomunicación y botiquines médicos), garantizando la disponibilidad operativa previa a los despliegues de patrulla.

### 🎯 Objetivos Clave
- **Cero Fallas Operativas:** Garantizar que ningún recurso averiado o incompleto sea despachado a terreno.
- **Trazabilidad Integral:** Registrar la cadena de custodia de radios, vehículos y material de trasporte por patrullero y turno.
- **Reducción de Tiempos de Respuesta:** Geolocalizar casetas y recursos estratégicos para despliegues de socorro inmediatos.

---

## 👥 Equipo y Créditos Académicos

| Rol | Nombre |
| :--- | :--- |
| **Desarrollador Principal** | **Leonardo Mahuida** |
| **Desarrollador Principal** | **Joel Lara** |

---

## 🛠️ Arquitectura de Software y Stack Tecnológico

El sistema fue construido siguiendo el patrón de diseño **MVC (Model-View-Controller)** sobre un entorno de ejecución en Node.js, priorizando la ligereza, resiliencia offline y bajo consumo energético en entornos fríos extremo.

```
                  ┌─────────────────────────────────────────┐
                  │            Cliente (Browser)            │
                  │   HTML5 / CSS3 / JavaScript / Leaflet   │
                  └────────────────────┬────────────────────┘
                                       │ HTTP / Web APIs
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │            Express.js Server            │
                  │  (Routes, Middlewares & Controllers)    │
                  └──────────┬───────────────────┬──────────┘
                             │                   │
                             ▼                   ▼
     ┌───────────────────────────────┐   ┌───────────────────────────────┐
     │        SQLite3 Database       │   │     APIs Externas (Weather    │
     │      (Models & Persistence)   │   │        & AI Engines)          │
     └───────────────────────────────┘   └───────────────────────────────┘
```

### Tecnologías Empleadas

- **Entorno de Ejecución:** [Node.js](https://nodejs.org/) (v18+)
- **Framework de Servidor:** [Express.js](https://expressjs.com/)
- **Motor de Base de Datos:** [SQLite3](https://www.sqlite.org/) *(almacenamiento embebido, relacional y liviano sin necesidad de servidor externo)*
- **Motor de Plantillas:** EJS (Embedded JavaScript Templates)
- **Geolocalización & Mapas:** Leaflet.js / OpenStreetMap API
- **Herramientas Dev:** Nodemon, Dotenv

---

## 📁 Estructura del Repositorio

```bash
sledge/
├── 📁 .vscode/          # Configuración del entorno de desarrollo (VS Code)
├── 📁 config/           # Parámetros de conexión a la base de datos SQLite3 y entorno
├── 📁 controllers/      # Lógica de negocio y manejo de peticiones (MVC)
├── 📁 middlewares/      # Interceptores de autenticación, sesión y validaciones
├── 📁 models/           # Abstracción de datos, esquemas y consultas SQLite
├── 📁 public/           # Assets estáticos (estilos CSS, JS cliente, recursos gráficos)
├── 📁 routes/           # Enrutamiento modularizado de endpoints y vistas
├── 📁 seeders/          # Poblado automático de datos iniciales para pruebas
├── 📁 sql/              # DDL, tablas relacionales, vistas y scripts de SQLite
├── 📁 test/             # Suites de pruebas unitarias e integración
├── 📁 views/            # Plantillas de renderizado del lado del servidor (EJS/HTML)
├── 📄 .gitignore        # Reglas de exclusión para control de versiones Git
├── 📄 README.md         # Documentación técnica del proyecto
├── 📄 app.js            # Punto de entrada principal y bootstrap del servidor Express
├── 📄 nodemon.json      # Configuración de recarga automática en desarrollo
├── 📄 package-lock.json # Árbol de dependencias bloqueado
└── 📄 package.json      # Manifiesto del proyecto, scripts y dependencias Node
```

---

## ⚡ Características Destacadas

### 1. 🗺️ Rastreo Telemétrico y Mapas en Vivo
Visualización interactiva de patrulleros y refugios mediante Leaflet API. Permite la fijación de marcas de riesgo (grietas, zonas de avalancha) y monitoreo de patrullas activas.

### 2. 📡 Resiliencia Offline (Nieve / Sin Cobertura)
Integración de captura de coordenadas con `navigator.geolocation` y almacenamiento buffer en `localStorage`. Al recuperar la conexión celular, los tracks de ruta se sincronizan automáticamente con el servidor Node.js.

### 3. 🚨 Protocolo SOS y Detector de Inmovilidad
- **Botón Flotante SOS:** Envío directo de estado de alarma con prioridad máxima al panel de control central.
- **Sensor de Inactividad:** Algoritmo en cliente que detecta la falta de movimiento por más de 15 minutos en terreno descubierto, activando una señal pasiva de rescate.

### 4. 🩺 Control de Caducidad y Stock Médico
Alertas preventivas programadas en SQLite3 que notifican cuando medicamentos o insumos médicos se encuentran a menos de **30 días de su fecha de vencimiento**.

### 5. 📻 Telemetría de Radio bajo Cero
Seguimiento del porcentaje de batería de transceptores en ambientes de congelamiento. Disparo de alertas visuales animadas (`.battery-critical`) al caer por debajo del 25% de carga.

### 6. 🤖 Recomendador Inteligente (Clima + AI Engine)
Conexión con servicios de pronóstico meteorológico en tiempo real y consumo de API de Inteligencia Artificial para sugerir material extra (cuerdas de aristas, mantas térmicas, camillas adicionales) según las condiciones de viento y visibilidad.

---

## 🚀 Guía de Instalación y Despliegue

### Requisitos Previos
- **Node.js** v18.0.0 o superior
- **npm** v9.0.0 o superior
- **Git** configurado con credenciales de acceso al repositorio privado

### 1. Clonación del Repositorio
```bash
git clone git@github.com:leonardomahuida-hash/sledge.git
cd sledge
```

### 2. Instalación de Dependencias
```bash
npm install
```

### 3. Configuración de Variables de Entorno
Duplica el archivo `copia_env` a `.env` y ajusta los parámetros correspondientes:
```bash
cp copia_env .env
```
Contenido de referencia para `.env`:
```env
PORT=3000
NODE_ENV=development
DB_PATH=./config/sledge.sqlite
SESSION_SECRET=sledge_secure_session_token_2026
WEATHER_API_KEY=tu_api_key_meteorologica
AI_API_KEY=tu_api_key_ia
```

### 4. Inicialización de Base de Datos (SQLite3)
Para crear las tablas y sembrar datos de prueba ejecute:
```bash
npm run seed  # O ejecute los scripts ubicados en la carpeta /sql y /seeders
```

### 5. Iniciar la Aplicación

#### Modo Desarrollo (con autorrecarga):
```bash
npm run dev
```

#### Modo Producción:
```bash
npm start
```

Acceda a la aplicación desde su navegador en: `http://localhost:3000`

---

## 🔐 Licencia y Propiedad

Este software es propiedad exclusiva de sus creadores: **Leonardo Mahuida** y **Joel Lara**.
Todos los derechos reservados. Queda prohibido el uso, copia, modificación o distribución no autorizada sin el consentimiento explícito y por escrito del equipo desarrollador.

<div align="center">
  <sub>SLEDGE Rescue Logistics System — 2026</sub>
</div>

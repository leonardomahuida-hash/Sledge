🏔️ SLEDGE — Sistema de Logística de Equipos de Rescate y Geolocalización de Recursos

Nota de Privacidad: Este es un repositorio privado. El acceso, distribución o copia no autorizada del código fuente y documentación asociada está estrictamente prohibido.

SLEDGE es una plataforma web y móvil diseñada para controlar de forma centralizada todo el equipamiento de rescate utilizado en estaciones de esquí y zonas de montaña (camillas Akja, tablas espinales, radios y botiquines). Su objetivo principal es asegurar la operatividad al 100% de los insumos y optimizar los tiempos de respuesta ante situaciones de emergencia.

👥 Créditos y Equipo

Desarrolladores: Leonardo Mahuida y Joel Lara

Curso: 4MA

Profesor de Asignatura: Francisco Prieto

🚀 Características Principales

🗺️ Rastreo y Geolocalización GPS: Visualización en tiempo real de la ubicación de los patrulleros y casetas en mapas interactivos.

📡 Modo Offline: Almacenamiento local de rutas y datos en el dispositivo mediante localStorage para garantizar la continuidad operativa en zonas de montaña sin cobertura móvil.

⚠️ Sistema de Alertas SOS e Inmovilidad: Botón flotante de emergencia y disparo automático de alertas por falta de movimiento en terreno.

🩺 Control de Stock y Vencimientos Médicos: Auditoría de botiquines y emisión automática de alertas para insumos médicos próximos a caducar (30 días).

📻 Gestión de Radiocomunicaciones: Monitoreo de niveles de batería en condiciones bajo cero, asignación por turno y gestión de canales/frecuencias.

🤖 Recomendaciones Inteligentes (IA + Clima): Sugerencias automáticas de equipamiento preventivo según las condiciones meteorológicas en tiempo real.

📊 Reportes e Historial: Registro unificado de uso en emergencias, estadísticas dinámicas y exportación de informes técnicos en PDF.

🛠️ Arquitectura y Tecnologías

Backend (Python)

Programación Orientada a Objetos (POO): Clases base Equipamiento y subclases específicas (Radiocomunicacion, InsumoMedico, MedioTraslado).

Seguridad y Cifrado: Encriptación de contraseñas mediante algoritmos Hash (Bcrypt / SHA-256).

Generación de Reportes: Exportación dinámica de reportes en PDF (reportlab / fpdf).

Peticiones HTTP: Módulo requests y gestión de tokens/llaves mediante python-dotenv.

Base de Datos (MySQL)

Integridad Referencial: Esquema relacional con llaves foráneas y tabla intermedia ASIGNACION_RECURSO para el manejo de turnos.

Lógica Almacenada (Stored Procedures): Procedimiento sp_AlertarCaducidadInsumos para el control automático de caducidad.

Control de Concurrencia: Manejo de transacciones y bloqueos explícitos (FOR UPDATE) para evitar doble asignación de recursos.

Automatización: Uso de MySQL Event Scheduler para el cierre automático de turnos inactivos a las 18:00 hrs.

Vistas: vw_EquiposInoperativos para consultas rápidas de material en taller o descarte.

Frontend

Interfaz Dinámica: HTML5, CSS3 y JavaScript vanilla.

Visualización Geográfica: Integración de mapa interactivo con Leaflet.js / OpenStreetMap.

Gráficos Estadísticos: Chart.js sobre contenedores HTML5 <canvas>.

📋 Requisitos Previos

Antes de clonar e instalar este repositorio, asegúrate de contar con:

Python: versión 3.10 o superior.

MySQL Server: versión 8.0 o superior.

Git: configurado con acceso por clave SSH o Token Personal al repositorio privado.

🔧 Instalación y Configuración

Clonar el repositorio privado:

git clone git@github.com:tu-usuario-o-organizacion/sledge.git
cd sledge


Crear y activar un entorno virtual de Python:

# En Linux / macOS:
python3 -m venv venv
source venv/bin/activate

# En Windows:
python -m venv venv
venv\Scripts\activate


Instalar dependencias requeridas:

pip install -r requirements.txt


Configurar las variables de entorno:
Crea un archivo .env en la raíz del proyecto basándote en la plantilla:

DB_HOST=localhost
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_NAME=sledge_db
WEATHER_API_KEY=tu_api_key_clima
AI_API_KEY=tu_api_key_ia
SECRET_KEY=clave_secreta_sesion


Cargar la Base de Datos:
Importa el esquema relacional, vistas y procedimientos en MySQL:

mysql -u tu_usuario -p sledge_db < database/schema.sql


🚀 Ejecución del Sistema

Iniciar el servidor Backend:

python main.py

# 🚐 RedMINI — Sistema de Bienvenida Automática por WhatsApp

Sistema que escucha nuevas inscripciones en un **Google Form**, guarda el contacto en **Google Contacts** y envía un **mensaje de bienvenida automático por WhatsApp**, sin intervención humana.

---

## 🎯 Objetivo

Cuando alguien completa el formulario **"¿Quieres ser parte de la Red MINI?"**, el sistema:

1. Guarda (o actualiza) el contacto en Google Contacts con etiqueta de rol
2. Envía un mensaje de bienvenida personalizado por WhatsApp al instante
3. No requiere acción manual ni APIs de pago

---

## 🧱 Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      FLUJO COMPLETO                         │
│                                                             │
│  Google Form                                                │
│      │  (alguien completa el formulario)                   │
│      ▼                                                      │
│  Google Sheets  (hoja de respuestas vinculada)              │
│      │  (trigger: onFormSubmit)                             │
│      ▼                                                      │
│  Apps Script                                                │
│      ├──► Google People API  →  crea/actualiza contacto    │
│      │                                                      │
│      └──► HTTP POST ──────────────────────────────────┐    │
│                                                        │    │
│                          ┌─────────────────────────┐  │    │
│                          │  Servidor Node.js        │◄─┘    │
│                          │  (Express + Baileys)     │       │
│                          │  corriendo en tu PC/VPS  │       │
│                          └──────────┬──────────────-┘       │
│                                     │                       │
│                                     ▼                       │
│                          WhatsApp Web (WebSocket)           │
│                                     │                       │
│                                     ▼                       │
│                          📱 Mensaje al nuevo miembro ✅     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Estructura del proyecto

```
redmini-whatsapp/
├── src/
│   └── server.js            # Servidor Express + Baileys
├── auth_info_baileys/        # Sesión WhatsApp persistida (generada al escanear QR)
├── .env                      # Variables de entorno (no commitear)
├── .env.example              # Plantilla de variables
├── package.json
├── README.md
└── apps-script-codigo.gs     # Código a pegar en Google Apps Script
```

---

## 🛠 Stack técnico

| Capa                  | Tecnología                                 |
| --------------------- | ------------------------------------------ |
| Automatización Google | Google Apps Script                         |
| Contactos             | Google People API v1                       |
| Servidor HTTP         | Node.js 18+ + Express 4                    |
| WhatsApp              | Baileys 6.x (WebSocket, sin Chromium)      |
| Sesión persistente    | `useMultiFileAuthState` (archivos locales) |
| Seguridad             | Header `x-secret-key` compartido           |

---

## ⚙️ Variables de entorno

Archivo `.env` en la raíz del servidor:

```env
# Puerto del servidor HTTP
PORT=3000

# Clave secreta compartida con Apps Script
# Generá una con: openssl rand -hex 32
SECRET_KEY=reemplaza_con_clave_larga_y_aleatoria

# Prefijo de país por defecto si el número llega sin código
# Bolivia = 591 | Argentina = 54 | Uruguay = 598
DEFAULT_COUNTRY_CODE=591
```

> ⚠️ **Nunca commitear `.env`**. Está incluido en `.gitignore`.

---

## 🚀 Instalación y primer arranque

### Requisitos previos

- Node.js >= 18
- Un número de WhatsApp activo (puede ser personal o secundario)
- PC encendida o VPS con acceso HTTP desde internet

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables

```bash
cp .env.example .env
# Editá .env con tu SECRET_KEY y DEFAULT_COUNTRY_CODE
```

### 3. Iniciar el servidor

```bash
npm start
```

La primera vez aparece un **QR en la terminal**. Escanearlo desde WhatsApp:

> Menú ⋮ → Dispositivos vinculados → Vincular dispositivo

Una vez escaneado:

```
✅ WhatsApp conectado y listo para enviar mensajes
```

La sesión queda guardada en `auth_info_baileys/`. No es necesario volver a escanear salvo que se cierre sesión manualmente.

### 4. Mantener el servidor activo (producción)

```bash
npm install -g pm2
pm2 start src/server.js --name redmini-wa
pm2 startup   # arranque automático con el sistema
pm2 save
```

---

## 📡 API del servidor

Todos los endpoints requieren el header:

```
x-secret-key: <valor de SECRET_KEY en .env>
```

### `POST /enviar`

Envía un mensaje de WhatsApp al número indicado.

**Body:**

```json
{
  "telefono": "62154475",
  "nombre": "Juan Pérez",
  "interes": "comprador"
}
```

**Valores válidos para `interes`:** `comprador` | `chofer` | `usuario` | `miembro`

**Respuesta exitosa:**

```json
{ "ok": true, "jid": "59162154475@s.whatsapp.net" }
```

**Respuesta si WhatsApp no está conectado aún:**

```json
{ "ok": true, "status": "encolado", "jid": "59162154475@s.whatsapp.net" }
```

> El mensaje se envía automáticamente cuando se establece la conexión.

---

### `GET /status`

Devuelve el estado actual de la conexión.

**Respuesta:**

```json
{
  "connected": true,
  "pending": 0,
  "timestamp": "2026-03-17T14:30:00.000Z"
}
```

---

## 📋 Google Apps Script

### Configuración

En el archivo `apps-script-codigo.gs`, editá las dos constantes al inicio:

```javascript
const WA_SERVER_URL = "http://TU_IP_O_DOMINIO:3000";
const WA_SECRET_KEY = "la_misma_clave_que_en_.env";
```

### Funciones principales

| Función                           | Cuándo se ejecuta                                  |
| --------------------------------- | -------------------------------------------------- |
| `crearContactoDesdeFormulario(e)` | Automáticamente con cada respuesta nueva (trigger) |
| `importarTodosLosContactos()`     | Una sola vez, para importar respuestas anteriores  |
| `verificarServidorWhatsApp()`     | Manualmente, para diagnosticar la conexión         |

### Configurar el trigger

1. Apps Script → ícono ⏰ Activadores
2. **+ Añadir activador**
3. Función: `crearContactoDesdeFormulario` | Fuente: Hoja de cálculo | Evento: **Al enviar el formulario**

---

## 🗂 Campos del formulario y etiquetas

| Respuesta en el formulario              | Etiqueta en Contacts  | Clave para la API |
| --------------------------------------- | --------------------- | ----------------- |
| "Comprar un MIMI para hacerlo trabajar" | `RedMINI (comprador)` | `comprador`       |
| "Busco trabajo como Chofer"             | `RedMINI (chofer)`    | `chofer`          |
| "Disfrutar de las tarifas bajas"        | `RedMINI (usuario)`   | `usuario`         |
| Cualquier otra respuesta                | `RedMINI`             | `miembro`         |

### Formato del contacto en Google Contacts

```
Juan Pérez RedMINI (comprador)
Teléfono: +59162154475
```

---

## 🌐 Exponer el servidor en red local (desarrollo)

Si el servidor corre en tu PC, Apps Script (servidores de Google) no puede alcanzar `localhost`. Usá **ngrok**:

```bash
# Instalar: https://ngrok.com/download
ngrok http 3000
# → genera https://abc123.ngrok.io → usá esa URL en WA_SERVER_URL
```

Para producción: usá un VPS o configurá port forwarding en tu router.

---

## 🔄 Comportamiento ante fallos

| Situación                                  | Comportamiento                                     |
| ------------------------------------------ | -------------------------------------------------- |
| Servidor WhatsApp caído                    | Apps Script lo ignora, el contacto igual se guarda |
| WhatsApp desconectado al llegar un mensaje | El mensaje se encola y se envía al reconectar      |
| Número ya existe en Contacts               | Se actualiza en lugar de duplicarse                |
| Fila del formulario incompleta             | Se omite sin error                                 |
| Reconexión de WhatsApp                     | Automática (salvo `loggedOut`)                     |

---

## 🔒 Seguridad

- El header `x-secret-key` protege el endpoint de acceso no autorizado
- La sesión de WhatsApp se guarda localmente en `auth_info_baileys/` — no sale a ningún servicio externo
- Baileys usa WebSocket directo a los servidores de WhatsApp, sin pasar por Chromium ni servicios intermedios

> ⚠️ Este sistema usa la API no oficial de WhatsApp (ingeniería inversa del protocolo). Meta lo prohíbe en sus TyC. Para volúmenes bajos (bienvenidas puntuales) el riesgo de ban es mínimo. Para producción a escala, considerar migrar a **Meta Cloud API**.

---

## 🐛 Solución de problemas

**El QR no aparece o expira antes de escanearlo**

```bash
# Reiniciar el servidor
npm start
```

**"Sesión cerrada. Borrá la carpeta auth_info_baileys"**

```bash
rm -rf auth_info_baileys
npm start
# Escanear QR nuevamente
```

**Apps Script no llega al servidor**

- Verificar que el firewall permita el puerto configurado en `PORT`
- Usar ngrok si el servidor está en red local
- Ejecutar `verificarServidorWhatsApp()` desde Apps Script para diagnosticar

**El número no recibe el mensaje**

- Verificar que el número exista en WhatsApp
- Verificar que `DEFAULT_COUNTRY_CODE` esté configurado correctamente
- Revisar el Logger de Apps Script para ver la respuesta del servidor

---

## 📌 Decisiones de diseño

- **Baileys sobre Playwright/Puppeteer**: Baileys usa WebSocket puro sin navegador, consume ~50MB de RAM vs ~500MB de Chromium. Mucho más estable para un proceso long-running.
- **Cola en memoria**: Los mensajes que llegan antes de que WhatsApp conecte se encolan en `pendingMessages[]` y se procesan al conectar. No se usa Redis ni persistencia para mantener el setup simple.
- **`muteHttpExceptions: true` en Apps Script**: El fallo del servidor WhatsApp no interrumpe el guardado del contacto. Ambas operaciones son independientes.
- **Normalización de números**: La función `normalizarNumero()` limpia cualquier formato (con/sin código de país, guiones, espacios) antes de construir el JID de WhatsApp.

---

## 🗺 Roadmap

- [ ] Persistir la cola de mensajes pendientes en disco (ante reinicios del servidor)
- [ ] Panel web simple para ver el estado y el historial de mensajes enviados
- [ ] Soporte para múltiples idiomas en el mensaje de bienvenida
- [ ] Migración opcional a Meta Cloud API para producción a escala
- [ ] Webhook de confirmación de lectura (doble tilde azul)# 🚐 RedMINI — Sistema de Bienvenida Automática por WhatsApp

Sistema que escucha nuevas inscripciones en un **Google Form**, guarda el contacto en **Google Contacts** y envía un **mensaje de bienvenida automático por WhatsApp**, sin intervención humana.

---

## 🎯 Objetivo

Cuando alguien completa el formulario **"¿Quieres ser parte de la Red MINI?"**, el sistema:

1. Guarda (o actualiza) el contacto en Google Contacts con etiqueta de rol
2. Envía un mensaje de bienvenida personalizado por WhatsApp al instante
3. No requiere acción manual ni APIs de pago

---

## 🧱 Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      FLUJO COMPLETO                         │
│                                                             │
│  Google Form                                                │
│      │  (alguien completa el formulario)                   │
│      ▼                                                      │
│  Google Sheets  (hoja de respuestas vinculada)              │
│      │  (trigger: onFormSubmit)                             │
│      ▼                                                      │
│  Apps Script                                                │
│      ├──► Google People API  →  crea/actualiza contacto    │
│      │                                                      │
│      └──► HTTP POST ──────────────────────────────────┐    │
│                                                        │    │
│                          ┌─────────────────────────┐  │    │
│                          │  Servidor Node.js        │◄─┘    │
│                          │  (Express + Baileys)     │       │
│                          │  corriendo en tu PC/VPS  │       │
│                          └──────────┬──────────────-┘       │
│                                     │                       │
│                                     ▼                       │
│                          WhatsApp Web (WebSocket)           │
│                                     │                       │
│                                     ▼                       │
│                          📱 Mensaje al nuevo miembro ✅     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Estructura del proyecto

```
redmini-whatsapp/
├── src/
│   └── server.js            # Servidor Express + Baileys
├── auth_info_baileys/        # Sesión WhatsApp persistida (generada al escanear QR)
├── .env                      # Variables de entorno (no commitear)
├── .env.example              # Plantilla de variables
├── package.json
├── README.md
└── apps-script-codigo.gs     # Código a pegar en Google Apps Script
```

---

## 🛠 Stack técnico

| Capa                  | Tecnología                                 |
| --------------------- | ------------------------------------------ |
| Automatización Google | Google Apps Script                         |
| Contactos             | Google People API v1                       |
| Servidor HTTP         | Node.js 18+ + Express 4                    |
| WhatsApp              | Baileys 6.x (WebSocket, sin Chromium)      |
| Sesión persistente    | `useMultiFileAuthState` (archivos locales) |
| Seguridad             | Header `x-secret-key` compartido           |

---

## ⚙️ Variables de entorno

Archivo `.env` en la raíz del servidor:

```env
# Puerto del servidor HTTP
PORT=3000

# Clave secreta compartida con Apps Script
# Generá una con: openssl rand -hex 32
SECRET_KEY=reemplaza_con_clave_larga_y_aleatoria

# Prefijo de país por defecto si el número llega sin código
# Bolivia = 591 | Argentina = 54 | Uruguay = 598
DEFAULT_COUNTRY_CODE=591
```

> ⚠️ **Nunca commitear `.env`**. Está incluido en `.gitignore`.

---

## 🚀 Instalación y primer arranque

### Requisitos previos

- Node.js >= 18
- Un número de WhatsApp activo (puede ser personal o secundario)
- PC encendida o VPS con acceso HTTP desde internet

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables

```bash
cp .env.example .env
# Editá .env con tu SECRET_KEY y DEFAULT_COUNTRY_CODE
```

### 3. Iniciar el servidor

```bash
npm start
```

La primera vez aparece un **QR en la terminal**. Escanearlo desde WhatsApp:

> Menú ⋮ → Dispositivos vinculados → Vincular dispositivo

Una vez escaneado:

```
✅ WhatsApp conectado y listo para enviar mensajes
```

La sesión queda guardada en `auth_info_baileys/`. No es necesario volver a escanear salvo que se cierre sesión manualmente.

### 4. Mantener el servidor activo (producción)

```bash
npm install -g pm2
pm2 start src/server.js --name redmini-wa
pm2 startup   # arranque automático con el sistema
pm2 save
```

---

## 📡 API del servidor

Todos los endpoints requieren el header:

```
x-secret-key: <valor de SECRET_KEY en .env>
```

### `POST /enviar`

Envía un mensaje de WhatsApp al número indicado.

**Body:**

```json
{
  "telefono": "62154475",
  "nombre": "Juan Pérez",
  "interes": "comprador"
}
```

**Valores válidos para `interes`:** `comprador` | `chofer` | `usuario` | `miembro`

**Respuesta exitosa:**

```json
{ "ok": true, "jid": "59162154475@s.whatsapp.net" }
```

**Respuesta si WhatsApp no está conectado aún:**

```json
{ "ok": true, "status": "encolado", "jid": "59162154475@s.whatsapp.net" }
```

> El mensaje se envía automáticamente cuando se establece la conexión.

---

### `GET /status`

Devuelve el estado actual de la conexión.

**Respuesta:**

```json
{
  "connected": true,
  "pending": 0,
  "timestamp": "2026-03-17T14:30:00.000Z"
}
```

---

## 📋 Google Apps Script

### Configuración

En el archivo `apps-script-codigo.gs`, editá las dos constantes al inicio:

```javascript
const WA_SERVER_URL = "http://TU_IP_O_DOMINIO:3000";
const WA_SECRET_KEY = "la_misma_clave_que_en_.env";
```

### Funciones principales

| Función                           | Cuándo se ejecuta                                  |
| --------------------------------- | -------------------------------------------------- |
| `crearContactoDesdeFormulario(e)` | Automáticamente con cada respuesta nueva (trigger) |
| `importarTodosLosContactos()`     | Una sola vez, para importar respuestas anteriores  |
| `verificarServidorWhatsApp()`     | Manualmente, para diagnosticar la conexión         |

### Configurar el trigger

1. Apps Script → ícono ⏰ Activadores
2. **+ Añadir activador**
3. Función: `crearContactoDesdeFormulario` | Fuente: Hoja de cálculo | Evento: **Al enviar el formulario**

---

## 🗂 Campos del formulario y etiquetas

| Respuesta en el formulario              | Etiqueta en Contacts  | Clave para la API |
| --------------------------------------- | --------------------- | ----------------- |
| "Comprar un MIMI para hacerlo trabajar" | `RedMINI (comprador)` | `comprador`       |
| "Busco trabajo como Chofer"             | `RedMINI (chofer)`    | `chofer`          |
| "Disfrutar de las tarifas bajas"        | `RedMINI (usuario)`   | `usuario`         |
| Cualquier otra respuesta                | `RedMINI`             | `miembro`         |

### Formato del contacto en Google Contacts

```
Juan Pérez RedMINI (comprador)
Teléfono: +59162154475
```

---

## 🌐 Exponer el servidor en red local (desarrollo)

Si el servidor corre en tu PC, Apps Script (servidores de Google) no puede alcanzar `localhost`. Usá **ngrok**:

```bash
# Instalar: https://ngrok.com/download
ngrok http 3000
# → genera https://abc123.ngrok.io → usá esa URL en WA_SERVER_URL
```

Para producción: usá un VPS o configurá port forwarding en tu router.

---

## 🔄 Comportamiento ante fallos

| Situación                                  | Comportamiento                                     |
| ------------------------------------------ | -------------------------------------------------- |
| Servidor WhatsApp caído                    | Apps Script lo ignora, el contacto igual se guarda |
| WhatsApp desconectado al llegar un mensaje | El mensaje se encola y se envía al reconectar      |
| Número ya existe en Contacts               | Se actualiza en lugar de duplicarse                |
| Fila del formulario incompleta             | Se omite sin error                                 |
| Reconexión de WhatsApp                     | Automática (salvo `loggedOut`)                     |

---

## 🔒 Seguridad

- El header `x-secret-key` protege el endpoint de acceso no autorizado
- La sesión de WhatsApp se guarda localmente en `auth_info_baileys/` — no sale a ningún servicio externo
- Baileys usa WebSocket directo a los servidores de WhatsApp, sin pasar por Chromium ni servicios intermedios

> ⚠️ Este sistema usa la API no oficial de WhatsApp (ingeniería inversa del protocolo). Meta lo prohíbe en sus TyC. Para volúmenes bajos (bienvenidas puntuales) el riesgo de ban es mínimo. Para producción a escala, considerar migrar a **Meta Cloud API**.

---

## 🐛 Solución de problemas

**El QR no aparece o expira antes de escanearlo**

```bash
# Reiniciar el servidor
npm start
```

**"Sesión cerrada. Borrá la carpeta auth_info_baileys"**

```bash
rm -rf auth_info_baileys
npm start
# Escanear QR nuevamente
```

**Apps Script no llega al servidor**

- Verificar que el firewall permita el puerto configurado en `PORT`
- Usar ngrok si el servidor está en red local
- Ejecutar `verificarServidorWhatsApp()` desde Apps Script para diagnosticar

**El número no recibe el mensaje**

- Verificar que el número exista en WhatsApp
- Verificar que `DEFAULT_COUNTRY_CODE` esté configurado correctamente
- Revisar el Logger de Apps Script para ver la respuesta del servidor

---

## 📌 Decisiones de diseño

- **Baileys sobre Playwright/Puppeteer**: Baileys usa WebSocket puro sin navegador, consume ~50MB de RAM vs ~500MB de Chromium. Mucho más estable para un proceso long-running.
- **Cola en memoria**: Los mensajes que llegan antes de que WhatsApp conecte se encolan en `pendingMessages[]` y se procesan al conectar. No se usa Redis ni persistencia para mantener el setup simple.
- **`muteHttpExceptions: true` en Apps Script**: El fallo del servidor WhatsApp no interrumpe el guardado del contacto. Ambas operaciones son independientes.
- **Normalización de números**: La función `normalizarNumero()` limpia cualquier formato (con/sin código de país, guiones, espacios) antes de construir el JID de WhatsApp.

---

## 🗺 Roadmap

- [ ] Persistir la cola de mensajes pendientes en disco (ante reinicios del servidor)
- [ ] Panel web simple para ver el estado y el historial de mensajes enviados
- [ ] Soporte para múltiples idiomas en el mensaje de bienvenida
- [ ] Migración opcional a Meta Cloud API para producción a escala
- [ ] Webhook de confirmación de lectura (doble tilde azul)

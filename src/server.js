import express from "express";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import "dotenv/config";

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT        = process.env.PORT        || 3000;
const SECRET_KEY  = process.env.SECRET_KEY  || "clave_no_configurada";
const DEFAULT_CC  = process.env.DEFAULT_COUNTRY_CODE || "591";
const AUTH_FOLDER = "./auth_info_baileys";

// Logger silencioso para Baileys (evita spam en consola)
const silentLogger = pino({ level: "silent" });

// ─── Estado global ────────────────────────────────────────────────────────────
let sock = null;           // instancia de Baileys
let isReady = false;       // true cuando WhatsApp está conectado
const pendingMessages = []; // cola de mensajes si llegan antes de conectarse

// ─── Inicializar WhatsApp ─────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    logger: silentLogger,
    printQRInTerminal: false, // lo manejamos nosotros
    browser: ["RedMINI Server", "Chrome", "1.0.0"],
  });

  // ── QR para escanear ──
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n╔══════════════════════════════════════╗");
      console.log("║   Escaneá este QR con WhatsApp        ║");
      console.log("╚══════════════════════════════════════╝\n");
      qrcode.generate(qr, { small: true });
      console.log("\n⏳ Esperando escaneo...\n");
    }

    if (connection === "close") {
      isReady = false;
      const shouldReconnect =
        new Boom(lastDisconnect?.error)?.output?.statusCode !==
        DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("🔄 Reconectando...");
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log("🚪 Sesión cerrada. Borrá la carpeta auth_info_baileys y reiniciá.");
      }
    }

    if (connection === "open") {
      isReady = true;
      console.log("✅ WhatsApp conectado y listo para enviar mensajes\n");

      // Enviar mensajes que llegaron mientras se conectaba
      while (pendingMessages.length > 0) {
        const { jid, text } = pendingMessages.shift();
        await enviarMensaje(jid, text);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// ─── Función central de envío ─────────────────────────────────────────────────
async function enviarMensaje(jid, texto) {
  try {
    await sock.sendMessage(jid, { text: texto });
    console.log(`📤 Enviado a ${jid}`);
    return { ok: true };
  } catch (err) {
    console.error(`❌ Error enviando a ${jid}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Normalizar número de teléfono ───────────────────────────────────────────
// Convierte "62154475", "591-621-54475", "+59162154475" → "59162154475@s.whatsapp.net"
function normalizarNumero(raw) {
  let num = raw.toString().replace(/\D/g, ""); // solo dígitos

  // Si no tiene código de país, agregar el default
  if (num.length <= 9) {
    num = DEFAULT_CC + num;
  }

  return num + "@s.whatsapp.net";
}

// ─── Servidor HTTP (Express) ──────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Middleware de autenticación por header
app.use((req, res, next) => {
  const key = req.headers["x-secret-key"];
  if (key !== SECRET_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
});

// ── POST /enviar ──────────────────────────────────────────────────────────────
// Body: { "telefono": "62154475", "nombre": "Juan", "interes": "comprador" }
app.post("/enviar", async (req, res) => {
  const { telefono, nombre, interes } = req.body;

  if (!telefono || !nombre) {
    return res.status(400).json({ error: "Faltan campos: telefono y nombre son obligatorios" });
  }

  const jid     = normalizarNumero(telefono);
  const mensaje = construirMensajeBienvenida(nombre, interes);

  if (!isReady) {
    // Encolar para cuando se conecte
    pendingMessages.push({ jid, text: mensaje });
    console.log(`⏳ WhatsApp no listo, mensaje encolado para ${jid}`);
    return res.json({ ok: true, status: "encolado", jid });
  }

  const resultado = await enviarMensaje(jid, mensaje);
  return res.json({ ...resultado, jid });
});

// ── GET /status ───────────────────────────────────────────────────────────────
app.get("/status", (req, res) => {
  res.json({
    connected: isReady,
    pending:   pendingMessages.length,
    timestamp: new Date().toISOString(),
  });
});

// ─── Mensaje de bienvenida ────────────────────────────────────────────────────
function construirMensajeBienvenida(nombre, interes) {
  const etiquetas = {
    comprador: "🛒 Comprador",
    chofer:    "🚗 Chofer",
    usuario:   "🎫 Usuario con tarifas bajas",
  };

  const perfil = etiquetas[interes?.toLowerCase()] || "🌟 Miembro";

  return (
    `¡Hola ${nombre}! 👋\n\n` +
    `Bienvenido/a a la *Red MINI* 🚐\n\n` +
    `Tu perfil: *${perfil}*\n\n` +
    `En breve un miembro del equipo se pondrá en contacto con vos para darte más información.\n\n` +
    `¡Gracias por sumarte! 🙌`
  );
}

// ─── Arrancar todo ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor RedMINI escuchando en http://localhost:${PORT}`);
  console.log(`🔑 Autenticación: header x-secret-key requerido\n`);
});

connectToWhatsApp();

import express from "express";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from "baileys";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import pino from "pino";
import "dotenv/config";

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "clave_no_configurada";
const DEFAULT_CC = process.env.DEFAULT_COUNTRY_CODE || "591";
const AUTH_FOLDER = "./auth_info_baileys";

const silentLogger = pino({ level: "silent" });

// ─── Estado global ────────────────────────────────────────────────────────────
let sock = null;
let isReady = false;
let currentQR = null;
const pendingMessages = [];

// ─── Inicializar WhatsApp ─────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    logger: silentLogger,
    printQRInTerminal: false,
    browser: ["RedMINI Server", "Chrome", "1.0.0"],
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      qrcode.generate(qr, { small: true });
      console.log("📱 QR listo — abrí /qr en el navegador para escanearlo");
    }

    if (connection === "close") {
      isReady = false;
      currentQR = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("🔄 Reconectando...");
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log("🚪 Sesión cerrada. Borrá auth_info_baileys y reiniciá.");
      }
    }

    if (connection === "open") {
      isReady = true;
      currentQR = null;
      console.log("✅ WhatsApp conectado y listo\n");

      while (pendingMessages.length > 0) {
        const { jid, text } = pendingMessages.shift();
        await enviarMensaje(jid, text);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

// ─── Envío ────────────────────────────────────────────────────────────────────
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

// ─── Normalizar número ───────────────────────────────────────────────────────
function normalizarNumero(raw) {
  let num = raw.toString().replace(/\D/g, "");
  if (num.length <= 9) num = DEFAULT_CC + num;
  return num + "@s.whatsapp.net";
}

// ─── Mensaje de bienvenida ────────────────────────────────────────────────────
function construirMensajeBienvenida(nombre, interes) {
  const etiquetas = {
    comprador: "🛒 Comprador",
    chofer: "🚗 Chofer",
    usuario: "🎫 Usuario con tarifas bajas",
  };
  const perfil = etiquetas[interes?.toLowerCase()] || "🌟 Miembro";

  return (
    `¡Hola ${nombre}! 👋\n\n` +
    `Bienvenido/a a la *Red MINI* 🚐\n\n` +
    `Tu perfil: *${perfil}*\n\n` +
    `En breve un miembro del equipo se pondrá en contacto con vos.\n\n` +
    `¡Gracias por sumarte! 🙌`
  );
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// /qr y /status son públicos — el resto requiere x-secret-key
app.use((req, res, next) => {
  if (["/qr", "/status"].includes(req.path)) return next();
  if (req.headers["x-secret-key"] !== SECRET_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
});

// ── GET /qr ───────────────────────────────────────────────────────────────────
app.get("/qr", async (req, res) => {
  if (isReady) {
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>✅ WhatsApp ya está conectado</h2>
        <p>No necesitás escanear nada.</p>
      </body></html>
    `);
  }

  if (!currentQR) {
    return res.send(`
      <html>
        <head><meta http-equiv="refresh" content="3"></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px">
          <h2>⏳ Generando QR...</h2>
          <p>Esta página se actualiza sola cada 3 segundos.</p>
        </body>
      </html>
    `);
  }

  try {
    const qrImageUrl = await QRCode.toDataURL(currentQR, { width: 400 });
    res.send(`
      <html>
        <head><meta http-equiv="refresh" content="25"></head>
        <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5">
          <h2>📱 Escaneá este QR con WhatsApp</h2>
          <p style="color:#555">
            WhatsApp → ⋮ → <b>Dispositivos vinculados</b> → Vincular dispositivo
          </p>
          <img
            src="${qrImageUrl}"
            style="border:8px solid white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15)"
          />
          <p style="color:#999;font-size:13px;margin-top:16px">
            El QR expira en ~60s. La página se refresca automáticamente cada 25 segundos.
          </p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Error generando QR: " + err.message);
  }
});

// ── GET /status ───────────────────────────────────────────────────────────────
app.get("/status", (req, res) => {
  res.json({
    connected: isReady,
    qr_available: !!currentQR,
    pending: pendingMessages.length,
    timestamp: new Date().toISOString(),
  });
});

// ── POST /enviar ──────────────────────────────────────────────────────────────
app.post("/enviar", async (req, res) => {
  const { telefono, nombre, interes } = req.body;
  if (!telefono || !nombre) {
    return res.status(400).json({ error: "Faltan campos: telefono y nombre" });
  }

  const jid = normalizarNumero(telefono);
  const mensaje = construirMensajeBienvenida(nombre, interes);

  if (!isReady) {
    pendingMessages.push({ jid, text: mensaje });
    return res.json({ ok: true, status: "encolado", jid });
  }

  const resultado = await enviarMensaje(jid, mensaje);
  return res.json({ ...resultado, jid });
});

// ─── Arrancar ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor RedMINI en puerto ${PORT}`);
  console.log(`📱 Para vincular WhatsApp abrí: <TU_URL>/qr`);
});

connectToWhatsApp();

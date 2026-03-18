// ═══════════════════════════════════════════════════════════════════════════
//  Red MINI — Apps Script completo
//  Google Forms → Google Contacts + Bienvenida WhatsApp automática
// ═══════════════════════════════════════════════════════════════════════════

// ── Configuración de columnas ─────────────────────────────────────────────
const COL_NOMBRE   = 2;  // Nombre Completo
const COL_EXTRA    = 3;  // ¿Cuál es tu interés?
const COL_TELEFONO = 4;  // Número de teléfono/Whatsapp

// ── Configuración del servidor WhatsApp ──────────────────────────────────
// Cambiá estos valores con los de tu servidor
const WA_SERVER_URL = "http://TU_IP_O_DOMINIO:3000";  // ej: http://192.168.1.50:3000
const WA_SECRET_KEY = "cambia_esta_clave_por_una_segura_123456"; // igual que en .env

// ── Convierte la respuesta en etiqueta corta ──────────────────────────────
function obtenerEtiqueta(interes) {
  if (!interes) return "RedMINI";
  if (interes.includes("Comprar"))  return "RedMINI (comprador)";
  if (interes.includes("Chofer"))   return "RedMINI (chofer)";
  if (interes.includes("tarifas"))  return "RedMINI (usuario)";
  return "RedMINI";
}

// ── Convierte interés en clave simple para el servidor ────────────────────
function obtenerClaveInteres(interes) {
  if (!interes) return "miembro";
  if (interes.includes("Comprar"))  return "comprador";
  if (interes.includes("Chofer"))   return "chofer";
  if (interes.includes("tarifas"))  return "usuario";
  return "miembro";
}

// ── Valida que la fila tenga los 3 datos obligatorios ────────────────────
function filaValida(nombre, extra, telefono) {
  if (!nombre   || nombre.toString().trim()   === "") return false;
  if (!extra    || extra.toString().trim()    === "") return false;
  if (!telefono || telefono.toString().trim() === "") return false;
  return true;
}

// ── Busca si ya existe un contacto con ese teléfono ──────────────────────
function buscarContactoPorTelefono(telefono) {
  const tel = telefono.toString().trim();

  const resultado = People.People.searchContacts({
    query: tel,
    readMask: "names,phoneNumbers"
  });

  if (!resultado.results) return null;

  for (const r of resultado.results) {
    const phones = r.person.phoneNumbers || [];
    for (const p of phones) {
      if (p.value.replace(/\D/g, "") === tel.replace(/\D/g, "")) {
        return r.person;
      }
    }
  }
  return null;
}

// ── Crea un contacto nuevo ────────────────────────────────────────────────
function crearContacto(nombre, telefono) {
  const recurso = {
    names: [{ givenName: nombre }],
    phoneNumbers: [{ value: telefono.toString().trim(), type: "mobile" }]
  };
  People.People.createContact(recurso);
}

// ── Actualiza un contacto existente ──────────────────────────────────────
function actualizarContacto(persona, nombre, telefono) {
  const recurso = {
    etag: persona.etag,
    names: [{ givenName: nombre }],
    phoneNumbers: [{ value: telefono.toString().trim(), type: "mobile" }]
  };
  People.People.updateContact(recurso, persona.resourceName, {
    updatePersonFields: "names,phoneNumbers"
  });
}

// ── Crea o actualiza según si ya existe ──────────────────────────────────
function crearOActualizarContacto(nombre, extra, telefono) {
  const nombreContacto = nombre.toString().trim() + " " + obtenerEtiqueta(extra.toString().trim());
  const tel = telefono.toString().trim();

  const existente = buscarContactoPorTelefono(tel);

  if (existente) {
    actualizarContacto(existente, nombreContacto, tel);
    return "actualizado";
  } else {
    crearContacto(nombreContacto, tel);
    return "creado";
  }
}

// ── Envía mensaje de bienvenida vía servidor WhatsApp ─────────────────────
function enviarBienvenidaWhatsApp(nombre, telefono, interes) {
  try {
    const payload = JSON.stringify({
      telefono: telefono.toString().trim(),
      nombre:   nombre.toString().trim(),
      interes:  obtenerClaveInteres(interes)
    });

    const opciones = {
      method:  "POST",
      contentType: "application/json",
      headers: { "x-secret-key": WA_SECRET_KEY },
      payload: payload,
      muteHttpExceptions: true  // no rompe el script si el servidor está caído
    };

    const respuesta = UrlFetchApp.fetch(WA_SERVER_URL + "/enviar", opciones);
    const codigo    = respuesta.getResponseCode();
    const cuerpo    = respuesta.getContentText();

    if (codigo === 200) {
      Logger.log("✅ WhatsApp enviado a " + telefono + " | Respuesta: " + cuerpo);
    } else {
      Logger.log("⚠️ Error WhatsApp (" + codigo + "): " + cuerpo);
    }
  } catch (err) {
    // Si el servidor no está disponible, solo loguea y continúa
    // NO interrumpe el guardado del contacto
    Logger.log("❌ Servidor WhatsApp no disponible: " + err.message);
  }
}

// ── Verifica si el servidor WhatsApp está online ──────────────────────────
function verificarServidorWhatsApp() {
  try {
    const respuesta = UrlFetchApp.fetch(WA_SERVER_URL + "/status", {
      headers: { "x-secret-key": WA_SECRET_KEY },
      muteHttpExceptions: true
    });
    const datos = JSON.parse(respuesta.getContentText());
    SpreadsheetApp.getUi().alert(
      "Estado del servidor WhatsApp:\n" +
      "• Conectado: " + (datos.connected ? "✅ Sí" : "❌ No") + "\n" +
      "• Mensajes pendientes: " + datos.pending + "\n" +
      "• Timestamp: " + datos.timestamp
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert("❌ No se pudo conectar al servidor: " + err.message);
  }
}

// ── Se ejecuta automáticamente con cada nueva respuesta del formulario ────
function crearContactoDesdeFormulario(e) {
  const fila     = e.values;
  const nombre   = fila[COL_NOMBRE - 1]   || "";
  const extra    = fila[COL_EXTRA - 1]    || "";
  const telefono = fila[COL_TELEFONO - 1] || "";

  if (!filaValida(nombre, extra, telefono)) return;

  // 1. Guardar/actualizar contacto en Google Contacts
  crearOActualizarContacto(nombre, extra, telefono);

  // 2. Enviar bienvenida por WhatsApp
  enviarBienvenidaWhatsApp(nombre, telefono, extra);
}

// ── Importar todos los existentes — ejecutar UNA SOLA VEZ ────────────────
function importarTodosLosContactos() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const datos = sheet.getDataRange().getValues();

  let creados      = 0;
  let actualizados = 0;
  let omitidos     = 0;

  for (let i = 1; i < datos.length; i++) {
    const nombre   = datos[i][COL_NOMBRE - 1];
    const extra    = datos[i][COL_EXTRA - 1];
    const telefono = datos[i][COL_TELEFONO - 1];

    if (!filaValida(nombre, extra, telefono)) {
      omitidos++;
      continue;
    }

    try {
      const resultado = crearOActualizarContacto(nombre, extra, telefono);
      if (resultado === "creado")      creados++;
      if (resultado === "actualizado") actualizados++;
    } catch (err) {
      Logger.log("Error en fila " + (i + 1) + ": " + err);
      omitidos++;
    }
  }

  SpreadsheetApp.getUi().alert(
    "✅ Proceso completado:\n" +
    "• Creados: "      + creados      + "\n" +
    "• Actualizados: " + actualizados + "\n" +
    "• Omitidos: "     + omitidos     + " (sin datos completos)"
  );
}

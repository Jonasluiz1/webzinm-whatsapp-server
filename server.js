const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET;

const sessions = new Map();
const qrCodes = new Map();
const status = new Map();

function safeId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function createSession(restauranteId) {
  const id = safeId(restauranteId);

  if (!id) throw new Error("restauranteId inválido");
  if (sessions.has(id)) return sessions.get(id);

  status.set(id, "iniciando");

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: id,
      dataPath: "./sessions"
    }),
    puppeteer: {
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    }
  });

  client.on("qr", async (qr) => {
    qrCodes.set(id, await QRCode.toDataURL(qr));
    status.set(id, "aguardando_qr");
  });

  client.on("authenticated", () => {
    status.set(id, "autenticado");
  });

  client.on("ready", () => {
    qrCodes.delete(id);
    status.set(id, "conectado");
    console.log(`[${id}] WhatsApp conectado`);
  });

  client.on("disconnected", () => {
    status.set(id, "desconectado");
  });

  client.initialize();

  sessions.set(id, client);
  return client;
}

function protect(req, res, next) {
  if (!API_SECRET) {
    return res.status(500).json({ error: "API_SECRET não configurado" });
  }

  if (req.headers["x-api-key"] !== API_SECRET) {
    return res.status(401).json({ error: "Não autorizado" });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    service: "WEBZINM WhatsApp Server",
    online: true
  });
});

app.post("/session/:id/start", protect, (req, res) => {
  try {
    const id = safeId(req.params.id);
    createSession(id);

    res.json({
      success: true,
      restauranteId: id,
      status: status.get(id)
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/session/:id/status", protect, (req, res) => {
  const id = safeId(req.params.id);

  res.json({
    restauranteId: id,
    status: status.get(id) || "nao_iniciado"
  });
});

app.get("/session/:id/qr", protect, (req, res) => {
  const id = safeId(req.params.id);
  const qr = qrCodes.get(id);

  if (!qr) {
    return res.status(404).json({
      error: "QR Code ainda não disponível ou WhatsApp já conectado"
    });
  }

  res.json({ qr });
});

app.post("/send", protect, async (req, res) => {
  try {
    const { restauranteId, telefone, mensagem } = req.body;

    const id = safeId(restauranteId);
    const client = sessions.get(id);

    if (!client || status.get(id) !== "conectado") {
      return res.status(409).json({
        error: "WhatsApp do restaurante não está conectado"
      });
    }

    if (!telefone || !mensagem) {
      return res.status(400).json({
        error: "telefone e mensagem são obrigatórios"
      });
    }

    const numero = String(telefone).replace(/\D/g, "");
    const chatId = `${numero}@c.us`;

    await client.sendMessage(chatId, String(mensagem));

    res.json({
      success: true,
      restauranteId: id
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WEBZINM WhatsApp Server rodando na porta ${PORT}`);
});

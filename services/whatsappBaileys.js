import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import pino from "pino";

let sock = null;

export const startWhatsApp = async () => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    sock = makeWASocket({
      auth: state,

      // 🔥 LOG MINIMAL (important pour Render)
      logger: pino({ level: "silent" }),

      // 🚀 OPTIMISATION IMPORTANTE
      syncFullHistory: false,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 0,

      // 🔥 empêche sync messages lourds
      shouldSyncHistoryMessage: () => false,
    });

    // 💾 sauvegarde session
    sock.ev.on("creds.update", saveCreds);

    // 📡 connexion / reconnexion
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log("❌ WhatsApp déconnecté.");

        if (shouldReconnect) {
          console.log("🔁 Reconnexion...");
          startWhatsApp();
        } else {
          console.log("🚫 Session expirée. Re-scan requis.");
        }
      }

      if (connection === "open") {
        console.log("✅ WhatsApp connecté !");
      }
    });

    // 📩 réception messages
    sock.ev.on("messages.upsert", async ({ messages }) => {
      const msg = messages[0];

      if (!msg.message) return;

      console.log("📩 Nouveau message reçu");
    });

  } catch (error) {
    console.error("❌ Erreur WhatsApp:", error.message);

    // 🔁 retry automatique
    setTimeout(() => {
      startWhatsApp();
    }, 5000);
  }
};

// 📤 envoyer message
export const sendMessage = async (to, message) => {
  if (!sock) throw new Error("WhatsApp non connecté");

  return await sock.sendMessage(to, { text: message });
};

// 📊 status
export const getStatus = () => {
  return {
    connected: !!sock
  };
};
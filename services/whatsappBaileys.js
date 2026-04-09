// services/whatsappBaileys.js
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import pino from "pino";
import { unlinkSync, existsSync } from "fs";
import path from "path";

// ============================================================
// 🔥 VARIABLES GLOBALES
// ============================================================
let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let connectionStatus = {
  connected: false,
  user: null,
  retryCount: 0
};

// ============================================================
// 📊 GETTERS
// ============================================================
export const getConnectionStatus = () => ({ ...connectionStatus });

export const getReconnectAttempts = () => reconnectAttempts;

export const resetReconnectAttempts = () => {
  reconnectAttempts = 0;
};

// ============================================================
// 👥 RÉCUPÉRER LES GROUPES WHATSAPP
// ============================================================
export const getGroups = async () => {
  try {
    if (!sock) {
      console.log("⚠️ WhatsApp non connecté, impossible de récupérer les groupes");
      return [];
    }

    if (!connectionStatus.connected) {
      console.log("⚠️ WhatsApp déconnecté, impossible de récupérer les groupes");
      return [];
    }

    // Récupérer tous les groupes
    const groups = await sock.groupFetchAllParticipating();
    
    // Transformer en tableau
    const groupList = Object.values(groups).map(g => ({
      id: g.id,
      subject: g.subject,
      name: g.subject,
      participants: g.participants || [],
      participantCount: g.participants?.length || 0,
      description: g.desc || '',
      owner: g.owner
    }));

    console.log(`📋 ${groupList.length} groupes WhatsApp récupérés`);
    return groupList;
  } catch (error) {
    console.error("❌ Erreur getGroups:", error.message);
    return [];
  }
};

// ============================================================
// 🚀 INIT WHATSAPP
// ============================================================
export const initWhatsApp = async (onQR, onConnected, onInvalidSession) => {
  try {
    // Vérifier version Baileys
    const { version } = await fetchLatestBaileysVersion();
    console.log(`📦 Baileys version: ${version}`);

    // Auth state
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    // Créer socket
    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
      },
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["AIFASA17", "Chrome", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
    });

    // ============================================================
    // 📡 ÉVÉNEMENTS
    // ============================================================
    
    // Sauvegarde credentials
    sock.ev.on("creds.update", saveCreds);

    // Connexion
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // 📱 QR Code
      if (qr && onQR) {
        onQR(qr);
      }

      // ✅ Connecté
      if (connection === "open") {
        reconnectAttempts = 0;
        connectionStatus.connected = true;
        connectionStatus.user = {
          name: sock.user?.name || "WhatsApp User",
          jid: sock.user?.id?.split(":")[0] + "@s.whatsapp.net"
        };
        
        console.log("✅ WhatsApp connecté !");
        if (onConnected) onConnected();
      }

      // ❌ Déconnecté
      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        
        connectionStatus.connected = false;
        connectionStatus.user = null;

        console.log(`❌ WhatsApp déconnecté (raison: ${statusCode})`);

        // Session invalide
        if (isLoggedOut) {
          console.log("🚫 Session expirée - reset auth requis");
          if (onInvalidSession) await onInvalidSession();
          return;
        }

        // Reconnexion automatique
        reconnectAttempts++;
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          console.log(`🔁 Reconnexion dans ${delay/1000}s (tentative ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          
          setTimeout(() => {
            initWhatsApp(onQR, onConnected, onInvalidSession).catch(console.error);
          }, delay);
        } else {
          console.error("❌ Max tentatives atteint - arrêt");
        }
      }
    });

    // 📩 Messages reçus
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      
      const msg = messages[0];
      if (!msg.message) return;

      console.log(`📩 Message reçu de ${msg.key.remoteJid}`);
    });

    return { success: true };

  } catch (error) {
    console.error("❌ Erreur init WhatsApp:", error.message);
    return { success: false, error: error.message };
  }
};

// ============================================================
// 📤 ENVOI MESSAGE
// ============================================================
export const sendMessage = async (to, message) => {
  try {
    if (!sock) {
      throw new Error("WhatsApp non connecté");
    }

    if (!connectionStatus.connected) {
      throw new Error("WhatsApp déconnecté");
    }

    // Formater le numéro
    let jid = to;
    if (!to.includes("@")) {
      jid = to.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
    }

    // Envoyer
    const result = await sock.sendMessage(jid, { 
      text: message 
    });

    return {
      success: true,
      messageId: result?.key?.id
    };

  } catch (error) {
    console.error("❌ Erreur envoi message:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

// ============================================================
// 👥 ENVOI GROUPE
// ============================================================
export const sendToGroup = async (groupId, message) => {
  try {
    if (!sock) {
      throw new Error("WhatsApp non connecté");
    }

    let jid = groupId;
    if (!groupId.includes("@")) {
      jid = groupId + "@g.us";
    }

    await sock.sendMessage(jid, { text: message });

    return { success: true };

  } catch (error) {
    console.error("❌ Erreur envoi groupe:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

// ============================================================
// 🔌 DISCONNECT
// ============================================================
export const disconnect = async () => {
  try {
    if (sock) {
      await sock.end();
      sock = null;
    }
    
    connectionStatus.connected = false;
    connectionStatus.user = null;
    
    console.log("🔌 WhatsApp déconnecté manuellement");
    return { success: true };
    
  } catch (error) {
    console.error("❌ Erreur disconnect:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

// ============================================================
// 🔄 RESET AUTH
// ============================================================
export const resetAuth = async () => {
  try {
    // Déconnecter d'abord
    if (sock) {
      await sock.end();
      sock = null;
    }

    // Supprimer fichiers auth
    const authPath = path.join(process.cwd(), "auth");
    if (existsSync(authPath)) {
      const credsPath = path.join(authPath, "creds.json");
      if (existsSync(credsPath)) {
        unlinkSync(credsPath);
        console.log("🗑️ Credentials supprimés");
      }
    }

    connectionStatus.connected = false;
    connectionStatus.user = null;
    reconnectAttempts = 0;

    console.log("🔄 Auth reset effectué");
    return { success: true };

  } catch (error) {
    console.error("❌ Erreur reset auth:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

// ============================================================
// 📊 STATUS DÉTAILLÉ
// ============================================================
export const getDetailedStatus = () => {
  return {
    connected: connectionStatus.connected,
    user: connectionStatus.user,
    reconnectAttempts,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
    sockExists: !!sock
  };
};
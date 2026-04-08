import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Convertir l'URL du module en chemin
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dossier pour stocker les informations d'authentification
const AUTH_DIR = path.join(__dirname, 'auth_info');

// Créer le dossier s'il n'existe pas
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let isInitializing = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;

const MAX_RETRIES = 5;
const RECONNECT_DELAY_MS = 5000;

// État de la connexion
export const getConnectionStatus = () => ({
  connected: !!sock && !!sock.user,
  user: sock?.user || null,
  retryCount: reconnectAttempts,
});

// Envoyer un message à un contact
export const sendMessage = async (to, message) => {
  if (!sock || !sock.user) {
    return { success: false, error: 'Non connecté à WhatsApp' };
  }

  try {
    const jid = `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    const res = await sock.sendMessage(jid, { text: message });
    return { success: true, messageId: res.key.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// Récupérer la liste des groupes
export const getGroups = async () => {
  if (!sock || !sock.user) {
    return { success: false, error: 'Non connecté à WhatsApp', data: [] };
  }

  try {
    const chats = await sock.groupFetchAllParticipating();
    return { success: true, data: Object.values(chats) };
  } catch (err) {
    return { success: false, error: err.message, data: [] };
  }
};

// Envoyer un message à un groupe
export const sendToGroup = async (groupId, message) => {
  if (!sock || !sock.user) {
    return { success: false, error: 'Non connecté à WhatsApp' };
  }

  try {
    await sock.sendMessage(groupId, { text: message });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// Déconnecter WhatsApp
export const disconnect = async () => {
  if (sock) {
    try {
      await sock.logout();
      sock = null;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Pas de session active' };
};

// Réinitialiser l'authentification
export const resetAuth = async () => {
  try {
    await disconnect();
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// Initialiser la connexion WhatsApp
export const initWhatsApp = async (onQR, onOpen, onInvalid) => {
  if (isInitializing) {
    return { success: false, error: 'Initialisation déjà en cours' };
  }

  isInitializing = true;

  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Utilisation de la version ${version.join('.')}`);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      browser: ['AIFASA 17', 'Chrome', '1.0.0'],
      keepAliveIntervalMs: 10000,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 20000,
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && onQR) {
        onQR(qr);
      }

      if (connection === 'open') {
        console.log('✅ CONNECTÉ À WHATSAPP');
        reconnectAttempts = 0;
        isInitializing = false;
        if (onOpen) onOpen();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = new Boom(lastDisconnect?.error)?.output?.payload?.message;

        console.log(`❌ Déconnecté (${statusCode || 'inconnu'}) - ${reason || 'raison inconnue'}`);

        sock = null;
        isInitializing = false;

        // Erreurs nécessitant une réauthentification
        if ([DisconnectReason.badSession, DisconnectReason.connectionClosed, DisconnectReason.timedOut].includes(lastDisconnect?.error) ||
            [401, 403, 405, 500].includes(statusCode)) {
          if (onInvalid) onInvalid();
          return;
        }

        // Tentative de reconnexion
        if (reconnectAttempts < MAX_RETRIES) {
          reconnectAttempts++;
          console.log(`🔄 Nouvelle tentative dans ${RECONNECT_DELAY_MS / 1000} secondes (${reconnectAttempts}/${MAX_RETRIES})...`);
          reconnectTimeout = setTimeout(() => {
            initWhatsApp(onQR, onOpen, onInvalid);
          }, RECONNECT_DELAY_MS);
        } else {
          console.log('❌ Nombre maximal de tentatives atteint');
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', (m) => {
      console.log('Nouveau message reçu:', m.messages[0]);
    });

    return { success: true, message: 'Initialisation en cours' };
  } catch (err) {
    console.error('❌ Erreur d\'initialisation:', err);
    isInitializing = false;
    return { success: false, error: err.message };
  }
};

// Fonction utilitaire pour nettoyer les timeouts
export const cleanup = () => {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
};

// Logger personnalisé pour Baileys
const logger = {
  ...console,
  trace: () => {},
  debug: () => {},
};
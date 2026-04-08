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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ FIX CRITIQUE : Logger défini EN PREMIER, avant tout usage dans makeWASocket
const logger = {
  ...console,
  trace: () => {},
  debug: () => {},
  info:  () => {},
};

const AUTH_DIR = path.join(__dirname, 'auth_info');

// ✅ FIX : Vérification que AUTH_DIR est bien dans le répertoire du projet
const PROJECT_ROOT = path.resolve(__dirname, '..');
const isSafeDir = (dir) => path.resolve(dir).startsWith(PROJECT_ROOT);

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let isInitializing = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;

const MAX_RETRIES = 5;
const RECONNECT_DELAY_MS = 5000;
const MAX_MESSAGE_LENGTH = 4096;

export const getConnectionStatus = () => ({
  connected: !!sock && !!sock.user,
  user: sock?.user || null,
  retryCount: reconnectAttempts,
});

// ✅ FIX : Validation du numéro de téléphone (format E.164)
const validatePhoneNumber = (to) => {
  if (!to || typeof to !== 'string') return { valid: false, error: 'Numéro manquant' };
  const digits = to.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return { valid: false, error: `Numéro invalide : ${digits.length} chiffres (attendu 8-15)` };
  }
  return { valid: true, digits };
};

// ✅ FIX : Validation et troncature du message
const validateMessage = (message) => {
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { valid: false, error: 'Message vide ou invalide' };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { valid: true, content: message.slice(0, MAX_MESSAGE_LENGTH) + '...[tronqué]', truncated: true };
  }
  return { valid: true, content: message, truncated: false };
};

export const sendMessage = async (to, message) => {
  if (!sock || !sock.user) {
    return { success: false, error: 'Non connecté à WhatsApp' };
  }

  const phoneCheck = validatePhoneNumber(to);
  if (!phoneCheck.valid) return { success: false, error: phoneCheck.error };

  const msgCheck = validateMessage(message);
  if (!msgCheck.valid) return { success: false, error: msgCheck.error };

  try {
    const jid = `${phoneCheck.digits}@s.whatsapp.net`;
    const res = await sock.sendMessage(jid, { text: msgCheck.content });
    return { success: true, messageId: res.key.id, truncated: msgCheck.truncated };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

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

export const sendToGroup = async (groupId, message) => {
  if (!sock || !sock.user) {
    return { success: false, error: 'Non connecté à WhatsApp' };
  }

  if (!groupId || typeof groupId !== 'string' || !groupId.includes('@g.us')) {
    return { success: false, error: 'ID de groupe invalide' };
  }

  const msgCheck = validateMessage(message);
  if (!msgCheck.valid) return { success: false, error: msgCheck.error };

  try {
    await sock.sendMessage(groupId, { text: msgCheck.content });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

export const disconnect = async () => {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (sock) {
    try {
      await sock.logout();
    } catch (_) {}
    sock = null;
    reconnectAttempts = 0;
    return { success: true };
  }
  return { success: false, error: 'Pas de session active' };
};

export const resetAuth = async () => {
  try {
    await disconnect();

    // ✅ FIX : Garde-fou avant suppression récursive
    if (!isSafeDir(AUTH_DIR)) {
      return { success: false, error: 'Chemin AUTH_DIR non sécurisé — suppression annulée' };
    }

    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    reconnectAttempts = 0;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

// ✅ Expose le compteur pour partage avec whatsappService
export const getReconnectAttempts = () => reconnectAttempts;
export const resetReconnectAttempts = () => { reconnectAttempts = 0; };

export const initWhatsApp = async (onQR, onOpen, onInvalid) => {
  if (isInitializing) {
    return { success: false, error: 'Initialisation déjà en cours' };
  }

  isInitializing = true;

  try {
    const { version } = await fetchLatestBaileysVersion();
    console.log(`WhatsApp Baileys version: ${version.join('.')}`);

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ['AIFASA 17', 'Chrome', '1.0.0'],
      keepAliveIntervalMs: 10000,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 20000,
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && onQR) onQR(qr);

      if (connection === 'open') {
        console.log('✅ WhatsApp connecté');
        reconnectAttempts = 0;
        isInitializing = false;
        if (onOpen) onOpen();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`❌ WhatsApp déconnecté (code: ${statusCode || 'inconnu'})`);

        sock = null;
        isInitializing = false;

        const isAuthError = [401, 403, 405].includes(statusCode) ||
          statusCode === DisconnectReason.badSession ||
          statusCode === DisconnectReason.loggedOut;

        if (isAuthError) {
          console.log('🔑 Erreur auth → réinitialisation de session');
          if (onInvalid) onInvalid();
          return;
        }

        // ✅ FIX : Délai exponentiel + arrêt propre quand MAX_RETRIES atteint
        if (reconnectAttempts < MAX_RETRIES) {
          reconnectAttempts++;
          const delay = RECONNECT_DELAY_MS * reconnectAttempts;
          console.log(`🔄 Reconnexion ${reconnectAttempts}/${MAX_RETRIES} dans ${delay / 1000}s...`);
          reconnectTimeout = setTimeout(() => {
            initWhatsApp(onQR, onOpen, onInvalid);
          }, delay);
        } else {
          console.log('❌ MAX_RETRIES atteint — réinitialisation requise manuellement');
          if (onInvalid) onInvalid();
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    return { success: true, message: 'Initialisation en cours' };
  } catch (err) {
    console.error('❌ Erreur init WhatsApp:', err.message);
    isInitializing = false;
    return { success: false, error: err.message };
  }
};

export const cleanup = () => {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
};
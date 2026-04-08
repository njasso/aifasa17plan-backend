import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 🔐 CONFIGURATION DE SÉCURITÉ
// ============================================================
const ENCRYPTION_KEY = process.env.WHATSAPP_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

// Fonctions de chiffrement/déchiffrement pour les clés sensibles
const encrypt = (text) => {
  try {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex').slice(0, 32);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      iv: iv.toString('hex'),
      content: encrypted.toString('hex'),
      tag: tag.toString('hex')
    });
  } catch (e) {
    console.error('Erreur chiffrement:', e.message);
    return text;
  }
};

// Logger sécurisé (masque les données sensibles)
const logger = {
  info: (msg) => console.log(`[INFO] ${msg.replace(/[0-9]{10,}/g, '[MASQUÉ]')}`),
  warn: (msg) => console.warn(`[WARN] ${msg.replace(/[0-9]{10,}/g, '[MASQUÉ]')}`),
  error: (msg) => console.error(`[ERROR] ${msg.replace(/[0-9]{10,}/g, '[MASQUÉ]')}`),
  debug: () => {},
  trace: () => {},
};

const AUTH_DIR = path.join(__dirname, 'auth_info');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOCK_FILE = path.join(AUTH_DIR, '.lock');

// ============================================================
// 🔒 VÉRIFICATIONS DE SÉCURITÉ
// ============================================================
const isSafeDir = (dir) => {
  const resolved = path.resolve(dir);
  return resolved.startsWith(PROJECT_ROOT) && !resolved.includes('..');
};

// Vérifier qu'un seul processus utilise la session
const acquireLock = () => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = fs.readFileSync(LOCK_FILE, 'utf8');
      try {
        process.kill(parseInt(pid), 0);
        return false; // Processus existant
      } catch {
        fs.unlinkSync(LOCK_FILE);
      }
    }
    fs.writeFileSync(LOCK_FILE, process.pid.toString());
    return true;
  } catch {
    return false;
  }
};

const releaseLock = () => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
};

// ============================================================
// 🛡️ VALIDATION ANTI-INJECTION
// ============================================================
const WHITELISTED_DOMAINS = ['whatsapp.net', 'g.us', 's.whatsapp.net'];
const MAX_MESSAGE_LENGTH = 4096;
const FORBIDDEN_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /on\w+=/i,
  /&#/i,
  /data:/i,
];

const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  let sanitized = input
    .replace(/[<>]/g, '') // Supprime les balises HTML
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Supprime caractères de contrôle
    .trim();
  
  FORBIDDEN_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[BLOQUÉ]');
  });
  
  return sanitized;
};

const validateJid = (jid) => {
  if (!jid || typeof jid !== 'string') return false;
  return WHITELISTED_DOMAINS.some(domain => jid.endsWith(`@${domain}`));
};

const validatePhoneNumber = (to) => {
  if (!to || typeof to !== 'string') return { valid: false, error: 'Numéro manquant' };
  const digits = to.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return { valid: false, error: 'Format invalide' };
  }
  return { valid: true, digits };
};

// ============================================================
// 🚦 RATE LIMITING AVEC BURST PROTECTION
// ============================================================
const RATE_LIMIT = {
  windowMs: 60000,
  maxMessages: 30,
  messages: [],
};

const checkRateLimit = () => {
  const now = Date.now();
  RATE_LIMIT.messages = RATE_LIMIT.messages.filter(t => t > now - RATE_LIMIT.windowMs);
  
  if (RATE_LIMIT.messages.length >= RATE_LIMIT.maxMessages) {
    const oldestTime = RATE_LIMIT.messages[0];
    const waitTime = oldestTime + RATE_LIMIT.windowMs - now;
    return { allowed: false, waitTime };
  }
  
  RATE_LIMIT.messages.push(now);
  return { allowed: true, waitTime: 0 };
};

// ============================================================
// VARIABLES D'ÉTAT
// ============================================================
let sock = null;
let isInitializing = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let messageCount = 0;
let lastMessageTime = 0;

const MAX_RETRIES = 3;
const RECONNECT_DELAY_MS = 15000;
const MESSAGE_COOLDOWN_MS = 2000;

// ============================================================
// FONCTIONS PUBLIQUES SÉCURISÉES
// ============================================================
export const getConnectionStatus = () => ({
  connected: !!sock && !!sock.user,
  user: sock?.user ? {
    name: sock.user.name,
    id: sock.user.id?.split('@')[0] + '@[MASQUÉ]'
  } : null,
  retryCount: reconnectAttempts,
  messageCount,
});

export const sendMessage = async (to, rawMessage) => {
  // 🔒 Vérification connexion
  if (!sock || !sock.user) {
    return { success: false, error: 'Non connecté à WhatsApp' };
  }

  // 🔒 Rate limiting
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    return { success: false, error: `Rate limit dépassé, réessayez dans ${Math.ceil(rateCheck.waitTime / 1000)}s` };
  }

  // 🔒 Cooldown entre messages
  const now = Date.now();
  const elapsed = now - lastMessageTime;
  if (elapsed < MESSAGE_COOLDOWN_MS) {
    await new Promise(r => setTimeout(r, MESSAGE_COOLDOWN_MS - elapsed));
  }

  // 🔒 Validation numéro
  const phoneCheck = validatePhoneNumber(to);
  if (!phoneCheck.valid) {
    return { success: false, error: phoneCheck.error };
  }

  // 🔒 Sanitization du message
  const sanitizedMessage = sanitizeInput(rawMessage);
  if (sanitizedMessage.length === 0) {
    return { success: false, error: 'Message vide après nettoyage' };
  }

  // 🔒 Troncature
  const finalMessage = sanitizedMessage.length > MAX_MESSAGE_LENGTH
    ? sanitizedMessage.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
    : sanitizedMessage;

  try {
    const jid = `${phoneCheck.digits}@s.whatsapp.net`;
    
    // 🔒 Validation JID
    if (!validateJid(jid)) {
      return { success: false, error: 'JID invalide' };
    }

    const res = await sock.sendMessage(jid, { text: finalMessage });
    lastMessageTime = Date.now();
    messageCount++;
    
    return { 
      success: true, 
      messageId: res?.key?.id,
      truncated: sanitizedMessage.length > MAX_MESSAGE_LENGTH
    };
  } catch (err) {
    // 🔒 Ne pas exposer les détails de l'erreur
    console.error('Erreur envoi message:', err.message);
    return { success: false, error: 'Erreur lors de l\'envoi' };
  }
};

export const sendToGroup = async (groupId, rawMessage) => {
  if (!sock || !sock.user) {
    return { success: false, error: 'Non connecté à WhatsApp' };
  }

  // 🔒 Validation groupId
  if (!groupId || typeof groupId !== 'string' || !groupId.includes('@g.us')) {
    return { success: false, error: 'ID de groupe invalide' };
  }

  // 🔒 Rate limiting
  const rateCheck = checkRateLimit();
  if (!rateCheck.allowed) {
    return { success: false, error: 'Rate limit dépassé' };
  }

  // 🔒 Sanitization
  const sanitizedMessage = sanitizeInput(rawMessage);
  if (sanitizedMessage.length === 0) {
    return { success: false, error: 'Message vide' };
  }

  const finalMessage = sanitizedMessage.length > MAX_MESSAGE_LENGTH
    ? sanitizedMessage.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
    : sanitizedMessage;

  try {
    await sock.sendMessage(groupId, { text: finalMessage });
    lastMessageTime = Date.now();
    messageCount++;
    return { success: true };
  } catch (err) {
    console.error('Erreur envoi groupe:', err.message);
    return { success: false, error: 'Erreur lors de l\'envoi' };
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
    } catch {}
    sock = null;
  }
  releaseLock();
  reconnectAttempts = 0;
  return { success: true };
};

export const resetAuth = async () => {
  try {
    await disconnect();

    if (!isSafeDir(AUTH_DIR)) {
      return { success: false, error: 'Chemin non autorisé' };
    }

    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 }); // 🔒 Permissions restrictives
    reconnectAttempts = 0;
    return { success: true };
  } catch (err) {
    console.error('Erreur resetAuth:', err.message);
    return { success: false, error: 'Erreur interne' };
  }
};

export const getReconnectAttempts = () => reconnectAttempts;
export const resetReconnectAttempts = () => { reconnectAttempts = 0; };

export const initWhatsApp = async (onQR, onOpen, onInvalid) => {
  // 🔒 Éviter race conditions
  if (isInitializing) {
    return { success: false, error: 'Initialisation en cours' };
  }

  // 🔒 Acquérir le lock
  if (!acquireLock()) {
    return { success: false, error: 'Session WhatsApp déjà utilisée par un autre processus' };
  }

  if (sock) {
    try { await sock.logout(); } catch {}
    sock = null;
  }

  isInitializing = true;

  try {
    // 🔒 Vérifier permissions du dossier
    if (fs.existsSync(AUTH_DIR)) {
      const stats = fs.statSync(AUTH_DIR);
      if ((stats.mode & 0o777) !== 0o700) {
        fs.chmodSync(AUTH_DIR, 0o700);
      }
    } else {
      fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
    }

    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ['AIFASA 17', 'Safari', '1.0.0'],
      keepAliveIntervalMs: 15000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 30000,
      markOnlineOnConnect: false, // 🔒 Plus discret
      syncFullHistory: false,      // 🔒 Évite de télécharger tout l'historique
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && onQR) {
        // 🔒 Ne pas logger le QR complet
        console.log('📱 QR Code généré (longueur:', qr.length, 'caractères)');
        onQR(qr);
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp connecté');
        reconnectAttempts = 0;
        isInitializing = false;
        if (onOpen) onOpen();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log(`WhatsApp déconnecté (code: ${statusCode || 'inconnu'})`);
        
        sock = null;
        isInitializing = false;
        releaseLock();

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (!shouldReconnect) {
          console.log('Session invalide - réinitialisation');
          if (onInvalid) onInvalid();
          return;
        }

        if (reconnectAttempts < MAX_RETRIES) {
          reconnectAttempts++;
          console.log(`Reconnexion ${reconnectAttempts}/${MAX_RETRIES} dans ${RECONNECT_DELAY_MS / 1000}s`);
          
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(() => {
            initWhatsApp(onQR, onOpen, onInvalid).catch(console.error);
          }, RECONNECT_DELAY_MS);
        } else {
          console.log('MAX_RETRIES atteint');
          if (onInvalid) onInvalid();
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    return { success: true, message: 'Initialisation lancée' };
  } catch (err) {
    console.error('Erreur init WhatsApp:', err.message);
    isInitializing = false;
    releaseLock();
    sock = null;
    return { success: false, error: 'Erreur d\'initialisation' };
  }
};

export const cleanup = () => {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  releaseLock();
};

// 🔒 Nettoyage à la sortie
process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
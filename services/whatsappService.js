import {
  initWhatsApp,
  sendMessage,
  getConnectionStatus,
  disconnect,
  resetAuth,
  sendToGroup as sendToGroupBaileys,
  getReconnectAttempts,
  resetReconnectAttempts,
} from './whatsappBaileys.js';

import logger from '../utils/logger.js';
import qrcode from 'qrcode-terminal';

let initialized = false;
let initPromise = null;
let invalidSessionCount = 0;
const MAX_INVALID_SESSIONS = 3;

const MESSAGE_DELAY_MS = 1500;
let lastSentAt = 0;

const rateLimitedSend = async (fn) => {
  const now = Date.now();
  const elapsed = now - lastSentAt;
  if (elapsed < MESSAGE_DELAY_MS) {
    await new Promise(r => setTimeout(r, MESSAGE_DELAY_MS - elapsed));
  }
  lastSentAt = Date.now();
  return fn();
};

const init = async () => {
  // ✅ Éviter les initialisations multiples
  if (initPromise) {
    logger.info('⚠️ WhatsApp: initialisation déjà en cours');
    return initPromise;
  }

  if (initialized && getConnectionStatus().connected) {
    logger.info('✅ WhatsApp déjà connecté');
    return { success: true, message: 'Déjà connecté' };
  }

  logger.info('🔄 Démarrage WhatsApp...');

  initPromise = (async () => {
    try {
      const result = await initWhatsApp(
        (qr) => {
          console.log('\n📱 ═══════════════════════════════════════');
          console.log('📲 SCANNEZ CE QR CODE AVEC WHATSAPP :');
          console.log('═══════════════════════════════════════\n');
          qrcode.generate(qr, { small: true });
          console.log('\n═══════════════════════════════════════\n');
        },
        () => {
          logger.info('✅ WhatsApp connecté avec succès !');
          initialized = true;
          invalidSessionCount = 0;
          resetReconnectAttempts();
          initPromise = null;
        },
        async () => {
          logger.warn('⚠️ Session WhatsApp invalide');
          initialized = false;
          invalidSessionCount++;
          initPromise = null;

          if (invalidSessionCount >= MAX_INVALID_SESSIONS) {
            logger.error(`❌ ${MAX_INVALID_SESSIONS} échecs - WhatsApp désactivé temporairement`);
            return;
          }

          // ✅ Réinitialiser et réessayer une seule fois
          logger.info('🔄 Réinitialisation de la session...');
          await resetAuth();
          
          setTimeout(() => {
            init().catch(err => logger.error('Erreur réinit WhatsApp:', err));
          }, 5000);
        }
      );

      if (result?.success === false) {
        initialized = false;
        initPromise = null;
        return { success: false, error: result.error };
      }

      initialized = true;
      return { success: true, message: 'Initialisation lancée' };
    } catch (err) {
      logger.error('❌ Erreur init WhatsApp:', err);
      initialized = false;
      initPromise = null;
      return { success: false, error: err.message };
    }
  })();

  return initPromise;
};

export const whatsappService = {
  init,

  async send({ to, message }) {
    try {
      const status = getConnectionStatus();
      if (!status.connected) {
        return { success: false, error: 'WhatsApp non connecté' };
      }

      const result = await rateLimitedSend(() => sendMessage(to, message));

      if (!result) return { success: false, error: 'Réponse vide' };
      if (result.success === false) return { success: false, error: result.error };

      return { success: true, messageId: result.messageId };
    } catch (err) {
      logger.error(`❌ Erreur envoi à ${to}:`, err);
      return { success: false, error: err.message };
    }
  },

  async sendBulk(recipients) {
    const results = [];
    for (const { to, message } of recipients) {
      const result = await this.send({ to, message });
      results.push({ to, ...result });
    }
    return results;
  },

  async getStatus() {
    try {
      const status = getConnectionStatus();
      return {
        connected: status.connected,
        user: status.user,
        retryCount: status.retryCount,
        invalidSessionCount,
        initialized,
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  },

  async disconnect() {
    try {
      await disconnect();
      initialized = false;
      initPromise = null;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async resetAuth() {
    try {
      await resetAuth();
      initialized = false;
      initPromise = null;
      invalidSessionCount = 0;
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async sendToGroup(groupId, message) {
    try {
      if (!getConnectionStatus().connected) {
        return { success: false, error: 'Non connecté' };
      }

      const result = await rateLimitedSend(() => sendToGroupBaileys(groupId, message));

      if (!result) return { success: false, error: 'Réponse vide' };
      if (result.success === false) return { success: false, error: result.error };

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  formatters: {
    message: ({ sujet, contenu, expediteur }) => {
      return `📢 *${sujet || 'Nouveau message'}*\n\n${contenu}\n\n_— ${expediteur || 'AIFASA 17'}_`;
    },
    alerte: ({ titre, message, activite, dateFin, priorite, jours }) => {
      const emoji = priorite === 'haute' ? '🔴' : priorite === 'moyenne' ? '🟡' : '🟢';
      return `${emoji} *${titre || 'Rappel'}*\n\n${message || `"${activite || ''}" se termine le ${dateFin ? new Date(dateFin).toLocaleDateString('fr-FR') : 'bientôt'}.`}\n\n📅 J-${jours || '?'}\n\n_— AIFASA 17_`;
    }
  }
};

export default whatsappService;
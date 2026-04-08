import {
  initWhatsApp,
  sendMessage,
  getConnectionStatus,
  disconnect,
  resetAuth,
  getGroups as getGroupsBaileys,
  sendToGroup as sendToGroupBaileys,
  getReconnectAttempts,
  resetReconnectAttempts,
} from './whatsappBaileys.js';

import logger from '../utils/logger.js';
import qrcode from 'qrcode-terminal';

let initialized = false;
let invalidSessionCount = 0;
const MAX_INVALID_SESSIONS = 3;

// ✅ FIX : Rate limiting — file d'attente pour éviter le ban WhatsApp
const MESSAGE_DELAY_MS = 1500; // 1.5s minimum entre chaque message
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
  if (initialized) {
    logger.info('⚠️ WhatsApp déjà initialisé');
    return { success: true, message: 'Déjà connecté' };
  }

  initialized = true;
  logger.info('🔄 Démarrage WhatsApp...');

  try {
    await initWhatsApp(
      (qr) => {
        console.log('\n📱 SCANNEZ LE QR CODE:\n');
        qrcode.generate(qr, { small: true });
      },
      () => {
        logger.info('✅ WhatsApp connecté');
        invalidSessionCount = 0;
        resetReconnectAttempts();
      },
      async () => {
        initialized = false;
        invalidSessionCount++;

        // ✅ FIX : Stopper la boucle si trop de sessions invalides
        if (invalidSessionCount > MAX_INVALID_SESSIONS) {
          logger.error(`❌ Session invalide ${invalidSessionCount} fois — arrêt automatique. Reconnexion manuelle requise.`);
          return;
        }

        logger.warn(`❌ Session invalide (tentative ${invalidSessionCount}/${MAX_INVALID_SESSIONS}) → réinitialisation`);
        await resetAuth();
        setTimeout(() => init(), 5000);
      }
    );
    return { success: true, message: 'Initialisation réussie' };
  } catch (err) {
    logger.error('❌ Erreur init WhatsApp:', err);
    initialized = false;
    return { success: false, error: err.message || 'Erreur inconnue' };
  }
};

export const whatsappService = {

  init,

  /**
   * Envoyer un message WhatsApp avec rate limiting
   */
  async send({ to, message }) {
    try {
      if (!getConnectionStatus().connected) {
        logger.warn('❌ Pas connecté à WhatsApp');
        return { success: false, error: 'Non connecté à WhatsApp' };
      }

      // ✅ FIX : Rate limiting appliqué
      const result = await rateLimitedSend(() => sendMessage(to, message));

      if (!result) return { success: false, error: 'Réponse vide du service WhatsApp' };
      if (result.success === false) return { success: false, error: result.error || 'Erreur envoi' };

      if (result.truncated) {
        logger.warn(`⚠️ Message tronqué à 4096 caractères pour ${to}`);
      }

      return { success: true, messageId: result.messageId, error: null };
    } catch (err) {
      logger.error(`❌ Erreur envoi à ${to}:`, err);
      return { success: false, error: err.message || 'Erreur inconnue' };
    }
  },

  /**
   * Envoyer en masse avec rate limiting intégré
   */
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
        error: status.error,
      };
    } catch (err) {
      logger.error('❌ Erreur statut WhatsApp:', err);
      return { connected: false, error: err.message || 'Erreur inconnue' };
    }
  },

  async disconnect() {
    try {
      await disconnect();
      initialized = false;
      return { success: true };
    } catch (err) {
      logger.error('❌ Erreur déconnexion WhatsApp:', err);
      return { success: false, error: err.message || 'Erreur inconnue' };
    }
  },

  async resetAuth() {
    try {
      await resetAuth();
      initialized = false;
      invalidSessionCount = 0;
      setTimeout(() => init(), 3000);
      return { success: true };
    } catch (err) {
      logger.error('❌ Erreur réinitialisation WhatsApp:', err);
      return { success: false, error: err.message || 'Erreur inconnue' };
    }
  },

  async getGroups() {
    try {
      const groups = await getGroupsBaileys();
      return { success: true, data: groups };
    } catch (err) {
      logger.error('❌ Erreur récupération groupes:', err);
      return { success: false, error: err.message || 'Erreur inconnue' };
    }
  },

  async sendToGroup(groupId, message) {
    try {
      if (!getConnectionStatus().connected) {
        return { success: false, error: 'Non connecté à WhatsApp' };
      }

      // ✅ Rate limiting aussi pour les groupes
      const result = await rateLimitedSend(() => sendToGroupBaileys(groupId, message));

      if (!result) return { success: false, error: 'Réponse vide du service WhatsApp' };
      if (result.success === false) return { success: false, error: result.error || 'Erreur envoi groupe' };

      return { success: true, messageId: result.messageId || result.id, error: null };
    } catch (err) {
      logger.error(`❌ Erreur envoi groupe ${groupId}:`, err);
      return { success: false, error: err.message || 'Erreur inconnue' };
    }
  },

  formatters: {
    message: ({ sujet, contenu, expediteur }) => {
      return `📢 *${sujet || 'Nouveau message'}*\n\n${contenu}\n\n_— ${expediteur || 'AIFASA 17'}_`;
    },
    alerte: ({ titre, message, activite, dateFin, priorite, jours }) => {
      const emojiPriorite = priorite === 'haute' ? '🔴' : priorite === 'moyenne' ? '🟡' : '🟢';
      return `${emojiPriorite} *${titre || 'Rappel important'}*\n\n${message || `L'activité "${activite || ''}" se termine le ${dateFin ? new Date(dateFin).toLocaleDateString('fr-FR') : 'bientôt'}.`}\n\n📅 *Jours restants: ${jours || '?'}*\n📌 *Priorité: ${priorite || 'normale'}*\n\n_— AIFASA 17_`.trim();
    }
  }
};

export default whatsappService;
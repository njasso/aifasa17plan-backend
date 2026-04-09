// services/whatsappService.js
import {
  initWhatsApp,
  sendMessage,
  getConnectionStatus,
  disconnect,
  resetAuth as resetAuthBaileys,
  sendToGroup as sendToGroupBaileys,
  getReconnectAttempts,
  resetReconnectAttempts,
  getGroups as getBaileysGroups,  // ✅ AJOUTÉ
} from './whatsappBaileys.js';

import logger from '../utils/logger.js';
import qrcode from 'qrcode-terminal';

// ============================================================
// 🔥 VARIABLES GLOBALES
// ============================================================
let initialized = false;
let initPromise = null;
let invalidSessionCount = 0;

const MAX_INVALID_SESSIONS = 3;
const MESSAGE_DELAY_MS = 1500;

let lastSentAt = 0;

// ============================================================
// ⏱️ RATE LIMIT (ANTI BAN WHATSAPP)
// ============================================================
const rateLimitedSend = async (fn) => {
  const now = Date.now();
  const elapsed = now - lastSentAt;

  if (elapsed < MESSAGE_DELAY_MS) {
    await new Promise((r) => setTimeout(r, MESSAGE_DELAY_MS - elapsed));
  }

  lastSentAt = Date.now();
  return fn();
};

// ============================================================
// 🚀 INITIALISATION WHATSAPP
// ============================================================
const init = async () => {
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
        // 📱 QR CODE
        (qr) => {
          console.log('\n📱 ═══════════════════════════════════════');
          console.log('📲 SCANNEZ CE QR CODE AVEC WHATSAPP :');
          console.log('═══════════════════════════════════════\n');
          qrcode.generate(qr, { small: true });
          console.log('\n═══════════════════════════════════════\n');
        },

        // ✅ CONNECTÉ
        () => {
          logger.info('✅ WhatsApp connecté !');
          initialized = true;
          invalidSessionCount = 0;
          resetReconnectAttempts();
          initPromise = null;
        },

        // ❌ SESSION INVALIDE
        async () => {
          logger.warn('⚠️ Session WhatsApp invalide');
          initialized = false;
          invalidSessionCount++;
          initPromise = null;

          if (invalidSessionCount >= MAX_INVALID_SESSIONS) {
            logger.error('❌ Trop d\'échecs - arrêt temporaire');
            return;
          }

          logger.info('🔄 Reset session WhatsApp...');
          await resetAuthBaileys();

          setTimeout(() => {
            init().catch(err => logger.error(err));
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
      logger.error('❌ Erreur init WhatsApp:', err.message);
      initialized = false;
      initPromise = null;

      setTimeout(() => {
        init().catch(() => {});
      }, 5000);

      return { success: false, error: err.message };
    }
  })();

  return initPromise;
};

// ============================================================
// 📦 SERVICE EXPORT
// ============================================================
export const whatsappService = {

  // 🚀 INIT
  init,

  // ============================================================
  // 📤 ENVOI MESSAGE
  // ============================================================
  async send({ to, message }) {
    try {
      const status = getConnectionStatus();

      if (!status.connected || !initialized) {
        return { success: false, error: 'WhatsApp non prêt' };
      }

      const result = await rateLimitedSend(() =>
        sendMessage(to, message)
      );

      if (!result) {
        return { success: false, error: 'Réponse vide' };
      }

      if (result.success === false) {
        return { success: false, error: result.error };
      }

      return {
        success: true,
        messageId: result.messageId,
      };

    } catch (err) {
      logger.error(`❌ Envoi échoué (${to}):`, err.message);
      return { success: false, error: err.message };
    }
  },

  // ============================================================
  // 📤 ENVOI BULK (séquentiel sécurisé)
  // ============================================================
  async sendBulk(recipients = []) {
    const results = [];

    for (const { to, message } of recipients) {
      const result = await this.send({ to, message });
      results.push({ to, ...result });
    }

    return results;
  },

  // ============================================================
  // 👥 ENVOI GROUPE
  // ============================================================
  async sendToGroup(groupId, message) {
    try {
      const status = getConnectionStatus();

      if (!status.connected || !initialized) {
        return { success: false, error: 'WhatsApp non prêt' };
      }

      const result = await rateLimitedSend(() =>
        sendToGroupBaileys(groupId, message)
      );

      if (!result) {
        return { success: false, error: 'Réponse vide' };
      }

      if (result.success === false) {
        return { success: false, error: result.error };
      }

      return { success: true };

    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ============================================================
  // 👥 RÉCUPÉRER LES GROUPES WHATSAPP
  // ============================================================
  async getGroups() {
    try {
      const status = getConnectionStatus();
      
      if (!status.connected || !initialized) {
        logger.warn('⚠️ WhatsApp non connecté, impossible de récupérer les groupes');
        return { success: false, error: 'WhatsApp non connecté', data: [] };
      }
      
      const groups = await getBaileysGroups();
      
      logger.info(`📋 ${groups.length} groupes WhatsApp récupérés`);
      
      return { 
        success: true, 
        data: groups.map(g => ({
          id: g.id,
          name: g.subject || g.name,
          participants: g.participantCount || g.participants?.length || 0
        }))
      };
    } catch (err) {
      logger.error('❌ Erreur getGroups:', err.message);
      return { success: false, error: err.message, data: [] };
    }
  },

  // ============================================================
  // 📊 STATUS
  // ============================================================
  async getStatus() {
    try {
      const status = getConnectionStatus();

      return {
        connected: status.connected,
        user: status.user,
        retryCount: status.retryCount,
        reconnectAttempts: getReconnectAttempts(),
        invalidSessionCount,
        initialized,
      };

    } catch (err) {
      return { connected: false, error: err.message };
    }
  },

  // ============================================================
  // 🔌 DISCONNECT
  // ============================================================
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

  // ============================================================
  // 🔄 RESET AUTH
  // ============================================================
  async resetAuth() {
    try {
      await resetAuthBaileys();

      initialized = false;
      initPromise = null;
      invalidSessionCount = 0;

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // ============================================================
  // ✍️ FORMATTERS
  // ============================================================
  formatters: {
    message: ({ sujet, contenu, expediteur }) => {
      return `📢 *${sujet || 'Nouveau message'}*\n\n${contenu}\n\n_— ${expediteur || 'AIFASA 17'}_`;
    },

    alerte: ({ titre, message, activite, dateFin, priorite, jours }) => {
      const emoji =
        priorite === 'haute' ? '🔴' :
        priorite === 'moyenne' ? '🟡' : '🟢';

      return `${emoji} *${titre || 'Rappel'}*\n\n${
        message || `"${activite || ''}" se termine le ${
          dateFin ? new Date(dateFin).toLocaleDateString('fr-FR') : 'bientôt'
        }.`
      }\n\n📅 J-${jours || '?'}\n\n_— AIFASA 17_`;
    }
  }
};

export default whatsappService;
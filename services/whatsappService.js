import {
  initWhatsApp,
  sendMessage,
  getConnectionStatus,
  disconnect,
  resetAuth,
  getGroups as getGroupsBaileys,
  sendToGroup as sendToGroupBaileys,
} from './whatsappBaileys.js';

import logger from '../utils/logger.js';
import qrcode from 'qrcode-terminal';

let initialized = false;

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
      },
      async () => {
        logger.warn('❌ Session invalide → réinitialisation');
        initialized = false;
        await resetAuth();
        setTimeout(() => init(), 3000);
      }
    );
    return { success: true, message: 'Initialisation réussie' };
  } catch (err) {
    logger.error('❌ Erreur lors de l\'initialisation:', err);
    initialized = false;
    return { success: false, error: err.message || 'Erreur inconnue lors de l\'initialisation' };
  }
};

export const whatsappService = {

  init,

  /**
   * Envoyer un message WhatsApp
   * @param {string} to - Numéro de téléphone du destinataire
   * @param {string} message - Contenu du message
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async send({ to, message }) {
    try {
      if (!getConnectionStatus().connected) {
        logger.warn('❌ Pas connecté à WhatsApp');
        return { success: false, error: 'Non connecté à WhatsApp' };
      }

      const result = await sendMessage(to, message);

      // Vérification du résultat
      if (!result) {
        return { success: false, error: 'Réponse vide du service WhatsApp' };
      }

      if (result.success === false) {
        return { success: false, error: result.error || 'Erreur inconnue lors de l\'envoi' };
      }

      return { success: true, messageId: result.messageId || result.id, error: null };
    } catch (err) {
      logger.error(`❌ Erreur lors de l'envoi à ${to}:`, err);
      return { success: false, error: err.message || 'Erreur inconnue lors de l\'envoi' };
    }
  },

  /**
   * Obtenir le statut de la connexion
   * @returns {Promise<{connected: boolean, error?: string}>}
   */
  async getStatus() {
    try {
      const status = getConnectionStatus();
      return { connected: status.connected, error: status.error };
    } catch (err) {
      logger.error('❌ Erreur lors de la récupération du statut:', err);
      return { connected: false, error: err.message || 'Erreur inconnue' };
    }
  },

  /**
   * Déconnecter WhatsApp
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async disconnect() {
    try {
      await disconnect();
      initialized = false;
      return { success: true };
    } catch (err) {
      logger.error('❌ Erreur lors de la déconnexion:', err);
      return { success: false, error: err.message || 'Erreur inconnue lors de la déconnexion' };
    }
  },

  /**
   * Réinitialiser l'authentification
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async resetAuth() {
    try {
      await resetAuth();
      initialized = false;
      setTimeout(() => init(), 3000);
      return { success: true };
    } catch (err) {
      logger.error('❌ Erreur lors de la réinitialisation:', err);
      return { success: false, error: err.message || 'Erreur inconnue lors de la réinitialisation' };
    }
  },

  /**
   * Obtenir la liste des groupes WhatsApp
   * @returns {Promise<{success: boolean, data?: Array, error?: string}>}
   */
  async getGroups() {
    try {
      const groups = await getGroupsBaileys();
      return { success: true, data: groups };
    } catch (err) {
      logger.error('❌ Erreur lors de la récupération des groupes:', err);
      return { success: false, error: err.message || 'Erreur inconnue lors de la récupération des groupes' };
    }
  },

  /**
   * Envoyer un message à un groupe WhatsApp
   * @param {string} groupId - ID du groupe
   * @param {string} message - Contenu du message
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async sendToGroup(groupId, message) {
    try {
      if (!getConnectionStatus().connected) {
        logger.warn('❌ Pas connecté à WhatsApp');
        return { success: false, error: 'Non connecté à WhatsApp' };
      }

      const result = await sendToGroupBaileys(groupId, message);

      if (!result) {
        return { success: false, error: 'Réponse vide du service WhatsApp' };
      }

      if (result.success === false) {
        return { success: false, error: result.error || 'Erreur inconnue lors de l\'envoi au groupe' };
      }

      return { success: true, messageId: result.messageId || result.id, error: null };
    } catch (err) {
      logger.error(`❌ Erreur lors de l'envoi au groupe ${groupId}:`, err);
      return { success: false, error: err.message || 'Erreur inconnue lors de l\'envoi au groupe' };
    }
  },

  // Formatters pour les messages
  formatters: {
    /**
     * Formater un message standard
     * @param {Object} params - Paramètres du message
     * @param {string} params.sujet - Sujet du message
     * @param {string} params.contenu - Contenu du message
     * @param {string} params.expediteur - Nom de l'expéditeur
     * @returns {string} - Message formaté
     */
    message: ({ sujet, contenu, expediteur }) => {
      return `📢 *${sujet || 'Nouveau message'}*\n\n${contenu}\n\n_— ${expediteur || 'AIFASA 17'}_`;
    },

    /**
     * Formater une alerte
     * @param {Object} params - Paramètres de l'alerte
     * @param {string} params.titre - Titre de l'alerte
     * @param {string} params.message - Message de l'alerte
     * @param {string} params.activite - Activité concernée
     * @param {Date} params.dateFin - Date de fin
     * @param {string} params.priorite - Priorité
     * @param {number} params.jours - Jours restants
     * @returns {string} - Alerte formatée
     */
    alerte: ({ titre, message, activite, dateFin, priorite, jours }) => {
      const emojiPriorite = priorite === 'haute' ? '🔴' : priorite === 'moyenne' ? '🟡' : '🟢';
      return `
${emojiPriorite} *${titre || 'Rappel important'}*

${message || `L'activité "${activite || ''}" se termine le ${dateFin ? new Date(dateFin).toLocaleDateString('fr-FR') : 'soon'}.`}

📅 *Jours restants: ${jours || '?'}*
📌 *Priorité: ${priorite || 'normale'}*

_— AIFASA 17_
      `.trim();
    }
  }
};

export default whatsappService;
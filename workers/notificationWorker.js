// backend/workers/notificationWorker.js
// ✅ VERSION CORRIGÉE — AIFASA 17
// BUG-09 FIX : concurrency explicite + listener 'failed'

import { notificationQueue } from '../queues/notificationQueue.js';
import { whatsappService } from '../services/whatsappService.js';
import { emailService } from '../services/emailService.js';
import logger from '../utils/logger.js';

// Concurrency : 3 jobs en parallèle (augmente si beaucoup de membres)
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 3;

notificationQueue.process(CONCURRENCY, async (job) => {
  const { type, data } = job.data;

  try {
    switch (type) {
      case 'whatsapp':
        if (!data?.to || !data?.message) throw new Error('Données WhatsApp incomplètes');
        await whatsappService.send(data);
        break;

      case 'email':
        if (!data?.to || !data?.subject) throw new Error('Données email incomplètes');
        await emailService.sendAlert(data);
        break;

      default:
        throw new Error(`Type de notification inconnu: "${type}"`);
    }

    logger.info(`✅ Worker: Job #${job.id} (${type} → ${data?.to}) traité`);
    return { success: true };

  } catch (err) {
    logger.error(`❌ Worker: Job #${job.id} (${type}) erreur: ${err.message}`);
    throw err; // Important: relancer pour que Bull gère le retry
  }
});

// [BUG-09 FIX] Alerter quand un job échoue définitivement
notificationQueue.on('failed', (job, err) => {
  logger.error([
    `🚨 NOTIFICATION DÉFINITIVEMENT PERDUE`,
    `   Job #${job.id} — ${job.data?.type} → ${job.data?.data?.to}`,
    `   Tentatives épuisées: ${job.attemptsMade}`,
    `   Erreur: ${err.message}`,
  ].join('\n'));
});

logger.info(`🔄 NotificationWorker démarré (concurrency=${CONCURRENCY})`);
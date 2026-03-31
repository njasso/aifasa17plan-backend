// backend/queues/notificationQueue.js
// ✅ VERSION CORRIGÉE — AIFASA 17
// BUG-08 FIX : Listeners d'erreurs Redis + options de nettoyage auto

import Queue from 'bull';
import logger from '../utils/logger.js';

export const notificationQueue = new Queue('notifications', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    // Reconnexion automatique si Redis tombe temporairement
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  },
  // Options par défaut pour tous les jobs
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: 'exponential', delay: 3000 },
    removeOnComplete: 100, // Garder les 100 derniers jobs réussis
    removeOnFail:     50,  // Garder les 50 derniers jobs échoués
  },
});

// [BUG-08 FIX] — Écouter les erreurs Redis pour éviter crash Node.js
notificationQueue.on('error', (err) => {
  logger.error(`❌ Queue Redis erreur: ${err.message}`);
});

notificationQueue.on('failed', (job, err) => {
  logger.error([
    `🚨 Notification perdue définitivement`,
    `   Job #${job.id} type="${job.data?.type}" → ${job.data?.data?.to}`,
    `   Tentatives: ${job.attemptsMade}/${job.opts.attempts}`,
    `   Erreur: ${err.message}`,
  ].join('\n'));
});

notificationQueue.on('stalled', (job) => {
  logger.warn(`⚠️ Job #${job.id} stallé (worker arrêté?)`);
});

notificationQueue.on('completed', (job) => {
  logger.info(`✅ Job #${job.id} (${job.data?.type} → ${job.data?.data?.to}) OK`);
});

export default notificationQueue;
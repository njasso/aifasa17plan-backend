// backend/services/schedulerService.js
// ✅ VERSION CORRIGÉE — AIFASA 17 AssocPlanner
// Corrections appliquées :
//  BUG-04 : try/catch global sur checkDeadlines()
//  BUG-05 : try/catch global + isolation par alerte sur sendScheduledAlerts()
//  BUG-06 : sendDailyDigest() réécrit (distinct() → find().populate() + Map)
//  BUG-07 : méthode stop() ajoutée (server.js::gracefulShutdown en avait besoin)
//  BUG-10 : act.save() isolé dans son propre try/catch
//  BUG-11 : catch {} vide remplacé par catch(e) avec logger.warn
//  BUG-12 : sendWeeklyReport() implémenté réellement (envoi notifs)

import cron from 'node-cron';
import Activite from '../models/Activite.js';
import { Alerte } from '../models/AlerteMessage.js';
import { aiService } from './aiService.js';
import { notificationQueue } from '../queues/notificationQueue.js';
import logger from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────
//  Étapes d'alerte automatique avant deadline
// ─────────────────────────────────────────────────────────────
const ETAPES = [
  { minutes: 7 * 24 * 60, label: '7 jours',   emoji: '📅', priority: 5 },
  { minutes: 3 * 24 * 60, label: '3 jours',   emoji: '⏳', priority: 4 },
  { minutes:      24 * 60, label: '24 heures', emoji: '⚠️', priority: 3 },
  { minutes:       6 * 60, label: '6 heures',  emoji: '🚨', priority: 2 },
  { minutes:           60, label: '1 heure',   emoji: '🔴', priority: 1 },
];

// Références des tâches cron (pour stop propre)
const _tasks = [];

// ─────────────────────────────────────────────────────────────
export const schedulerService = {

  start() {
    _tasks.push(
      cron.schedule('*/30 * * * *', async () => {
        logger.info('⏰ Vérification deadlines...');
        await this.checkDeadlines();
      })
    );

    _tasks.push(
      cron.schedule('* * * * *', async () => {
        await this.sendScheduledAlerts();
      })
    );

    _tasks.push(
      cron.schedule('0 8 * * *', async () => {
        logger.info('📊 Envoi digest quotidien...');
        await this.sendDailyDigest();
      })
    );

    _tasks.push(
      cron.schedule('0 9 * * 1', async () => {
        logger.info('📈 Envoi rapport hebdomadaire...');
        await this.sendWeeklyReport();
      })
    );

    logger.info('✅ Scheduler démarré (4 tâches)');
  },

  // [BUG-07 FIX] Méthode stop() — server.js::gracefulShutdown l'appelle
  stop() {
    _tasks.forEach(t => t.stop());
    _tasks.length = 0;
    logger.info('🛑 Scheduler arrêté');
  },

  // ─────────────────────────────────────────────────────────
  //  DEADLINES — [BUG-04 FIX] try/catch global
  // ─────────────────────────────────────────────────────────
  async checkDeadlines() {
    try {
      const now = new Date();

      const activites = await Activite.find({
        statut:  { $in: ['planifie', 'en_cours'] },
        dateFin: { $gte: now },
      }).populate('responsables', 'nom prenom email whatsapp telephone');

      for (const act of activites) {
        const minutesRestantes = Math.round((act.dateFin - now) / 60000);

        for (const etape of ETAPES) {
          const alreadySent = act.alertHistory?.some(a => a.type === etape.label);

          if (Math.abs(minutesRestantes - etape.minutes) <= 15 && !alreadySent) {
            await this.notify(act, etape);

            // [BUG-10 FIX] save isolé
            try {
              act.alertHistory = act.alertHistory || [];
              act.alertHistory.push({ type: etape.label, sentAt: new Date() });
              await act.save();
            } catch (saveErr) {
              logger.error(`❌ Échec save alertHistory "${act.titre}": ${saveErr.message}`);
            }
          }
        }
      }
    } catch (err) {
      logger.error(`❌ checkDeadlines: ${err.message}`, { stack: err.stack });
    }
  },

  // ─────────────────────────────────────────────────────────
  //  NOTIFICATION — [BUG-11 FIX] catch IA avec log
  // ─────────────────────────────────────────────────────────
  async notify(act, etape) {
    // [BUG-11 FIX] catch avec log au lieu de catch {}
    let suggestion = '';
    try {
      if (process.env.DEEPSEEK_API_KEY) {
        suggestion = await aiService.suggererAction(act);
      }
    } catch (e) {
      logger.warn(`⚠️ aiService échec pour "${act.titre}": ${e.message}`);
    }

    const dateStr = new Date(act.dateFin).toLocaleDateString('fr-FR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });

    const message = [
      `${etape.emoji} *${etape.label} avant la deadline*`,
      `📋 Activité : *${act.titre}*`,
      `📅 Échéance : ${dateStr}`,
      suggestion ? `\n💡 Suggestion IA : ${suggestion}` : '',
      `\n_${process.env.APP_NAME || 'AIFASA 17'} — Gestion associative_`,
    ].filter(Boolean).join('\n');

    for (const resp of act.responsables) {
      const tel = resp.whatsapp || resp.telephone;

      if (resp.email) {
        await notificationQueue.add(
          { type: 'email', data: { to: resp.email, subject: `${etape.emoji} ${etape.label} — ${act.titre}`, message } },
          { attempts: 5, backoff: { type: 'exponential', delay: 5000 } }
        );
      }

      if (tel) {
        await notificationQueue.add(
          { type: 'whatsapp', data: { to: tel, message } },
          { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, priority: etape.priority }
        );
      }
    }

    logger.info(`✅ Alerte "${etape.label}" mise en queue pour "${act.titre}" (${act.responsables.length} resp.)`);
  },

  // ─────────────────────────────────────────────────────────
  //  ALERTES MANUELLES — [BUG-05 FIX] double try/catch
  // ─────────────────────────────────────────────────────────
  async sendScheduledAlerts() {
    try {
      const now = new Date();
      const alertes = await Alerte.find({
        statut:         'programmee',
        dateProgrammee: { $lte: now },
      }).populate('destinataires.membre', 'nom prenom email whatsapp telephone');

      for (const alerte of alertes) {
        // [BUG-05 FIX] isolation par alerte
        try {
          for (const dest of alerte.destinataires) {
            if (dest.statut === 'envoye') continue;

            const email = dest.email || dest.membre?.email;
            const tel   = dest.whatsapp || dest.membre?.whatsapp || dest.membre?.telephone;

            if (email) {
              await notificationQueue.add({
                type: 'email',
                data: { to: email, subject: alerte.titre, message: alerte.message },
              });
            }
            if (tel) {
              await notificationQueue.add({
                type: 'whatsapp',
                data: { to: tel, message: alerte.message },
              });
            }
            dest.statut = 'envoye';
          }

          alerte.statut    = 'envoyee';
          alerte.dateEnvoi = new Date();
          await alerte.save();

        } catch (alerteErr) {
          logger.error(`❌ Traitement alerte ${alerte._id}: ${alerteErr.message}`);
        }
      }
    } catch (err) {
      logger.error(`❌ sendScheduledAlerts: ${err.message}`, { stack: err.stack });
    }
  },

  // ─────────────────────────────────────────────────────────
  //  DIGEST QUOTIDIEN — [BUG-06 FIX] distinct() → find().populate() + Map
  // ─────────────────────────────────────────────────────────
  async sendDailyDigest() {
    try {
      const today  = new Date();
      const dans7j = new Date(today.getTime() + 7 * 86400000);

      const urgentes = await Activite.find({
        priorite: 'urgente',
        statut:   { $nin: ['termine', 'annule'] },
      }).populate('responsables', 'email whatsapp telephone');

      const deadlines = await Activite.find({
        dateFin: { $gte: today, $lte: dans7j },
        statut:  { $nin: ['termine', 'annule'] },
      }).populate('responsables', 'email whatsapp telephone');

      if (urgentes.length === 0 && deadlines.length === 0) return;

      const lignes = deadlines
        .slice(0, 5)
        .map(a => `• ${a.titre} — ${new Date(a.dateFin).toLocaleDateString('fr-FR')}`)
        .join('\n');

      const msg = [
        `📊 *Digest du ${today.toLocaleDateString('fr-FR')}*`,
        '',
        urgentes.length  > 0 ? `🚨 ${urgentes.length} activité(s) urgente(s) en cours` : '',
        deadlines.length > 0 ? `⏰ ${deadlines.length} deadline(s) dans les 7 prochains jours` : '',
        '',
        lignes,
        '',
        `_${process.env.APP_NAME || 'AIFASA 17'}_`,
      ].filter(l => l !== null && l !== undefined).join('\n');

      // [BUG-06 FIX] Déduplication via Map (objets populés, pas ObjectIds)
      const responsablesMap = new Map();
      for (const act of [...urgentes, ...deadlines]) {
        for (const r of act.responsables || []) {
          if (r._id && !responsablesMap.has(r._id.toString())) {
            responsablesMap.set(r._id.toString(), r);
          }
        }
      }

      for (const [, resp] of responsablesMap) {
        if (resp.email) {
          await notificationQueue.add({
            type: 'email',
            data: { to: resp.email, subject: `📊 Digest AIFASA 17 — ${today.toLocaleDateString('fr-FR')}`, message: msg },
          });
        }
        const tel = resp.whatsapp || resp.telephone;
        if (tel) {
          await notificationQueue.add({
            type: 'whatsapp',
            data: { to: tel, message: msg },
          });
        }
      }

      logger.info(`📊 Digest mis en queue pour ${responsablesMap.size} membre(s)`);
    } catch (err) {
      logger.error(`❌ sendDailyDigest: ${err.message}`, { stack: err.stack });
    }
  },

  // ─────────────────────────────────────────────────────────
  //  RAPPORT HEBDO — [BUG-12 FIX] envoi réel implémenté
  // ─────────────────────────────────────────────────────────
  async sendWeeklyReport() {
    try {
      const total     = await Activite.countDocuments();
      const enCours   = await Activite.countDocuments({ statut: 'en_cours' });
      const terminees = await Activite.countDocuments({ statut: 'termine' });
      const urgentes  = await Activite.countDocuments({ priorite: 'urgente', statut: { $nin: ['termine', 'annule'] } });
      const taux      = total > 0 ? Math.round((terminees / total) * 100) : 0;

      const msg = [
        `📈 *Rapport hebdomadaire — ${new Date().toLocaleDateString('fr-FR')}*`,
        '',
        `📋 Total activités  : ${total}`,
        `🔄 En cours         : ${enCours}`,
        `✅ Terminées        : ${terminees} (${taux}%)`,
        `🚨 Urgentes actives : ${urgentes}`,
        '',
        `_${process.env.APP_NAME || 'AIFASA 17'} — Gestion associative_`,
      ].join('\n');

      const activitesActives = await Activite.find({ statut: { $nin: ['annule'] } })
        .populate('responsables', 'email whatsapp telephone')
        .lean();

      const responsablesMap = new Map();
      for (const act of activitesActives) {
        for (const r of act.responsables || []) {
          if (r._id && !responsablesMap.has(r._id.toString())) {
            responsablesMap.set(r._id.toString(), r);
          }
        }
      }

      for (const [, resp] of responsablesMap) {
        if (resp.email) {
          await notificationQueue.add({
            type: 'email',
            data: { to: resp.email, subject: '📈 Rapport hebdomadaire AIFASA 17', message: msg },
          });
        }
        const tel = resp.whatsapp || resp.telephone;
        if (tel) {
          await notificationQueue.add({ type: 'whatsapp', data: { to: tel, message: msg } });
        }
      }

      logger.info(`📈 Rapport hebdo mis en queue pour ${responsablesMap.size} membre(s) (${taux}% terminé)`);
    } catch (err) {
      logger.error(`❌ sendWeeklyReport: ${err.message}`, { stack: err.stack });
    }
  },
};
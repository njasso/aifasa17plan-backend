// backend/routes/dashboard.js
import express from 'express';
import { query, validationResult } from 'express-validator';
import Activite from '../models/Activite.js';
import Membre from '../models/Membre.js';
import { Alerte, Message } from '../models/AlerteMessage.js';
import { protect } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// GET /api/dashboard - Données du tableau de bord
router.get('/',
  query('period').optional().isIn(['day', 'week', 'month', 'year']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const now = new Date();
      const week = new Date(now.getTime() + 7 * 86400 * 1000);
      const month = new Date(now.getTime() - 30 * 86400 * 1000);
      const year = new Date(now.getTime() - 365 * 86400 * 1000);

      const [
        totalActivites,
        activitesEnCours,
        activitesTerminees,
        activitesUrgentes,
        deadlinesSemaine,
        totalMembres,
        membresActifs,
        alertesProgrammees,
        messagesEnvoyes,
        activitesRecentes,
        activitesParType,
        activitesParMois
      ] = await Promise.all([
        Activite.countDocuments(),
        Activite.countDocuments({ statut: 'en_cours' }),
        Activite.countDocuments({ statut: 'termine' }),
        Activite.countDocuments({ priorite: 'urgente', statut: { $nin: ['termine', 'annule'] } }),
        Activite.countDocuments({ dateFin: { $gte: now, $lte: week }, statut: { $nin: ['termine', 'annule'] } }),
        Membre.countDocuments(),
        Membre.countDocuments({ actif: true }),
        Alerte.countDocuments({ statut: 'programmee' }),
        Message.countDocuments({ statut: 'envoye', createdAt: { $gte: month } }),
        Activite.find({ statut: { $nin: ['termine', 'annule'] } })
          .sort({ dateFin: 1 })
          .limit(5)
          .populate('responsables', 'nom prenom photo')
          .select('titre statut priorite dateFin progression type'),
        Activite.aggregate([
          { $group: { _id: '$type', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        Activite.aggregate([
          {
            $match: {
              createdAt: { $gte: year }
            }
          },
          {
            $group: {
              _id: { $month: '$createdAt' },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ])
      ]);

      const tauxCompletion = totalActivites > 0
        ? Math.round((activitesTerminees / totalActivites) * 100)
        : 0;

      res.json({
        success: true,
        data: {
          activites: {
            total: totalActivites,
            enCours: activitesEnCours,
            terminees: activitesTerminees,
            urgentes: activitesUrgentes,
            deadlinesSemaine,
            tauxCompletion,
            parType: activitesParType,
            parMois: activitesParMois
          },
          membres: {
            total: totalMembres,
            actifs: membresActifs,
            tauxActifs: totalMembres > 0 ? Math.round((membresActifs / totalMembres) * 100) : 0
          },
          alertes: {
            programmees: alertesProgrammees
          },
          messages: {
            envoyesCeMois: messagesEnvoyes
          },
          activitesRecentes
        }
      });
    } catch (err) {
      logger.error('Erreur GET /dashboard:', err);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des données du tableau de bord' });
    }
  }
);

export default router;
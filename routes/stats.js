// backend/routes/stats.js
import express from 'express';
import { protect, admin } from '../middleware/auth.js';
import Activite from '../models/Activite.js';
import Membre from '../models/Membre.js';
import { Alerte, Message } from '../models/AlerteMessage.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// GET /api/stats/global - Statistiques globales
router.get('/global', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));

    const [
      totalActivites,
      activitesMois,
      activitesSemaine,
      totalMembres,
      nouveauxMembresMois,
      messagesEnvoyes,
      alertesEnvoyees
    ] = await Promise.all([
      Activite.countDocuments(),
      Activite.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Activite.countDocuments({ createdAt: { $gte: startOfWeek } }),
      Membre.countDocuments(),
      Membre.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Message.countDocuments({ statut: 'envoye' }),
      Alerte.countDocuments({ statut: 'envoyee' })
    ]);

    res.json({
      success: true,
      data: {
        activites: {
          total: totalActivites,
          ceMois: activitesMois,
          cetteSemaine: activitesSemaine
        },
        membres: {
          total: totalMembres,
          nouveauxCeMois: nouveauxMembresMois
        },
        communications: {
          messagesEnvoyes,
          alertesEnvoyees
        }
      }
    });
  } catch (err) {
    logger.error('Erreur GET /stats/global:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/stats/activites - Statistiques détaillées des activités
router.get('/activites', admin, async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const [parType, parStatut, parPriorite] = await Promise.all([
      Activite.aggregate([{ $match: filter }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
      Activite.aggregate([{ $match: filter }, { $group: { _id: '$statut', count: { $sum: 1 } } }]),
      Activite.aggregate([{ $match: filter }, { $group: { _id: '$priorite', count: { $sum: 1 } } }])
    ]);

    res.json({
      success: true,
      data: { parType, parStatut, parPriorite }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/stats/membres - Statistiques des membres
router.get('/membres', admin, async (req, res) => {
  try {
    const membresParRole = await Membre.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const competencesPopulaires = await Membre.aggregate([
      { $unwind: '$competences' },
      { $group: { _id: '$competences', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        parRole: membresParRole,
        competencesPopulaires
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
// backend/routes/targets.js
import express from 'express';
import { query, validationResult } from 'express-validator';
import Activite from '../models/Activite.js';
import { protect } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// GET /api/targets - Récupérer toutes les cibles
router.get('/',
  query('type').optional().isIn(['personne', 'projet', 'evenement', 'groupe', 'autre']),
  query('activiteId').optional().isMongoId(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { type, activiteId } = req.query;
      const filter = { 'cibles.0': { $exists: true } };

      if (activiteId) {
        filter._id = activiteId;
      }

      let activitesQuery = Activite.find(filter)
        .select('titre cibles dateDebut dateFin type statut')
        .lean();

      const activites = await activitesQuery;

      const cibles = activites.flatMap(a =>
        a.cibles
          .filter(c => !type || c.type === type)
          .map(c => ({
            ...c,
            activiteTitre: a.titre,
            activiteId: a._id,
            activiteType: a.type,
            activiteStatut: a.statut,
            dateDebut: a.dateDebut,
            dateFin: a.dateFin
          }))
      );

      // Statistiques par type
      const stats = {};
      cibles.forEach(c => {
        if (!stats[c.type]) {
          stats[c.type] = { count: 0, nom: c.type };
        }
        stats[c.type].count++;
      });

      res.json({
        success: true,
        data: cibles,
        stats: Object.values(stats),
        total: cibles.length
      });
    } catch (err) {
      logger.error('Erreur GET /targets:', err);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des cibles' });
    }
  }
);

// GET /api/targets/activite/:id - Cibles d'une activité spécifique
router.get('/activite/:id',
  async (req, res) => {
    try {
      const activite = await Activite.findById(req.params.id)
        .select('titre cibles')
        .lean();

      if (!activite) {
        return res.status(404).json({ success: false, message: 'Activité introuvable' });
      }

      res.json({
        success: true,
        data: {
          activite: activite.titre,
          cibles: activite.cibles || []
        }
      });
    } catch (err) {
      logger.error(`Erreur GET /targets/activite/${req.params.id}:`, err);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des cibles' });
    }
  }
);

export default router;
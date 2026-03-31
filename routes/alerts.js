// backend/routes/alerts.js
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { Alerte } from '../models/AlerteMessage.js';
import Membre from '../models/Membre.js';
import { protect } from '../middleware/auth.js';
import { emailService } from '../services/emailService.js';
import { whatsappService } from '../services/whatsappService.js';
import logger from '../utils/logger.js';

// DÉCLARATION DU ROUTER (manquante)
const router = express.Router();
router.use(protect);

// Validation pour la création d'alerte
const validateAlerte = [
  body('titre').trim().notEmpty().withMessage('Le titre est requis').isLength({ max: 200 }),
  body('message').trim().notEmpty().withMessage('Le message est requis'),
  body('type').optional().isIn(['deadline', 'rappel', 'urgence', 'info']),
  body('canaux').isArray().withMessage('Les canaux doivent être un tableau'),
  body('canaux.*').isIn(['email', 'whatsapp', 'inapp']),
  body('dateProgrammee').isISO8601().withMessage('Date invalide'),
  body('destinataires').optional().isArray(),
  body('activite').optional().isMongoId()
];

// GET /api/alerts - Liste des alertes
router.get('/', async (req, res) => {
  try {
    const { statut, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (statut) filter.statut = statut;

    const skip = (page - 1) * limit;

    const [alertes, total] = await Promise.all([
      Alerte.find(filter)
        .populate('destinataires.membre', 'nom prenom email whatsapp')
        .populate('activite', 'titre dateFin')
        .sort({ dateProgrammee: -1 })
        .skip(skip)
        .limit(limit),
      Alerte.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: alertes,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    logger.error('Erreur GET /alerts:', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des alertes' });
  }
});

// POST /api/alerts - Créer une alerte
router.post('/', validateAlerte, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { destinataires, dateProgrammee, ...rest } = req.body;

    // Vérifier que dateProgrammee est présente
    if (!dateProgrammee) {
      return res.status(400).json({ 
        success: false, 
        message: 'La date de programmation est requise' 
      });
    }

    // NORMALISER LA DATE
    let normalizedDate = dateProgrammee;
    
    if (normalizedDate && !normalizedDate.includes('Z') && !normalizedDate.includes('+')) {
      if (normalizedDate.length === 10) {
        normalizedDate = `${normalizedDate}T12:00:00.000Z`;
      } 
      else if (normalizedDate.length === 16) {
        normalizedDate = `${normalizedDate}:00.000Z`;
      }
    }
    
    let dateObj = new Date(normalizedDate);
    
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ 
        success: false, 
        message: 'Format de date invalide' 
      });
    }
    
    const now = new Date();
    if (dateObj <= now) {
      dateObj = new Date(now.getTime() + 5 * 60 * 1000);
      console.log(`📅 Date ajustée: ${dateObj.toISOString()}`);
    }

    if (!rest.canaux || rest.canaux.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Au moins un canal doit être sélectionné' 
      });
    }

    // Enrichir les destinataires
    const enrichedDestinataires = [];
    
    if (destinataires && destinataires.length > 0) {
      for (const dest of destinataires) {
        if (dest.membre) {
          const membre = await Membre.findById(dest.membre);
          if (membre) {
            enrichedDestinataires.push({
              membre: dest.membre,
              email: dest.email || membre.email,
              whatsapp: dest.whatsapp || membre.whatsapp,
              statut: 'en_attente'
            });
          }
        } else {
          enrichedDestinataires.push({
            ...dest,
            statut: 'en_attente'
          });
        }
      }
    }

    if (enrichedDestinataires.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Aucun destinataire valide' 
      });
    }

    const alerte = await Alerte.create({
      ...rest,
      dateProgrammee: dateObj,
      destinataires: enrichedDestinataires,
      createdBy: req.user._id,
      statut: 'programmee'
    });

    logger.info(`Alerte créée: ${alerte.titre} (${alerte._id})`);

    res.status(201).json({
      success: true,
      data: alerte,
      message: 'Alerte programmée avec succès'
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      logger.error('Erreur validation:', messages);
      return res.status(400).json({ 
        success: false, 
        message: 'Erreur de validation',
        errors: messages 
      });
    }
    
    logger.error('Erreur POST /alerts:', err);
    res.status(500).json({ 
      success: false, 
      message: err.message || 'Erreur lors de la création de l\'alerte' 
    });
  }
});

// POST /api/alerts/:id/send - Envoyer une alerte immédiatement
router.post('/:id/send',
  param('id').isMongoId().withMessage('ID invalide'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const alerte = await Alerte.findById(req.params.id).populate('destinataires.membre');
      if (!alerte) {
        return res.status(404).json({ success: false, message: 'Alerte introuvable' });
      }

      if (alerte.statut !== 'programmee') {
        return res.status(400).json({ success: false, message: 'Cette alerte ne peut plus être envoyée' });
      }

      const resultats = [];
      const errorsList = [];

      for (const dest of alerte.destinataires) {
        const email = dest.email || dest.membre?.email;
        const whatsapp = dest.whatsapp || dest.membre?.whatsapp;

        for (const canal of alerte.canaux) {
          try {
            if (canal === 'email' && email) {
              const r = await emailService.sendAlert({
                to: email,
                subject: alerte.titre,
                message: alerte.message
              });
              resultats.push({ canal, dest: email, success: r.success });
              dest.statut = r.success ? 'envoye' : 'echoue';
            }

            if (canal === 'whatsapp' && whatsapp) {
              const r = await whatsappService.send({
                to: whatsapp,
                message: whatsappService.formatters.alerte({
                  titre: alerte.titre,
                  message: alerte.message,
                  priorite: alerte.type
                })
              });
              resultats.push({ canal, dest: whatsapp, success: r.success });
              dest.statut = r.success ? 'envoye' : 'echoue';
            }
          } catch (err) {
            logger.error(`Erreur envoi:`, err);
            errorsList.push({ canal, dest: dest.membre?._id, error: err.message });
            dest.statut = 'echoue';
          }
        }
      }

      alerte.statut = resultats.some(r => r.success) ? 'envoyee' : 'echouee';
      alerte.dateEnvoi = new Date();
      await alerte.save();

      res.json({
        success: true,
        resultats,
        errors: errorsList.length > 0 ? errorsList : undefined,
        message: `${resultats.filter(r => r.success).length} message(s) envoyé(s)`
      });
    } catch (err) {
      logger.error(`Erreur POST /alerts/${req.params.id}/send:`, err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// DELETE /api/alerts/:id - Supprimer une alerte
router.delete('/:id',
  param('id').isMongoId().withMessage('ID invalide'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const alerte = await Alerte.findByIdAndDelete(req.params.id);

      if (!alerte) {
        return res.status(404).json({ success: false, message: 'Alerte introuvable' });
      }

      logger.info(`Alerte supprimée: ${alerte.titre} (${alerte._id})`);

      res.json({ success: true, message: 'Alerte supprimée avec succès' });
    } catch (err) {
      logger.error(`Erreur DELETE /alerts/${req.params.id}:`, err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

export default router;
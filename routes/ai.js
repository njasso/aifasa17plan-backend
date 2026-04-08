// backend/routes/ai.js
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { aiService } from '../services/aiService.js';
import Activite from '../models/Activite.js';
import Jalon from '../models/Jalon.js';
import Ressource from '../models/Ressource.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// ──────────────────────────────────────────────────────────────
// GET /api/ai/status - Vérifier la configuration IA
// ──────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ 
    success: true, 
    disponible: aiService.isConfigured(), 
    modele: 'DeepSeek Chat',
    version: '2.0.0',
    fonctions: [
      'optimisation_planning',
      'redaction_messages',
      'analyse_activites',
      'analyse_critique',
      'reallocation_ressources',
      'planification_jalons',
      'redaction_compte_rendu'
    ]
  });
});

// ──────────────────────────────────────────────────────────────
// POST /api/ai/analyser/:id - Analyse approfondie d'une activité
// ──────────────────────────────────────────────────────────────
router.post('/analyser/:id',
  param('id').isMongoId().withMessage('ID invalide'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const act = await Activite.findById(req.params.id)
        .populate('responsables', 'nom prenom email')
        .populate('cibles.membreRef', 'nom prenom');
      
      if (!act) {
        return res.status(404).json({ success: false, message: 'Activité introuvable' });
      }

      // Récupérer les jalons associés
      const jalons = await Jalon.find({ activiteId: act._id });
      
      // Récupérer les ressources associées
      const ressources = await Ressource.find({ activiteId: act._id });

      const analyse = await aiService.analyserActivite({
        ...act.toObject(),
        jalons,
        ressources
      });
      
      res.json({ success: true, data: analyse });
    } catch (err) { 
      logger.error('Erreur POST /ai/analyser/:id:', err);
      res.status(500).json({ success: false, message: err.message }); 
    }
  }
);

// ──────────────────────────────────────────────────────────────
// GET /api/ai/optimiser - Optimisation du planning global
// ──────────────────────────────────────────────────────────────
router.get('/optimiser', async (req, res) => {
  try {
    const activites = await Activite.find({ 
      statut: { $nin: ['termine', 'annule'] } 
    })
      .sort({ dateFin: 1 })
      .limit(15)
      .populate('responsables', 'nom prenom');
    
    if (!activites.length) {
      return res.json({ success: true, data: "Aucune activité en cours à analyser." });
    }

    const suggestions = await aiService.optimiserPlanning(activites);
    res.json({ success: true, data: suggestions });
  } catch (err) { 
    logger.error('Erreur GET /ai/optimiser:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/ai/rediger-message - Rédaction automatique de message
// ──────────────────────────────────────────────────────────────
router.post('/rediger-message',
  body('titre').notEmpty().withMessage('Le titre est requis'),
  body('contexte').notEmpty().withMessage('Le contexte est requis'),
  body('canal').isIn(['email', 'whatsapp']).withMessage('Canal invalide'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { titre, contexte, canal, priorite = 'normale' } = req.body;
      const msg = await aiService.redigerMessage({ titre, contexte, canal, priorite });
      
      if (!msg) {
        return res.status(503).json({ success: false, message: 'IA non disponible' });
      }
      
      res.json({ success: true, data: msg });
    } catch (err) { 
      logger.error('Erreur POST /ai/rediger-message:', err);
      res.status(500).json({ success: false, message: err.message }); 
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /api/ai/analyser-critique - Analyse des situations critiques
// ──────────────────────────────────────────────────────────────
router.post('/analyser-critique', async (req, res) => {
  try {
    const { activites, jalons, ressources } = req.body;
    
    // Si pas de données fournies, récupérer depuis la base
    let activitesData = activites;
    let jalonsData = jalons;
    let ressourcesData = ressources;
    
    if (!activitesData) {
      activitesData = await Activite.find({ 
        statut: { $nin: ['termine', 'annule'] } 
      }).limit(20);
    }
    
    if (!jalonsData) {
      jalonsData = await Jalon.find({ 
        statut: { $nin: ['atteint', 'annule'] } 
      }).limit(20);
    }
    
    if (!ressourcesData) {
      ressourcesData = await Ressource.find({}).limit(20);
    }
    
    const analyse = await aiService.analyserCritique(activitesData, jalonsData, ressourcesData);
    
    res.json({ 
      success: true, 
      data: analyse,
      meta: {
        activitesAnalysees: activitesData.length,
        jalonsAnalysees: jalonsData.length,
        ressourcesAnalysees: ressourcesData.length
      }
    });
  } catch (err) { 
    logger.error('Erreur POST /ai/analyser-critique:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/ai/suggerer-reallocation - Suggestions de réallocation
// ──────────────────────────────────────────────────────────────
router.post('/suggerer-reallocation', async (req, res) => {
  try {
    const { activites, ressources } = req.body;
    
    let activitesData = activites;
    let ressourcesData = ressources;
    
    if (!activitesData) {
      activitesData = await Activite.find({ 
        priorite: 'urgente', 
        statut: { $nin: ['termine', 'annule'] } 
      }).populate('responsables');
    }
    
    if (!ressourcesData) {
      ressourcesData = await Ressource.find({}).populate('responsable');
    }
    
    const suggestions = await aiService.suggererReallocation(activitesData, ressourcesData);
    
    res.json({ success: true, data: suggestions });
  } catch (err) { 
    logger.error('Erreur POST /ai/suggerer-reallocation:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/ai/planifier-jalons/:id - Planification automatique des jalons
// ──────────────────────────────────────────────────────────────
router.post('/planifier-jalons/:id',
  param('id').isMongoId().withMessage('ID invalide'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const activite = await Activite.findById(req.params.id);
      if (!activite) {
        return res.status(404).json({ success: false, message: 'Activité introuvable' });
      }
      
      const jalonsProposes = await aiService.planifierJalons(activite);
      
      if (!jalonsProposes) {
        return res.status(503).json({ success: false, message: 'IA non disponible' });
      }
      
      // Optionnel: Créer automatiquement les jalons
      const autoCreate = req.body.autoCreate === true;
      const jalonsCrees = [];
      
      if (autoCreate && Array.isArray(jalonsProposes)) {
        for (const jalon of jalonsProposes) {
          const nouveauJalon = await Jalon.create({
            titre: jalon.nom,
            description: jalon.description,
            activiteId: activite._id,
            datePrevue: new Date(activite.dateDebut.getTime() + (jalon.progression / 100) * (activite.dateFin - activite.dateDebut)),
            progression: jalon.progression,
            responsable: activite.responsables?.[0]
          });
          jalonsCrees.push(nouveauJalon);
        }
      }
      
      res.json({ 
        success: true, 
        data: jalonsProposes,
        jalonsCrees: autoCreate ? jalonsCrees : undefined,
        message: autoCreate ? `${jalonsCrees.length} jalons créés` : 'Jalons proposés (non créés)'
      });
    } catch (err) { 
      logger.error('Erreur POST /ai/planifier-jalons/:id:', err);
      res.status(500).json({ success: false, message: err.message }); 
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /api/ai/rediger-compte-rendu - Rédaction de compte-rendu
// ──────────────────────────────────────────────────────────────
router.post('/rediger-compte-rendu',
  body('sujet').notEmpty().withMessage('Le sujet est requis'),
  body('date').optional().isISO8601(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { sujet, date, participants, points, decisions } = req.body;
      
      const compteRendu = await aiService.redigerCompteRendu({
        sujet,
        date: date || new Date(),
        participants: participants || [],
        points: points || [],
        decisions: decisions || []
      });
      
      if (!compteRendu) {
        return res.status(503).json({ success: false, message: 'IA non disponible' });
      }
      
      res.json({ success: true, data: compteRendu });
    } catch (err) { 
      logger.error('Erreur POST /ai/rediger-compte-rendu:', err);
      res.status(500).json({ success: false, message: err.message }); 
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /api/ai/resume - Résumé de rapport (générique)
// ──────────────────────────────────────────────────────────────
router.post('/resume', async (req, res) => {
  try {
    const { data, type = 'general' } = req.body;
    
    if (!data) {
      return res.status(400).json({ success: false, message: 'Données manquantes' });
    }
    
    let resume;
    
    if (type === 'rapport') {
      resume = await aiService.resumerRapport(data);
    } else {
      const prompt = `Rédige un résumé concis de ces données : ${JSON.stringify(data)}`;
      resume = await aiService.redigerMessage({ titre: 'Résumé', contexte: prompt, canal: 'email' });
    }
    
    res.json({ success: true, data: resume });
  } catch (err) { 
    logger.error('Erreur POST /ai/resume:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
});

// ──────────────────────────────────────────────────────────────
// GET /api/ai/suggestions - Suggestions rapides pour le dashboard
// ──────────────────────────────────────────────────────────────
router.get('/suggestions', async (req, res) => {
  try {
    const [activites, jalons, ressources] = await Promise.all([
      Activite.find({ statut: { $nin: ['termine', 'annule'] } }).limit(10),
      Jalon.find({ statut: { $nin: ['atteint', 'annule'] }, datePrevue: { $lt: new Date() } }).limit(5),
      Ressource.find({ disponibilite: false }).limit(5)
    ]);
    
    const suggestions = [];
    
    // Suggestions basées sur les activités
    for (const act of activites) {
      const daysLeft = Math.ceil((new Date(act.dateFin) - new Date()) / 86400000);
      if (daysLeft <= 3 && act.progression < 50) {
        suggestions.push({
          type: 'urgence',
          message: `"${act.titre}" se termine dans ${daysLeft} jours (progression: ${act.progression}%)`,
          activiteId: act._id
        });
      }
    }
    
    // Suggestions IA avancées si disponible
    let iaSuggestions = null;
    if (aiService.isConfigured() && activites.length > 0) {
      iaSuggestions = await aiService.optimiserPlanning(activites.slice(0, 5));
    }
    
    res.json({ 
      success: true, 
      data: {
        urgences: suggestions,
        jalonsDepasses: jalons.map(j => ({ titre: j.titre, datePrevue: j.datePrevue })),
        ressourcesIndisponibles: ressources.map(r => ({ nom: r.nom, type: r.type })),
        iaSuggestions
      }
    });
  } catch (err) { 
    logger.error('Erreur GET /ai/suggestions:', err);
    res.status(500).json({ success: false, message: err.message }); 
  }
});

export default router;
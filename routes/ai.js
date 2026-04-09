// backend/routes/ai.js - VERSION ULTIME COMPLÈTE
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { protect } from '../middleware/auth.js';
import { aiService } from '../services/aiService.js';
import Activite from '../models/Activite.js';
import Jalon from '../models/Jalon.js';
import Ressource from '../models/Ressource.js';
import Membre from '../models/Membre.js';
import { Transaction, Expense, Caisse } from '../models/Finance.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// ──────────────────────────────────────────────────────────────
// GET /api/ai/status - Vérifier la configuration IA (ULTIME)
// ──────────────────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json({ 
    success: true, 
    disponible: aiService.isConfigured(), 
    modele: 'DeepSeek Chat',
    version: '3.0.0-ultime',
    fonctions: [
      'optimisation_planning',
      'redaction_messages',
      'analyse_activites',
      'analyse_critique',
      'reallocation_ressources',
      'planification_jalons',
      'redaction_compte_rendu',
      'analyse_finances',
      'detection_membres_risque',
      'planification_activites',
      'rapport_narratif',
      'chat_contextuel'
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

      const jalons = await Jalon.find({ activiteId: act._id });
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

// ============================================================
// 🆕 ROUTES ULTIMES - SYNCHRONISATION COMPLÈTE
// ============================================================

// ──────────────────────────────────────────────────────────────
// POST /api/ai/analyser-finances - Analyse financière intelligente
// ──────────────────────────────────────────────────────────────
router.post('/analyser-finances',
  body('stats').optional(),
  body('annee').optional().isInt({ min: 2020, max: 2030 }),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { stats, annee = new Date().getFullYear() } = req.body;
      
      let financeData = stats;
      if (!financeData) {
        // Récupérer les données depuis la base
        const transactions = await Transaction.find({ annee });
        const depenses = await Expense.find({ annee });
        const caisses = await Caisse.find();
        const membres = await Membre.find({ actif: true });
        
        financeData = {
          annee,
          totalCotisations: transactions.filter(t => t.type === 'cotisation').reduce((s, t) => s + t.montant, 0),
          totalSanctions: transactions.filter(t => t.type === 'sanction').reduce((s, t) => s + t.montant, 0),
          totalDepenses: depenses.reduce((s, d) => s + d.montant, 0),
          totalMembres: membres.length,
          transactions,
          depenses,
          caisses
        };
      }
      
      const analyse = await aiService.analyserFinances(financeData, annee);
      
      res.json({ success: true, data: analyse });
    } catch (err) {
      logger.error('Erreur POST /ai/analyser-finances:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /api/ai/detecter-risques - Détection des membres à risque
// ──────────────────────────────────────────────────────────────
router.post('/detecter-risques',
  body('membres').optional().isArray(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      let { membres } = req.body;
      
      if (!membres) {
        membres = await Membre.find({ actif: true }).lean();
      }
      
      const membresARisque = await aiService.detecterMembresARisque(membres);
      
      res.json({ 
        success: true, 
        data: membresARisque,
        count: membresARisque.length 
      });
    } catch (err) {
      logger.error('Erreur POST /ai/detecter-risques:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /api/ai/planifier-activites - Planification optimisée
// ──────────────────────────────────────────────────────────────
router.post('/planifier-activites',
  body('activites').optional().isArray(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      let { activites } = req.body;
      
      if (!activites) {
        activites = await Activite.find({ 
          statut: { $nin: ['termine', 'annule'] } 
        }).populate('responsables', 'nom prenom').lean();
      }
      
      const planning = await aiService.planifierActivites(activites);
      
      res.json({ success: true, data: planning });
    } catch (err) {
      logger.error('Erreur POST /ai/planifier-activites:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /api/ai/rapport-narratif - Génération de rapport narratif
// ──────────────────────────────────────────────────────────────
router.post('/rapport-narratif',
  body('periode').optional().isString(),
  body('sections').optional().isArray(),
  body('ton').optional().isIn(['professionnel', 'formel', 'motivationnel']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { 
        periode = '2026', 
        sections = ['resume', 'finances', 'activites', 'membres', 'recommandations'], 
        ton = 'professionnel' 
      } = req.body;
      
      const annee = parseInt(periode) || new Date().getFullYear();
      
      // Récupérer toutes les données nécessaires
      const [transactions, depenses, caisses, membres, activites] = await Promise.all([
        Transaction.find({ annee }).populate('membreId', 'nom prenom').lean(),
        Expense.find({ annee }).lean(),
        Caisse.find().lean(),
        Membre.find({ actif: true }).lean(),
        Activite.find({ 
          $or: [
            { dateDebut: { $gte: new Date(annee, 0, 1), $lte: new Date(annee, 11, 31) } },
            { dateFin: { $gte: new Date(annee, 0, 1), $lte: new Date(annee, 11, 31) } }
          ]
        }).lean()
      ]);
      
      const rapport = await aiService.genererRapportNarratif({
        periode,
        sections,
        ton,
        data: {
          finances: { transactions, depenses, caisses },
          membres,
          activites
        }
      });
      
      res.json({ success: true, data: rapport });
    } catch (err) {
      logger.error('Erreur POST /ai/rapport-narratif:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ──────────────────────────────────────────────────────────────
// POST /api/ai/chat - Assistant conversationnel contextuel
// ──────────────────────────────────────────────────────────────
router.post('/chat',
  body('question').notEmpty().withMessage('Question requise'),
  body('contexte').optional(),
  body('historique').optional().isArray(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { question, contexte = {}, historique = [] } = req.body;
      
      // Enrichir le contexte avec des données fraîches si nécessaire
      let contexteEnrichi = { ...contexte };
      
      if (contexte.module === 'finances') {
        const annee = new Date().getFullYear();
        const [transactions, depenses] = await Promise.all([
          Transaction.find({ annee }).limit(50).lean(),
          Expense.find({ annee }).limit(20).lean()
        ]);
        contexteEnrichi.finances = { transactions, depenses };
      } else if (contexte.module === 'membres') {
        const membres = await Membre.find({ actif: true }).limit(30).lean();
        contexteEnrichi.membres = membres;
      } else if (contexte.module === 'activites') {
        const activites = await Activite.find({ 
          statut: { $nin: ['termine', 'annule'] } 
        }).limit(20).lean();
        contexteEnrichi.activites = activites;
      }
      
      const reponse = await aiService.chatContextuel(question, contexteEnrichi, historique);
      
      res.json({ success: true, data: reponse });
    } catch (err) {
      logger.error('Erreur POST /ai/chat:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// ──────────────────────────────────────────────────────────────
// GET /api/ai/quick-analyse - Analyse rapide pour dashboard
// ──────────────────────────────────────────────────────────────
router.get('/quick-analyse', async (req, res) => {
  try {
    const [activites, membres, transactions] = await Promise.all([
      Activite.find({ statut: { $nin: ['termine', 'annule'] } }).limit(10).lean(),
      Membre.countDocuments({ actif: true }),
      Transaction.find({ annee: new Date().getFullYear() }).lean()
    ]);
    
    const totalCollecte = transactions.reduce((s, t) => s + t.montant, 0);
    const urgences = activites.filter(a => {
      const days = Math.ceil((new Date(a.dateFin) - new Date()) / 86400000);
      return days <= 7 && a.progression < 70;
    });
    
    let analyseIA = null;
    if (aiService.isConfigured() && urgences.length > 0) {
      analyseIA = await aiService.optimiserPlanning(urgences.slice(0, 3));
    }
    
    res.json({
      success: true,
      data: {
        activitesEnCours: activites.length,
        totalMembres: membres,
        totalCollecte,
        urgences: urgences.length,
        analyseIA
      }
    });
  } catch (err) {
    logger.error('Erreur GET /ai/quick-analyse:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
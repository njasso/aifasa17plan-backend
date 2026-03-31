// backend/routes/members.js
import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import Membre from '../models/Membre.js';
import { protect } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// ──────────────────────────────────────────────────────────────
// FONCTIONS UTILITAIRES DE FORMATAGE DES NUMÉROS
// ──────────────────────────────────────────────────────────────

const cleanPhoneNumber = (value) => {
  if (!value) return '';
  return value.toString().replace(/[^0-9]/g, '');
};

const isValidPhoneNumber = (value) => {
  if (!value) return true;
  const clean = cleanPhoneNumber(value);
  return clean.length === 9 || clean.length === 12;
};

const formatPhoneNumber = (value) => {
  if (!value) return '';
  
  const clean = cleanPhoneNumber(value);
  
  if (clean.length === 9) {
    return `237${clean}`;
  }
  
  if (clean.length === 12 && clean.startsWith('237')) {
    return clean;
  }
  
  return clean;
};

const formatPhoneNumberForDisplay = (value) => {
  if (!value) return '';
  const clean = cleanPhoneNumber(value);
  if (clean.length === 12 && clean.startsWith('237')) {
    return `+${clean}`;
  }
  if (clean.length === 9) {
    return `+237${clean}`;
  }
  return clean;
};

// ──────────────────────────────────────────────────────────────
// VALIDATION DES CHAMPS
// ──────────────────────────────────────────────────────────────

const validateMembre = [
  body('nom').trim().notEmpty().withMessage('Le nom est requis')
    .isLength({ max: 100 }).withMessage('Le nom ne peut pas dépasser 100 caractères'),
  body('prenom').optional().trim().isLength({ max: 100 }).withMessage('Le prénom ne peut pas dépasser 100 caractères'),
  body('email').optional().isEmail().withMessage('Email invalide').normalizeEmail(),
  
  body('telephone').optional()
    .custom(isValidPhoneNumber)
    .withMessage('Téléphone invalide. Format: 9 chiffres (ex: 656816540) ou 237XXXXXXXXX'),
  
  body('whatsapp').optional()
    .custom(isValidPhoneNumber)
    .withMessage('WhatsApp invalide. Format: 9 chiffres (ex: 656816540) ou 237XXXXXXXXX'),
  
  body('role').optional().trim().isLength({ max: 50 }).withMessage('Le rôle ne peut pas dépasser 50 caractères'),
  body('poste').optional().trim().isLength({ max: 100 }).withMessage('Le poste ne peut pas dépasser 100 caractères'),
  body('actif').optional().isBoolean().withMessage('actif doit être un booléen'),
  body('competences').optional().isArray().withMessage('compétences doit être un tableau'),
  body('competences.*').optional().trim().isLength({ max: 50 }).withMessage('Chaque compétence ne peut pas dépasser 50 caractères')
];

// ──────────────────────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────────────────────

// GET /api/members - Liste des membres
router.get('/',
  query('search').optional().trim().escape(),
  query('actif').optional().isBoolean().toBoolean(),           // Correction : conversion en booléen
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(), // ← LIMIT AUGMENTÉE À 500
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { search, actif, page = 1, limit = 50 } = req.query;  // Default limit = 50 (plus raisonnable)
      const filter = {};
      
      if (actif !== undefined) filter.actif = actif;
      
      if (search) {
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { nom: { $regex: escapedSearch, $options: 'i' } },
          { prenom: { $regex: escapedSearch, $options: 'i' } },
          { email: { $regex: escapedSearch, $options: 'i' } },
          { role: { $regex: escapedSearch, $options: 'i' } },
          { poste: { $regex: escapedSearch, $options: 'i' } }   // Ajouté pour plus de pertinence
        ];
      }

      const skip = (page - 1) * limit;
      
      const [membres, total] = await Promise.all([
        Membre.find(filter)
          .sort({ nom: 1, prenom: 1 })
          .skip(skip)
          .limit(limit)
          .select('-__v')
          .lean(),
        Membre.countDocuments(filter)
      ]);

      // Formater les numéros pour l'affichage
      const membresFormatted = membres.map(m => ({
        ...m,
        telephone: m.telephone ? formatPhoneNumberForDisplay(m.telephone) : '',
        whatsapp: m.whatsapp ? formatPhoneNumberForDisplay(m.whatsapp) : ''
      }));

      logger.info(`Liste membres: ${total} total, page ${page}, limit ${limit}`);

      res.json({
        success: true,
        data: membresFormatted,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (err) {
      logger.error('Erreur GET /members:', err);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des membres' });
    }
  }
);

// GET /api/members/stats/all  ← DOIT être avant /:id pour ne pas être avalé par Express
router.get('/stats/all', async (req, res) => {
  try {
    const [total, actifs, inactifs, parRole, parCompetence] = await Promise.all([
      Membre.countDocuments(),
      Membre.countDocuments({ actif: true }),
      Membre.countDocuments({ actif: false }),
      Membre.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      Membre.aggregate([
        { $unwind: '$competences' },
        { $group: { _id: '$competences', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    res.json({
      success: true,
      data: {
        total,
        actifs,
        inactifs,
        tauxActifs: total > 0 ? Math.round((actifs / total) * 100) : 0,
        parRole,
        competencesPrincipales: parCompetence
      }
    });
  } catch (err) {
    logger.error('Erreur GET /members/stats:', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des statistiques' });
  }
});

// GET /api/members/:id - Détail d'un membre
router.get('/:id',
  param('id').isMongoId().withMessage('ID invalide'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const membre = await Membre.findById(req.params.id).select('-__v').lean();
      
      if (!membre) {
        return res.status(404).json({ success: false, message: 'Membre non trouvé' });
      }
      
      const membreFormatted = {
        ...membre,
        telephone: membre.telephone ? formatPhoneNumberForDisplay(membre.telephone) : '',
        whatsapp: membre.whatsapp ? formatPhoneNumberForDisplay(membre.whatsapp) : ''
      };
      
      res.json({ success: true, data: membreFormatted });
    } catch (err) {
      logger.error(`Erreur GET /members/${req.params.id}:`, err);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération du membre' });
    }
  }
);

// POST /api/members - Créer un membre
router.post('/',
  validateMembre,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const formattedData = {
        ...req.body,
        telephone: formatPhoneNumber(req.body.telephone),
        whatsapp: formatPhoneNumber(req.body.whatsapp)
      };

      // Vérification unicité email
      if (formattedData.email) {
        const existingMember = await Membre.findOne({ email: formattedData.email });
        if (existingMember) {
          return res.status(409).json({ success: false, message: 'Un membre avec cet email existe déjà' });
        }
      }

      // Vérification unicité téléphone
      if (formattedData.telephone) {
        const existingPhone = await Membre.findOne({ telephone: formattedData.telephone });
        if (existingPhone) {
          return res.status(409).json({ success: false, message: 'Un membre avec ce téléphone existe déjà' });
        }
      }

      const membre = await Membre.create({
        ...formattedData,
        createdBy: req.user._id,
        dateAdhesion: formattedData.dateAdhesion || new Date()
      });
      
      logger.info(`Membre créé: ${membre.nom} ${membre.prenom || ''} (${membre._id})`);

      const membreFormatted = {
        ...membre.toObject(),
        telephone: membre.telephone ? formatPhoneNumberForDisplay(membre.telephone) : '',
        whatsapp: membre.whatsapp ? formatPhoneNumberForDisplay(membre.whatsapp) : ''
      };
      
      res.status(201).json({
        success: true,
        data: membreFormatted,
        message: 'Membre créé avec succès'
      });
    } catch (err) {
      if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(e => e.message);
        return res.status(400).json({ success: false, message: 'Erreur de validation', errors });
      }
      
      logger.error('Erreur POST /members:', err);
      res.status(500).json({ success: false, message: 'Erreur lors de la création du membre' });
    }
  }
);

// PUT /api/members/:id - Modifier un membre
router.put('/:id',
  param('id').isMongoId().withMessage('ID invalide'),
  validateMembre,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const membre = await Membre.findById(req.params.id);
      if (!membre) {
        return res.status(404).json({ success: false, message: 'Membre non trouvé' });
      }

      const formattedData = {
        ...req.body,
        telephone: formatPhoneNumber(req.body.telephone),
        whatsapp: formatPhoneNumber(req.body.whatsapp)
      };

      // Vérification unicité email (sauf soi-même)
      if (formattedData.email && formattedData.email !== membre.email) {
        const existingMember = await Membre.findOne({ 
          email: formattedData.email, 
          _id: { $ne: req.params.id } 
        });
        if (existingMember) {
          return res.status(409).json({ success: false, message: 'Un autre membre avec cet email existe déjà' });
        }
      }

      // Vérification unicité téléphone (sauf soi-même)
      if (formattedData.telephone && formattedData.telephone !== membre.telephone) {
        const existingPhone = await Membre.findOne({ 
          telephone: formattedData.telephone, 
          _id: { $ne: req.params.id } 
        });
        if (existingPhone) {
          return res.status(409).json({ success: false, message: 'Un autre membre avec ce téléphone existe déjà' });
        }
      }

      const updatedMembre = await Membre.findByIdAndUpdate(
        req.params.id,
        { ...formattedData, updatedAt: new Date() },
        { new: true, runValidators: true }
      ).lean();
      
      logger.info(`Membre modifié: ${updatedMembre.nom} ${updatedMembre.prenom || ''} (${updatedMembre._id})`);

      const membreFormatted = {
        ...updatedMembre,
        telephone: updatedMembre.telephone ? formatPhoneNumberForDisplay(updatedMembre.telephone) : '',
        whatsapp: updatedMembre.whatsapp ? formatPhoneNumberForDisplay(updatedMembre.whatsapp) : ''
      };
      
      res.json({
        success: true,
        data: membreFormatted,
        message: 'Membre modifié avec succès'
      });
    } catch (err) {
      if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map(e => e.message);
        return res.status(400).json({ success: false, message: 'Erreur de validation', errors });
      }
      
      logger.error(`Erreur PUT /members/${req.params.id}:`, err);
      res.status(500).json({ success: false, message: 'Erreur lors de la modification du membre' });
    }
  }
);

// DELETE /api/members/:id
router.delete('/:id',
  param('id').isMongoId().withMessage('ID invalide'),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const membre = await Membre.findById(req.params.id);
      if (!membre) {
        return res.status(404).json({ success: false, message: 'Membre non trouvé' });
      }

      await Membre.findByIdAndDelete(req.params.id);
      
      logger.info(`Membre supprimé: ${membre.nom} ${membre.prenom || ''} (${membre._id})`);
      
      res.json({
        success: true,
        message: 'Membre supprimé avec succès'
      });
    } catch (err) {
      logger.error(`Erreur DELETE /members/${req.params.id}:`, err);
      res.status(500).json({ success: false, message: 'Erreur lors de la suppression du membre' });
    }
  }
);

export default router;
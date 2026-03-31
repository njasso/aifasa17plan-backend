// backend/routes/auth.js
import express from 'express';
import { body, validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Génération du token avec vérification du secret
const genToken = (id) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET non défini dans les variables d\'environnement');
  }
  return jwt.sign({ id }, secret, { expiresIn: '30d' });
};

// Validation pour l'inscription
const validateRegister = [
  body('nom').trim().notEmpty().withMessage('Le nom est requis').isLength({ max: 100 }),
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('motdepasse').isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères'),
  body('telephone').optional().matches(/^(\+237|237)?[0-9]{9}$/).withMessage('Téléphone invalide'),
  body('whatsapp').optional().matches(/^(\+237|237)?[0-9]{9}$/).withMessage('WhatsApp invalide'),
  body('role').optional().isIn(['admin', 'moderateur', 'membre']).withMessage('Rôle invalide'),
];

// Validation pour la connexion
const validateLogin = [
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('motdepasse').notEmpty().withMessage('Le mot de passe est requis'),
];

// POST /api/auth/register - Inscription
router.post('/register', validateRegister, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { nom, email, motdepasse, telephone, whatsapp, role, association } = req.body;

    // Vérifier si l'email existe déjà
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    }

    const user = await User.create({
      nom,
      email,
      motdepasse,
      telephone,
      whatsapp,
      role: role || 'membre',
      association: association || 'AIFASA 17',
      actif: true
    });

    const token = genToken(user._id);

    logger.info(`Nouvel utilisateur inscrit: ${email} (${user._id})`);

    res.status(201).json({
      success: true,
      token,
      user: user.toJSON()
    });
  } catch (err) {
    logger.error('Erreur inscription:', err);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'inscription' });
  }
});

// POST /api/auth/login - Connexion
router.post('/login', validateLogin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, motdepasse } = req.body;

    const user = await User.findOne({ email }).select('+motdepasse');
    if (!user) {
      logger.warn(`Tentative de connexion échouée: email inexistant ${email}`);
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    // Vérifier si le compte est actif
    if (!user.actif) {
      logger.warn(`Tentative de connexion sur compte inactif: ${email}`);
      return res.status(401).json({ success: false, message: 'Compte désactivé' });
    }

    const isValid = await user.verifierMotdepasse(motdepasse);
    if (!isValid) {
      logger.warn(`Tentative de connexion échouée: mot de passe incorrect pour ${email}`);
      return res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }

    // Mettre à jour la dernière connexion
    user.lastLogin = new Date();
    await user.save();

    const token = genToken(user._id);

    logger.info(`Connexion réussie: ${email} (${user._id})`);

    res.json({
      success: true,
      token,
      user: user.toJSON()
    });
  } catch (err) {
    logger.error('Erreur connexion:', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la connexion' });
  }
});

// GET /api/auth/me - Récupérer l'utilisateur courant
router.get('/me', protect, (req, res) => {
  res.json({ success: true, user: req.user });
});

// POST /api/auth/logout - Déconnexion (optionnel, côté client)
router.post('/logout', protect, async (req, res) => {
  try {
    // Mettre à jour la date de déconnexion si nécessaire
    await User.findByIdAndUpdate(req.user._id, { lastLogout: new Date() });
    res.json({ success: true, message: 'Déconnexion réussie' });
  } catch (err) {
    logger.error('Erreur déconnexion:', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la déconnexion' });
  }
});

export default router;
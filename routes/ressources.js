// backend/routes/ressources.js
import express from 'express';
import Ressource from '../models/Ressource.js';
import { protect } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// GET /api/ressources - Liste des ressources
router.get('/', async (req, res) => {
  try {
    const { from, to, type, activiteId, disponibilite } = req.query;
    const filter = {};
    
    if (type) filter.type = type;
    if (activiteId) filter.activiteId = activiteId;
    if (disponibilite !== undefined) filter.disponibilite = disponibilite === 'true';
    
    if (from || to) {
      filter.dateDebut = {};
      if (from) filter.dateDebut.$gte = new Date(from);
      if (to) filter.dateDebut.$lte = new Date(to);
    }
    
    const ressources = await Ressource.find(filter)
      .populate('responsable', 'nom prenom email whatsapp')
      .populate('activiteId', 'titre')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, data: ressources });
  } catch (err) {
    logger.error('Erreur GET /ressources:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/ressources/:id - Détail d'une ressource
router.get('/:id', async (req, res) => {
  try {
    const ressource = await Ressource.findById(req.params.id)
      .populate('responsable', 'nom prenom email whatsapp')
      .populate('activiteId', 'titre');
    
    if (!ressource) {
      return res.status(404).json({ success: false, message: 'Ressource introuvable' });
    }
    
    res.json({ success: true, data: ressource });
  } catch (err) {
    logger.error(`Erreur GET /ressources/${req.params.id}:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/ressources - Créer une ressource
router.post('/', async (req, res) => {
  try {
    const ressource = await Ressource.create({
      ...req.body,
      createdBy: req.user._id
    });
    logger.info(`Ressource créée: ${ressource.nom} (${ressource._id})`);
    res.status(201).json({ success: true, data: ressource });
  } catch (err) {
    logger.error('Erreur POST /ressources:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/ressources/:id - Modifier une ressource
router.put('/:id', async (req, res) => {
  try {
    const ressource = await Ressource.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!ressource) {
      return res.status(404).json({ success: false, message: 'Ressource introuvable' });
    }
    
    logger.info(`Ressource modifiée: ${ressource.nom} (${ressource._id})`);
    res.json({ success: true, data: ressource });
  } catch (err) {
    logger.error(`Erreur PUT /ressources/${req.params.id}:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/ressources/:id - Supprimer une ressource
router.delete('/:id', async (req, res) => {
  try {
    const ressource = await Ressource.findByIdAndDelete(req.params.id);
    
    if (!ressource) {
      return res.status(404).json({ success: false, message: 'Ressource introuvable' });
    }
    
    logger.info(`Ressource supprimée: ${ressource.nom} (${ressource._id})`);
    res.json({ success: true, message: 'Ressource supprimée' });
  } catch (err) {
    logger.error(`Erreur DELETE /ressources/${req.params.id}:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/ressources/:id/reserver - Réserver une ressource
router.post('/:id/reserver', async (req, res) => {
  try {
    const ressource = await Ressource.findByIdAndUpdate(
      req.params.id,
      { 
        disponibilite: false, 
        dateDebut: req.body.dateDebut,
        dateFin: req.body.dateFin,
        activiteId: req.body.activiteId,
        statut: 'reserve'
      },
      { new: true }
    );
    
    if (!ressource) {
      return res.status(404).json({ success: false, message: 'Ressource introuvable' });
    }
    
    logger.info(`Ressource réservée: ${ressource.nom} (${ressource._id})`);
    res.json({ success: true, data: ressource, message: 'Ressource réservée' });
  } catch (err) {
    logger.error(`Erreur POST /ressources/${req.params.id}/reserver:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/ressources/:id/liberer - Libérer une ressource
router.post('/:id/liberer', async (req, res) => {
  try {
    const ressource = await Ressource.findByIdAndUpdate(
      req.params.id,
      { 
        disponibilite: true,
        dateDebut: null,
        dateFin: null,
        activiteId: null,
        statut: 'disponible'
      },
      { new: true }
    );
    
    if (!ressource) {
      return res.status(404).json({ success: false, message: 'Ressource introuvable' });
    }
    
    logger.info(`Ressource libérée: ${ressource.nom} (${ressource._id})`);
    res.json({ success: true, data: ressource, message: 'Ressource libérée' });
  } catch (err) {
    logger.error(`Erreur POST /ressources/${req.params.id}/liberer:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
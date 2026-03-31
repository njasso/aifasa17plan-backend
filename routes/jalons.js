// backend/routes/jalons.js
import express from 'express';
import Jalon from '../models/Jalon.js';
import { protect } from '../middleware/auth.js';
import { emailService } from '../services/emailService.js';
import { whatsappService } from '../services/whatsappService.js';

const router = express.Router();
router.use(protect);

// Liste des jalons
router.get('/', async (req, res) => {
  try {
    const { from, to, activiteId } = req.query;
    const filter = {};
    if (activiteId) filter.activiteId = activiteId;
    if (from || to) {
      filter.datePrevue = {};
      if (from) filter.datePrevue.$gte = new Date(from);
      if (to) filter.datePrevue.$lte = new Date(to);
    }
    const jalons = await Jalon.find(filter)
      .populate('responsable', 'nom prenom email whatsapp')
      .sort({ datePrevue: 1 });
    res.json({ success: true, data: jalons });
  } catch (err) {
    console.error('Erreur GET /jalons:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Créer un jalon
router.post('/', async (req, res) => {
  try {
    const jalon = await Jalon.create({
      ...req.body,
      createdBy: req.user._id
    });
    console.log(`✅ Jalon créé: ${jalon.titre} (${jalon._id})`);
    res.status(201).json({ success: true, data: jalon });
  } catch (err) {
    console.error('Erreur POST /jalons:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Mettre à jour un jalon
router.put('/:id', async (req, res) => {
  try {
    const jalon = await Jalon.findByIdAndUpdate(
      req.params.id, 
      { ...req.body, updatedAt: new Date() }, 
      { new: true, runValidators: true }
    );
    if (!jalon) {
      return res.status(404).json({ success: false, message: 'Jalon introuvable' });
    }
    console.log(`✅ Jalon modifié: ${jalon.titre} (${jalon._id})`);
    res.json({ success: true, data: jalon });
  } catch (err) {
    console.error('Erreur PUT /jalons:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Envoyer des notifications pour les jalons
router.post('/:id/notify', async (req, res) => {
  try {
    const jalon = await Jalon.findById(req.params.id).populate('responsable');
    if (!jalon) return res.status(404).json({ success: false, message: 'Jalon introuvable' });
    
    const message = `📌 *Jalon: ${jalon.titre}*\n\nPrévu pour le ${new Date(jalon.datePrevue).toLocaleDateString()}\n${jalon.description || ''}\n\n_Message automatique AIFASA 17_`;
    
    if (jalon.responsable?.email) {
      await emailService.sendAlert({ to: jalon.responsable.email, subject: `Jalon: ${jalon.titre}`, message });
    }
    if (jalon.responsable?.whatsapp) {
      await whatsappService.send({ to: jalon.responsable.whatsapp, message });
    }
    
    res.json({ success: true, message: 'Notifications envoyées' });
  } catch (err) {
    console.error('Erreur POST /jalons/notify:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
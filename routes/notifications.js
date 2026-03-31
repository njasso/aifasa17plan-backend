// backend/routes/notifications.js
import express from 'express';
import { protect } from '../middleware/auth.js';
import Notification from '../models/Notification.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// GET /api/notifications - Liste des notifications
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const filter = { user: req.user._id };
    if (unreadOnly === 'true') filter.lu = false;

    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    logger.error('Erreur GET /notifications:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/notifications/unread/count - Nombre de notifications non lues
router.get('/unread/count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({ user: req.user._id, lu: false });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/:id/read - Marquer comme lu
router.put('/:id/read', async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { lu: true, luAt: new Date() },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification non trouvée' });
    }
    res.json({ success: true, data: notification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/read-all - Marquer toutes comme lues
router.put('/read-all', async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, lu: false },
      { lu: true, luAt: new Date() }
    );
    res.json({ success: true, message: 'Toutes les notifications ont été marquées comme lues' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/notifications/:id - Supprimer une notification
router.delete('/:id', async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id
    });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification non trouvée' });
    }
    res.json({ success: true, message: 'Notification supprimée' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
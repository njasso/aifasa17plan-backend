// backend/routes/upload.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { protect } from '../middleware/auth.js';
import Document from '../models/Document.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// Configuration multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// POST /api/upload/image - Upload d'image
router.post('/image', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
    }

    const document = await Document.create({
      nom: req.file.originalname,
      type: req.body.type || 'autre',
      referenceId: req.body.referenceId,
      chemin: `/uploads/${req.file.filename}`,
      taille: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id
    });

    logger.info(`Fichier uploadé: ${req.file.filename} par ${req.user._id}`);

    res.json({
      success: true,
      data: {
        url: document.chemin,
        id: document._id,
        nom: document.nom
      }
    });
  } catch (err) {
    logger.error('Erreur upload:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/upload/:id - Récupérer un fichier
router.get('/:id', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ success: false, message: 'Fichier non trouvé' });
    }

    const filePath = path.join(process.cwd(), document.chemin);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Fichier non trouvé sur le disque' });
    }

    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/upload/:id - Supprimer un fichier
router.delete('/:id', async (req, res) => {
  try {
    const document = await Document.findOneAndDelete({
      _id: req.params.id,
      uploadedBy: req.user._id
    });

    if (!document) {
      return res.status(404).json({ success: false, message: 'Fichier non trouvé' });
    }

    const filePath = path.join(process.cwd(), document.chemin);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    logger.info(`Fichier supprimé: ${document.chemin} par ${req.user._id}`);

    res.json({ success: true, message: 'Fichier supprimé' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
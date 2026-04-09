import express from 'express';
import { body, validationResult } from 'express-validator';
import { Message } from '../models/AlerteMessage.js';
import Activite from '../models/Activite.js';
import { protect } from '../middleware/auth.js';
import { emailService } from '../services/emailService.js';
import { whatsappService } from '../services/whatsappService.js';
import logger from '../utils/logger.js';

const router = express.Router();
router.use(protect);

// Validation pour l'envoi de message
const validateMessage = [
  body('sujet').trim().notEmpty().withMessage('Le sujet est requis').isLength({ max: 200 }),
  body('contenu').trim().notEmpty().withMessage('Le contenu est requis'),
  body('canal').isIn(['email', 'whatsapp']).withMessage('Canal invalide'),
  body('destinataires').optional().isArray().withMessage('Les destinataires doivent être un tableau'),
  body('destinataires.*.membre').optional().isMongoId(),
  body('destinataires.*.email').optional().isEmail(),
  body('destinataires.*.whatsapp').optional().matches(/^(\+237|237)?[0-9]{9}$/)
];

// GET /api/messages - Liste des messages
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      Message.find()
       .populate('destinataires.membre', 'nom prenom email whatsapp')
       .populate('createdBy', 'nom email')
       .sort({ createdAt: -1 })
       .skip(skip)
       .limit(parseInt(limit)),
      Message.countDocuments()
    ]);

    res.json(messages); // ← tableau direct
  } catch (err) {
    logger.error('Erreur GET /messages:', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la récupération des messages' });
  }
});

// GET /api/messages/groups - Récupérer les groupes WhatsApp
// GET /api/messages/groups - Récupérer les groupes WhatsApp
router.get('/groups', async (req, res) => {
  try {
    // Vérifier si la méthode existe
    if (typeof whatsappService.getGroups !== 'function') {
      logger.warn('⚠️ whatsappService.getGroups non disponible');
      return res.json([]);
    }
    
    const groups = await whatsappService.getGroups();
    
    if (!groups.success) {
      logger.warn('⚠️ Erreur récupération groupes:', groups.error);
      return res.json([]);
    }
    
    res.json(groups.data || []);
  } catch (err) {
    logger.error('Erreur GET /messages/groups:', err);
    res.json([]);
  }
});

// GET /api/messages/whatsapp-status - Statut de la connexion WhatsApp
router.get('/whatsapp-status', async (req, res) => {
  try {
    const status = await whatsappService.getStatus();
    res.json(status); // ← objet direct {connected, user}
  } catch (err) {
    logger.error('Erreur GET /messages/whatsapp-status:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/messages/send - Envoyer un message
router.post('/send', validateMessage, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { sujet, contenu, canal, destinataires = [], mode, groupeId } = req.body;

    // Si mode groupe
    if (mode === 'groupe') {
      if (!groupeId) {
        return res.status(400).json({ success: false, message: 'ID du groupe requis' });
      }
      const formattedMessage = whatsappService.formatters.message({
        sujet,
        contenu,
        expediteur: req.user.nom
      });
      const result = await whatsappService.sendToGroup(groupeId, formattedMessage);

      const msg = await Message.create({
        sujet,
        contenu,
        canal,
        mode: 'groupe',
        dateEnvoi: new Date(),
        statut: result.success? 'envoye' : 'echoue',
        destinataires: [{ groupe: groupeId }],
        createdBy: req.user._id
      });

      return res.json({
        success: result.success,
        data: msg,
        message: result.success? 'Message envoyé au groupe avec succès' : result.error
      });
    }

    if (!destinataires.length) {
      return res.status(400).json({ success: false, message: 'Aucun destinataire sélectionné' });
    }

    logger.info(`📤 Envoi de message: "${sujet}" via ${canal} à ${destinataires.length} destinataire(s)`);

    const resultats = [];
    const errorsList = [];

    for (const dest of destinataires) {
      try {
        if (canal === 'email' && dest.email) {
          const r = await emailService.sendAlert({
            to: dest.email,
            subject: sujet,
            message: contenu,
            expediteur: req.user.nom
          });
          const success = r.success || r.messageId;
          resultats.push({ dest: dest.email, success:!!success, error: success? null : r.error || 'Erreur inconnue' });
          if (!success) errorsList.push({ dest: dest.email, error: r.error || 'Erreur inconnue' });
        } else if (canal === 'whatsapp' && dest.whatsapp) {
          const messageFormatted = whatsappService.formatters.message({
            sujet,
            contenu,
            expediteur: req.user.nom
          });
          const r = await whatsappService.send({ to: dest.whatsapp, message: messageFormatted });
          const success = r?.success || false;
          resultats.push({ dest: dest.whatsapp, success, error: success? null : r?.error || 'Erreur inconnue' });
          if (!success) errorsList.push({ dest: dest.whatsapp, error: r?.error || 'Erreur inconnue' });
        } else {
          resultats.push({ dest: dest.membre, success: false, error: 'Contact non disponible (email ou whatsapp manquant)' });
          errorsList.push({ dest: dest.membre, error: 'Contact non disponible' });
        }
      } catch (err) {
        logger.error(`❌ Erreur pour ${dest.email || dest.whatsapp || dest.membre}:`, err);
        resultats.push({ dest: dest.email || dest.whatsapp || dest.membre, success: false, error: err.message || 'Erreur inconnue' });
        errorsList.push({ dest: dest.email || dest.whatsapp || dest.membre, error: err.message || 'Erreur inconnue' });
      }
    }

    const successCount = resultats.filter(r => r.success).length;

    const msg = await Message.create({
      sujet,
      contenu,
      canal,
      mode: mode || 'individuel',
      dateEnvoi: new Date(),
      statut: successCount > 0? 'envoye' : 'echoue',
      destinataires: destinataires.map(d => {
        const resultat = resultats.find(r => r.dest === d.email || r.dest === d.whatsapp || r.dest === d.membre);
        return {...d, statut: resultat? (resultat.success? 'envoye' : 'echoue') : 'echoue', error: resultat? resultat.error : 'Erreur inconnue' };
      }),
      createdBy: req.user._id
    });

    res.json({
      success: true,
      data: msg,
      resultats,
      errors: errorsList.length > 0? errorsList : undefined,
      message: `${successCount} message(s) envoyé(s) avec succès sur ${resultats.length} tentative(s)`
    });
  } catch (err) {
    logger.error('❌ Erreur POST /messages/send:', err);
    res.status(500).json({ success: false, message: err.message || 'Erreur inconnue lors de l\'envoi des messages' });
  }
});

// POST /api/messages/send-group - Envoyer à un groupe WhatsApp
router.post('/send-group', async (req, res) => {
  try {
    const { groupId, message, sujet } = req.body;

    if (!groupId ||!message) {
      return res.status(400).json({ success: false, message: 'Groupe et message requis' });
    }

    const formattedMessage = whatsappService.formatters.message({
      sujet,
      contenu: message,
      expediteur: req.user.nom
    });

    const result = await whatsappService.sendToGroup(groupId, formattedMessage);

    const msg = await Message.create({
      sujet: sujet || `Message au groupe ${groupId}`,
      contenu: message,
      canal: 'whatsapp',
      mode: 'groupe',
      dateEnvoi: new Date(),
      statut: result.success? 'envoye' : 'echoue',
      destinataires: [{ groupe: groupId }],
      createdBy: req.user._id
    });

    res.json({
      success: result.success,
      data: msg,
      message: result.success? 'Message envoyé au groupe avec succès' : result.error
    });
  } catch (err) {
    logger.error('Erreur POST /messages/send-group:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/messages/send-rappel - Envoyer un rappel pour une activité
router.post('/send-rappel', async (req, res) => {
  try {
    const { activiteId, message, type } = req.body;

    const activite = await Activite.findById(activiteId)
     .populate('responsables', 'nom prenom whatsapp telephone email');

    if (!activite) {
      return res.status(404).json({ success: false, message: 'Activité non trouvée' });
    }

    const responsables = activite.responsables || [];
    const results = [];
    const daysLeft = Math.ceil((new Date(activite.dateFin) - new Date()) / 86400000);
    const defaultMessage = message || `L'activité "${activite.titre}" se termine dans ${daysLeft} jours. Progression: ${activite.progression}%`;

    for (const resp of responsables) {
      if (resp.whatsapp) {
        const result = await whatsappService.send({
          to: resp.whatsapp,
          message: whatsappService.formatters.alerte({
            titre: `Rappel: ${activite.titre}`,
            message: defaultMessage,
            activite: activite.titre,
            dateFin: activite.dateFin,
            priorite: activite.priorite,
            jours: daysLeft > 0? daysLeft : 0
          })
        });
        results.push({ destinataire: `${resp.nom}`, canal: 'whatsapp', success: result.success, error: result.error });
      }

      if (resp.email) {
        const result = await emailService.sendAlert({
          to: resp.email,
          subject: `📢 Rappel: ${activite.titre}`,
          message: defaultMessage,
          activite: activite.titre,
          dateFin: activite.dateFin,
          priorite: activite.priorite,
          jours: daysLeft > 0? daysLeft : 0,
          progression: activite.progression
        });
        results.push({ destinataire: `${resp.nom}`, canal: 'email', success: result.success, error: result.error });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      success: true,
      message: `${successCount}/${results.length} notification(s) envoyée(s)`,
      results
    });
  } catch (err) {
    logger.error('Erreur POST /messages/send-rappel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/messages/:id - Supprimer un message
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'ID invalide' });
    }

    const message = await Message.findByIdAndDelete(id);

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message introuvable' });
    }

    logger.info(`Message supprimé: ${message.sujet} (${message._id}) par ${req.user._id}`);

    res.json({ success: true, message: 'Message supprimé avec succès' });
  } catch (err) {
    logger.error('Erreur DELETE /messages/:id:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Route de test direct pour WhatsApp
router.post('/test-wa', async (req, res) => {
  try {
    const { to, message } = req.body;
    const result = await whatsappService.send({ to, message });
    res.json({ success: true, result });
  } catch (err) {
    logger.error('❌ Erreur test WhatsApp:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
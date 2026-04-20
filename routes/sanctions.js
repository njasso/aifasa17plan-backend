// routes/sanctions.js
import express from 'express';
import {
  getDettesDisciplinaires,
  getDetteMembre,
  ajouterSanction,
  payerSanction,
  supprimerSanction,
  getHistoriqueSanctions,
  exportSanctionsPDF,
  getSanctionsStats
} from '../controllers/sanctionsController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

// Routes principales
router.get('/dettes', getDettesDisciplinaires);
router.get('/dettes/:membreId', getDetteMembre);
router.get('/historique/:membreId', getHistoriqueSanctions);
router.get('/stats', getSanctionsStats);
router.get('/export/pdf', exportSanctionsPDF);

// Routes d'écriture (admin uniquement)
router.post('/sanction', admin, ajouterSanction);
router.post('/payer/:id', admin, payerSanction);
router.delete('/:id/sanction/:sanctionId', admin, supprimerSanction);

export default router;
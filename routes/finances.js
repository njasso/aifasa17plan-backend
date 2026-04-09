// routes/finances.js
import express from 'express';
import {
  getTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getExpenses,
  addExpense,
  modifierDepense,
  approuverDepense,
  getSoldes,
  getFinancialStats,
  sendRappel,
  sendMassRappels,
  generateFinancialReport,
  getMemberStatement,
  setTypeInscription,
  effectuerVirement
} from '../controllers/financesController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(protect);

// ── Transactions ──────────────────────────────────────────
router.get('/transactions',        getTransactions);
router.post('/transactions',       addTransaction);
router.put('/transactions/:id',    admin, updateTransaction);
router.delete('/transactions/:id', admin, deleteTransaction);

// ── Dépenses ─────────────────────────────────────────────
router.get('/depenses',           getExpenses);
router.post('/depenses',          addExpense);
router.put('/depenses/:id',       admin, modifierDepense);
router.put('/depenses/:id/approuver', admin, approuverDepense);

// ── Virement ─────────────────────────────────────────────
router.post('/virement', admin, effectuerVirement);

// ── Caisses & Statistiques ───────────────────────────────
router.get('/soldes', getSoldes);
router.get('/stats',  getFinancialStats);

// ── Rappels ──────────────────────────────────────────────
router.post('/rappels/masse',     sendMassRappels);
router.post('/rappels/:membreId', sendRappel);

// ── Rapports ─────────────────────────────────────────────
router.get('/rapport',       generateFinancialReport);
router.get('/etat-membres',  getMemberStatement);

// ── Type inscription (marquer ancien/nouveau manuellement) ─
router.put('/membres/:membreId/type-inscription', setTypeInscription);

export default router;
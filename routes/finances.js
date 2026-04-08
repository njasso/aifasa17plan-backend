// routes/finances.js
import express from 'express';
import {
  getTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getExpenses,
  addExpense,
  getSoldes,
  getFinancialStats,
  sendRappel,
  sendMassRappels,
  generateFinancialReport,
  getMemberStatement,
  setTypeInscription       // ✅ nouveau
} from '../controllers/financesController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(protect);

// ── Transactions ──────────────────────────────────────────
router.get('/transactions',        getTransactions);
router.post('/transactions',       addTransaction);
router.put('/transactions/:id',    admin, updateTransaction);   // ✅ admin en une seule fois
router.delete('/transactions/:id', admin, deleteTransaction);   // ✅ supprimé le doublon

// ── Dépenses ─────────────────────────────────────────────
router.get('/depenses',  getExpenses);
router.post('/depenses', addExpense);

// ── Caisses & Statistiques ───────────────────────────────
router.get('/soldes', getSoldes);
router.get('/stats',  getFinancialStats);

// ── Rappels ──────────────────────────────────────────────
router.post('/rappels/masse',       sendMassRappels);   // ✅ /masse avant /:membreId
router.post('/rappels/:membreId',   sendRappel);

// ── Rapports ─────────────────────────────────────────────
router.get('/rapport',       generateFinancialReport);
router.get('/etat-membres',  getMemberStatement);

// ── Type inscription (marquer ancien/nouveau manuellement) ─
router.put('/membres/:membreId/type-inscription', setTypeInscription);

export default router;
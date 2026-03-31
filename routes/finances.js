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
  getMemberStatement
} from '../controllers/financesController.js';
import { protect, admin } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// Routes protégées (authentification requise)
// ============================================================
router.use(protect);

// Transactions
router.get('/transactions', getTransactions);
router.post('/transactions', addTransaction);
router.put('/transactions/:id', updateTransaction);
router.delete('/transactions/:id', deleteTransaction);

// Dépenses
router.get('/depenses', getExpenses);
router.post('/depenses', addExpense);

// Soldes des caisses
router.get('/soldes', getSoldes);

// Statistiques
router.get('/stats', getFinancialStats);

// Rappels
router.post('/rappels/:membreId', sendRappel);
router.post('/rappels/masse', sendMassRappels);

// Rapports
router.get('/rapport', generateFinancialReport);
router.get('/etat-membres', getMemberStatement);

// Routes admin uniquement
router.delete('/transactions/:id', admin, deleteTransaction);
router.put('/transactions/:id', admin, updateTransaction);

export default router;
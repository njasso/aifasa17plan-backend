// backend/controllers/financesController.js
import { Transaction, Expense, Caisse, Rappel } from '../models/Finance.js';
import Membre from '../models/Membre.js';
import { emailService } from '../services/emailService.js';
import whatsappService from '../services/whatsappService.js';
import mongoose from 'mongoose';

// ============================================================
// CONSTANTES - RÈGLES MÉTIER AIFASA 17
// ============================================================
const COTISATIONS = {
  adhesion: 2500,              // Unique pour nouveaux membres
  inscriptionNouveau: 5000,    // Pour les nouveaux membres
  inscriptionAncien: 2500,     // Pour les anciens membres (renouvellement)
  fondsSocial: 25000,
  fondsSocialT1: 15000,
  fondsSocialT2: 10000,
  contributionAG: 0
};

const SANCTIONS = {
  absenceAG: 15000,           // Absence non justifiée à l'AG
  desertionAG: 5000,          // Quitte l'AG avant la fin
  retardAG: 1000,             // Arrive en retard à l'AG
  perturbationAG: 1000,       // Trouble pendant l'AG
  nonOrganisationAG: 10000,   // Refus d'organiser l'AG
  retardCotisation: 1000,     // Paiement de cotisation en retard
  manquementDiscipline: 10000, // Autres manquements disciplinaires
};

// Échéances fixes
const ECHEANCES = {
  fondsSocialT1: { mois: 2, jour: 28, montant: 15000, label: "Fonds Social — 1ère tranche" },
  fondsSocialT2: { mois: 4, jour: 30, montant: 10000, label: "Fonds Social — 2ème tranche", grace: 14 },
  agJuin: { mois: 6, jour: 7, label: "Contribution AG Juin" },
  agDec: { mois: 12, jour: 7, label: "Contribution AG Décembre" },
  inscription: { mois: 12, jour: 31, label: "Inscription annuelle" }
};

// ============================================================
// FONCTIONS UTILITAIRES
// ============================================================

// Mettre à jour le solde d'une caisse
const updateCaisseBalance = async (caisseName, montant, type, referenceId) => {
  let caisse = await Caisse.findOne({ caisse: caisseName });
  
  if (!caisse) {
    caisse = new Caisse({
      caisse: caisseName,
      solde: 0,
      soldeInitial: 0,
      historique: []
    });
  }
  
  const newSolde = type === 'credit' 
    ? caisse.solde + montant 
    : caisse.solde - montant;
  
  caisse.solde = newSolde;
  caisse.derniereMiseAJour = new Date();
  caisse.historique.push({
    date: new Date(),
    montant,
    type,
    reference: referenceId,
    description: type === 'credit' ? 'Crédit' : 'Débit'
  });
  
  await caisse.save();
  return caisse;
};

// Vérifier les soldes critiques
const checkCriticalBalance = async (caisseName) => {
  const seuils = {
    fonctionnement: 50000,
    fondsSocial: 100000,
    ag: 50000,
    projet: 50000
  };
  
  const caisse = await Caisse.findOne({ caisse: caisseName });
  if (caisse && caisse.solde < seuils[caisseName]) {
    console.log(`⚠️ Alerte: Solde critique pour la caisse ${caisseName}: ${caisse.solde} FCFA`);
  }
};

// Calculer le montant dû par membre
const calculerMontantDu = async (membreId, annee) => {
  let montantDu = 0;
  let details = [];
  
  // Vérifier l'adhésion (uniquement pour les nouveaux membres)
  const adhesion = await Transaction.findOne({ 
    membreId, 
    sousType: 'adhesion' 
  });
  const dateAdhesion = await Membre.findById(membreId).select('dateAdhesion');
  const estNouveau = dateAdhesion && new Date(dateAdhesion.dateAdhesion).getFullYear() >= annee;
  
  if (estNouveau && !adhesion) {
    montantDu += COTISATIONS.adhesion;
    details.push({ type: 'adhesion', montant: COTISATIONS.adhesion, label: 'Adhésion' });
  }
  
  // Vérifier l'inscription annuelle
  const inscriptionTx = await Transaction.aggregate([
    { $match: { membreId, sousType: 'inscription', annee } },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  const inscriptionPaye = inscriptionTx[0]?.total || 0;
  if (inscriptionPaye < COTISATIONS.inscription) {
    const reste = COTISATIONS.inscription - inscriptionPaye;
    montantDu += reste;
    details.push({ type: 'inscription', montant: reste, label: 'Inscription annuelle' });
  }
  
  // Vérifier le Fonds Social
  const fondsSocialTx = await Transaction.aggregate([
    { $match: { membreId, sousType: 'fondsSocial', annee } },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  const fondsSocialPaye = fondsSocialTx[0]?.total || 0;
  if (fondsSocialPaye < COTISATIONS.fondsSocial) {
    const reste = COTISATIONS.fondsSocial - fondsSocialPaye;
    montantDu += reste;
    details.push({ type: 'fondsSocial', montant: reste, label: 'Fonds Social' });
  }
  
  return { montantDu, details };
};

// ============================================================
// TRANSACTIONS
// ============================================================

// Obtenir toutes les transactions
export const getTransactions = async (req, res) => {
  try {
    const { membreId, annee, type, sousType, startDate, endDate, page = 1, limit = 50 } = req.query;
    
    const filter = {};
    if (membreId) filter.membreId = membreId;
    if (annee) filter.annee = parseInt(annee);
    if (type) filter.type = type;
    if (sousType) filter.sousType = sousType;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('membreId', 'nom prenom email telephone whatsapp')
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Transaction.countDocuments(filter)
    ]);
    
    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Erreur getTransactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Ajouter une transaction
export const addTransaction = async (req, res) => {
  try {
    const { membreId, type, sousType, montant, date, description, mode, reference } = req.body;
    
    // Vérifier que le membre existe
    const membre = await Membre.findById(membreId);
    if (!membre) {
      return res.status(404).json({ success: false, error: 'Membre non trouvé' });
    }
    
    // Créer la transaction
    const transaction = new Transaction({
      membreId,
      type,
      sousType,
      montant,
      date: date || new Date(),
      description,
      mode: mode || 'especes',
      reference: reference || `TXN-${Date.now()}`,
      annee: new Date(date || new Date()).getFullYear(),
      trimestre: Math.floor(new Date(date || new Date()).getMonth() / 3) + 1,
      createdBy: req.user?.id
    });
    
    await transaction.save();
    
    // Mettre à jour le solde de la caisse concernée
    let caisseName = 'fonctionnement';
    if (sousType === 'fondsSocial') caisseName = 'fondsSocial';
    else if (sousType === 'contributionAG') caisseName = 'ag';
    else if (sousType.startsWith('sanction')) caisseName = 'fonctionnement';
    
    await updateCaisseBalance(caisseName, montant, 'credit', transaction._id);
    
    res.json({
      success: true,
      data: transaction,
      message: 'Transaction enregistrée avec succès'
    });
  } catch (error) {
    console.error('Erreur addTransaction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Modifier une transaction
export const updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const transaction = await Transaction.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction non trouvée' });
    }
    
    res.json({ success: true, data: transaction });
  } catch (error) {
    console.error('Erreur updateTransaction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Supprimer une transaction
export const deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction non trouvée' });
    }
    
    // Déduire du solde de la caisse
    let caisseName = 'fonctionnement';
    if (transaction.sousType === 'fondsSocial') caisseName = 'fondsSocial';
    else if (transaction.sousType === 'contributionAG') caisseName = 'ag';
    
    await updateCaisseBalance(caisseName, transaction.montant, 'debit', null);
    
    await transaction.deleteOne();
    
    res.json({ success: true, message: 'Transaction supprimée' });
  } catch (error) {
    console.error('Erreur deleteTransaction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// DÉPENSES
// ============================================================

// Obtenir les dépenses
export const getExpenses = async (req, res) => {
  try {
    const { caisse, annee, startDate, endDate, page = 1, limit = 50 } = req.query;
    
    const filter = {};
    if (caisse) filter.caisse = caisse;
    if (annee) filter.annee = parseInt(annee);
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [expenses, total] = await Promise.all([
      Expense.find(filter)
        .populate('approuvePar', 'nom prenom')
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Expense.countDocuments(filter)
    ]);
    
    res.json({
      success: true,
      data: expenses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Erreur getExpenses:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Ajouter une dépense
export const addExpense = async (req, res) => {
  try {
    const { caisse, montant, date, motif, beneficiaire, pieceJointe } = req.body;
    
    // Vérifier le solde disponible
    const caisseDoc = await Caisse.findOne({ caisse });
    if (!caisseDoc || caisseDoc.solde < montant) {
      return res.status(400).json({ success: false, error: `Solde insuffisant dans la caisse ${caisse}` });
    }
    
    // Créer la dépense
    const expense = new Expense({
      caisse,
      montant,
      date: date || new Date(),
      motif,
      beneficiaire,
      pieceJointe,
      annee: new Date(date || new Date()).getFullYear(),
      createdBy: req.user?.id
    });
    
    await expense.save();
    
    // Déduire du solde
    await updateCaisseBalance(caisse, montant, 'debit', null);
    
    // Vérifier le solde critique
    await checkCriticalBalance(caisse);
    
    res.json({
      success: true,
      data: expense,
      message: 'Dépense enregistrée avec succès'
    });
  } catch (error) {
    console.error('Erreur addExpense:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// CAISSES
// ============================================================

// Obtenir les soldes des caisses
export const getSoldes = async (req, res) => {
  try {
    const caisses = await Caisse.find();
    
    const soldes = {
      fonctionnement: 0,
      fondsSocial: 0,
      ag: 0,
      projet: 0,
      total: 0
    };
    
    caisses.forEach(c => {
      soldes[c.caisse] = c.solde;
      soldes.total += c.solde;
    });
    
    res.json({ success: true, data: soldes });
  } catch (error) {
    console.error('Erreur getSoldes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// STATISTIQUES FINANCIÈRES
// ============================================================

// Obtenir les statistiques financières
export const getFinancialStats = async (req, res) => {
  try {
    const { annee = new Date().getFullYear() } = req.query;
    
    // Transactions par type
    const transactionsByType = await Transaction.aggregate([
      { $match: { annee: parseInt(annee) } },
      { $group: {
        _id: '$sousType',
        total: { $sum: '$montant' },
        count: { $sum: 1 }
      } }
    ]);
    
    // Total des cotisations
    const cotisations = await Transaction.aggregate([
      { $match: { annee: parseInt(annee), type: 'cotisation' } },
      { $group: { _id: null, total: { $sum: '$montant' } } }
    ]);
    
    // Total des sanctions
    const sanctions = await Transaction.aggregate([
      { $match: { annee: parseInt(annee), type: 'sanction' } },
      { $group: { _id: null, total: { $sum: '$montant' } } }
    ]);
    
    // Total des dépenses
    const depenses = await Expense.aggregate([
      { $match: { annee: parseInt(annee) } },
      { $group: { _id: '$caisse', total: { $sum: '$montant' } } }
    ]);
    
    // Membres à jour
    const membres = await Membre.find({ actif: true });
    let membresAjour = 0;
    
    for (const membre of membres) {
      const adhesion = await Transaction.findOne({ membreId: membre._id, sousType: 'adhesion' });
      const inscription = await Transaction.aggregate([
        { $match: { membreId: membre._id, sousType: 'inscription', annee: parseInt(annee) } },
        { $group: { _id: null, total: { $sum: '$montant' } } }
      ]);
      const fondsSocial = await Transaction.aggregate([
        { $match: { membreId: membre._id, sousType: 'fondsSocial', annee: parseInt(annee) } },
        { $group: { _id: null, total: { $sum: '$montant' } } }
      ]);
      
      const dateAdhesion = membre.dateAdhesion;
      const estNouveau = dateAdhesion && new Date(dateAdhesion).getFullYear() >= annee;
      const adhesionPaye = !estNouveau || !!adhesion;
      const inscriptionPaye = inscription[0]?.total || 0;
      const fondsSocialPaye = fondsSocial[0]?.total || 0;
      
      const montantInscription = estNouveau ? COTISATIONS.inscriptionNouveau : COTISATIONS.inscriptionAncien;
      
      if (adhesionPaye && inscriptionPaye >= COTISATIONS.inscription && fondsSocialPaye >= COTISATIONS.fondsSocial) {
        membresAjour++;
      }
    }
    
    res.json({
      success: true,
      data: {
        annee,
        transactionsByType,
        totalCotisations: cotisations[0]?.total || 0,
        totalSanctions: sanctions[0]?.total || 0,
        totalDepenses: depenses.reduce((acc, d) => acc + d.total, 0),
        depensesParCaisse: depenses,
        membresAjour,
        totalMembres: membres.length,
        tauxRecouvrement: membres.length > 0 ? (membresAjour / membres.length) * 100 : 0
      }
    });
  } catch (error) {
    console.error('Erreur getFinancialStats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// RAPPELS
// ============================================================

// Envoyer un rappel à un membre
export const sendRappel = async (req, res) => {
  try {
    const { membreId } = req.params;
    const { type } = req.body;
    const annee = new Date().getFullYear();
    
    const membre = await Membre.findById(membreId);
    if (!membre) {
      return res.status(404).json({ success: false, error: 'Membre non trouvé' });
    }
    
    const { montantDu, details } = await calculerMontantDu(membreId, annee);
    
    if (montantDu === 0) {
      return res.json({ success: true, message: 'Ce membre est à jour de ses cotisations' });
    }
    
    // Préparer le message
    const detailsText = details.map(d => `- ${d.label}: ${d.montant.toLocaleString()} FCFA`).join('\n');
    const fullMessage = `🔔 RAPPEL DE COTISATION AIFASA 17

Cher/Chère ${membre.nom} ${membre.prenom},

Nous vous rappelons que votre situation financière présente un solde dû de ${montantDu.toLocaleString()} FCFA pour l'année ${annee}.

Détail:
${detailsText}

Merci de régulariser votre situation dans les meilleurs délais.

🌿 AIFASA 17 - Association des Ingénieurs Agronomes FASA Promotion 17`;

    // Envoyer par email
    if (membre.email) {
      await emailService.sendMessage({
        to: membre.email,
        subject: `Rappel de cotisation AIFASA 17 - ${annee}`,
        contenu: fullMessage,
        expediteur: 'AIFASA 17 - Bureau'
      });
    }
    
    // Envoyer par WhatsApp
    if (membre.whatsapp) {
      await whatsappService.send({
        to: membre.whatsapp,
        message: fullMessage
      });
    }
    
    // Enregistrer le rappel
    const rappel = new Rappel({
      membreId,
      type,
      montantDu,
      dateEnvoi: new Date(),
      statut: 'envoye',
      canal: 'email'
    });
    await rappel.save();
    
    res.json({ success: true, message: `Rappel envoyé à ${membre.nom} ${membre.prenom}` });
  } catch (error) {
    console.error('Erreur sendRappel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Envoyer des rappels en masse
export const sendMassRappels = async (req, res) => {
  try {
    const { type } = req.body;
    const annee = new Date().getFullYear();
    
    const membres = await Membre.find({ actif: true });
    let envoyes = 0;
    let erreurs = 0;
    
    for (const membre of membres) {
      try {
        const { montantDu } = await calculerMontantDu(membre._id, annee);
        
        if (montantDu > 0 && membre.email) {
          const message = `🔔 RAPPEL DE COTISATION AIFASA 17

Cher/Chère ${membre.nom} ${membre.prenom},

Votre solde dû est de ${montantDu.toLocaleString()} FCFA pour l'année ${annee}.

Merci de régulariser votre situation.

🌿 AIFASA 17`;
          
          await emailService.sendMessage({
            to: membre.email,
            subject: `Rappel de cotisation AIFASA 17 - ${annee}`,
            contenu: message,
            expediteur: 'AIFASA 17 - Bureau'
          });
          envoyes++;
        }
      } catch (err) {
        erreurs++;
        console.error(`Erreur pour ${membre.email}:`, err);
      }
    }
    
    res.json({
      success: true,
      message: `${envoyes} rappels envoyés, ${erreurs} erreurs`
    });
  } catch (error) {
    console.error('Erreur sendMassRappels:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// RAPPORTS
// ============================================================

// Générer un rapport financier
export const generateFinancialReport = async (req, res) => {
  try {
    const { annee = new Date().getFullYear(), startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);
    
    const transactions = await Transaction.find({
      ...(annee && { annee: parseInt(annee) }),
      ...(Object.keys(dateFilter).length && { date: dateFilter })
    }).populate('membreId', 'nom prenom');
    
    const expenses = await Expense.find({
      ...(annee && { annee: parseInt(annee) }),
      ...(Object.keys(dateFilter).length && { date: dateFilter })
    });
    
    const caisses = await Caisse.find();
    const soldes = {};
    caisses.forEach(c => { soldes[c.caisse] = c.solde; });
    
    const totalRecettes = transactions.reduce((sum, t) => sum + t.montant, 0);
    const totalDepenses = expenses.reduce((sum, e) => sum + e.montant, 0);
    
    const recettesParType = {};
    transactions.forEach(t => {
      recettesParType[t.sousType] = (recettesParType[t.sousType] || 0) + t.montant;
    });
    
    const depensesParCaisse = {};
    expenses.forEach(e => {
      depensesParCaisse[e.caisse] = (depensesParCaisse[e.caisse] || 0) + e.montant;
    });
    
    res.json({
      success: true,
      data: {
        periode: { annee, startDate, endDate },
        synthese: {
          totalRecettes,
          totalDepenses,
          soldeNet: totalRecettes - totalDepenses,
          soldesCaisses: soldes
        },
        recettesParType,
        depensesParCaisse,
        transactions: transactions.slice(0, 100),
        depenses: expenses.slice(0, 100)
      }
    });
  } catch (error) {
    console.error('Erreur generateFinancialReport:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Générer l'état des membres
export const getMemberStatement = async (req, res) => {
  try {
    const { annee = new Date().getFullYear() } = req.query;
    
    const membres = await Membre.find({ actif: true });
    const resultats = [];
    
    for (const membre of membres) {
      const transactions = await Transaction.find({
        membreId: membre._id,
        annee: parseInt(annee)
      });
      
      const dateAdhesion = membre.dateAdhesion;
      const estNouveau = dateAdhesion && new Date(dateAdhesion).getFullYear() >= annee;
      
      const adhesion = transactions.find(t => t.sousType === 'adhesion');
      const adhesionPaye = !estNouveau || !!adhesion;
      
      const inscription = transactions.filter(t => t.sousType === 'inscription').reduce((sum, t) => sum + t.montant, 0);
      const fondsSocial = transactions.filter(t => t.sousType === 'fondsSocial').reduce((sum, t) => sum + t.montant, 0);
      const contributionsAG = transactions.filter(t => t.sousType === 'contributionAG').reduce((sum, t) => sum + t.montant, 0);
      const sanctions = transactions.filter(t => t.type === 'sanction').reduce((sum, t) => sum + t.montant, 0);
      
const totalDu = (estNouveau ? COTISATIONS.adhesion : 0) 
                + (estNouveau ? COTISATIONS.inscription : COTISATIONS.inscriptionAncien) 
                + COTISATIONS.fondsSocial;      const totalPaye = (adhesionPaye && estNouveau ? COTISATIONS.adhesion : 0) + inscription + fondsSocial;
      
      resultats.push({
        membre: {
          _id: membre._id,
          nom: membre.nom,
          prenom: membre.prenom,
          email: membre.email,
          telephone: membre.telephone,
          whatsapp: membre.whatsapp
        },
        estNouveau,
        adhesion: { paye: adhesionPaye, montant: COTISATIONS.adhesion },
        inscription: { paye: inscription, du: COTISATIONS.inscription, reste: Math.max(0, COTISATIONS.inscription - inscription) },
        fondsSocial: { paye: fondsSocial, du: COTISATIONS.fondsSocial, reste: Math.max(0, COTISATIONS.fondsSocial - fondsSocial) },
        contributionsAG,
        sanctions,
        totalPaye,
        totalDu,
        resteDu: Math.max(0, totalDu - totalPaye),
        statut: totalPaye >= totalDu ? 'a_jour' : 'retard'
      });
    }
    
    res.json({
      success: true,
      data: resultats
    });
  } catch (error) {
    console.error('Erreur getMemberStatement:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// EXPORTS
// ============================================================
export default {
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
};
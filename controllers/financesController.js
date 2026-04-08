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

// Liste des opérations UNIQUES par année (anti-doublon)
const OPERATIONS_UNIQUES_PAR_AN = [
  'inscription',
  'adhesion',
  'fondsSocial_t1',
  'fondsSocial_t2'
];

const SANCTIONS = {
  absenceAG: 15000,
  desertionAG: 5000,
  retardAG: 1000,
  perturbationAG: 1000,
  nonOrganisationAG: 10000,
  retardCotisation: 1000,
  manquementDiscipline: 10000,
};

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

/**
 * Détermine le type réel d'un membre pour une année donnée.
 * Règle : un membre est "ancien" si :
 *   - Sa dateAdhesion est antérieure à l'année courante
 *   - OU il a déjà payé une inscription >= 5000 F dans une année précédente
 *   - OU il possède un flag typeInscription = 'ancien' sur son profil
 * Un membre ne peut être "nouveau" (5000 F) qu'une seule fois dans sa vie d'adhérent.
 */
const determinerTypeMembre = async (membre, annee) => {
  const anneeNum = parseInt(annee);

  // 1. Flag explicite sur le profil (override manuel via l'API)
  if (membre.typeInscription === 'ancien') {
    return {
      estNouveau: false,
      estConsidererAncien: true,
      montantInscription: COTISATIONS.inscriptionAncien,
      raisonAncien: 'flag_manuel'
    };
  }

  // 2. Vérifier la dateAdhesion
  const anneeAdhesion = membre.dateAdhesion
    ? new Date(membre.dateAdhesion).getFullYear()
    : null;
  const estNouveau = anneeAdhesion !== null && anneeAdhesion >= anneeNum;

  // 3. A-t-il déjà payé >= 5000 F d'inscription une année précédente ?
  //    Si oui, il ne peut plus être traité comme "nouveau" même si dateAdhesion dit le contraire
  const inscriptionsAnterieures = await Transaction.find({
    membreId: membre._id,
    sousType: 'inscription',
    annee: { $lt: anneeNum }
  }).lean();

  const aPaye5000Avant = inscriptionsAnterieures.some(t => t.montant >= COTISATIONS.inscriptionNouveau);
  const estConsidererAncien = !estNouveau || aPaye5000Avant;

  return {
    estNouveau,
    estConsidererAncien,
    montantInscription: estConsidererAncien ? COTISATIONS.inscriptionAncien : COTISATIONS.inscriptionNouveau,
    raisonAncien: aPaye5000Avant ? 'a_deja_paye_5000' : (!estNouveau ? 'date_adhesion_anterieure' : null)
  };
};

const updateCaisseBalance = async (caisseName, montant, type, referenceId, description = null) => {
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
    description: description || (type === 'credit' ? 'Crédit' : 'Débit')
  });
  
  await caisse.save();
  return caisse;
};

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

// Vérifier si une opération est un doublon
const verifierDoublon = async (membreId, sousType, annee) => {
  if (OPERATIONS_UNIQUES_PAR_AN.includes(sousType)) {
    const existe = await Transaction.findOne({
      membreId,
      sousType,
      annee: parseInt(annee)
    });
    return !!existe;
  }
  return false;
};

// Calculer le montant dû par membre — utilise determinerTypeMembre
const calculerMontantDu = async (membreId, annee) => {
  let montantDu = 0;
  let details = [];
  const anneeNum = parseInt(annee);

  const membre = await Membre.findById(membreId);
  if (!membre) return { montantDu: 0, details: [] };

  // ✅ Utilise la fonction unifiée de détermination du type
  const { estNouveau, estConsidererAncien, montantInscription } = await determinerTypeMembre(membre, anneeNum);

  // Adhésion (nouveaux membres uniquement, non-payée)
  const adhesion = await Transaction.findOne({ membreId, sousType: 'adhesion' });
  const adhesionPaye = !estNouveau || !!adhesion;
  if (estNouveau && !adhesionPaye) {
    montantDu += COTISATIONS.adhesion;
    details.push({ type: 'adhesion', montant: COTISATIONS.adhesion, label: 'Adhésion' });
  }

  // Inscription annuelle — montant correct selon type membre
  const inscriptionTx = await Transaction.aggregate([
    { $match: { membreId: new mongoose.Types.ObjectId(membreId), sousType: 'inscription', annee: anneeNum } },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  const inscriptionPaye = inscriptionTx[0]?.total || 0;
  if (inscriptionPaye < montantInscription) {
    const reste = montantInscription - inscriptionPaye;
    montantDu += reste;
    details.push({
      type: 'inscription',
      montant: reste,
      label: estConsidererAncien ? 'Renouvellement (ancien)' : 'Inscription (nouveau)'
    });
  }

  // Fonds Social
  const fondsSocialTx = await Transaction.aggregate([
    { $match: { membreId: new mongoose.Types.ObjectId(membreId), sousType: 'fondsSocial', annee: anneeNum } },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  const fondsSocialPaye = fondsSocialTx[0]?.total || 0;
  if (fondsSocialPaye < COTISATIONS.fondsSocial) {
    const reste = COTISATIONS.fondsSocial - fondsSocialPaye;
    montantDu += reste;
    details.push({ type: 'fondsSocial', montant: reste, label: 'Fonds Social' });
  }

  return { montantDu, details, estConsidererAncien, estNouveau, montantInscription };
};

// ============================================================
// TRANSACTIONS
// ============================================================

export const getTransactions = async (req, res) => {
  try {
    const { membreId, annee, type, sousType, startDate, endDate, page = 1, limit = 500 } = req.query;
    
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

export const addTransaction = async (req, res) => {
  try {
    const { membreId, type, sousType, montant, date, description, mode, reference, sourceCaisse } = req.body;
    
    // Vérifier que le membre existe
    const membre = await Membre.findById(membreId);
    if (!membre) {
      return res.status(404).json({ success: false, error: 'Membre non trouvé' });
    }
    
    const anneeOperation = new Date(date || new Date()).getFullYear();
    
    // ANTI-DOUBLON
    const estDoublon = await verifierDoublon(membreId, sousType, anneeOperation);
    if (estDoublon) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cette opération a déjà été effectuée pour ce membre cette année' 
      });
    }
    
    // Si paiement depuis caisse Fonds Social
    if (sourceCaisse === 'fondsSocial') {
      const caisseFS = await Caisse.findOne({ caisse: 'fondsSocial' });
      if (!caisseFS || caisseFS.solde < montant) {
        return res.status(400).json({ 
          success: false, 
          error: `Solde insuffisant dans la caisse Fonds Social (${caisseFS?.solde || 0} F disponible)` 
        });
      }
      
      // Créer une dépense automatique
      const expense = new Expense({
        caisse: 'fondsSocial',
        montant,
        date: date || new Date(),
        motif: `Paiement ${sousType} - ${membre.nom} ${membre.prenom}`,
        beneficiaire: 'Transfert interne',
        annee: anneeOperation,
        createdBy: req.user?.id
      });
      await expense.save();
      await updateCaisseBalance('fondsSocial', montant, 'debit', expense._id, `Prélèvement pour ${sousType}`);
    }
    
    // Créer la transaction
    const transaction = new Transaction({
      membreId,
      type,
      sousType,
      montant,
      date: date || new Date(),
      description: description || `${sousType}${sourceCaisse === 'fondsSocial' ? ' (prélevé sur caisse FS)' : ''}`,
      mode: sourceCaisse === 'fondsSocial' ? 'transfert' : (mode || 'especes'),
      reference: reference || `TXN-${Date.now()}`,
      annee: anneeOperation,
      trimestre: Math.floor(new Date(date || new Date()).getMonth() / 3) + 1,
      sourceCaisse: sourceCaisse || 'especes',
      createdBy: req.user?.id
    });
    
    await transaction.save();
    
    // Mettre à jour le solde de la caisse concernée (si pas déjà fait pour FS)
    if (sourceCaisse !== 'fondsSocial') {
      let caisseName = 'fonctionnement';
      if (sousType === 'fondsSocial') caisseName = 'fondsSocial';
      else if (sousType === 'contributionAG') caisseName = 'ag';
      
      await updateCaisseBalance(caisseName, montant, 'credit', transaction._id);
    }
    
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

export const deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction non trouvée' });
    }
    
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

export const getExpenses = async (req, res) => {
  try {
    const { caisse, annee, startDate, endDate, page = 1, limit = 500 } = req.query;
    
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

export const addExpense = async (req, res) => {
  try {
    const { caisse, montant, date, motif, beneficiaire, pieceJointe } = req.body;
    
    const caisseDoc = await Caisse.findOne({ caisse });
    if (!caisseDoc || caisseDoc.solde < montant) {
      return res.status(400).json({ success: false, error: `Solde insuffisant dans la caisse ${caisse}` });
    }
    
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
    await updateCaisseBalance(caisse, montant, 'debit', expense._id);
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

export const getFinancialStats = async (req, res) => {
  try {
    const { annee = new Date().getFullYear() } = req.query;
    const anneeNum = parseInt(annee);
    
    const transactionsByType = await Transaction.aggregate([
      { $match: { annee: anneeNum } },
      { $group: {
        _id: '$sousType',
        total: { $sum: '$montant' },
        count: { $sum: 1 }
      } }
    ]);
    
    const cotisations = await Transaction.aggregate([
      { $match: { annee: anneeNum, type: 'cotisation' } },
      { $group: { _id: null, total: { $sum: '$montant' } } }
    ]);
    
    const sanctions = await Transaction.aggregate([
      { $match: { annee: anneeNum, type: 'sanction' } },
      { $group: { _id: null, total: { $sum: '$montant' } } }
    ]);
    
    const depenses = await Expense.aggregate([
      { $match: { annee: anneeNum } },
      { $group: { _id: '$caisse', total: { $sum: '$montant' } } }
    ]);
    
    const membres = await Membre.find({ actif: true });
    let membresAjour = 0;
    
    for (const membre of membres) {
      const { montantDu } = await calculerMontantDu(membre._id, anneeNum);
      if (montantDu === 0) membresAjour++;
    }
    
    res.json({
      success: true,
      data: {
        annee: anneeNum,
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
    
    const detailsText = details.map(d => `- ${d.label}: ${d.montant.toLocaleString()} FCFA`).join('\n');
    const fullMessage = `🔔 RAPPEL DE COTISATION AIFASA 17

Cher/Chère ${membre.nom} ${membre.prenom},

Nous vous rappelons que votre situation financière présente un solde dû de ${montantDu.toLocaleString()} FCFA pour l'année ${annee}.

Détail:
${detailsText}

Merci de régulariser votre situation dans les meilleurs délais.

🌿 AIFASA 17 - Association des Ingénieurs Agronomes FASA Promotion 17`;

    if (membre.email) {
      await emailService.sendMessage({
        to: membre.email,
        subject: `Rappel de cotisation AIFASA 17 - ${annee}`,
        contenu: fullMessage,
        expediteur: 'AIFASA 17 - Bureau'
      });
    }
    
    if (membre.whatsapp) {
      await whatsappService.send({
        to: membre.whatsapp,
        message: fullMessage
      });
    }
    
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
          const message = `🔔 RAPPEL DE COTISATION AIFASA 17\n\nCher/Chère ${membre.nom} ${membre.prenom},\n\nVotre solde dû est de ${montantDu.toLocaleString()} FCFA pour l'année ${annee}.\n\nMerci de régulariser votre situation.\n\n🌿 AIFASA 17`;
          
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

export const getMemberStatement = async (req, res) => {
  try {
    const { annee = new Date().getFullYear() } = req.query;
    const anneeNum = parseInt(annee);

    const membres = await Membre.find({ actif: true });
    const resultats = [];

    // Compteurs budget réel
    let budgetNouveaux = 0;   // uniquement 5000 × nb vrais nouveaux
    let budgetAnciens  = 0;   // uniquement 2500 × nb anciens
    let budgetTotal    = 0;

    for (const membre of membres) {
      const txAnnee = await Transaction.find({ membreId: membre._id, annee: anneeNum }).lean();

      // ✅ Type déterminé par la fonction unifiée (historique + flag manuel)
      const { estNouveau, estConsidererAncien, montantInscription, raisonAncien } =
        await determinerTypeMembre(membre, anneeNum);

      const adhesionTx  = txAnnee.find(t => t.sousType === 'adhesion');
      const adhesionPaye = !estNouveau || !!adhesionTx;

      const insPaye  = txAnnee.filter(t => t.sousType === 'inscription').reduce((s, t) => s + t.montant, 0);
      const fsPaye   = txAnnee.filter(t => t.sousType === 'fondsSocial').reduce((s, t) => s + t.montant, 0);
      const agPaye   = txAnnee.filter(t => t.sousType === 'contributionAG').reduce((s, t) => s + t.montant, 0);
      const sancMontant = txAnnee.filter(t => t.type === 'sanction').reduce((s, t) => s + t.montant, 0);

      // ✅ Budget réel : on exclut complètement les 5000 F pour les anciens
      const adhesionDue = estNouveau ? COTISATIONS.adhesion : 0;
      const totalDu = adhesionDue + montantInscription + COTISATIONS.fondsSocial;
      const totalPaye = (adhesionPaye && estNouveau ? COTISATIONS.adhesion : 0) + insPaye + fsPaye;
      const resteDu = Math.max(0, totalDu - totalPaye + sancMontant);

      // Cumul budget réel global
      if (!estConsidererAncien) budgetNouveaux += montantInscription;
      else                       budgetAnciens  += montantInscription;
      budgetTotal += totalDu;

      resultats.push({
        membre: {
          _id: membre._id,
          nom: membre.nom,
          prenom: membre.prenom,
          email: membre.email,
          telephone: membre.telephone,
          whatsapp: membre.whatsapp,
          typeInscription: membre.typeInscription || null
        },
        estNouveau,
        estConsidererAncien,
        raisonAncien,
        adhesion: { paye: adhesionPaye, montant: COTISATIONS.adhesion, due: adhesionDue },
        inscription: {
          paye: insPaye,
          du: montantInscription,
          reste: Math.max(0, montantInscription - insPaye),
          label: estConsidererAncien ? 'Renouvellement' : 'Inscription nouveau'
        },
        fondsSocial: { paye: fsPaye, du: COTISATIONS.fondsSocial, reste: Math.max(0, COTISATIONS.fondsSocial - fsPaye) },
        fsT1Ok: fsPaye >= COTISATIONS.fondsSocialT1,
        fsT2Ok: fsPaye >= COTISATIONS.fondsSocial,
        contributionsAG: agPaye,
        sanctions: sancMontant,
        totalPaye,
        totalDu,
        resteDu,
        statut: resteDu === 0 ? 'a_jour' : 'retard'
      });
    }

    res.json({
      success: true,
      data: resultats,
      // ✅ Budget réel ventilé par type de membre
      budgetReel: {
        annee: anneeNum,
        nouveaux: {
          count: resultats.filter(r => !r.estConsidererAncien).length,
          montantInscription: budgetNouveaux,
          montantTotal: resultats.filter(r => !r.estConsidererAncien).reduce((s, r) => s + r.totalDu, 0)
        },
        anciens: {
          count: resultats.filter(r => r.estConsidererAncien).length,
          montantInscription: budgetAnciens,
          montantTotal: resultats.filter(r => r.estConsidererAncien).reduce((s, r) => s + r.totalDu, 0)
        },
        totalTheorique: budgetTotal,
        totalCollecte: resultats.reduce((s, r) => s + r.totalPaye, 0),
        totalResteDu: resultats.reduce((s, r) => s + r.resteDu, 0)
      }
    });
  } catch (error) {
    console.error('Erreur getMemberStatement:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// MARQUER UN MEMBRE COMME ANCIEN (override manuel)
// ============================================================
export const setTypeInscription = async (req, res) => {
  try {
    const { membreId } = req.params;
    const { typeInscription } = req.body; // 'nouveau' | 'ancien'

    if (!['nouveau', 'ancien'].includes(typeInscription)) {
      return res.status(400).json({ success: false, error: 'typeInscription doit être "nouveau" ou "ancien"' });
    }

    const membre = await Membre.findByIdAndUpdate(
      membreId,
      { typeInscription },
      { new: true }
    );

    if (!membre) return res.status(404).json({ success: false, error: 'Membre non trouvé' });

    res.json({
      success: true,
      message: `Membre marqué comme "${typeInscription}" — inscription à ${typeInscription === 'ancien' ? COTISATIONS.inscriptionAncien : COTISATIONS.inscriptionNouveau} FCFA`,
      data: { _id: membre._id, nom: membre.nom, prenom: membre.prenom, typeInscription: membre.typeInscription }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

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
  getMemberStatement,
  setTypeInscription
};
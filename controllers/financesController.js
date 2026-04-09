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

// Pack Nouveau Membre = 7500 F
const PACK_NOUVEAU = {
  adhesion: 2500,
  inscription: 5000,
  total: 7500
};

// Liste des opérations UNIQUES par année (anti-doublon)
const OPERATIONS_UNIQUES_PAR_AN = [
  'inscription',
  'adhesion',
  'pack_nouveau',
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

// ============================================================
// FONCTIONS UTILITAIRES
// ============================================================

/**
 * Détermine le type réel d'un membre pour une année donnée.
 */
const determinerTypeMembre = async (membre, annee) => {
  const anneeNum = parseInt(annee);

  if (membre.typeInscription === 'ancien') {
    return {
      estNouveau: false,
      estConsidererAncien: true,
      montantInscription: COTISATIONS.inscriptionAncien,
      raisonAncien: 'flag_manuel'
    };
  }

  const anneeAdhesion = membre.dateAdhesion
    ? new Date(membre.dateAdhesion).getFullYear()
    : null;
  const estNouveau = anneeAdhesion !== null && anneeAdhesion >= anneeNum;

  const inscriptionsAnterieures = await Transaction.find({
    membreId: membre._id,
    sousType: { $in: ['inscription', 'pack_nouveau'] },
    annee: { $lt: anneeNum }
  }).lean();

  const aPayeAvant = inscriptionsAnterieures.length > 0;
  const estConsidererAncien = !estNouveau || aPayeAvant;

  return {
    estNouveau,
    estConsidererAncien,
    montantInscription: estConsidererAncien ? COTISATIONS.inscriptionAncien : COTISATIONS.inscriptionNouveau,
    raisonAncien: aPayeAvant ? 'a_deja_paye' : (!estNouveau ? 'date_adhesion_anterieure' : null)
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

const calculerMontantDu = async (membreId, annee) => {
  let montantDu = 0;
  let details = [];
  const anneeNum = parseInt(annee);

  const membre = await Membre.findById(membreId);
  if (!membre) return { montantDu: 0, details: [] };

  const { estNouveau, estConsidererAncien, montantInscription } = await determinerTypeMembre(membre, anneeNum);

  // Adhésion
  const adhesion = await Transaction.findOne({ membreId, sousType: { $in: ['adhesion', 'pack_nouveau'] } });
  const adhesionPaye = !estNouveau || !!adhesion;
  if (estNouveau && !adhesionPaye) {
    montantDu += COTISATIONS.adhesion;
    details.push({ type: 'adhesion', montant: COTISATIONS.adhesion, label: 'Adhésion' });
  }

  // Inscription annuelle
  const inscriptionTx = await Transaction.aggregate([
    { $match: { membreId: new mongoose.Types.ObjectId(membreId), sousType: { $in: ['inscription', 'pack_nouveau'] }, annee: anneeNum } },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  const inscriptionPaye = inscriptionTx[0]?.total || 0;
  
  // Ajuster pour le pack
  const packTx = await Transaction.findOne({ membreId, sousType: 'pack_nouveau', annee: anneeNum });
  const insPayeReel = inscriptionPaye + (packTx ? 5000 : 0);
  
  if (insPayeReel < montantInscription) {
    const reste = montantInscription - insPayeReel;
    montantDu += reste;
    details.push({
      type: 'inscription',
      montant: reste,
      label: estConsidererAncien ? 'Renouvellement (ancien)' : 'Inscription (nouveau)'
    });
  }

  // Fonds Social
  const fondsSocialTx = await Transaction.aggregate([
    { $match: { membreId: new mongoose.Types.ObjectId(membreId), sousType: { $in: ['fondsSocial', 'fondsSocial_t1', 'fondsSocial_t2'] }, annee: anneeNum } },
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
    const { membreId, type, sousType, montant, date, description, mode, reference, sourceCaisse, notes } = req.body;
    
    const membre = await Membre.findById(membreId);
    if (!membre) {
      return res.status(404).json({ success: false, error: 'Membre non trouvé' });
    }
    
    const anneeOperation = new Date(date || new Date()).getFullYear();
    
    // ANTI-DOUBLON
    if (sousType !== 'pack_nouveau') {
      const estDoublon = await verifierDoublon(membreId, sousType, anneeOperation);
      if (estDoublon) {
        return res.status(400).json({ 
          success: false, 
          error: 'Cette opération a déjà été effectuée pour ce membre cette année' 
        });
      }
    }
    
    // Gestion du Pack Nouveau Membre
    if (sousType === 'pack_nouveau') {
      // Vérifier que le pack n'a pas déjà été payé
      const packExiste = await Transaction.findOne({ membreId, sousType: 'pack_nouveau', annee: anneeOperation });
      if (packExiste) {
        return res.status(400).json({ success: false, error: 'Pack Nouveau Membre déjà payé cette année' });
      }
      
      // Créer la transaction pack
      const transactionPack = new Transaction({
        membreId,
        type: 'cotisation',
        sousType: 'pack_nouveau',
        montant: PACK_NOUVEAU.total,
        date: date || new Date(),
        description: description || 'Pack Nouveau Membre (Adhésion 2500 + Inscription 5000)',
        mode: mode || 'especes',
        notes,
        annee: anneeOperation,
        trimestre: Math.floor(new Date(date || new Date()).getMonth() / 3) + 1,
        createdBy: req.user?.id
      });
      await transactionPack.save();
      
      await updateCaisseBalance('fonctionnement', PACK_NOUVEAU.total, 'credit', transactionPack._id);
      
      return res.json({
        success: true,
        data: transactionPack,
        message: 'Pack Nouveau Membre enregistré avec succès (Adhésion 2500 + Inscription 5000)'
      });
    }
    
    // Transaction normale
    const transaction = new Transaction({
      membreId,
      type,
      sousType,
      montant,
      date: date || new Date(),
      description: description || sousType,
      mode: mode || 'especes',
      notes,
      reference: reference || `TXN-${Date.now()}`,
      annee: anneeOperation,
      trimestre: Math.floor(new Date(date || new Date()).getMonth() / 3) + 1,
      sourceCaisse: sourceCaisse || 'especes',
      createdBy: req.user?.id
    });
    
    await transaction.save();
    
    // Mettre à jour la caisse
    let caisseName = 'fonctionnement';
    if (sousType?.startsWith('fondsSocial')) caisseName = 'fondsSocial';
    else if (sousType?.startsWith('contributionAG')) caisseName = 'ag';
    
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
    if (transaction.sousType?.startsWith('fondsSocial')) caisseName = 'fondsSocial';
    else if (transaction.sousType?.startsWith('contributionAG')) caisseName = 'ag';
    
    await updateCaisseBalance(caisseName, transaction.montant, 'debit', null, 'Annulation transaction');
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
    const { caisse, montant, date, motif, beneficiaire, pieceJointe, notes } = req.body;
    
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
      notes,
      annee: new Date(date || new Date()).getFullYear(),
      createdBy: req.user?.id
    });
    
    await expense.save();
    await updateCaisseBalance(caisse, montant, 'debit', expense._id, motif);
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

// ✅ NOUVEAU : Modifier une dépense
export const modifierDepense = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const expense = await Expense.findById(id);
    if (!expense) {
      return res.status(404).json({ success: false, error: 'Dépense non trouvée' });
    }
    
    // Si le montant change, ajuster la caisse
    if (updates.montant && updates.montant !== expense.montant) {
      const difference = updates.montant - expense.montant;
      await updateCaisseBalance(expense.caisse, Math.abs(difference), 
        difference > 0 ? 'debit' : 'credit', id, 'Ajustement dépense');
    }
    
    Object.assign(expense, updates);
    expense.updatedAt = new Date();
    await expense.save();
    
    res.json({ success: true, data: expense, message: 'Dépense mise à jour' });
  } catch (error) {
    console.error('Erreur modifierDepense:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ NOUVEAU : Approuver une dépense
export const approuverDepense = async (req, res) => {
  try {
    const { id } = req.params;
    
    const expense = await Expense.findByIdAndUpdate(
      id,
      { 
        approbation: 'approuve',
        approuvePar: req.user.id,
        dateApprobation: new Date()
      },
      { new: true }
    );
    
    if (!expense) {
      return res.status(404).json({ success: false, error: 'Dépense non trouvée' });
    }
    
    res.json({ success: true, data: expense, message: 'Dépense approuvée' });
  } catch (error) {
    console.error('Erreur approuverDepense:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ✅ NOUVEAU : Virement entre caisses
export const effectuerVirement = async (req, res) => {
  try {
    const { caisseSource, caisseDest, montant, motif, date } = req.body;
    
    if (caisseSource === caisseDest) {
      return res.status(400).json({ success: false, error: 'Les caisses source et destination doivent être différentes' });
    }
    
    const caisseSrc = await Caisse.findOne({ caisse: caisseSource });
    if (!caisseSrc || caisseSrc.solde < montant) {
      return res.status(400).json({ 
        success: false, 
        error: `Solde insuffisant dans ${caisseSource} (${caisseSrc?.solde || 0} F disponible)` 
      });
    }
    
    const anneeOperation = new Date(date || new Date()).getFullYear();
    
    // Débiter la source
    await updateCaisseBalance(caisseSource, montant, 'debit', null, `Virement vers ${caisseDest}: ${motif}`);
    
    // Créditer la destination
    await updateCaisseBalance(caisseDest, montant, 'credit', null, `Virement depuis ${caisseSource}: ${motif}`);
    
    // Créer une dépense pour tracer le virement
    const expense = new Expense({
      caisse: caisseSource,
      montant,
      date: date || new Date(),
      motif: `Virement vers ${caisseDest} - ${motif}`,
      beneficiaire: caisseDest,
      annee: anneeOperation,
      approbation: 'approuve',
      approuvePar: req.user.id,
      createdBy: req.user.id
    });
    await expense.save();
    
    res.json({ success: true, message: 'Virement effectué avec succès' });
  } catch (error) {
    console.error('Erreur effectuerVirement:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// CAISSES
// ============================================================

export const getSoldes = async (req, res) => {
  try {
    const { annee } = req.query;
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

    for (const membre of membres) {
      const txAnnee = await Transaction.find({ membreId: membre._id, annee: anneeNum }).lean();

      const { estNouveau, estConsidererAncien, montantInscription } = await determinerTypeMembre(membre, anneeNum);

      const packTx = txAnnee.find(t => t.sousType === 'pack_nouveau');
      const adhesionTx = txAnnee.find(t => t.sousType === 'adhesion');
      const adhesionPaye = !!packTx || !!adhesionTx || !estNouveau;

      const insPaye = txAnnee.filter(t => t.sousType === 'inscription').reduce((s, t) => s + t.montant, 0) + (packTx ? 5000 : 0);
      const fsPaye = txAnnee.filter(t => t.sousType?.startsWith('fondsSocial')).reduce((s, t) => s + t.montant, 0);
      const agPaye = txAnnee.filter(t => t.sousType?.startsWith('contributionAG')).reduce((s, t) => s + t.montant, 0);
      const sancMontant = txAnnee.filter(t => t.type === 'sanction').reduce((s, t) => s + t.montant, 0);

      const adhesionDue = estNouveau && !adhesionPaye ? COTISATIONS.adhesion : 0;
      const totalDu = adhesionDue + montantInscription + COTISATIONS.fondsSocial;
      const totalPaye = (adhesionPaye && estNouveau ? COTISATIONS.adhesion : 0) + insPaye + fsPaye + agPaye;
      const resteDu = Math.max(0, totalDu - totalPaye + sancMontant);

      resultats.push({
        membre: { _id: membre._id, nom: membre.nom, prenom: membre.prenom },
        estNouveau,
        estConsidererAncien,
        packPaye: !!packTx,
        adhesionPaye,
        inscription: { paye: insPaye, du: montantInscription, reste: Math.max(0, montantInscription - insPaye) },
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

    res.json({ success: true, data: resultats });
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
    const { typeInscription } = req.body;

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
      message: `Membre marqué comme "${typeInscription}"`,
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
  modifierDepense,
  approuverDepense,
  effectuerVirement,
  getSoldes,
  getFinancialStats,
  sendRappel,
  sendMassRappels,
  generateFinancialReport,
  getMemberStatement,
  setTypeInscription
};
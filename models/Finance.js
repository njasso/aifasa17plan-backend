// models/Finance.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  membreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Membre',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['cotisation', 'sanction', 'autre'],
    required: true
  },
  sousType: {
    type: String,
    enum: [
      'adhesion', 
      'inscription', 
      'fondsSocial', 
      'contributionAG',
      'fondsSocial_t1',
      'fondsSocial_t2',
      'contributionAG_presentiel',
      'contributionAG_enligne',
      'sanction_absenceAG', 
      'sanction_retardCotisation', 
      'sanction_manquementDiscipline', 
      'sanction_autre',
      'sanction_nonOrg_AG_juin',
      'sanction_nonOrg_AG_dec',
      'sanction_perturbation_AG',
      'sanction_desertion_AG',
      'sanction_retard_AG',
      'sanction_retard_fonds'
    ],
    required: true
  },
  montant: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  mode: {
    type: String,
    enum: ['especes', 'mobile_money', 'virement', 'cheque', 'transfert', 'autre'],
    default: 'especes'
  },
  // NOUVEAU : Source du paiement (pour les prélèvements sur caisse)
  sourceCaisse: {
    type: String,
    enum: ['especes', 'fondsSocial', 'fonctionnement', 'ag', 'projet'],
    default: 'especes'
  },
  reference: {
    type: String,
    default: ''
  },
  annee: {
    type: Number,
    required: true,
    default: () => new Date().getFullYear(),
    index: true
  },
  trimestre: {
    type: Number,
    min: 1,
    max: 4,
    default: () => Math.floor(new Date().getMonth() / 3) + 1
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index pour les recherches rapides et l'anti-doublon
transactionSchema.index({ membreId: 1, annee: 1, sousType: 1 }, { unique: false });
transactionSchema.index({ membreId: 1, annee: 1, type: 1 });
transactionSchema.index({ date: -1 });
transactionSchema.index({ sousType: 1 });
transactionSchema.index({ annee: 1 });

// Méthode statique pour vérifier un doublon
transactionSchema.statics.estDoublon = async function(membreId, sousType, annee) {
  const operationsUniques = [
    'inscription', 
    'adhesion', 
    'fondsSocial_t1', 
    'fondsSocial_t2'
  ];
  
  if (!operationsUniques.includes(sousType)) {
    return false;
  }
  
  const existe = await this.findOne({
    membreId,
    sousType,
    annee: parseInt(annee)
  });
  
  return !!existe;
};

// Méthode statique pour obtenir le total par membre
transactionSchema.statics.getTotalByMember = async function(membreId, annee) {
  const filter = { membreId: new mongoose.Types.ObjectId(membreId) };
  if (annee) filter.annee = parseInt(annee);
  
  const result = await this.aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  return result[0]?.total || 0;
};

// Méthode statique pour obtenir les totaux par sous-type pour un membre
transactionSchema.statics.getTotauxParSousType = async function(membreId, annee) {
  const filter = { membreId: new mongoose.Types.ObjectId(membreId) };
  if (annee) filter.annee = parseInt(annee);
  
  return await this.aggregate([
    { $match: filter },
    { $group: {
      _id: '$sousType',
      total: { $sum: '$montant' },
      count: { $sum: 1 }
    } }
  ]);
};

// Méthode statique pour obtenir les statistiques annuelles
transactionSchema.statics.getAnnualStats = async function(annee) {
  return await this.aggregate([
    { $match: { annee: parseInt(annee) || new Date().getFullYear() } },
    { $group: {
      _id: '$sousType',
      total: { $sum: '$montant' },
      count: { $sum: 1 }
    } },
    { $sort: { total: -1 } }
  ]);
};

// Méthode pour vérifier si un membre a payé 5000F d'inscription avant
transactionSchema.statics.aPayeInscription5000Avant = async function(membreId, anneeCourante) {
  const inscriptions = await this.find({
    membreId: new mongoose.Types.ObjectId(membreId),
    sousType: 'inscription',
    annee: { $lt: parseInt(anneeCourante) }
  });
  
  return inscriptions.some(t => t.montant === 5000);
};

// ============================================================
// EXPENSE (DÉPENSES)
// ============================================================

const expenseSchema = new mongoose.Schema({
  caisse: {
    type: String,
    enum: ['fonctionnement', 'fondsSocial', 'ag', 'projet'],
    required: true
  },
  montant: {
    type: Number,
    required: true,
    min: 0
  },
  date: {
    type: Date,
    default: Date.now,
    required: true
  },
  motif: {
    type: String,
    required: true
  },
  beneficiaire: {
    type: String,
    default: ''
  },
  pieceJointe: {
    type: String,
    default: ''
  },
  approbation: {
    type: String,
    enum: ['en_attente', 'approuve', 'rejete'],
    default: 'en_attente'
  },
  approuvePar: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  annee: {
    type: Number,
    required: true,
    default: () => new Date().getFullYear(),
    index: true
  },
  // Lien vers la transaction si la dépense est un prélèvement pour paiement
  transactionLiee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

expenseSchema.index({ caisse: 1, date: -1 });
expenseSchema.index({ annee: 1 });
expenseSchema.index({ caisse: 1, annee: 1 });

// Méthode statique pour obtenir le total des dépenses par caisse
expenseSchema.statics.getTotalByCaisse = async function(caisse, annee) {
  const filter = { caisse };
  if (annee) filter.annee = parseInt(annee);
  
  const result = await this.aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  return result[0]?.total || 0;
};

// ============================================================
// CAISSE (SOLDE DES CAISSES)
// ============================================================

const caisseSchema = new mongoose.Schema({
  caisse: {
    type: String,
    enum: ['fonctionnement', 'fondsSocial', 'ag', 'projet'],
    required: true,
    unique: true
  },
  solde: {
    type: Number,
    default: 0
  },
  soldeInitial: {
    type: Number,
    default: 0
  },
  derniereMiseAJour: {
    type: Date,
    default: Date.now
  },
  historique: [{
    date: { type: Date, default: Date.now },
    montant: Number,
    type: { type: String, enum: ['credit', 'debit'] },
    reference: { type: mongoose.Schema.Types.ObjectId },
    description: String
  }]
});

caisseSchema.index({ caisse: 1 });

// Méthode pour créditer une caisse
caisseSchema.statics.crediter = async function(caisseName, montant, reference, description) {
  let caisse = await this.findOne({ caisse: caisseName });
  
  if (!caisse) {
    caisse = new this({
      caisse: caisseName,
      solde: 0,
      soldeInitial: 0,
      historique: []
    });
  }
  
  caisse.solde += montant;
  caisse.derniereMiseAJour = new Date();
  caisse.historique.push({
    date: new Date(),
    montant,
    type: 'credit',
    reference,
    description: description || 'Crédit'
  });
  
  await caisse.save();
  return caisse;
};

// Méthode pour débiter une caisse
caisseSchema.statics.debiter = async function(caisseName, montant, reference, description) {
  let caisse = await this.findOne({ caisse: caisseName });
  
  if (!caisse) {
    caisse = new this({
      caisse: caisseName,
      solde: 0,
      soldeInitial: 0,
      historique: []
    });
  }
  
  if (caisse.solde < montant) {
    throw new Error(`Solde insuffisant dans la caisse ${caisseName} (${caisse.solde} F disponible)`);
  }
  
  caisse.solde -= montant;
  caisse.derniereMiseAJour = new Date();
  caisse.historique.push({
    date: new Date(),
    montant,
    type: 'debit',
    reference,
    description: description || 'Débit'
  });
  
  await caisse.save();
  return caisse;
};

// Méthode pour obtenir tous les soldes
caisseSchema.statics.getAllSoldes = async function() {
  const caisses = await this.find();
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
  
  return soldes;
};

// ============================================================
// RAPPEL
// ============================================================

const rappelSchema = new mongoose.Schema({
  membreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Membre',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['cotisation', 'contribution_ag', 'sanction', 'fondsSocial', 'inscription'],
    required: true
  },
  montantDu: {
    type: Number,
    required: true
  },
  dateEnvoi: {
    type: Date,
    default: Date.now
  },
  statut: {
    type: String,
    enum: ['envoye', 'en_attente', 'echoue', 'lu'],
    default: 'envoye'
  },
  canal: {
    type: String,
    enum: ['email', 'whatsapp', 'sms', 'tous'],
    default: 'email'
  },
  annee: {
    type: Number,
    default: () => new Date().getFullYear()
  }
});

rappelSchema.index({ membreId: 1, dateEnvoi: -1 });
rappelSchema.index({ annee: 1 });
rappelSchema.index({ statut: 1 });

// Méthode pour obtenir les rappels par membre
rappelSchema.statics.getRappelsByMembre = async function(membreId, annee) {
  const filter = { membreId: new mongoose.Types.ObjectId(membreId) };
  if (annee) filter.annee = parseInt(annee);
  
  return await this.find(filter).sort({ dateEnvoi: -1 });
};

// ============================================================
// EXPORTS
// ============================================================

export const Transaction = mongoose.model('Transaction', transactionSchema);
export const Expense = mongoose.model('Expense', expenseSchema);
export const Caisse = mongoose.model('Caisse', caisseSchema);
export const Rappel = mongoose.model('Rappel', rappelSchema);

export default {
  Transaction,
  Expense,
  Caisse,
  Rappel
};
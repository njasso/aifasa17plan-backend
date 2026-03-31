// models/Finance.js
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  membreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Membre',  // CORRIGÉ: 'Membre' au lieu de 'Member'
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
    enum: ['adhesion', 'inscription', 'fondsSocial', 'contributionAG', 
           'sanction_absenceAG', 'sanction_retardCotisation', 'sanction_manquementDiscipline', 'sanction_autre'],
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
    enum: ['especes', 'mobile_money', 'virement', 'cheque', 'autre'],
    default: 'especes'
  },
  reference: {
    type: String,
    default: ''
  },
  annee: {
    type: Number,
    required: true,
    default: () => new Date().getFullYear()
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

// Index pour les recherches rapides
transactionSchema.index({ membreId: 1, annee: 1, type: 1 });
transactionSchema.index({ date: -1 });
transactionSchema.index({ sousType: 1 });

// Méthode statique pour obtenir le total par membre
transactionSchema.statics.getTotalByMember = async function(membreId, annee) {
  const filter = { membreId };
  if (annee) filter.annee = annee;
  
  const result = await this.aggregate([
    { $match: filter },
    { $group: { _id: null, total: { $sum: '$montant' } } }
  ]);
  return result[0]?.total || 0;
};

// Méthode statique pour obtenir les statistiques annuelles
transactionSchema.statics.getAnnualStats = async function(annee) {
  return await this.aggregate([
    { $match: { annee: annee || new Date().getFullYear() } },
    { $group: {
      _id: '$sousType',
      total: { $sum: '$montant' },
      count: { $sum: 1 }
    } }
  ]);
};

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
    default: () => new Date().getFullYear()
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

// Modèle pour le solde des caisses
const caisseSchema = new mongoose.Schema({
  caisse: {
    type: String,
    enum: ['fonctionnement', 'fondsSocial', 'ag', 'projet'],
    required: true,
    unique: true
  },
  solde: {
    type: Number,
    default: 0,
    min: 0
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
    reference: String,
    description: String
  }]
});

// Modèle pour les rappels programmés
const rappelSchema = new mongoose.Schema({
  membreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Membre',  // CORRIGÉ: 'Membre' au lieu de 'Member'
    required: true
  },
  type: {
    type: String,
    enum: ['cotisation', 'contribution_ag', 'sanction'],
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
    enum: ['envoye', 'en_attente', 'echoue'],
    default: 'envoye'
  },
  canal: {
    type: String,
    enum: ['email', 'whatsapp', 'sms'],
    default: 'email'
  }
});

export const Transaction = mongoose.model('Transaction', transactionSchema);
export const Expense = mongoose.model('Expense', expenseSchema);
export const Caisse = mongoose.model('Caisse', caisseSchema);
export const Rappel = mongoose.model('Rappel', rappelSchema);
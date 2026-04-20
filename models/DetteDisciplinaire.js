// models/DetteDisciplinaire.js
import mongoose from 'mongoose';

const historiqueSanctionSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['ajout', 'modification', 'suppression', 'paiement_partiel', 'paiement_total'],
    required: true
  },
  ancienMontant: {
    type: Number,
    default: 0
  },
  nouveauMontant: {
    type: Number,
    default: 0
  },
  motif: {
    type: String,
    default: ''
  },
  date: {
    type: Date,
    default: Date.now
  },
  faitPar: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    default: ''
  }
});

const detteDisciplinaireSchema = new mongoose.Schema({
  membreId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Membre',
    required: true,
    unique: true,
    index: true
  },
  montantTotal: {
    type: Number,
    default: 0,
    min: 0
  },
  montantPaye: {
    type: Number,
    default: 0,
    min: 0
  },
  montantRestant: {
    type: Number,
    default: 0
  },
  annee: {
    type: Number,
    required: true,
    default: () => new Date().getFullYear(),
    index: true
  },
  sanctions: [{
    id: { type: String, required: true },
    libelle: { type: String, required: true },
    montant: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    motif: { type: String },
    statut: { type: String, enum: ['en_attente', 'payee', 'annulee'], default: 'en_attente' }
  }],
  historique: [historiqueSanctionSchema],
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

// Index pour recherches rapides
detteDisciplinaireSchema.index({ membreId: 1, annee: 1 });
detteDisciplinaireSchema.index({ annee: 1, montantRestant: 1 });
detteDisciplinaireSchema.index({ membreId: 1, 'sanctions.statut': 1 });

// Méthode pour ajouter une sanction
detteDisciplinaireSchema.methods.ajouterSanction = async function(sanctionData, userId, notes = '') {
  const nouvelleSanction = {
    id: `sanction_${Date.now()}`,
    libelle: sanctionData.libelle,
    montant: sanctionData.montant,
    date: sanctionData.date || new Date(),
    motif: sanctionData.motif,
    statut: 'en_attente'
  };
  
  this.sanctions.push(nouvelleSanction);
  this.montantTotal += sanctionData.montant;
  this.montantRestant = this.montantTotal - this.montantPaye;
  
  this.historique.push({
    action: 'ajout',
    nouveauMontant: this.montantTotal,
    motif: sanctionData.motif,
    faitPar: userId,
    notes
  });
  
  this.updatedAt = new Date();
  await this.save();
  return nouvelleSanction;
};

// Méthode pour enregistrer un paiement
detteDisciplinaireSchema.methods.enregistrerPaiement = async function(montant, userId, notes = '') {
  const ancienPaye = this.montantPaye;
  this.montantPaye += montant;
  this.montantRestant = this.montantTotal - this.montantPaye;
  
  // Marquer les sanctions comme payées si nécessaire
  let resteAPayer = montant;
  for (const sanction of this.sanctions) {
    if (sanction.statut === 'en_attente' && resteAPayer > 0) {
      if (sanction.montant <= resteAPayer) {
        sanction.statut = 'payee';
        resteAPayer -= sanction.montant;
      } else {
        // Paiement partiel d'une sanction - on garde en attente
        break;
      }
    }
  }
  
  this.historique.push({
    action: this.montantRestant === 0 ? 'paiement_total' : 'paiement_partiel',
    ancienMontant: ancienPaye,
    nouveauMontant: this.montantPaye,
    faitPar: userId,
    notes
  });
  
  this.updatedAt = new Date();
  await this.save();
  return this;
};

// Méthode pour supprimer une sanction
detteDisciplinaireSchema.methods.supprimerSanction = async function(sanctionId, userId, notes = '') {
  const sanction = this.sanctions.id(sanctionId);
  if (!sanction) {
    throw new Error('Sanction non trouvée');
  }
  
  const montantSanction = sanction.montant;
  sanction.statut = 'annulee';
  
  this.montantTotal -= montantSanction;
  this.montantRestant = this.montantTotal - this.montantPaye;
  
  this.historique.push({
    action: 'suppression',
    ancienMontant: montantSanction,
    nouveauMontant: this.montantTotal,
    motif: sanction.motif,
    faitPar: userId,
    notes
  });
  
  this.updatedAt = new Date();
  await this.save();
  return this;
};

// Méthode statique pour obtenir les statistiques des dettes
detteDisciplinaireSchema.statics.getStats = async function(annee = new Date().getFullYear()) {
  const result = await this.aggregate([
    { $match: { annee: parseInt(annee) } },
    { $group: {
      _id: null,
      totalDettes: { $sum: '$montantTotal' },
      totalPaye: { $sum: '$montantPaye' },
      totalRestant: { $sum: '$montantRestant' },
      countMembres: { $sum: 1 },
      countMembresAvecDette: { $sum: { $cond: [{ $gt: ['$montantRestant', 0] }, 1, 0] } }
    } }
  ]);
  
  return result[0] || {
    totalDettes: 0,
    totalPaye: 0,
    totalRestant: 0,
    countMembres: 0,
    countMembresAvecDette: 0
  };
};

export const DetteDisciplinaire = mongoose.model('DetteDisciplinaire', detteDisciplinaireSchema);
export default DetteDisciplinaire;
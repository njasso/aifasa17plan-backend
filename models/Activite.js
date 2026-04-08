// backend/models/Activite.js
// ✅ VERSION CORRIGÉE — AIFASA 17
// BUG-02 FIX : Ajout du champ 'alertHistory' (anti-doublon scheduler)
// Ajout d'index optimisés pour les requêtes fréquentes du scheduler

import mongoose from 'mongoose';

const activiteSchema = new mongoose.Schema({
  titre: { 
    type: String, 
    required: [true, 'Le titre est requis'],
    trim: true,
    maxlength: [200, 'Le titre ne peut pas dépasser 200 caractères']
  },
  description: { 
    type: String,
    trim: true,
    maxlength: [2000, 'La description ne peut pas dépasser 2000 caractères']
  },
  type: {
    type: String,
    enum: ['reunion', 'evenement', 'projet', 'tache', 'formation', 'autre'],
    default: 'tache'
  },
  statut: {
    type: String,
    enum: ['planifie', 'en_cours', 'termine', 'annule', 'reporte'],
    default: 'planifie'
  },
  priorite: { 
    type: String, 
    enum: ['basse', 'normale', 'haute', 'urgente'], 
    default: 'normale' 
  },
  dateDebut: { 
    type: Date, 
    required: [true, 'La date de début est requise']
  },
  dateFin: { 
    type: Date, 
    required: [true, 'La date de fin est requise']
  },
  lieu: { 
    type: String,
    trim: true,
    maxlength: [200, 'Le lieu ne peut pas dépasser 200 caractères']
  },
  responsables: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Membre' 
  }],
  cibles: [{
    type: { 
      type: String, 
      enum: ['personne', 'projet', 'evenement', 'groupe', 'autre'],
      default: 'personne'
    },
    nom: { 
      type: String,
      trim: true,
      maxlength: [100, 'Le nom de la cible ne peut pas dépasser 100 caractères']
    },
    details: { 
      type: String,
      trim: true,
      maxlength: [500, 'Les détails ne peuvent pas dépasser 500 caractères']
    },
    membreRef: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Membre' 
    }
  }],
  ressources: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Ressource' 
  }],
  jalons: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Jalon' 
  }],
  budget: {
    prevu: { 
      type: Number, 
      default: 0,
      min: [0, 'Le budget prévu doit être positif']
    },
    reel: { 
      type: Number, 
      default: 0,
      min: [0, 'Le budget réel doit être positif']
    },
    devise: { 
      type: String, 
      default: 'XAF',
      uppercase: true,
      match: [/^[A-Z]{3}$/, 'Devise invalide (ISO 4217)']
    }
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [30, 'Chaque tag ne peut pas dépasser 30 caractères']
  }],
  progression: { 
    type: Number, 
    min: 0, 
    max: 100, 
    default: 0 
  },
  notes: { 
    type: String,
    trim: true
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },

  // ✅ [BUG-02 FIX] Champ anti-doublon pour les alertes automatiques du scheduler
  // Permet de tracer quelles étapes d'alerte ont été envoyées pour cette activité
  // Sans ce champ, act.alertHistory?.some() retourne toujours false → spam de notifications
  alertHistory: [
    {
      type:   { type: String, required: true }, // ex: "1 heure", "24 heures", "7 jours"
      sentAt: { type: Date, default: Date.now },
    }
  ],

}, { 
  timestamps: true 
});

// ─── Validations ────────────────────────────────────────────
activiteSchema.pre('validate', function(next) {
  if (this.dateDebut && this.dateFin && this.dateFin <= this.dateDebut) {
    next(new Error('La date de fin doit être postérieure à la date de début'));
  }
  next();
});

// ─── Auto-statut par progression ────────────────────────────
activiteSchema.pre('save', function(next) {
  if (this.progression === 100 && this.statut !== 'termine') {
    this.statut = 'termine';
  } else if (this.progression > 0 && this.progression < 100 && this.statut === 'planifie') {
    this.statut = 'en_cours';
  }
  next();
});

// ─── Index ───────────────────────────────────────────────────
activiteSchema.index({ dateDebut: 1, dateFin: 1 });
activiteSchema.index({ statut: 1 });
activiteSchema.index({ priorite: 1 });
activiteSchema.index({ type: 1 });
activiteSchema.index({ createdAt: -1 });
// ✅ Index spécifiques pour les requêtes fréquentes du scheduler
activiteSchema.index({ statut: 1, dateFin: 1 });       // checkDeadlines()
activiteSchema.index({ priorite: 1, statut: 1 });       // sendDailyDigest() urgentes

export default mongoose.model('Activite', activiteSchema);
// backend/models/AlerteMessage.js
import mongoose from 'mongoose';

// Schéma partagé pour les destinataires
const destinataireSchema = new mongoose.Schema({
  membre: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Membre' 
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  whatsapp: {
    type: String,
    trim: true
  },
  statut: { 
    type: String, 
    enum: ['en_attente', 'envoye', 'echoue'], 
    default: 'en_attente' 
  },
  erreur: { 
    type: String 
  }
}, { _id: false });

// ── Alerte ───────────────────────────────────────────────────
const alerteSchema = new mongoose.Schema({
  titre: { 
    type: String, 
    required: [true, 'Le titre est requis'],
    trim: true,
    maxlength: [200, 'Le titre ne peut pas dépasser 200 caractères']
  },
  message: { 
    type: String, 
    required: [true, 'Le message est requis'],
    trim: true
  },
  type: { 
    type: String, 
    enum: ['deadline', 'rappel', 'urgence', 'info'], 
    default: 'rappel' 
  },
  canaux: [{ 
    type: String, 
    enum: ['email', 'whatsapp', 'inapp'],
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'Au moins un canal doit être sélectionné'
    }
  }],
  statut: { 
    type: String, 
    enum: ['programmee', 'envoyee', 'echouee', 'annulee'], 
    default: 'programmee' 
  },
  dateProgrammee: { 
    type: Date, 
    required: [true, 'La date de programmation est requise'],
    // CORRECTION : Accepte aussi la date du jour
    validate: {
      validator: function(v) {
        if (!v) return false;
        // Permet d'accepter les dates dans les prochaines minutes
        const now = new Date();
        const diffMinutes = (new Date(v) - now) / 60000;
        return diffMinutes > -5; // Accepte jusqu'à 5 minutes dans le passé
      },
      message: 'La date de programmation doit être dans le futur ou très proche'
    }
  },
  dateEnvoi: Date,
  activite: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Activite' 
  },
  destinataires: [destinataireSchema],
  recurrence: {
    active: { 
      type: Boolean, 
      default: false 
    },
    frequence: { 
      type: String, 
      enum: ['quotidien', 'hebdo', 'mensuel'] 
    },
    finRecurrence: Date
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }
}, { 
  timestamps: true 
});

// Index
alerteSchema.index({ dateProgrammee: 1 });
alerteSchema.index({ statut: 1 });
alerteSchema.index({ type: 1 });
alerteSchema.index({ activite: 1 });

// ── Message ───────────────────────────────────────────────────
const messageSchema = new mongoose.Schema({
  sujet: { 
    type: String, 
    required: [true, 'Le sujet est requis'],
    trim: true,
    maxlength: [200, 'Le sujet ne peut pas dépasser 200 caractères']
  },
  contenu: { 
    type: String, 
    required: [true, 'Le contenu est requis'],
    trim: true
  },
  canal: { 
    type: String, 
    enum: ['email', 'whatsapp'], 
    required: true 
  },
  mode: { 
    type: String, 
    enum: ['individuel', 'groupe', 'tous'], 
    default: 'individuel' 
  },
  statut: { 
    type: String, 
    enum: ['brouillon', 'envoye', 'echoue'], 
    default: 'brouillon' 
  },
  dateEnvoi: Date,
  destinataires: [destinataireSchema],
  activite: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Activite' 
  },
  pieceJointe: { 
    type: String 
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }
}, { 
  timestamps: true 
});

// Index
messageSchema.index({ createdAt: -1 });
messageSchema.index({ statut: 1 });
messageSchema.index({ createdBy: 1 });

export const Alerte = mongoose.model('Alerte', alerteSchema);
export const Message = mongoose.model('Message', messageSchema);
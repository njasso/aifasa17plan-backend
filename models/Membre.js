// backend/models/Membre.js
import mongoose from 'mongoose';

const membreSchema = new mongoose.Schema({
  nom: { 
    type: String, 
    required: [true, 'Le nom est requis'],
    trim: true,
    maxlength: [100, 'Le nom ne peut pas dépasser 100 caractères']
  },
  prenom: { 
    type: String,
    trim: true,
    maxlength: [100, 'Le prénom ne peut pas dépasser 100 caractères']
  },
  email: { 
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Email invalide']
  },
  telephone: { 
    type: String,
    trim: true,
    set: v => v ? v.replace(/[\s-]/g, '') : v,   // enlève espaces et tirets
    match: [/^\+?[0-9]{9,15}$/, 'Format téléphone invalide (ex: +237699000001)']
  },
  whatsapp: { 
    type: String,
    trim: true,
    set: v => v ? v.replace(/[\s-]/g, '') : v,
    match: [/^\+?[0-9]{9,15}$/, 'Format WhatsApp invalide (ex: +237699000001)']
  },
  role: { 
    type: String,
    trim: true,
    maxlength: [50, 'Le rôle ne peut pas dépasser 50 caractères']
  },
  poste: { 
    type: String,
    trim: true,
    maxlength: [100, 'Le poste ne peut pas dépasser 100 caractères']
  },
  photo: { 
    type: String,
    default: ''
  },
  actif: { 
    type: Boolean, 
    default: true 
  },
  dateAdhesion: { 
    type: Date, 
    default: Date.now 
  },
  competences: [{
    type: String,
    trim: true,
    maxlength: [50, 'Chaque compétence ne peut pas dépasser 50 caractères']
  }],
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }
}, { 
  timestamps: true 
});

// Index pour les recherches
membreSchema.index({ nom: 1, prenom: 1 });
membreSchema.index({ email: 1 });
membreSchema.index({ role: 1 });
membreSchema.index({ actif: 1 });
membreSchema.index({ dateAdhesion: -1 });

// Méthode pour obtenir le nom complet
membreSchema.virtual('nomComplet').get(function() {
  return `${this.nom} ${this.prenom || ''}`.trim();
});

// Méthode pour vérifier si le membre a un contact valide
membreSchema.methods.hasContact = function(canal) {
  if (canal === 'email') return !!this.email;
  if (canal === 'whatsapp') return !!this.whatsapp;
  return false;
};

export default mongoose.model('Membre', membreSchema);
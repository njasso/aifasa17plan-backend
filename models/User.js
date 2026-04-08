import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
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
    required: [true, 'L\'email est requis'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Email invalide']
  },
  telephone: { 
    type: String,
    trim: true,
    set: v => v ? v.replace(/[\s-]/g, '') : v, // supprime espaces/tirets avant validation
    match: [/^\+?[0-9]{9,15}$/, 'Format téléphone invalide (ex: +237699000001)']
  },
  whatsapp: { 
    type: String,
    trim: true,
    set: v => v ? v.replace(/[\s-]/g, '') : v,
    match: [/^\+?[0-9]{9,15}$/, 'Format WhatsApp invalide (ex: +237699000001)']
  },
  motdepasse: { 
    type: String, 
    required: [true, 'Le mot de passe est requis'],
    minlength: [6, 'Le mot de passe doit contenir au moins 6 caractères'],
    select: false
  },
  role: { 
    type: String, 
    enum: ['admin', 'moderateur', 'membre'], 
    default: 'membre' 
  },
  association: { 
    type: String,
    default: 'AIFASA 17',
    trim: true
  },
  avatar: { 
    type: String,
    default: ''
  },
  actif: { 
    type: Boolean, 
    default: true 
  },
  lastLogin: { 
    type: Date 
  },
  lastLogout: { 
    type: Date 
  },
  loginAttempts: {
    type: Number,
    default: 0,
    min: 0
  },
  lockedUntil: {
    type: Date
  }
}, { 
  timestamps: true 
});

// Index pour les recherches
userSchema.index({ role: 1 });
userSchema.index({ actif: 1 });
userSchema.index({ createdAt: -1 });

// Hash du mot de passe avant sauvegarde
userSchema.pre('save', async function(next) {
  if (!this.isModified('motdepasse')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.motdepasse = await bcrypt.hash(this.motdepasse, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Méthode pour vérifier le mot de passe
userSchema.methods.verifierMotdepasse = async function(mdp) {
  if (!this.motdepasse) return false;
  return bcrypt.compare(mdp, this.motdepasse);
};

// Méthode pour incrémenter les tentatives de connexion
userSchema.methods.incrementLoginAttempts = async function() {
  this.loginAttempts += 1;
  if (this.loginAttempts >= 5) {
    this.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  }
  await this.save();
};

// Méthode pour réinitialiser les tentatives de connexion
userSchema.methods.resetLoginAttempts = async function() {
  this.loginAttempts = 0;
  this.lockedUntil = null;
  await this.save();
};

// Méthode pour vérifier si le compte est verrouillé
userSchema.methods.isLocked = function() {
  if (!this.lockedUntil) return false;
  return this.lockedUntil > new Date();
};

// Virtual pour le nom complet
userSchema.virtual('nomComplet').get(function() {
  return `${this.nom} ${this.prenom || ''}`.trim();
});

// Transformer en objet pour les réponses (supprimer les champs sensibles)
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.motdepasse;
  delete obj.loginAttempts;
  delete obj.lockedUntil;
  delete obj.__v;
  return obj;
};

// Statics
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email }).select('+motdepasse');
};

userSchema.statics.findActive = function() {
  return this.find({ actif: true });
};

export default mongoose.model('User', userSchema);
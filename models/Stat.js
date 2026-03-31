// backend/models/Stat.js
import mongoose from 'mongoose';

const statSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['daily', 'weekly', 'monthly', 'yearly'],
    required: true 
  },
  date: { type: Date, required: true },
  data: {
    activites: {
      total: Number,
      parType: Object,
      parStatut: Object,
      parPriorite: Object
    },
    membres: {
      total: Number,
      actifs: Number,
      nouveaux: Number
    },
    communications: {
      messagesEnvoyes: Number,
      alertesEnvoyees: Number,
      tauxOuverture: Number
    }
  },
  generatedAt: { type: Date, default: Date.now }
});

statSchema.index({ type: 1, date: 1 }, { unique: true });

export default mongoose.model('Stat', statSchema);
// backend/models/Jalon.js
import mongoose from 'mongoose';

const jalonSchema = new mongoose.Schema({
  titre: { type: String, required: true },
  description: { type: String },
  activiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activite', required: true },
  datePrevue: { type: Date, required: true },
  dateReelle: Date,
  statut: { 
    type: String, 
    enum: ['a_venir', 'en_cours', 'atteint', 'depasse', 'annule'], 
    default: 'a_venir' 
  },
  progression: { type: Number, min: 0, max: 100, default: 0 },
  livrables: [String],
  responsable: { type: mongoose.Schema.Types.ObjectId, ref: 'Membre' },
  notifications: [{
    type: { type: String, enum: ['email', 'whatsapp'] },
    delai: Number,
    envoyee: { type: Boolean, default: false },
    dateEnvoi: Date
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

jalonSchema.index({ activiteId: 1, datePrevue: 1 });

export default mongoose.model('Jalon', jalonSchema);
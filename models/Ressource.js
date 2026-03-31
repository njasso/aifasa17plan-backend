// backend/models/Ressource.js
import mongoose from 'mongoose';

const ressourceSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['humaine', 'financiere', 'materielle', 'equipement', 'vehicule', 'salle'],
    required: true
  },
  nom: { type: String, required: true },
  description: { type: String },
  quantite: { type: Number, default: 1 },
  unite: { type: String },
  coutUnitaire: { type: Number, default: 0 },
  devise: { type: String, default: 'XAF' },
  disponibilite: { type: Boolean, default: true },
  responsable: { type: mongoose.Schema.Types.ObjectId, ref: 'Membre' },
  activiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Activite' },
  dateDebut: Date,
  dateFin: Date,
  statut: { 
    type: String, 
    enum: ['disponible', 'reserve', 'utilise', 'indisponible'], 
    default: 'disponible' 
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

ressourceSchema.index({ activiteId: 1 });
ressourceSchema.index({ type: 1 });
ressourceSchema.index({ disponibilite: 1 });

export default mongoose.model('Ressource', ressourceSchema);
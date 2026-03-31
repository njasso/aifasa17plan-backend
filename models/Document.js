// backend/models/Document.js
import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['activite', 'membre', 'rapport', 'autre'],
    required: true 
  },
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  chemin: { type: String, required: true },
  taille: { type: Number },
  mimeType: { type: String },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

documentSchema.index({ referenceId: 1, type: 1 });

export default mongoose.model('Document', documentSchema);
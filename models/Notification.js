// backend/models/Notification.js
import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  type: { 
    type: String, 
    enum: ['alerte', 'message', 'rappel', 'systeme'],
    default: 'systeme'
  },
  titre: { 
    type: String, 
    required: true 
  },
  message: { 
    type: String, 
    required: true 
  },
  lien: { type: String },
  lu: { type: Boolean, default: false },
  luAt: Date,
  data: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
});

notificationSchema.index({ user: 1, lu: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
import mongoose from "mongoose";

const organisationSchema = new mongoose.Schema({
  nom: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  whatsappNumbers: [
    {
      phone: String,
      sessionId: String
    }
  ]
}, { timestamps: true });

export default mongoose.model("Organisation", organisationSchema);
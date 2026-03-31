// routes/webhook.js

import express from "express";
import { aiService } from "../services/aiService.js";
import { whatsappService } from "../services/whatsappService.js";

const router = express.Router();

router.post("/evolution", async (req, res) => {
  try {
    const msg = req.body;

    const text = msg?.message?.conversation;
    const from = msg?.key?.remoteJid;

    if (!text) return res.sendStatus(200);

    // 🤖 IA
    const reply = await aiService.generateReply(text);

    // 📩 réponse
    await whatsappService.send({
      to: from,
      message: reply
    });

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

export default router;
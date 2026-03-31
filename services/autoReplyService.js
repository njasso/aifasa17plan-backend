import { aiService } from "./aiService.js";
import { whatsappService } from "./whatsappService.js";

export const autoReplyService = {

  async handleIncomingMessage({ sessionId, from, message }) {

    // 🔥 IA génère réponse
    const response = await aiService.generateReply(message);

    // 📩 envoi réponse
    await whatsappService.send({
      sessionId,
      to: from,
      message: response
    });

  }

};
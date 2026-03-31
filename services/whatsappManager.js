import { initWhatsApp } from "./whatsappBaileys.js";

const sessions = new Map();

export const whatsappManager = {

  async createSession(sessionId) {

    if (sessions.has(sessionId)) {
      return sessions.get(sessionId);
    }

    let sock;

    await initWhatsApp(
      (qr) => {
        console.log(`📱 QR pour ${sessionId}`);
      },
      () => {
        console.log(`✅ ${sessionId} connecté`);
      },
      () => {
        console.log(`❌ ${sessionId} déconnecté`);
        sessions.delete(sessionId);
      },
      sessionId // 👈 important
    ).then(s => sock = s);

    sessions.set(sessionId, sock);

    return sock;
  },

  getSession(sessionId) {
    return sessions.get(sessionId);
  }
};
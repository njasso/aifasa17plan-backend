import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

const AUTH_DIR = path.join(process.cwd(), 'auth_business');

// Créer le dossier d'authentification
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

console.log('\n' + '='.repeat(60));
console.log('💼 WHATSAPP BUSINESS');
console.log('='.repeat(60));
console.log(`📱 Numéro: 237620370286`);
console.log(`📁 Dossier: ${AUTH_DIR}`);
console.log('='.repeat(60) + '\n');

let sock = null;

const start = async () => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['AIFASA17 Business', 'Chrome', '1.0.0'],
    });
    
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.clear();
        console.log('\n' + '='.repeat(60));
        console.log('📱 SCANNEZ CE QR CODE AVEC WHATSAPP BUSINESS:');
        console.log('='.repeat(60));
        qrcode.generate(qr, { small: true });
        console.log('\n📱 Instructions:');
        console.log('1. Ouvrez WhatsApp Business sur votre téléphone');
        console.log('2. Paramètres > Appareils connectés > Lier un appareil');
        console.log('3. Scannez le QR code ci-dessus');
        console.log('💡 Utilisez le numéro: 237620370286');
        console.log('='.repeat(60) + '\n');
      }
      
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log('🔄 Reconnexion dans 5 secondes...');
          setTimeout(start, 5000);
        } else {
          console.log('❌ Déconnecté définitivement. Scannez à nouveau le QR code.');
          process.exit(1);
        }
      }
      
      if (connection === 'open') {
        console.clear();
        console.log('\n' + '='.repeat(60));
        console.log('✅ WHATSAPP BUSINESS CONNECTÉ ! 🎉');
        console.log('='.repeat(60));
        console.log(`📱 Numéro: ${sock.user?.id || '237620370286'}`);
        console.log(`💼 Mode: WhatsApp Business`);
        console.log(`📁 Session: ${AUTH_DIR}`);
        console.log('='.repeat(60) + '\n');
        console.log('Vous pouvez maintenant:');
        console.log('- Envoyer des messages');
        console.log('- Gérer les groupes');
        console.log('- Utiliser les fonctionnalités Business\n');
        process.exit(0);
      }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('error', (err) => {
      console.error('❌ Erreur:', err.message);
    });
    
  } catch (error) {
    console.error('❌ Erreur de démarrage:', error.message);
    process.exit(1);
  }
};

start();

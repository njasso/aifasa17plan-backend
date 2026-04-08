import express from 'express';
import { initWhatsApp } from './services/whatsappBaileys.js';
import qrcode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

let currentQR = null;

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp QR Code - AIFASA 17</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          background: linear-gradient(135deg, #14532d, #15803d);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          margin: 0;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 24px;
          padding: 32px;
          text-align: center;
          max-width: 400px;
          width: 100%;
          box-shadow: 0 20px 40px rgba(0,0,0,0.2);
        }
        h1 {
          color: #14532d;
          margin-bottom: 8px;
          font-size: 24px;
        }
        .status {
          color: #6b7c6b;
          margin-bottom: 24px;
          font-size: 14px;
        }
        #qrcode {
          margin: 20px 0;
          display: flex;
          justify-content: center;
        }
        .instructions {
          background: #f0fdf4;
          padding: 16px;
          border-radius: 12px;
          text-align: left;
          font-size: 14px;
          color: #14532d;
          margin-top: 20px;
        }
        .step {
          margin: 8px 0;
        }
        .connected {
          color: #16a34a;
          font-weight: bold;
        }
        .loading {
          color: #f59e0b;
        }
        button {
          background: #16a34a;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 10px;
          cursor: pointer;
          margin-top: 10px;
        }
        button:hover {
          background: #15803d;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 WhatsApp Business</h1>
        <div class="status" id="status">🔄 En attente de connexion...</div>
        <div id="qrcode"></div>
        <div class="instructions">
          <strong>📖 Instructions:</strong>
          <div class="step">1️⃣ Ouvrez WhatsApp sur votre téléphone</div>
          <div class="step">2️⃣ Paramètres > Appareils connectés > Lier un appareil</div>
          <div class="step">3️⃣ Scannez le QR code ci-dessus</div>
        </div>
        <button onclick="location.reload()">🔄 Rafraîchir</button>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/qrcodejs2@0.0.2/qrcode.min.js"></script>
      <script>
        function updateQR(qrData) {
          if (qrData && qrData !== 'null') {
            document.getElementById('qrcode').innerHTML = '';
            new QRCode(document.getElementById('qrcode'), {
              text: qrData,
              width: 256,
              height: 256,
              colorDark: '#14532d',
              colorLight: '#ffffff',
              correctLevel: QRCode.CorrectLevel.M
            });
            document.getElementById('status').innerHTML = '✅ QR Code prêt - Scannez avec WhatsApp';
            document.getElementById('status').className = 'connected';
          }
        }
        
        async function checkQR() {
          const response = await fetch('/qr');
          const data = await response.json();
          if (data.qr) {
            updateQR(data.qr);
          } else if (data.connected) {
            document.getElementById('qrcode').innerHTML = '<div class="connected">✅ WhatsApp CONNECTÉ !</div>';
            document.getElementById('status').innerHTML = '🎉 WhatsApp connecté avec succès !';
            document.getElementById('status').className = 'connected';
          }
        }
        
        setInterval(checkQR, 2000);
        checkQR();
      </script>
    </body>
    </html>
  `);
});

app.get('/qr', async (req, res) => {
  res.json({ qr: currentQR, connected: !!global.waConnected });
});

app.listen(PORT, () => {
  console.log(`\n🌐 Interface QR Code: http://localhost:${PORT}\n`);
  console.log('📱 Ouvrez cette URL dans votre navigateur');
  console.log('🔗 Scannez le QR code avec WhatsApp\n');
});

// Démarrer WhatsApp
let qrDisplayed = false;
await initWhatsApp(
  (qr) => {
    currentQR = qr;
    if (!qrDisplayed) {
      console.log('\n✅ QR Code généré !');
      console.log(`🌐 Ouvrez: http://localhost:${PORT}\n`);
      qrDisplayed = true;
    }
  },
  () => {
    global.waConnected = true;
    currentQR = null;
    console.log('\n🎉 WhatsApp CONNECTÉ !\n');
  },
  () => {
    global.waConnected = false;
    console.log('\n⚠️ WhatsApp déconnecté\n');
  }
);

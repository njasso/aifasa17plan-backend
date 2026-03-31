import puppeteer from 'puppeteer';
import express from 'express';
import qrcode from 'qrcode';

const app = express();
const PORT = 3002;

let browser = null;
let page = null;

app.get('/', async (req, res) => {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    await page.goto('https://web.whatsapp.com');
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>WhatsApp Session</title>
      <style>
        body {
          font-family: system-ui;
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
          max-width: 500px;
        }
        h1 { color: #14532d; }
        .status {
          padding: 16px;
          border-radius: 12px;
          margin: 20px 0;
          font-weight: bold;
        }
        .waiting { background: #fef3c7; color: #d97706; }
        .connected { background: #dcfce7; color: #16a34a; }
        button {
          background: #16a34a;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 10px;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 WhatsApp Session</h1>
        <div class="status waiting" id="status">
          🔄 En attente de connexion...
        </div>
        <p>1. Ouvrez WhatsApp Web dans une autre fenêtre</p>
        <p>2. Scannez le QR code</p>
        <p>3. Revenez ici</p>
        <button onclick="checkStatus()">🔄 Vérifier statut</button>
        <div id="info" style="margin-top: 20px;"></div>
      </div>
      <script>
        async function checkStatus() {
          const res = await fetch('/status');
          const data = await res.json();
          const statusDiv = document.getElementById('status');
          const infoDiv = document.getElementById('info');
          
          if (data.connected) {
            statusDiv.className = 'status connected';
            statusDiv.innerHTML = '✅ WhatsApp CONNECTÉ !';
            infoDiv.innerHTML = '<p>🎉 Vous pouvez maintenant utiliser WhatsApp dans votre application.</p>';
          } else {
            statusDiv.className = 'status waiting';
            statusDiv.innerHTML = '⚠️ Non connecté. Scannez le QR code sur WhatsApp Web.';
          }
        }
        setInterval(checkStatus, 3000);
        checkStatus();
      </script>
    </body>
    </html>
  `);
});

app.get('/status', async (req, res) => {
  if (page) {
    const url = await page.url();
    const isConnected = !url.includes('qrcode');
    res.json({ connected: isConnected });
  } else {
    res.json({ connected: false });
  }
});

app.listen(PORT, () => {
  console.log(`\n🌐 Interface: http://localhost:${PORT}`);
  console.log('📱 Ouvrez WhatsApp Web: https://web.whatsapp.com\n');
});

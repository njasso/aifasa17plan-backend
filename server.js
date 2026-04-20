import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import { schedulerService } from './services/schedulerService.js';
import { whatsappService } from './services/whatsappService.js';
import logger, { setupUncaughtExceptions } from './utils/logger.js';

// ============================================================
// 🔥 INIT
// ============================================================
setupUncaughtExceptions();
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================
// ✅ CORS FIX (PROPRE ET STABLE)
// ============================================================
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://aifasa17plan-frontend.onrender.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, true); // 🔥 autoriser tout temporairement
  },
  credentials: true,
}));

// 🔥 IMPORTANT pour OPTIONS
app.options('*', cors());

// ============================================================
// 🔐 SECURITY + MIDDLEWARES
// ============================================================
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use(
  process.env.NODE_ENV === 'production'
    ? morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } })
    : morgan('dev')
);

// ============================================================
// 📁 STATIC
// ============================================================
const uploadsDir = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

// ============================================================
// 🌐 HTTP + SOCKET.IO
// ============================================================
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    credentials: true,
  },
});

io.on('connection', (socket) => {
  logger.info(`🔌 Socket connecté: ${socket.id}`);
  socket.on('registerSession', (data) => logger.info(`Socket registered:`, data));
  socket.on('disconnect', () => logger.info(`🔌 Socket déconnecté: ${socket.id}`));
});

// ============================================================
// 🗄️ MONGODB (NON BLOQUANT)
// ============================================================
let mongoRetryCount = 0;
const MAX_MONGO_RETRIES = 5;

const connectDB = async () => {
  try {
    console.log("🔄 Connexion MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    mongoRetryCount = 0;
    console.log("✅ MongoDB connecté");

    schedulerService.start();

  } catch (err) {
    mongoRetryCount++;
    console.error(`❌ MongoDB (${mongoRetryCount}/${MAX_MONGO_RETRIES}):`, err.message);

    if (mongoRetryCount < MAX_MONGO_RETRIES) {
      setTimeout(connectDB, 5000);
    }
  }
};

connectDB();

// ============================================================
// 🤖 WHATSAPP (NON BLOQUANT)
// ============================================================
const startWhatsApp = async () => {
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    logger.info('📵 WhatsApp désactivé');
    return;
  }

  try {
    logger.info('🔄 Initialisation WhatsApp...');
    await whatsappService.init();
    logger.info('✅ WhatsApp prêt');
  } catch (err) {
    logger.warn('⚠️ WhatsApp erreur:', err.message);
  }
};

// ============================================================
// 📦 ROUTES
// ============================================================
import authRoutes from './routes/auth.js';
import memberRoutes from './routes/members.js';
import activityRoutes from './routes/activities.js';
import targetRoutes from './routes/targets.js';
import alertRoutes from './routes/alerts.js';
import messageRoutes from './routes/messages.js';
import dashboardRoutes from './routes/dashboard.js';
import reportRoutes from './routes/reports.js';
import aiRoutes from './routes/ai.js';
import notificationRoutes from './routes/notifications.js';
import statsRoutes from './routes/stats.js';
import uploadRoutes from './routes/upload.js';
import jalonRoutes from './routes/jalons.js';
import ressourceRoutes from './routes/ressources.js';
import webhookRoutes from './routes/webhook.js';
import financesRoutes from './routes/finances.js';
import sanctionsRoutes from './routes/sanctions.js';


app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/jalons', jalonRoutes);
app.use('/api/ressources', ressourceRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/sanctions', sanctionsRoutes);

// ============================================================
// ❤️ HEALTH CHECK (IMPORTANT RENDER)
// ============================================================
app.get('/health', async (req, res) => {
  let waStatus = { connected: false };
  try {
    waStatus = await whatsappService.getStatus();
  } catch {}

  res.json({
    status: 'UP',
    uptime: process.uptime(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    whatsapp: waStatus.connected,
  });
});

app.get('/', (req, res) => {
  res.json({ name: 'AIFASA API', status: 'OK' });
});

// ============================================================
// ❌ 404 + ERROR HANDLER
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

app.use((err, req, res, next) => {
  logger.error(err.message);
  res.status(500).json({ error: 'Erreur serveur' });
});

// ============================================================
// 🚀 START SERVER (UNE SEULE FOIS)
// ============================================================
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur ${PORT}`);

  // 🔥 WhatsApp en arrière-plan
  startWhatsApp();
});

// ============================================================
// 🛑 SHUTDOWN
// ============================================================
process.on('SIGINT', async () => {
  console.log("🛑 Arrêt serveur...");
  await mongoose.connection.close();
  process.exit(0);
});

export { app, server, io };
export default app;
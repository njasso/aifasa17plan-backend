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

setupUncaughtExceptions();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'https://localhost',              // 🔥 AJOUTER CETTE LIGNE
  'capacitor://localhost',        // Capacitor Android
  'http://localhost',              // WebView local
  'file://',                       // Fichiers locaux
  'https://aifasa17plan-frontend.onrender.com',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'X-Requested-With'],
  optionsSuccessStatus: 200,
}));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (process.env.NODE_ENV !== 'production') {
    res.header('Access-Control-Allow-Origin', origin || '*');
  } else if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    },
  } : false,
}));

app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
} else {
  app.use(morgan('dev'));
}

const uploadsDir = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : '*',
    credentials: true,
    methods: ['GET', 'POST'],
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

io.on('connection', (socket) => {
  logger.info(`🔌 Socket connecté: ${socket.id}`);
  socket.on('registerSession', (data) => logger.info(`Socket registered:`, data));
  socket.on('disconnect', () => logger.info(`🔌 Socket déconnecté: ${socket.id}`));
});

let isConnected = false;
let mongoRetryCount = 0;
const MAX_MONGO_RETRIES = 5;

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aifasa17';
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      family: 4,
      retryWrites: true,
      retryReads: true,
    });

    isConnected = true;
    mongoRetryCount = 0;
    console.log('✅ MongoDB connecté avec succès');
    console.log(` 📁 Base de données: ${mongoose.connection.name}`);
    console.log(` 🔗 Hôte: ${mongoose.connection.host}`);

    schedulerService.start();
    await whatsappService.init();

  } catch (err) {
    isConnected = false;
    mongoRetryCount++;
    console.error(`❌ Erreur MongoDB (tentative ${mongoRetryCount}/${MAX_MONGO_RETRIES}):`, err.message);
    if (mongoRetryCount < MAX_MONGO_RETRIES) {
      setTimeout(connectDB, 5000);
    } else {
      console.error('❌ Impossible de se connecter à MongoDB après plusieurs tentatives');
    }
  }
};

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error:', err);
  isConnected = false;
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB déconnecté, reconnexion...');
  isConnected = false;
  setTimeout(connectDB, 5000);
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnecté');
  isConnected = true;
});

connectDB();

// Import des routes
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

// Utilisation des routes
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

app.get('/test-cors', (req, res) => res.json({ message: 'CORS OK', timestamp: new Date() }));

app.get('/health', async (req, res) => {
  const dbStatus = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' }[mongoose.connection.readyState] || 'unknown';
  const waStatus = await whatsappService.getStatus();
  res.json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: { status: dbStatus, name: mongoose.connection.name, host: mongoose.connection.host },
      ai: { configured: !!process.env.DEEPSEEK_API_KEY, provider: 'DeepSeek' },
      email: { configured: !!(process.env.SMTP_USER && process.env.SMTP_PASS) },
      whatsapp: { connected: waStatus.connected, user: waStatus.user, provider: 'Baileys' },
      websocket: { status: 'active', connections: io.engine?.clientsCount || 0 },
      finances: { status: 'active', version: '1.0.0' }
    },
    version: '2.1.0',
  });
});

app.get('/', (req, res) => res.json({ 
  name: 'AIFASA 17 API', 
  version: '2.1.0',
  endpoints: {
    auth: '/api/auth',
    members: '/api/members',
    activities: '/api/activities',
    finances: '/api/finances',
    dashboard: '/api/dashboard',
    reports: '/api/reports'
  }
}));

app.use((req, res) => {
  logger.warn(`Route non trouvée: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ success: false, error: 'Route non trouvée', path: req.originalUrl });
});

app.use((err, req, res, next) => {
  logger.error(`Erreur serveur: ${err.message}`, { stack: err.stack });

  if (err.name === 'ValidationError') {
    return res.status(400).json({ success: false, error: 'Erreur de validation', details: Object.values(err.errors).map(e => e.message) });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, error: 'ID invalide', field: err.path });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({ success: false, error: `"${field}" existe déjà`, field });
  }
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ success: false, error: 'Token invalide' });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ success: false, error: 'Token expiré' });

  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Erreur interne du serveur' : err.message,
  });
});

server.listen(PORT, async () => {
  const waStatus = await whatsappService.getStatus();

  console.log(`
  🌿 AIFASA 17 API
  ═══════════════════════════════════════════════════════════════════════
  🚀 Serveur: http://localhost:${PORT}
  📊 Health: http://localhost:${PORT}/health
  📚 Documentation: http://localhost:${PORT}/api/docs
  🌍 Environnement: ${process.env.NODE_ENV || 'development'}
  🤖 IA DeepSeek: ${process.env.DEEPSEEK_API_KEY ? '✅ Configurée' : '❌ Non configurée'}
  📧 Email: ${process.env.SMTP_USER ? '✅ Configuré' : '❌ Non configuré'}
  💬 WhatsApp: ${waStatus.connected ? `✅ Connecté (${waStatus.user?.name || 'Session'})` : '🔄 En initialisation...'}
  💰 Finances: ✅ Actif (gestion des cotisations, sanctions, caisses)
  🔌 WebSocket: ✅ Actif
  ═══════════════════════════════════════════════════════════════════════
  `);
});

const gracefulShutdown = async () => {
  console.log('\n🛑 Arrêt du serveur...');
  io.close(() => logger.info('Socket.io fermé'));
  schedulerService.stop();
  await mongoose.connection.close();
  server.close(() => {
    logger.info('✅ Serveur arrêté proprement');
    process.exit(0);
  });
  setTimeout(() => { logger.error('Arrêt forcé'); process.exit(1); }, 10000);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

export { app, server, io };
export default app;
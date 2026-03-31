// backend/utils/logger.js
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Déterminer le dossier des logs
// Priorité: variable d'environnement > dossier local > dossier par défaut
const getLogDirectory = () => {
  // 1. Utiliser la variable d'environnement si définie
  if (process.env.LOG_PATH) {
    return process.env.LOG_PATH;
  }
  
  // 2. En production, utiliser /app/logs (Docker)
  if (process.env.NODE_ENV === 'production') {
    return '/app/logs';
  }
  
  // 3. En développement, utiliser le dossier local
  return path.join(__dirname, '../../logs');
};

const logDir = getLogDirectory();

// Créer le dossier logs avec les bonnes permissions
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o777 });
    console.log(`📁 Dossier logs créé: ${logDir}`);
  }
} catch (error) {
  console.error(`❌ Impossible de créer le dossier logs: ${error.message}`);
  // Fallback: utiliser un dossier temporaire
  if (process.env.NODE_ENV !== 'production') {
    const tempDir = '/tmp/aifasa-logs';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    logDir = tempDir;
    console.log(`📁 Utilisation du dossier temporaire: ${logDir}`);
  }
}

// Format personnalisé pour les fichiers (JSON)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Format pour la console (développement)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    let log = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0 && meta.service !== 'aifasa17-api') {
      // Éviter d'afficher les métadonnées trop volumineuses
      const cleanMeta = { ...meta };
      delete cleanMeta.service;
      if (Object.keys(cleanMeta).length > 0) {
        log += ` | ${JSON.stringify(cleanMeta)}`;
      }
    }
    return log;
  })
);

// Configuration des transports
const transports = [];

// Ajouter les transports fichier seulement en production ou si LOG_TO_FILE est défini
if (process.env.NODE_ENV === 'production' || process.env.LOG_TO_FILE === 'true') {
  // Fichier pour les erreurs
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: fileFormat
    }),
    
    // Fichier pour tous les logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: fileFormat
    })
  );
}

// Ajouter la console toujours en développement, et en production si LOG_TO_CONSOLE est défini
if (process.env.NODE_ENV !== 'production' || process.env.LOG_TO_CONSOLE === 'true') {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
    })
  );
}

// Créer le logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  defaultMeta: { service: 'aifasa17-api' },
  transports,
  exitOnError: false
});

// Fonctions utilitaires pour des logs spécifiques
export const logInfo = (message, meta = {}) => {
  logger.info(message, { ...meta });
};

export const logError = (message, error, meta = {}) => {
  logger.error(message, {
    ...meta,
    error: error?.message || error,
    stack: error?.stack
  });
};

export const logWarn = (message, meta = {}) => {
  logger.warn(message, { ...meta });
};

export const logDebug = (message, meta = {}) => {
  logger.debug(message, { ...meta });
};

// Logger pour les requêtes API
export const logRequest = (req, res, duration) => {
  logger.info(`${req.method} ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    status: res.statusCode,
    duration: `${duration}ms`,
    ip: req.ip || req.connection.remoteAddress,
    user: req.user?._id,
    userAgent: req.get('user-agent')
  });
};

// Logger pour les actions utilisateur
export const logUserAction = (userId, action, details = {}) => {
  logger.info(`User action: ${action}`, {
    userId,
    action,
    ...details
  });
};

// Logger pour les erreurs de base de données
export const logDBError = (operation, error, query = {}) => {
  logger.error(`Database error on ${operation}`, {
    operation,
    error: error.message,
    query,
    stack: error.stack
  });
};

// Logger pour les envois de messages
export const logMessageSend = (type, channel, recipient, success, error = null) => {
  logger.info(`Message sent: ${type} via ${channel}`, {
    type,
    channel,
    recipient,
    success,
    error: error?.message
  });
};

// Logger pour WhatsApp
export const logWhatsApp = (action, status, details = {}) => {
  logger.info(`WhatsApp: ${action}`, {
    action,
    status,
    ...details
  });
};

// Fonction pour capturer les exceptions non gérées
export const setupUncaughtExceptions = () => {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack
    });
    
    // En développement, ne pas quitter
    if (process.env.NODE_ENV === 'production') {
      setTimeout(() => {
        process.exit(1);
      }, 5000);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
      reason: reason?.message || reason,
      promise: promise?.toString?.() || 'unknown'
    });
  });
};

// Fonction pour nettoyer les logs
export const cleanupLogs = (maxAgeDays = 30) => {
  if (!fs.existsSync(logDir)) return;
  
  const now = Date.now();
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  
  try {
    const files = fs.readdirSync(logDir);
    let deletedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(logDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch (err) {
        logger.warn(`Could not delete old log file: ${file}`, { error: err.message });
      }
    });
    
    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old log files`);
    }
  } catch (error) {
    logger.error('Error during log cleanup', { error: error.message });
  }
};

// Exécuter le nettoyage périodiquement (toutes les 24h)
if (process.env.NODE_ENV === 'production') {
  setInterval(() => cleanupLogs(30), 24 * 60 * 60 * 1000);
}

// Setup uncaught exceptions
setupUncaughtExceptions();

export default logger;
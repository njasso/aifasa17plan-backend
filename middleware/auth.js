// backend/middleware/auth.js
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import logger from '../utils/logger.js';

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Accès non autorisé. Token manquant.' 
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const secret = process.env.JWT_SECRET;
    
    if (!secret) {
      logger.error('JWT_SECRET non défini dans les variables d\'environnement');
      return res.status(500).json({ 
        success: false, 
        message: 'Erreur de configuration serveur' 
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          message: 'Session expirée. Veuillez vous reconnecter.' 
        });
      }
      if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          success: false, 
          message: 'Token invalide.' 
        });
      }
      throw jwtError;
    }

    const user = await User.findById(decoded.id)
      .select('-motdepasse')
      .lean();

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Utilisateur non trouvé.' 
      });
    }

    if (!user.actif) {
      return res.status(403).json({ 
        success: false, 
        message: 'Compte désactivé. Contactez l\'administrateur.' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    logger.error('Erreur middleware protect:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur d\'authentification' 
    });
  }
};

export const admin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      message: 'Non authentifié' 
    });
  }
  
  if (req.user.role !== 'admin') {
    logger.warn(`Tentative d'accès admin refusée pour ${req.user.email} (${req.user.role})`);
    return res.status(403).json({ 
      success: false, 
      message: 'Accès administrateur requis' 
    });
  }
  
  next();
};

export const moderateur = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      message: 'Non authentifié' 
    });
  }
  
  if (!['admin', 'moderateur'].includes(req.user.role)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Accès modérateur requis' 
    });
  }
  
  next();
};
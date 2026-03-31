// backend/ecosystem.config.cjs
// ✅ VERSION CORRIGÉE — AIFASA 17
// BUG-03 FIX : instances: 1 pour le scheduler (cluster mode interdit)
//   Avant : instances: 2, exec_mode: 'cluster' → schedulerService.start()
//   exécuté 2 fois → DOUBLONS DE NOTIFICATIONS garantis
//
// Architecture : 3 processus séparés
//   aifasa17-api       → Express + Socket.io (peut scaler si besoin)
//   aifasa17-worker    → Bull worker (traitement notifications)
//   aifasa17-scheduler → Cron jobs (1 SEULE instance obligatoire)

module.exports = {
  apps: [

    // ── API Server ─────────────────────────────────────────
    {
      name:         'aifasa17-api',
      script:       'server.js',
      // [BUG-03 FIX] instances: 1 en attendant que le scheduler soit
      // extrait de server.js dans un fichier séparé (scheduler.js)
      // Si vous passez à instances: 2, créez d'abord backend/scheduler.js
      // et retirez schedulerService.start() de server.js
      instances:    1,
      exec_mode:    'fork',
      autorestart:  true,
      watch:        false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT:     5000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT:     5000,
      },
      error_file:      './logs/api-error.log',
      out_file:        './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:      true,
      autorestart:     true,
      max_restarts:    10,
      min_uptime:      '10s',
    },

    // ── Notification Worker ─────────────────────────────────
    {
      name:         'aifasa17-worker',
      script:       'workers/notificationWorker.js',
      instances:    1,
      exec_mode:    'fork',
      autorestart:  true,
      watch:        false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV:           'production',
        WORKER_CONCURRENCY: 3,
      },
      env_development: {
        NODE_ENV:           'development',
        WORKER_CONCURRENCY: 1,
      },
      error_file:      './logs/worker-error.log',
      out_file:        './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

  ],

  // ════════════════════════════════════════════════════════
  // NOTE POUR SCALE FUTUR :
  // Quand vous voulez instances: 2+ pour l'API, procédez ainsi :
  //
  // 1. Créez backend/scheduler.js :
  //    import { schedulerService } from './services/schedulerService.js';
  //    import './services/whatsappService.js';
  //    schedulerService.start();
  //    console.log('🕐 Scheduler démarré');
  //
  // 2. Retirez schedulerService.start() de server.js (connectDB)
  //
  // 3. Ajoutez dans apps[] :
  //    { name: 'aifasa17-scheduler', script: 'scheduler.js', instances: 1, exec_mode: 'fork' }
  //
  // 4. Passez aifasa17-api à instances: 2, exec_mode: 'cluster'
  // ════════════════════════════════════════════════════════

};

// backend/routes/reports.js — Génération de rapports PDF professionnels
import express from 'express';
import { protect } from '../middleware/auth.js';
import Activite from '../models/Activite.js';
import Membre from '../models/Membre.js';
import { Alerte, Message } from '../models/AlerteMessage.js';
import { aiService } from '../services/aiService.js';
import { emailService } from '../services/emailService.js';
import PDFDocument from 'pdfkit';

const router = express.Router();
router.use(protect);

// Helper — Calcul des stats
const getStats = async (from, to) => {
  const filter = {};
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const [total, enCours, terminees, annulees, urgentes, membres, messages] = await Promise.all([
    Activite.countDocuments(filter),
    Activite.countDocuments({ ...filter, statut: 'en_cours' }),
    Activite.countDocuments({ ...filter, statut: 'termine' }),
    Activite.countDocuments({ ...filter, statut: 'annule' }),
    Activite.countDocuments({ ...filter, priorite: 'urgente', statut: { $nin: ['termine', 'annule'] } }),
    Membre.countDocuments({ actif: true }),
    Message.countDocuments({ statut: 'envoye', ...filter }),
  ]);

  return {
    total,
    enCours,
    terminees,
    annulees,
    urgentes,
    membres,
    messages,
    taux: total > 0 ? Math.round((terminees / total) * 100) : 0,
  };
};

// GET /api/reports/stats — Stats pour l'UI
router.get('/stats', async (req, res) => {
  try {
    const { from, to } = req.query;
    const stats = await getStats(from, to);

    // Résumé IA si disponible
    let resumeIA = null;
    if (aiService.isConfigured && aiService.isConfigured()) {
      try {
        resumeIA = await aiService.resumerRapport(stats);
      } catch (iaErr) {
        console.warn('Erreur IA:', iaErr.message);
      }
    }

    res.json({ success: true, data: { ...stats, resumeIA } });
  } catch (err) {
    console.error('Erreur GET /reports/stats:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/activites — Liste pour rapport (note: activites sans 'i')
router.get('/activites', async (req, res) => {
  try {
    const { from, to, statut, type } = req.query;
    const filter = {};
    
    if (statut) filter.statut = statut;
    if (type) filter.type = type;
    
    if (from || to) {
      filter.dateDebut = {};
      if (from) filter.dateDebut.$gte = new Date(from);
      if (to) filter.dateDebut.$lte = new Date(to);
    }

    const activites = await Activite.find(filter)
      .populate('responsables', 'nom prenom email')
      .sort({ dateDebut: 1 })
      .limit(200);

    res.json({ success: true, data: activites });
  } catch (err) {
    console.error('Erreur GET /reports/activites:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Aliase pour compatibility avec l'orthographe anglaise
router.get('/activities', async (req, res) => {
  // Rediriger vers /activites
  req.url = '/activites';
  return router.handle(req, res);
});

// GET /api/reports/pdf — Génération PDF
router.get('/pdf', async (req, res) => {
  try {
    const { from, to, type = 'complet' } = req.query;
    const stats = await getStats(from, to);
    const activites = await Activite.find({})
      .populate('responsables', 'nom prenom')
      .sort({ dateDebut: 1 })
      .limit(100);

    // Résumé IA
    let resumeIA = '';
    if (aiService.isConfigured && aiService.isConfigured()) {
      try {
        resumeIA = await aiService.resumerRapport(stats) || '';
      } catch (iaErr) {
        console.warn('Erreur IA PDF:', iaErr.message);
      }
    }

    // ── Génération PDF ────────────────────────────────────────
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const bufs = [];
    doc.on('data', (d) => bufs.push(d));

    const periode =
      from && to
        ? `${new Date(from).toLocaleDateString('fr-FR')} — ${new Date(to).toLocaleDateString('fr-FR')}`
        : `Généré le ${new Date().toLocaleDateString('fr-FR')}`;

    const GREEN = '#16a34a';
    const DARK = '#1a2e1a';
    const MUTED = '#6b7c6b';
    const LIGHT = '#f0f4f0';

    // ── Page de couverture ────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 180).fill(GREEN);
    doc.fillColor('white')
      .font('Helvetica-Bold')
      .fontSize(28)
      .text(process.env.APP_NAME || 'AIFASA 17', 50, 50);
    doc.font('Helvetica')
      .fontSize(14)
      .text('Rapport d\'activités', 50, 90);
    doc.fontSize(12)
      .fillColor('rgba(255,255,255,0.8)')
      .text(periode, 50, 115);
    doc.fontSize(10)
      .text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, 50, 140);

    doc.fillColor(DARK).moveDown(4);

    // ── Résumé IA ─────────────────────────────────────────────
    if (resumeIA) {
      doc.rect(50, doc.y, doc.page.width - 100, 1).fill(GREEN);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(GREEN)
        .text('💡 Analyse IA');
      doc.font('Helvetica')
        .fontSize(10)
        .fillColor('#374151')
        .text(resumeIA, { align: 'justify' });
      doc.moveDown(1);
    }

    // ── KPIs ──────────────────────────────────────────────────
    doc.rect(50, doc.y, doc.page.width - 100, 1).fill(GREEN);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(DARK)
      .text('Indicateurs clés');
    doc.moveDown(0.5);

    const kpis = [
      ['Total activités', stats.total, ''],
      ['Activités terminées', stats.terminees, ''],
      ['Taux de complétion', `${stats.taux}%`, ''],
      ['En cours', stats.enCours, ''],
      ['Urgentes', stats.urgentes, ''],
      ['Membres actifs', stats.membres, ''],
      ['Messages envoyés', stats.messages, ''],
    ];

    const colW = (doc.page.width - 100) / 2;
    let kpiX = 50,
      kpiY = doc.y;
    kpis.forEach(([lbl, val], i) => {
      if (i > 0 && i % 2 === 0) {
        kpiY += 50;
        kpiX = 50;
      }
      doc.rect(kpiX, kpiY, colW - 10, 40)
        .fill(LIGHT)
        .stroke('#e2e8e2');
      doc.font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(GREEN)
        .text(String(val), kpiX + 12, kpiY + 6, { width: colW - 24 });
      doc.font('Helvetica')
        .fontSize(9)
        .fillColor(MUTED)
        .text(lbl, kpiX + 12, kpiY + 26, { width: colW - 24 });
      kpiX += colW;
    });

    doc.y = kpiY + 60;

    // ── Tableau des activités ─────────────────────────────────
    if (activites.length > 0) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 60).fill(GREEN);
      doc.fillColor('white')
        .font('Helvetica-Bold')
        .fontSize(16)
        .text('Liste des activités', 50, 20);
      doc.fillColor('white')
        .font('Helvetica')
        .fontSize(10)
        .text(periode, 50, 42);
      doc.y = 80;

      // En-têtes
      const cols = { titre: 200, type: 70, priorite: 65, statut: 70, fin: 70, prog: 40 };
      const headers = [
        ['Titre', 'titre'],
        ['Type', 'type'],
        ['Priorité', 'priorite'],
        ['Statut', 'statut'],
        ['Deadline', 'fin'],
        ['%', 'prog'],
      ];
      let hX = 50;
      doc.rect(50, doc.y, doc.page.width - 100, 20).fill(DARK);
      headers.forEach(([lbl, key]) => {
        doc.font('Helvetica-Bold')
          .fontSize(8)
          .fillColor('white')
          .text(lbl, hX + 4, doc.y + 6, { width: cols[key] - 8 });
        hX += cols[key];
      });
      doc.y += 20;

      // Lignes
      activites.slice(0, 80).forEach((a, i) => {
        if (doc.y > 750) doc.addPage();
        const bg = i % 2 === 0 ? 'white' : '#f8faf8';
        doc.rect(50, doc.y, doc.page.width - 100, 18)
          .fill(bg)
          .stroke('#e2e8e2');
        let cX = 50;
        const vals = [
          a.titre?.substring(0, 30) + (a.titre?.length > 30 ? '…' : ''),
          a.type,
          a.priorite,
          a.statut?.replace('_', ' '),
          a.dateFin
            ? new Date(a.dateFin).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
              })
            : '',
          `${a.progression}%`,
        ];
        vals.forEach((v, vi) => {
          const key = Object.keys(cols)[vi];
          const color =
            vi === 2
              ? {
                  urgente: '#dc2626',
                  haute: '#b45309',
                  normale: '#16a34a',
                  basse: '#64748b',
                }[a.priorite] || DARK
              : DARK;
          doc.font('Helvetica')
            .fontSize(8)
            .fillColor(color)
            .text(v || '', cX + 4, doc.y + 5, { width: cols[key] - 8 });
          cX += cols[key];
        });
        doc.y += 18;
      });
    }

    doc.end();

    await new Promise((resolve) => doc.on('end', resolve));
    const pdfBuffer = Buffer.concat(bufs);

    const filename = `rapport_${type}_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Erreur PDF:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reports/send — Envoyer le rapport par email
router.post('/send', async (req, res) => {
  try {
    const { to, from, to: toPeriod } = req.body;
    const stats = await getStats(from, toPeriod);

    await emailService.sendReport({
      to,
      subject: `📊 Rapport d'activités — ${new Date().toLocaleDateString('fr-FR')}`,
      stats,
    });

    res.json({ success: true, message: `Rapport envoyé à ${to}` });
  } catch (err) {
    console.error('Erreur POST /reports/send:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
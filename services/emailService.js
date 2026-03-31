// services/emailService.js - AJOUT de la méthode sendMessage
import nodemailer from 'nodemailer';

const transporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const isConfigured = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

const PRIO_COLOR = { urgente:'#dc2626', haute:'#f59e0b', normale:'#16a34a', basse:'#64748b' };

const baseTemplate = ({ title, content, color = '#16a34a' }) => `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width">
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Segoe UI',Arial,sans-serif; background:#f0f4f0; padding:32px 16px; }
  .wrap { max-width:600px; margin:0 auto; }
  .header { background:linear-gradient(135deg,#14532d,#16a34a); border-radius:16px 16px 0 0; padding:28px 32px; text-align:center; }
  .header h1 { color:white; font-size:22px; font-weight:800; letter-spacing:0.02em; }
  .header p  { color:rgba(255,255,255,0.75); font-size:13px; margin-top:4px; }
  .body { background:white; padding:32px; border:1px solid #e2e8e2; border-top:none; }
  .badge { display:inline-block; padding:4px 14px; border-radius:99px; font-size:12px; font-weight:700; background:${color}18; color:${color}; margin-bottom:20px; }
  .title { font-size:20px; font-weight:800; color:#1a2e1a; margin-bottom:12px; }
  .message { color:#475569; line-height:1.7; font-size:14px; white-space:pre-wrap; }
  .infobox { background:${color}08; border:1px solid ${color}30; border-radius:10px; padding:16px 20px; margin:20px 0; }
  .infobox strong { color:${color}; }
  .infobox p { font-size:13px; color:#374151; margin-top:4px; line-height:1.5; }
  .progress-wrap { margin:20px 0; }
  .progress-label { display:flex; justify-content:space-between; font-size:12px; color:#6b7c6b; margin-bottom:6px; }
  .progress-bar { height:8px; background:#e2e8e2; border-radius:99px; overflow:hidden; }
  .progress-fill { height:100%; background:linear-gradient(90deg,${color},${color}cc); border-radius:99px; }
  .footer { background:#f8faf8; border:1px solid #e2e8e2; border-top:none; border-radius:0 0 16px 16px; padding:16px 32px; text-align:center; }
  .footer p { font-size:11px; color:#9ca3af; line-height:1.6; }
  .footer a { color:#16a34a; }
</style></head>
<body><div class="wrap">
  <div class="header">
    <h1>🌿 ${process.env.APP_NAME || 'AssocPlanner'}</h1>
    <p>Gestion intelligente des associations</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <p>${process.env.APP_NAME || 'AssocPlanner'} — Système de gestion des associations<br>
    Ce message a été envoyé automatiquement, ne pas répondre directement.<br>
    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}">Accéder à l'application</a></p>
  </div>
</div></body></html>`;

export const emailService = {
  async sendAlert({ to, subject, activite, message, dateFin, priorite = 'normale', jours, progression }) {
    const color = PRIO_COLOR[priorite] || '#16a34a';
    const dateStr = dateFin
      ? new Date(dateFin).toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '';

    const content = `
      <span class="badge">${{ urgente:'🚨 URGENT', haute:'⚠️ Priorité haute', normale:'🔔 Rappel', basse:'ℹ️ Info' }[priorite] || '🔔 Alerte'}</span>
      <h2 class="title">${subject}</h2>
      <div class="message">${message.replace(/\n/g, '<br>')}</div>
      ${activite ? `<div class="infobox"><strong>📌 Activité</strong><p>${activite}</p></div>` : ''}
      ${dateStr  ? `<div class="infobox"><strong>⏰ Deadline : ${dateStr}</strong>${jours !== undefined ? `<p>${jours === 0 ? "Aujourd'hui !" : jours === 1 ? 'Demain !' : `Dans ${jours} jours`}</p>` : ''}</div>` : ''}
      ${progression !== undefined ? `<div class="progress-wrap"><div class="progress-label"><span>Progression</span><span><strong>${progression}%</strong></span></div><div class="progress-bar"><div class="progress-fill" style="width:${progression}%"></div></div></div>` : ''}
    `;

    return this._send({ to, subject, html: baseTemplate({ title: subject, content, color }) });
  },

  // NOUVELLE MÉTHODE sendMessage pour les rappels financiers
  async sendMessage({ to, subject, contenu, expediteur }) {
    const content = `
      <h2 class="title">📨 ${subject}</h2>
      <div class="message" style="white-space:pre-wrap">${contenu.replace(/\n/g, '<br>')}</div>
      ${expediteur ? `<p style="margin-top:20px;color:#6b7c6b;font-size:13px;font-style:italic">— ${expediteur}</p>` : ''}
    `;
    return this._send({ to, subject, html: baseTemplate({ title: subject, content }) });
  },

  async sendReport({ to, subject, stats, pdfBuffer }) {
    const content = `
      <h2 class="title">📊 Rapport disponible</h2>
      <div class="message">Votre rapport a été généré avec succès. Retrouvez-le en pièce jointe ou téléchargez-le depuis l'application.</div>
      <div class="infobox">
        <strong>📋 Résumé</strong>
        <p>Activités totales : <strong>${stats?.total || 0}</strong></p>
        <p>Terminées : <strong>${stats?.terminees || 0}</strong></p>
        <p>En cours : <strong>${stats?.enCours || 0}</strong></p>
        <p>Taux de complétion : <strong>${stats?.taux || 0}%</strong></p>
      </div>
    `;
    const attachments = pdfBuffer ? [{ filename: 'rapport.pdf', content: pdfBuffer, contentType: 'application/pdf' }] : [];
    return this._send({ to, subject, html: baseTemplate({ title: subject, content }), attachments });
  },

  async _send({ to, subject, html, attachments = [] }) {
    if (!isConfigured()) {
      console.log(`📧 [EMAIL SIMULÉ] → ${to} | ${subject}`);
      return { success: true, simule: true };
    }
    try {
      const info = await transporter().sendMail({
        from: process.env.SMTP_FROM || `"${process.env.APP_NAME||'AssocPlanner'}" <${process.env.SMTP_USER}>`,
        to, subject, html, attachments,
      });
      console.log(`✅ Email envoyé → ${to}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`❌ Email échoué → ${to}:`, err.message);
      return { success: false, error: err.message };
    }
  },
};
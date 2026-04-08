// backend/services/aiService.js
// Intégration DeepSeek pour suggestions, optimisations et analyses avancées
import axios from 'axios';

const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';

export const isConfigured = () => !!process.env.DEEPSEEK_API_KEY;

const callDeepSeek = async (prompt, maxTokens = 300, temperature = 0.7) => {
  if (!isConfigured()) {
    console.warn('⚠️ DeepSeek non configuré');
    return null;
  }
  
  try {
    const res = await axios.post(
      DEEPSEEK_URL,
      {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: temperature,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    return res.data.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error('Erreur appel DeepSeek:', err.response?.data?.error?.message || err.message);
    throw err;
  }
};

export const aiService = {
  // Vérifier si l'IA est configurée
  isConfigured,

  // Suggestion d'action pour une activité en retard / urgente
  async suggererAction(activite) {
    if (!isConfigured()) return null;
    try {
      const prompt = `Tu es un assistant de gestion associative. Donne UNE seule suggestion courte (max 2 phrases) pour cette activité :
Titre: ${activite.titre}
Type: ${activite.type}
Priorité: ${activite.priorite}
Statut: ${activite.statut}
Progression: ${activite.progression}%
Deadline: ${new Date(activite.dateFin).toLocaleDateString('fr-FR')}
Description: ${activite.description || 'Non spécifiée'}

Suggestion actionnable et précise en français :`;
      return await callDeepSeek(prompt, 150);
    } catch (err) {
      console.warn('IA suggestion échouée:', err.message);
      return null;
    }
  },

  // Analyse complète d'une activité
  async analyserActivite(activite) {
    if (!isConfigured()) return { disponible: false };
    try {
      const prompt = `Analyse cette activité associative et fournis un JSON avec : risques (array), recommandations (array), scoreRisque (0-10).
Données : ${JSON.stringify({
        titre: activite.titre,
        type: activite.type,
        priorite: activite.priorite,
        statut: activite.statut,
        progression: activite.progression,
        dateFin: activite.dateFin,
        description: activite.description,
        ressources: activite.ressources || [],
        jalons: activite.jalons || []
      })}
Réponds UNIQUEMENT avec un JSON valide, sans markdown.`;
      const raw = await callDeepSeek(prompt, 400);
      try {
        return JSON.parse(raw);
      } catch {
        return { disponible: false, erreur: 'Format JSON invalide' };
      }
    } catch (err) {
      console.warn('IA analyse échouée:', err.message);
      return { disponible: false, erreur: err.message };
    }
  },

  // Optimisation du planning
  async optimiserPlanning(activites) {
    if (!isConfigured()) return null;
    try {
      const resume = activites
        .slice(0, 10)
        .map(
          (a) =>
            `- ${a.titre} (${a.priorite}, ${a.statut}, ${Math.round(
              (new Date(a.dateFin) - new Date()) / 86400000
            )}j restants, progression: ${a.progression}%)`
        )
        .join('\n');
      const prompt = `Tu es expert en gestion de projet associatif. Voici les activités actuelles :
${resume}

Donne 3 recommandations concrètes pour optimiser ce planning. Sois bref et actionnable. Format: "1. ... 2. ... 3. ..."`;
      return await callDeepSeek(prompt, 300);
    } catch (err) {
      console.warn('IA optimisation échouée:', err.message);
      return null;
    }
  },

  // Analyse critique des situations (jalons dépassés, retards, ressources)
  async analyserCritique(activites, jalons, ressources) {
    if (!isConfigured()) return null;
    try {
      const activitesCritiques = activites.filter(a => {
        const daysLeft = Math.ceil((new Date(a.dateFin) - new Date()) / 86400000);
        return daysLeft <= 7 && a.progression < 50;
      });
      
      const jalonsDepasses = jalons.filter(j => 
        new Date(j.datePrevue) < new Date() && j.statut !== 'atteint'
      );
      
      const ressourcesCritiques = ressources.filter(r => !r.disponibilite);
      
      const prompt = `Analyse la situation critique de cette association et propose des actions prioritaires :

**Activités critiques (échéance proche):**
${activitesCritiques.map(a => `- ${a.titre}: ${a.progression}% (échéance ${new Date(a.dateFin).toLocaleDateString()})`).join('\n') || 'Aucune'}

**Jalons dépassés:**
${jalonsDepasses.map(j => `- ${j.titre}: prévu le ${new Date(j.datePrevue).toLocaleDateString()}`).join('\n') || 'Aucun'}

**Ressources indisponibles:**
${ressourcesCritiques.map(r => `- ${r.nom}: ${r.type}`).join('\n') || 'Toutes disponibles'}

Donne une analyse concise (max 5 phrases) des risques et des actions prioritaires à mener immédiatement.`;
      
      return await callDeepSeek(prompt, 400, 0.8);
    } catch (err) {
      console.warn('IA analyse critique échouée:', err.message);
      return null;
    }
  },

  // Rédiger automatiquement un message d'alerte
  async redigerMessage({ titre, contexte, canal, priorite = 'normale' }) {
    if (!isConfigured()) return null;
    try {
      const emoji = { urgente: '🚨', haute: '⚠️', normale: '🔔', basse: 'ℹ️' }[priorite] || '🔔';
      const prompt = `Rédige un message d'alerte professionnel pour une association.
Sujet: ${titre}
Contexte: ${contexte}
Canal: ${canal} (${canal === 'whatsapp' ? 'court et direct, utiliser emojis' : 'email professionnel, complet'})
Priorité: ${priorite}
Langue: français
Réponds UNIQUEMENT avec le message, sans introduction ni explication.`;
      const message = await callDeepSeek(prompt, 250);
      return `${emoji} ${message}`;
    } catch (err) {
      console.warn('IA rédaction échouée:', err.message);
      return null;
    }
  },

  // Résumé d'un rapport
  async resumerRapport(stats) {
    if (!isConfigured()) return null;
    try {
      const prompt = `Rédige un résumé exécutif de 3 phrases pour ce rapport d'activité associatif :
- Total activités : ${stats.total}
- Terminées : ${stats.terminees} (${stats.taux}%)
- En cours : ${stats.enCours}
- Urgentes : ${stats.urgentes}
- Membres actifs : ${stats.membres}
- Messages envoyés : ${stats.messages}
Sois synthétique et positif tout en soulignant les points d'attention.`;
      return await callDeepSeek(prompt, 200);
    } catch (err) {
      console.warn('IA résumé échouée:', err.message);
      return null;
    }
  },

  // Suggestion de réallocation de ressources
  async suggererReallocation(activites, ressources) {
    if (!isConfigured()) return null;
    try {
      const activitesUrgentes = activites.filter(a => 
        a.priorite === 'urgente' && a.statut !== 'termine'
      );
      
      const ressourcesDisponibles = ressources.filter(r => r.disponibilite);
      
      const prompt = `Propose une réallocation des ressources pour optimiser les activités urgentes :

Activités urgentes: ${activitesUrgentes.map(a => a.titre).join(', ') || 'Aucune'}
Ressources disponibles: ${ressourcesDisponibles.map(r => r.nom).join(', ') || 'Aucune'}

Donne 2-3 suggestions concrètes pour mieux utiliser les ressources disponibles.`;
      
      return await callDeepSeek(prompt, 300);
    } catch (err) {
      console.warn('IA réallocation échouée:', err.message);
      return null;
    }
  },

  // Planification automatique des jalons
  async planifierJalons(activite) {
    if (!isConfigured()) return null;
    try {
      const startDate = new Date(activite.dateDebut);
      const endDate = new Date(activite.dateFin);
      const duration = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
      
      const prompt = `Propose une séquence de jalons pour cette activité :
Titre: ${activite.titre}
Durée: ${duration} jours
Type: ${activite.type}

Propose 3-5 jalons avec leurs noms et le pourcentage de progression attendu.
Format: JSON avec {nom, progression, description}`;
      
      const response = await callDeepSeek(prompt, 400);
      try {
        return JSON.parse(response);
      } catch {
        return null;
      }
    } catch (err) {
      console.warn('IA planification jalons échouée:', err.message);
      return null;
    }
  },

  // Rédaction de compte-rendu de réunion
  async redigerCompteRendu(reunion) {
    if (!isConfigured()) return null;
    try {
      const prompt = `Rédige un compte-rendu professionnel pour cette réunion :
Sujet: ${reunion.sujet}
Date: ${new Date(reunion.date).toLocaleDateString()}
Participants: ${reunion.participants?.join(', ') || 'Non spécifiés'}
Points discutés: ${reunion.points?.join('\n') || 'Non spécifiés'}
Décisions: ${reunion.decisions?.join('\n') || 'Non spécifiées'}

Rédige un compte-rendu structuré avec:
1. Introduction
2. Points principaux
3. Décisions
4. Actions à mener`;
      
      return await callDeepSeek(prompt, 800);
    } catch (err) {
      console.warn('IA compte-rendu échouée:', err.message);
      return null;
    }
  }
};

export default aiService;
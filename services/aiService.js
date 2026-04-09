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
        timeout: 60000,
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

  // ============================================================
  // FONCTIONS EXISTANTES
  // ============================================================

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
  },

  // ============================================================
  // ✅ NOUVELLES FONCTIONS ULTIMES
  // ============================================================

  // Analyse financière intelligente
  async analyserFinances(financeData, annee) {
    if (!isConfigured()) {
      return "⚠️ IA non configurée. Ajoutez DEEPSEEK_API_KEY dans les variables d'environnement.";
    }

    try {
      const prompt = `Tu es un expert financier pour l'association AIFASA 17. Analyse ces données financières pour l'année ${annee} :

${JSON.stringify(financeData, null, 2)}

Fournis une analyse concise avec :
1. 📊 Résumé global (total collecté, dépenses, solde)
2. 📈 Taux de recouvrement et interprétation
3. 📉 Tendances observées
4. 💡 2-3 recommandations concrètes pour améliorer la situation financière

Réponds en français, sur un ton professionnel mais accessible.`;

      return await callDeepSeek(prompt, 1500, 0.6);
    } catch (err) {
      console.warn('IA analyse financière échouée:', err.message);
      return "❌ Erreur lors de l'analyse financière. Veuillez réessayer.";
    }
  },

  // Détection des membres à risque
  async detecterMembresARisque(membres) {
    if (!isConfigured()) {
      return [];
    }

    try {
      const membresResume = membres.slice(0, 50).map(m => ({
        id: m._id?.toString(),
        nom: m.nom,
        prenom: m.prenom,
        role: m.role,
        actif: m.actif,
        dateAdhesion: m.dateAdhesion
      }));

      const prompt = `Analyse cette liste de membres de l'association AIFASA 17 et identifie ceux qui présentent un risque (inactifs, en retard de paiement, absence aux événements, etc.).

Membres : ${JSON.stringify(membresResume, null, 2)}

Retourne UNIQUEMENT un tableau JSON valide avec ce format :
[
  { "id": "ID_DU_MEMBRE", "nom": "NOM", "prenom": "PRENOM", "raison": "Raison du risque", "niveau": "élevé" }
]

Ne mets PAS de texte autour du JSON. Réponds UNIQUEMENT avec le tableau JSON.`;

      const response = await callDeepSeek(prompt, 1000, 0.3);
      
      try {
        const jsonMatch = response?.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        return [];
      } catch (e) {
        console.warn('Erreur parsing JSON membres à risque:', e.message);
        return [];
      }
    } catch (err) {
      console.warn('IA détection risques échouée:', err.message);
      return [];
    }
  },

  // Planification optimisée des activités
  async planifierActivites(activites) {
    if (!isConfigured()) {
      return "⚠️ IA non configurée. Ajoutez DEEPSEEK_API_KEY dans les variables d'environnement.";
    }

    try {
      const activitesResume = activites.map(a => ({
        id: a._id,
        titre: a.titre,
        priorite: a.priorite,
        progression: a.progression,
        statut: a.statut,
        dateFin: a.dateFin,
        joursRestants: Math.ceil((new Date(a.dateFin) - new Date()) / 86400000),
        responsables: a.responsables?.length || 0
      }));

      const prompt = `Tu es un expert en planification de projet pour l'association AIFASA 17. Analyse ces activités et propose un planning optimisé :

${JSON.stringify(activitesResume, null, 2)}

Fournis :
1. 📋 Ordre de priorité suggéré (top 5)
2. 🔄 Allocation des ressources recommandée
3. ⚠️ Points d'attention (activités à risque)
4. 🚀 Suggestions d'amélioration du planning

Réponds en français, de manière concise et actionable.`;

      return await callDeepSeek(prompt, 1200, 0.6);
    } catch (err) {
      console.warn('IA planification activités échouée:', err.message);
      return "❌ Erreur lors de la planification. Veuillez réessayer.";
    }
  },

  // Génération de rapport narratif complet
  async genererRapportNarratif({ periode, sections, ton, data }) {
    if (!isConfigured()) {
      return "⚠️ IA non configurée. Ajoutez DEEPSEEK_API_KEY dans les variables d'environnement.";
    }

    try {
      const prompt = `Tu es un expert en rédaction de rapports associatifs pour AIFASA 17. Rédige un rapport narratif complet avec les paramètres suivants :

📅 Période : ${periode}
📑 Sections demandées : ${sections.join(', ')}
🎭 Ton : ${ton}

📊 Données disponibles : ${JSON.stringify(data, null, 2)}

Structure le rapport avec :
1. 📝 Résumé exécutif
2. 💰 Analyse financière (si section demandée)
3. 📋 Bilan des activités (si section demandée)
4. 👥 État des membres (si section demandée)
5. 🎯 Recommandations stratégiques

Rédige en français, avec un ton ${ton}. Sois précis et utilise les données fournies.`;

      return await callDeepSeek(prompt, 2500, 0.7);
    } catch (err) {
      console.warn('IA rapport narratif échoué:', err.message);
      return "❌ Erreur lors de la génération du rapport. Veuillez réessayer.";
    }
  },

  // Assistant conversationnel contextuel
  async chatContextuel(question, contexte, historique = []) {
    if (!isConfigured()) {
      return "⚠️ IA non configurée. Ajoutez DEEPSEEK_API_KEY dans les variables d'environnement.";
    }

    try {
      const systemPrompt = `Tu es un assistant IA pour l'association AIFASA 17 (Association des Ingénieurs Agronomes FASA Promotion 17).
Tu aides à gérer :
- Les finances (cotisations, dépenses, caisses)
- Les membres (suivi, adhésions, statuts)
- Les activités (planification, jalons, progression)
- Les communications (emails, WhatsApp, alertes)

Contexte actuel : ${JSON.stringify(contexte, null, 2)}

Réponds toujours en français, de manière utile et concise. Si tu ne sais pas, dis-le honnêtement.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...historique.slice(-10).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: question }
      ];

      const res = await axios.post(
        DEEPSEEK_URL,
        {
          model: 'deepseek-chat',
          messages: messages,
          max_tokens: 1000,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );
      
      return res.data.choices?.[0]?.message?.content?.trim() || "Je n'ai pas pu générer de réponse.";
    } catch (err) {
      console.warn('IA chat contextuel échoué:', err.message);
      return "❌ Désolé, je n'ai pas pu traiter votre demande. Veuillez réessayer.";
    }
  },

  // Analyse rapide pour dashboard
  async quickAnalyse(data) {
    if (!isConfigured()) {
      return null;
    }

    try {
      const prompt = `Analyse rapide de ces données pour le dashboard d'AIFASA 17 :
${JSON.stringify(data, null, 2)}

Donne :
1. Une phrase de résumé (max 50 mots)
2. Une recommandation prioritaire (max 30 mots)

Format : "📊 [résumé] | 💡 [recommandation]"`;

      return await callDeepSeek(prompt, 200, 0.5);
    } catch (err) {
      console.warn('IA quick analyse échouée:', err.message);
      return null;
    }
  }
};

export default aiService;
// backend/routes/activities.js
import express from 'express';
import Activite from '../models/Activite.js';
import Ressource from '../models/Ressource.js';
import Jalon from '../models/Jalon.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

// ============================================================
// FONCTIONS DE NETTOYAGE
// ============================================================

const cleanObjectId = (value) => {
  if (!value || value === '' || value === 'null' || value === 'undefined') return undefined;
  if (typeof value === 'string' && value.match(/^[0-9a-fA-F]{24}$/)) return value;
  return undefined;
};

const cleanRessource = (res) => {
  if (!res || !res.nom || res.nom.trim() === '') return null;
  return {
    type: res.type || 'materielle',
    nom: res.nom.trim(),
    description: res.description || '',
    quantite: res.quantite || 1,
    unite: res.unite || '',
    coutUnitaire: res.coutUnitaire || 0,
    devise: res.devise || 'XAF',
    disponibilite: res.disponibilite !== undefined ? res.disponibilite : true,
    responsable: cleanObjectId(res.responsable),
    dateDebut: res.dateDebut ? new Date(res.dateDebut) : null,
    dateFin: res.dateFin ? new Date(res.dateFin) : null,
    statut: res.statut || 'disponible'
  };
};

const cleanJalon = (jalon) => {
  if (!jalon || !jalon.titre || jalon.titre.trim() === '') return null;
  return {
    titre: jalon.titre.trim(),
    description: jalon.description || '',
    datePrevue: jalon.datePrevue ? new Date(jalon.datePrevue) : new Date(),
    dateReelle: jalon.dateReelle ? new Date(jalon.dateReelle) : null,
    progression: jalon.progression || 0,
    livrables: jalon.livrables || [],
    responsable: cleanObjectId(jalon.responsable),
    statut: jalon.statut || 'a_venir'
  };
};

const cleanCible = (cible) => {
  if (!cible || !cible.nom || cible.nom.trim() === '') return null;
  return {
    type: cible.type || 'personne',
    nom: cible.nom.trim(),
    details: cible.details || '',
    membreRef: cleanObjectId(cible.membreRef)
  };
};

// ============================================================
// GET /api/activities - Liste des activités
// ============================================================
router.get('/', async (req, res) => {
  try {
    const { statut, type, priorite, from, to, page = 1, limit = 20 } = req.query;
    const filter = {};
    
    if (statut) filter.statut = statut;
    if (type) filter.type = type;
    if (priorite) filter.priorite = priorite;
    
    if (from || to) {
      filter.dateDebut = {};
      if (from) filter.dateDebut.$gte = new Date(from);
      if (to) filter.dateDebut.$lte = new Date(to);
    }

    const skip = (page - 1) * limit;
    const limitNum = parseInt(limit);

    const [activites, total] = await Promise.all([
      Activite.find(filter)
        .populate('responsables', 'nom prenom email whatsapp photo')
        .populate({
          path: 'ressources',
          select: 'nom type quantite coutUnitaire disponibilite description unite statut'
        })
        .populate({
          path: 'jalons',
          select: 'titre description datePrevue progression statut livrables responsable'
        })
        .sort({ dateDebut: 1 })
        .skip(skip)
        .limit(limitNum),
      Activite.countDocuments(filter)
    ]);

    // Log pour déboguer
    console.log(`📊 ${activites.length} activités chargées`);
    activites.forEach(act => {
      if (act.jalons && act.jalons.length > 0) {
        console.log(`   - ${act.titre}: ${act.jalons.length} jalons, ${act.ressources?.length || 0} ressources`);
      }
    });

    res.json({
      success: true,
      data: activites,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('❌ Erreur GET /activities:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// GET /api/activities/:id - Détail d'une activité
// ============================================================
router.get('/:id', async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'ID invalide' });
    }

    const activite = await Activite.findById(req.params.id)
      .populate('responsables', 'nom prenom email whatsapp photo role')
      .populate({
        path: 'ressources',
        select: 'nom type quantite coutUnitaire disponibilite description unite statut'
      })
      .populate({
        path: 'jalons',
        select: 'titre description datePrevue progression statut livrables responsable'
      })
      .populate('cibles.membreRef', 'nom prenom')
      .populate('createdBy', 'nom email');

    if (!activite) {
      return res.status(404).json({ success: false, message: 'Activité introuvable' });
    }

    res.json({ success: true, data: activite });
  } catch (err) {
    console.error(`❌ Erreur GET /activities/${req.params.id}:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// POST /api/activities - Créer une activité
// ============================================================
router.post('/', async (req, res) => {
  try {
    const { dateDebut, dateFin, titre, ressources, jalons, cibles, ...rest } = req.body;
    
    console.log('📝 Création activité:', titre);
    
    // Vérifications de base
    if (!titre || titre.trim() === '') {
      return res.status(400).json({ success: false, message: 'Le titre est requis' });
    }
    
    if (!dateDebut || !dateFin) {
      return res.status(400).json({ success: false, message: 'Les dates sont requises' });
    }

    const startDate = new Date(dateDebut);
    const endDate = new Date(dateFin);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Format de date invalide' });
    }

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: 'La date de fin doit être postérieure à la date de début'
      });
    }

    // Nettoyer les cibles
    const cleanedCibles = (cibles || []).map(cleanCible).filter(c => c !== null);

    // Créer l'activité
    const activite = await Activite.create({
      titre: titre.trim(),
      dateDebut: startDate,
      dateFin: endDate,
      ...rest,
      cibles: cleanedCibles,
      createdBy: req.user._id
    });

    console.log(`✅ Activité créée: ${activite._id}`);

    // Créer les ressources
    const ressourcesCrees = [];
    if (ressources && ressources.length > 0) {
      for (const res of ressources) {
        const cleaned = cleanRessource(res);
        if (cleaned) {
          const newRes = await Ressource.create({
            ...cleaned,
            activiteId: activite._id,
            createdBy: req.user._id
          });
          ressourcesCrees.push(newRes._id);
          console.log(`   - Ressource créée: ${newRes._id}`);
        }
      }
    }

    // Créer les jalons
    const jalonsCrees = [];
    if (jalons && jalons.length > 0) {
      for (const jalon of jalons) {
        const cleaned = cleanJalon(jalon);
        if (cleaned) {
          const newJalon = await Jalon.create({
            ...cleaned,
            activiteId: activite._id,
            createdBy: req.user._id
          });
          jalonsCrees.push(newJalon._id);
          console.log(`   - Jalon créé: ${newJalon._id}`);
        }
      }
    }

    // Mettre à jour les références
    if (ressourcesCrees.length) {
      activite.ressources = ressourcesCrees;
    }
    if (jalonsCrees.length) {
      activite.jalons = jalonsCrees;
    }
    await activite.save();

    // Recharger avec les populations
    const activiteComplete = await Activite.findById(activite._id)
      .populate('responsables', 'nom prenom')
      .populate('ressources')
      .populate('jalons');

    console.log(`✅ Activité finale: ${activite.titre} (${activiteComplete.ressources?.length || 0} ressources, ${activiteComplete.jalons?.length || 0} jalons)`);

    res.status(201).json({
      success: true,
      data: activiteComplete,
      message: 'Activité créée avec succès'
    });
  } catch (err) {
    console.error('❌ Erreur POST /activities:', err);
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Erreur de validation',
        errors: Object.values(err.errors).map(e => e.message)
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PUT /api/activities/:id - Modifier une activité
// ============================================================
router.put('/:id', async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'ID invalide' });
    }

    console.log(`📝 Modification activité: ${req.params.id}`);

    const { dateDebut, dateFin, ressources, jalons, cibles, ...rest } = req.body;

    // Valider les dates
    if (dateDebut && dateFin) {
      const start = new Date(dateDebut);
      const end = new Date(dateFin);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ success: false, message: 'Format de date invalide' });
      }
      if (end <= start) {
        return res.status(400).json({
          success: false,
          message: 'La date de fin doit être postérieure à la date de début'
        });
      }
    }

    const activite = await Activite.findById(req.params.id);
    if (!activite) {
      return res.status(404).json({ success: false, message: 'Activité introuvable' });
    }

    // Nettoyer les cibles
    const cleanedCibles = (cibles || []).map(cleanCible).filter(c => c !== null);

    // Mettre à jour l'activité
    const updateData = { ...rest, cibles: cleanedCibles, updatedAt: new Date() };
    if (dateDebut) updateData.dateDebut = new Date(dateDebut);
    if (dateFin) updateData.dateFin = new Date(dateFin);

    await Activite.findByIdAndUpdate(req.params.id, updateData);

    // Gérer les ressources
    if (ressources !== undefined) {
      await Ressource.deleteMany({ activiteId: req.params.id });
      const nouvellesRessources = [];
      for (const res of ressources) {
        const cleaned = cleanRessource(res);
        if (cleaned) {
          const newRes = await Ressource.create({
            ...cleaned,
            activiteId: req.params.id,
            createdBy: req.user._id
          });
          nouvellesRessources.push(newRes._id);
        }
      }
      await Activite.findByIdAndUpdate(req.params.id, { ressources: nouvellesRessources });
    }

    // Gérer les jalons
    if (jalons !== undefined) {
      await Jalon.deleteMany({ activiteId: req.params.id });
      const nouveauxJalons = [];
      for (const jalon of jalons) {
        const cleaned = cleanJalon(jalon);
        if (cleaned) {
          const newJalon = await Jalon.create({
            ...cleaned,
            activiteId: req.params.id,
            createdBy: req.user._id
          });
          nouveauxJalons.push(newJalon._id);
        }
      }
      await Activite.findByIdAndUpdate(req.params.id, { jalons: nouveauxJalons });
    }

    const activiteComplete = await Activite.findById(req.params.id)
      .populate('responsables', 'nom prenom email whatsapp photo')
      .populate('ressources')
      .populate('jalons');

    console.log(`✅ Activité modifiée: ${activiteComplete.titre}`);

    res.json({
      success: true,
      data: activiteComplete,
      message: 'Activité modifiée avec succès'
    });
  } catch (err) {
    console.error('❌ Erreur PUT /activities:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// DELETE /api/activities/:id - Supprimer une activité
// ============================================================
router.delete('/:id', async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'ID invalide' });
    }

    const activite = await Activite.findById(req.params.id);
    if (!activite) {
      return res.status(404).json({ success: false, message: 'Activité introuvable' });
    }

    await Ressource.deleteMany({ activiteId: req.params.id });
    await Jalon.deleteMany({ activiteId: req.params.id });
    await Activite.findByIdAndDelete(req.params.id);

    console.log(`✅ Activité supprimée: ${activite.titre} (${activite._id})`);

    res.json({ success: true, message: 'Activité supprimée avec succès' });
  } catch (err) {
    console.error(`❌ Erreur DELETE /activities/${req.params.id}:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// PATCH /api/activities/:id/progression - Mettre à jour la progression
// ============================================================
router.patch('/:id/progression', async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'ID invalide' });
    }

    const { progression } = req.body;
    if (progression === undefined || isNaN(progression)) {
      return res.status(400).json({ success: false, message: 'La progression est requise' });
    }
    if (progression < 0 || progression > 100) {
      return res.status(400).json({ success: false, message: 'La progression doit être entre 0 et 100' });
    }

    const newStatut = progression === 100 ? 'termine' : progression > 0 ? 'en_cours' : 'planifie';

    const activite = await Activite.findByIdAndUpdate(
      req.params.id,
      { progression, statut: newStatut, updatedAt: new Date() },
      { new: true }
    );

    if (!activite) {
      return res.status(404).json({ success: false, message: 'Activité introuvable' });
    }

    console.log(`📊 Progression mise à jour: ${activite.titre} → ${progression}%`);

    res.json({
      success: true,
      data: activite,
      message: `Progression mise à jour à ${progression}%`
    });
  } catch (err) {
    console.error(`❌ Erreur PATCH /activities/${req.params.id}/progression:`, err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
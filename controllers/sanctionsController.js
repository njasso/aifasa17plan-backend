// backend/controllers/sanctionsController.js
import { DetteDisciplinaire } from '../models/DetteDisciplinaire.js';
import Membre from '../models/Membre.js';
import { Transaction } from '../models/Finance.js';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// GESTION DES DETTES DISCIPLINAIRES
// ============================================================

// Obtenir toutes les dettes disciplinaires
export const getDettesDisciplinaires = async (req, res) => {
  try {
    const { annee = new Date().getFullYear(), membreId, avecDetteSeulement = false } = req.query;
    
    const filter = { annee: parseInt(annee) };
    if (membreId) filter.membreId = new mongoose.Types.ObjectId(membreId);
    if (avecDetteSeulement === 'true') filter.montantRestant = { $gt: 0 };
    
    const dettes = await DetteDisciplinaire.find(filter)
      .populate('membreId', 'nom prenom email telephone whatsapp role')
      .populate('createdBy', 'nom prenom')
      .sort({ montantRestant: -1 });
    
    const stats = await DetteDisciplinaire.getStats(annee);
    
    res.json({
      success: true,
      data: dettes,
      stats,
      total: dettes.length
    });
  } catch (error) {
    console.error('Erreur getDettesDisciplinaires:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Obtenir la dette d'un membre spécifique
export const getDetteMembre = async (req, res) => {
  try {
    const { membreId } = req.params;
    const annee = req.query.annee || new Date().getFullYear();
    
    let dette = await DetteDisciplinaire.findOne({
      membreId: new mongoose.Types.ObjectId(membreId),
      annee: parseInt(annee)
    }).populate('membreId', 'nom prenom email telephone whatsapp');
    
    if (!dette) {
      // Créer un document vide si inexistant
      dette = await DetteDisciplinaire.create({
        membreId,
        annee: parseInt(annee),
        montantTotal: 0,
        montantPaye: 0,
        montantRestant: 0,
        sanctions: [],
        historique: []
      });
    }
    
    res.json({ success: true, data: dette });
  } catch (error) {
    console.error('Erreur getDetteMembre:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Ajouter une sanction disciplinaire
export const ajouterSanction = async (req, res) => {
  try {
    const { membreId, libelle, montant, motif, date, notes } = req.body;
    const annee = new Date(date || new Date()).getFullYear();
    
    let dette = await DetteDisciplinaire.findOne({
      membreId: new mongoose.Types.ObjectId(membreId),
      annee
    });
    
    if (!dette) {
      dette = new DetteDisciplinaire({
        membreId,
        annee,
        montantTotal: 0,
        montantPaye: 0,
        montantRestant: 0,
        sanctions: [],
        historique: [],
        createdBy: req.user.id
      });
    }
    
    await dette.ajouterSanction(
      { libelle, montant, motif, date },
      req.user.id,
      notes
    );
    
    // Mettre à jour le statut du membre
    await Membre.findByIdAndUpdate(membreId, {
      statutDisciplinaire: dette.montantRestant > 0 ? 'alerte' : 'clean',
      derniereSanction: { date: new Date(), motif, montant }
    });
    
    res.json({
      success: true,
      data: dette,
      message: `Sanction de ${montant.toLocaleString()} FCFA ajoutée avec succès`
    });
  } catch (error) {
    console.error('Erreur ajouterSanction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Enregistrer un paiement de sanction
export const payerSanction = async (req, res) => {
  try {
    const { id } = req.params;
    const { montant, notes, transactionId } = req.body;
    
    const dette = await DetteDisciplinaire.findById(id);
    if (!dette) {
      return res.status(404).json({ success: false, error: 'Dette non trouvée' });
    }
    
    if (montant > dette.montantRestant) {
      return res.status(400).json({ 
        success: false, 
        error: `Le montant (${montant.toLocaleString()} F) dépasse le reste dû (${dette.montantRestant.toLocaleString()} F)` 
      });
    }
    
    await dette.enregistrerPaiement(montant, req.user.id, notes);
    
    // Mettre à jour le statut du membre
    await Membre.findByIdAndUpdate(dette.membreId, {
      statutDisciplinaire: dette.montantRestant === 0 ? 'clean' : 'alerte'
    });
    
    res.json({
      success: true,
      data: dette,
      message: `Paiement de ${montant.toLocaleString()} FCFA enregistré`
    });
  } catch (error) {
    console.error('Erreur payerSanction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Supprimer une sanction
export const supprimerSanction = async (req, res) => {
  try {
    const { id, sanctionId } = req.params;
    const { notes } = req.body;
    
    const dette = await DetteDisciplinaire.findById(id);
    if (!dette) {
      return res.status(404).json({ success: false, error: 'Dette non trouvée' });
    }
    
    await dette.supprimerSanction(sanctionId, req.user.id, notes);
    
    res.json({
      success: true,
      data: dette,
      message: 'Sanction supprimée avec succès'
    });
  } catch (error) {
    console.error('Erreur supprimerSanction:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Obtenir l'historique des sanctions d'un membre
export const getHistoriqueSanctions = async (req, res) => {
  try {
    const { membreId } = req.params;
    const { annee, limit = 50 } = req.query;
    
    const filter = { membreId: new mongoose.Types.ObjectId(membreId) };
    if (annee) filter.annee = parseInt(annee);
    
    const dette = await DetteDisciplinaire.findOne(filter)
      .populate('historique.faitPar', 'nom prenom');
    
    if (!dette) {
      return res.json({ success: true, data: [] });
    }
    
    const historique = dette.historique
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, parseInt(limit));
    
    res.json({ success: true, data: historique });
  } catch (error) {
    console.error('Erreur getHistoriqueSanctions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// EXPORT PDF
// ============================================================

export const exportSanctionsPDF = async (req, res) => {
  try {
    const { annee = new Date().getFullYear(), membreId } = req.query;
    
    let dettes;
    if (membreId) {
      dettes = await DetteDisciplinaire.findOne({
        membreId: new mongoose.Types.ObjectId(membreId),
        annee: parseInt(annee)
      }).populate('membreId', 'nom prenom email telephone');
      if (dettes) dettes = [dettes];
      else dettes = [];
    } else {
      dettes = await DetteDisciplinaire.find({ annee: parseInt(annee) })
        .populate('membreId', 'nom prenom email telephone')
        .sort({ montantRestant: -1 });
    }
    
    const stats = await DetteDisciplinaire.getStats(annee);
    
    // Création du PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=releve_sanctions_${annee}.pdf`);
    
    doc.pipe(res);
    
    // En-tête
    doc.fontSize(20)
      .fillColor('#14532d')
      .text('AIFASA 17 - Relevé des sanctions disciplinaires', { align: 'center' });
    
    doc.fontSize(12)
      .fillColor('#666666')
      .text(`Exercice ${annee} - Généré le ${new Date().toLocaleDateString('fr-FR')}`, { align: 'center' });
    
    doc.moveDown();
    
    // Statistiques
    doc.fontSize(14).fillColor('#14532d').text('Synthèse', { underline: true });
    doc.moveDown(0.5);
    
    const startX = 50;
    let y = doc.y;
    
    doc.fontSize(11).fillColor('#333333');
    doc.text(`Total des dettes : ${stats.totalDettes.toLocaleString()} FCFA`, startX, y);
    doc.text(`Déjà payé : ${stats.totalPaye.toLocaleString()} FCFA`, startX + 250, y);
    y += 20;
    doc.text(`Reste à payer : ${stats.totalRestant.toLocaleString()} FCFA`, startX, y);
    doc.text(`Membres concernés : ${stats.countMembresAvecDette}`, startX + 250, y);
    y += 30;
    
    // Ligne de séparation
    doc.moveTo(50, y).lineTo(550, y).stroke('#e8f5e9');
    y += 15;
    
    // Tableau des sanctions
    doc.fontSize(12).fillColor('#14532d').text('Détail des sanctions', { underline: true });
    doc.moveDown(0.5);
    
    // En-têtes du tableau
    const colWidths = [30, 150, 80, 80, 80, 80];
    let currentY = doc.y;
    
    doc.fontSize(10).fillColor('#ffffff');
    doc.rect(50, currentY - 5, 30, 22).fill('#16a34a');
    doc.rect(80, currentY - 5, 150, 22).fill('#16a34a');
    doc.rect(230, currentY - 5, 80, 22).fill('#16a34a');
    doc.rect(310, currentY - 5, 80, 22).fill('#16a34a');
    doc.rect(390, currentY - 5, 80, 22).fill('#16a34a');
    doc.rect(470, currentY - 5, 80, 22).fill('#16a34a');
    
    doc.fillColor('#ffffff')
      .text('#', 58, currentY)
      .text('Membre', 90, currentY)
      .text('Total dû', 238, currentY)
      .text('Payé', 318, currentY)
      .text('Reste', 398, currentY)
      .text('Statut', 478, currentY);
    
    currentY += 22;
    let rowNum = 1;
    
    for (const dette of dettes) {
      if (currentY > 750) {
        doc.addPage();
        currentY = 50;
      }
      
      const membre = dette.membreId;
      const nomComplet = `${membre?.nom || ''} ${membre?.prenom || ''}`.trim() || 'Membre inconnu';
      
      doc.fontSize(9).fillColor('#333333');
      doc.rect(50, currentY - 3, 30, 18).fill(rowNum % 2 === 0 ? '#f8faf8' : '#ffffff');
      doc.rect(80, currentY - 3, 150, 18).fill(rowNum % 2 === 0 ? '#f8faf8' : '#ffffff');
      doc.rect(230, currentY - 3, 80, 18).fill(rowNum % 2 === 0 ? '#f8faf8' : '#ffffff');
      doc.rect(310, currentY - 3, 80, 18).fill(rowNum % 2 === 0 ? '#f8faf8' : '#ffffff');
      doc.rect(390, currentY - 3, 80, 18).fill(rowNum % 2 === 0 ? '#f8faf8' : '#ffffff');
      doc.rect(470, currentY - 3, 80, 18).fill(rowNum % 2 === 0 ? '#f8faf8' : '#ffffff');
      
      doc.fillColor('#333333')
        .text(rowNum.toString(), 58, currentY)
        .text(nomComplet.substring(0, 25), 90, currentY)
        .text(dette.montantTotal.toLocaleString(), 238, currentY)
        .text(dette.montantPaye.toLocaleString(), 318, currentY)
        .text(dette.montantRestant.toLocaleString(), 398, currentY)
        .text(dette.montantRestant === 0 ? '✅ Réglé' : '⚠️ En attente', 478, currentY);
      
      currentY += 18;
      rowNum++;
    }
    
    // Pied de page
    doc.fontSize(8).fillColor('#999999')
      .text('AIFASA 17 - Association des Ingénieurs Agronomes FASA Promotion 17', 50, 800, { align: 'center' });
    
    doc.end();
  } catch (error) {
    console.error('Erreur exportSanctionsPDF:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================================
// STATISTIQUES
// ============================================================

export const getSanctionsStats = async (req, res) => {
  try {
    const { annee = new Date().getFullYear() } = req.query;
    
    const stats = await DetteDisciplinaire.getStats(annee);
    
    // Top membres avec dettes
    const topMembres = await DetteDisciplinaire.find({ annee: parseInt(annee), montantRestant: { $gt: 0 } })
      .populate('membreId', 'nom prenom')
      .sort({ montantRestant: -1 })
      .limit(10);
    
    // Évolution mensuelle (simulée via historique)
    const evolution = await DetteDisciplinaire.aggregate([
      { $match: { annee: parseInt(annee) } },
      { $unwind: '$historique' },
      { $match: { 'historique.action': { $in: ['ajout', 'paiement_partiel', 'paiement_total'] } } },
      { $group: {
        _id: { month: { $month: '$historique.date' }, action: '$historique.action' },
        total: { $sum: { $abs: { $subtract: ['$historique.nouveauMontant', '$historique.ancienMontant'] } } }
      } },
      { $sort: { '_id.month': 1 } }
    ]);
    
    res.json({
      success: true,
      data: {
        ...stats,
        topMembres,
        evolution
      }
    });
  } catch (error) {
    console.error('Erreur getSanctionsStats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
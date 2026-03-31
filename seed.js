import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Membre from './models/Membre.js';

dotenv.config();

// Nettoie le numéro : enlève espaces, garde le +
const cleanPhone = (num) => {
  if (!num) return '';
  return num.replace(/\s/g, '');
};

const NEW_MEMBERS = [
  { nom: 'NGIJOL', prenom: 'BALENG Roland', email: 'rolandngijol@gmail.com', telephone: '+237654916181', whatsapp: '+237654916181', role: 'Membre' },
  { nom: 'ESSOLA ONJA\'A', prenom: 'FELIX MAGLOIRE', email: 'efelixmagloire@gmail.com', telephone: '+237620370286', whatsapp: '+237620370286', role: 'Président' },
  { nom: 'MOUYAKAN A MOUMBOCK', prenom: 'Elvis', email: 'mouyakanelvis@gmail.com', telephone: '+237679761484', whatsapp: '+237679761484', role: 'Membre' },
  { nom: 'SANDRINE JOSEPHINE', prenom: 'MAHBOU TEGUIA', email: 'sjtegy@gmail.com', telephone: '+237696106513', whatsapp: '', role: 'Membre' },
  { nom: 'NLEND NKOTT', prenom: 'ANNY LUCRECE', email: 'lucrecenlend@gmail.com', telephone: '+2290157073548', whatsapp: '', role: 'Membre' },
  { nom: 'GNINTEDEM TSANE', prenom: 'William', email: 'gnintedemwilliam@yahoo.fr', telephone: '+237694048752', whatsapp: '', role: 'Membre' },
  { nom: 'BIDJOGO TA', prenom: 'Pauline Francine', email: 'bidjogop@gmail.com', telephone: '+237675720165', whatsapp: '+237675720165', role: 'Membre' },
  { nom: 'BINDOP', prenom: 'FRANCK GAEL', email: 'franckbindop@yahoo.fr', telephone: '+237697276402', whatsapp: '', role: 'Membre' },
  { nom: 'TCHOWO HAPI', prenom: 'MAURIAD', email: 'tmauriad@yahoo.fr', telephone: '+237677758577', whatsapp: '+237693536465', role: 'Membre' },
  { nom: 'ABANGAWOH epse BEDJEME', prenom: 'HILLDA', email: 'hildabedjeme@gmail.com', telephone: '+237679769358', whatsapp: '+237679769358', role: 'Membre' },
  { nom: 'NDOUNTSA', prenom: 'PATRICK LE SAGE', email: 'pndountsa@gmail.com', telephone: '+237679116519', whatsapp: '+237679116519', role: 'Membre' },
  { nom: 'GUEFACK', prenom: 'Arnaud Gildas', email: 'guefackarnaudgildas@gmail.com', telephone: '+237670611304', whatsapp: '+237690122497', role: 'Membre' },
  { nom: 'NGAPOUT', prenom: 'Adamou', email: 'adamoungapout@gmail.com', telephone: '+237699884196', whatsapp: '+237699884196', role: 'Membre' },
  { nom: 'MBAMBA', prenom: 'AUGUSTIN GUERIN', email: 'augustinmbamba@yahoo.fr', telephone: '+237697161530', whatsapp: '', role: 'Membre' },
  { nom: 'EDONGO ABEGA', prenom: 'DAVY FABRICE', email: 'davy_e@yahoo.fr', telephone: '+237696322069', whatsapp: '', role: 'Membre' },
  { nom: 'IMBEY', prenom: 'MOÏSE OLIVIER', email: 'imbeymoiseolivier@yahoo.fr', telephone: '+237674556970', whatsapp: '', role: 'Membre' },
  { nom: 'AKAGOU SOKENG', prenom: 'LOIC PAQUIT', email: 'akagou2@gmail.com', telephone: '+237698364522', whatsapp: '', role: 'Membre' },
  { nom: 'KENGNI', prenom: 'Thibault', email: 'Kengnithibault@yahoo.com', telephone: '+237676103827', whatsapp: '+237656798326', role: 'Membre' },
  { nom: 'NKONO', prenom: 'Julien', email: 'julioati2024@gmail.com', telephone: '+237699788813', whatsapp: '+237699788813', role: 'Membre' },
  { nom: 'KOBLA', prenom: 'Anne Stéphanie', email: 'annestphanie.kobla@yahoo.fr', telephone: '+237697675558', whatsapp: '', role: 'Membre' },
  { nom: 'WANKAKI WOWE', prenom: 'ABEL AIMÉ', email: 'wawa.aime@gmail.com', telephone: '+237670540253', whatsapp: '+237670540253', role: 'Membre' },
  { nom: 'FONJI TANYA', prenom: 'FOLEFAC', email: 'fonji.t@gmail.com', telephone: '+237693790520', whatsapp: '+237693790520', role: 'Membre' },
  { nom: 'JAQUES', prenom: 'KUENBOU KEUMO', email: 'jkuenbou@yahoo.com', telephone: '+237695633156', whatsapp: '+237695633156', role: 'Membre' },
  { nom: 'KENFACK ESSOUGONG', prenom: 'Urcil Papito', email: 'urcilessougong@gmail.com', telephone: '+2250719599305', whatsapp: '+2250719599305', role: 'Membre' },
  { nom: 'YENE OWONA', prenom: 'JOSEPH LIONEL', email: 'yenelionel71@gmail.com', telephone: '+237694041010', whatsapp: '+237694041010', role: 'Membre' }
];

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/assoc_planner')
  .then(async () => {
    // 1. Vider les deux collections
    await User.deleteMany({});
    await Membre.deleteMany({});
    console.log('✅ Tous les membres supprimés');

    // 2. Créer l’admin dans User
    const admin = await User.create({
      nom: 'Admin',
      email: 'admin@assoc.cm',
      motdepasse: 'Njasso@1990',
      role: 'admin',
      association: 'Association Culturelle NA²'
    });
    console.log(`✅ Admin créé: ${admin.email} / Njasso@1990`);

    // 3. Créer les membres dans Membre (pas de motdepasse)
    const membersToCreate = NEW_MEMBERS.map(m => ({
      nom: m.nom,
      prenom: m.prenom,
      email: m.email,
      telephone: cleanPhone(m.telephone),
      whatsapp: cleanPhone(m.whatsapp) || cleanPhone(m.telephone),
      role: m.role || 'Membre',
      actif: true
    }));

    const membres = await Membre.insertMany(membersToCreate);
    console.log(`✅ ${membres.length} membres créés`);

    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Erreur seed:', err);
    process.exit(1);
  });
// scripts/check-env.js
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const requiredVars = [
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
];

const optionalVars = [
  'SMTP_USER',
  'SMTP_PASS',
  'DEEPSEEK_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'CALLMEBOT_API_KEY',
  'META_WA_TOKEN',
];

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

console.log(`\n${colors.cyan}🌿 AIFASA 17 - Vérification de l'environnement${colors.reset}\n`);
console.log(`${colors.cyan}═${colors.reset}`.repeat(60));

let hasError = false;

// Vérifier les variables requises
console.log(`\n${colors.yellow}📋 Variables requises:${colors.reset}`);
requiredVars.forEach(varName => {
  const value = process.env[varName];
  const isDefault = value === 'changez_moi_avec_une_chaine_aleatoire_longue';
  const isSet = value && !isDefault;
  const status = isSet ? '✅' : '❌';
  console.log(`  ${status} ${varName} ${isSet ? '✓' : '✗'}`);
  if (!isSet) hasError = true;
});

// Vérifier les variables optionnelles
console.log(`\n${colors.yellow}🔧 Variables optionnelles:${colors.reset}`);
optionalVars.forEach(varName => {
  const value = process.env[varName];
  const isSet = value && value.length > 0;
  const status = isSet ? '⚡' : '○';
  console.log(`  ${status} ${varName} ${isSet ? 'configuré' : 'non configuré'}`);
});

// Vérification spécifique JWT
const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret === 'changez_moi_avec_une_chaine_aleatoire_longue') {
  console.log(`\n${colors.red}⚠️  ALERTE SÉCURITÉ: La clé JWT n'a pas été modifiée!${colors.reset}`);
  console.log(`${colors.yellow}   Générez une nouvelle clé avec: npm run generate:jwt${colors.reset}`);
  hasError = true;
}

// Vérification DeepSeek
if (process.env.DEEPSEEK_API_KEY) {
  console.log(`\n${colors.green}🤖 IA DeepSeek: Configurée${colors.reset}`);
} else {
  console.log(`\n${colors.yellow}🤖 IA DeepSeek: Non configurée (fonctionnalités IA désactivées)${colors.reset}`);
}

// Vérification MongoDB
console.log(`\n${colors.yellow}🗄️  MongoDB:${colors.reset}`);
console.log(`   URI: ${process.env.MONGODB_URI?.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@') || 'non configuré'}`);

console.log(`\n${colors.cyan}═${colors.reset}`.repeat(60));

if (hasError) {
  console.log(`\n${colors.red}❌ Configuration incomplète. Corrigez les erreurs ci-dessus.${colors.reset}\n`);
  process.exit(1);
} else {
  console.log(`\n${colors.green}✅ Configuration valide! Vous pouvez démarrer l'application.${colors.reset}\n`);
  process.exit(0);
}
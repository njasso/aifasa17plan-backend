// backend/test-final.js
import dotenv from 'dotenv';
dotenv.config();

import { whatsappService } from './services/whatsappService.js';

const test = async () => {
  console.log('🧪 Test WhatsApp Meta...');
  console.log('Version API:', process.env.META_WA_API_VERSION);
  
  const result = await whatsappService.send({
    to: '+237681001827',
    message: '🌿 AIFASA 17 - Votre configuration WhatsApp est maintenant opérationnelle !'
  });
  
  console.log('\n📊 Résultat:', result);
};

test();
import express from 'express';
import { whatsappService } from '../services/whatsappService.js';

const router = express.Router();

router.get('/whatsapp', async (req, res) => {
  const status = await whatsappService.getStatus();
  res.json({ success: true, data: status });
});

export default router;
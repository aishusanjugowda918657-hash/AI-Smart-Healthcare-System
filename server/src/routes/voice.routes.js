import express from 'express';
import {
  getVoiceConfig,
  transcribeAudioFile,
  synthesizeAudio,
  voiceChat
} from '../controllers/voiceController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { aiRateLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Public configuration endpoint
router.get('/config', getVoiceConfig);

// Authenticated voice processing endpoints
router.post('/transcribe', requireAuth, aiRateLimiter, transcribeAudioFile);
router.post('/synthesize', requireAuth, aiRateLimiter, synthesizeAudio);
router.post('/chat', requireAuth, aiRateLimiter, voiceChat);

export default router;

import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';
import { transcribeVoice, speakVoice } from '../controllers/voiceController.js';

const router = express.Router();

const audioBody = express.raw({
  type: [
    'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/ogg',
    'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/flac'
  ],
  limit: '10mb'
});

router.post('/transcribe', requireAuth, requireRole('patient'), audioBody, transcribeVoice);
router.post('/speak', requireAuth, requireRole('patient'), speakVoice);

export default router;

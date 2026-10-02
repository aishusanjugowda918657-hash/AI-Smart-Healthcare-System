import express from 'express';
import {
  aiChat,
  aiChatConfirm,
  aiDoctorAsk,
  aiSmartSlotRecommendation,
  aiExtractPrescriptionDraft,
  aiDictate,
  aiExtractPaper
} from '../controllers/aiController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/chat', requireAuth, aiChat);
router.post('/chat/confirm', requireAuth, aiChatConfirm);
router.post('/doctor/ask', requireAuth, requireRole('doctor', 'admin'), aiDoctorAsk);
router.post('/smart-slot', requireAuth, aiSmartSlotRecommendation);
router.post('/extract-prescription', requireAuth, requireRole('doctor', 'admin'), aiExtractPrescriptionDraft);
router.post('/dictate', requireAuth, requireRole('doctor', 'admin'), aiDictate);
router.post('/extract-paper', requireAuth, requireRole('doctor', 'admin'), aiExtractPaper);

export default router;

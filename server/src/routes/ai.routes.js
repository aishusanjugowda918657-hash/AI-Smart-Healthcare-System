import express from 'express';
import {
  aiChat,
  aiSmartSlotRecommendation,
  aiExtractPrescriptionDraft
} from '../controllers/aiController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/chat', requireAuth, aiChat);
router.post('/smart-slot', requireAuth, aiSmartSlotRecommendation);
router.post('/extract-prescription', requireAuth, requireRole('doctor', 'admin'), aiExtractPrescriptionDraft);

export default router;

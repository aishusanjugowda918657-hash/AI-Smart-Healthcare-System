import express from 'express';
import { scanCheckIn, manualCheckIn } from '../controllers/checkinController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/scan', requireAuth, requireRole('reception', 'nurse', 'doctor', 'admin'), scanCheckIn);
router.post('/manual', requireAuth, requireRole('reception', 'nurse', 'doctor', 'admin'), manualCheckIn);

export default router;

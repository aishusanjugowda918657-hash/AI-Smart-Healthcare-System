import express from 'express';
import {
  syncPrescriptionReminders,
  getTodayReminders,
  logMedicineAction
} from '../controllers/reminderController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/sync', requireAuth, syncPrescriptionReminders);
router.get('/today', requireAuth, getTodayReminders);
router.post('/log', requireAuth, logMedicineAction);

export default router;

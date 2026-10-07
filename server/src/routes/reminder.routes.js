import express from 'express';
import {
  syncPrescriptionReminders,
  getTodayReminders,
  logMedicineAction,
  respondToReminder,
  getAdherenceMetrics
} from '../controllers/reminderController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', requireAuth, getTodayReminders);
router.post('/sync', requireAuth, syncPrescriptionReminders);
router.get('/today', requireAuth, getTodayReminders);
router.post('/log', requireAuth, logMedicineAction);
router.get('/adherence', requireAuth, getAdherenceMetrics);
router.get('/:healthId/adherence', requireAuth, getAdherenceMetrics);

// Respond endpoint supports either standard auth OR HMAC actionToken in body/headers
router.post('/:id/respond', (req, res, next) => {
  if (req.headers.authorization || req.headers['x-demo-uid']) {
    return requireAuth(req, res, next);
  }
  next();
}, respondToReminder);

export default router;

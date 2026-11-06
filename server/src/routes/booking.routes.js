import express from 'express';
import {
  performTriage,
  getDoctorOptions,
  getBookingSuggestions,
  getTriageAlerts,
  acknowledgeTriageAlert,
  confirmEmergencyAlert,
  adjustTriageAlertLevel,
  overrideClinicalLevel,
  registerWalkin,
  autoAssignDoctor
} from '../controllers/bookingController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/triage', performTriage);
router.get('/doctor-options', getDoctorOptions);
router.post('/auto-assign', autoAssignDoctor);
router.get('/suggestions', getBookingSuggestions);
router.get('/alerts', requireAuth, requireRole('nurse', 'doctor', 'admin'), getTriageAlerts);
router.post('/alerts/:id/acknowledge', requireAuth, requireRole('nurse', 'doctor', 'admin'), acknowledgeTriageAlert);
router.post('/alerts/:id/confirm-emergency', requireAuth, requireRole('nurse', 'doctor', 'admin'), confirmEmergencyAlert);
router.post('/alerts/:id/adjust-level', requireAuth, requireRole('nurse', 'doctor', 'admin'), adjustTriageAlertLevel);
router.post('/walkins', requireAuth, requireRole('reception', 'admin'), registerWalkin);

export default router;

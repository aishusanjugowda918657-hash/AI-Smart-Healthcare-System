import express from 'express';
import {
  getDoctors,
  getDoctorById,
  saveDoctorSchedule,
  getDepartments,
  createDepartment,
  getDoctorAlerts,
  resolveDoctorAlert,
  snoozeDoctorAlert,
  sendPatientReminderAlert
} from '../controllers/doctorController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/', getDoctors);
router.get('/alerts', requireAuth, requireRole('doctor', 'admin'), getDoctorAlerts);
router.get('/patients-needing-attention', requireAuth, requireRole('doctor', 'admin'), getDoctorAlerts);
router.post('/alerts/:id/resolve', requireAuth, requireRole('doctor', 'admin'), resolveDoctorAlert);
router.post('/alerts/:id/snooze', requireAuth, requireRole('doctor', 'admin'), snoozeDoctorAlert);
router.post('/alerts/:id/send-reminder', requireAuth, requireRole('doctor', 'admin'), sendPatientReminderAlert);

router.get('/:id', getDoctorById);
router.put('/:id/schedule', requireAuth, requireRole('doctor', 'admin'), saveDoctorSchedule);

export default router;

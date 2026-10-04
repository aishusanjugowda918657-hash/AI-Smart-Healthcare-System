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
  sendPatientReminderAlert,
  getLeaves
} from '../controllers/doctorController.js';
import { adminCreateLeave, adminDeleteLeave } from '../controllers/slotController.js';
import { getAppointmentPreConsultationSummary } from '../controllers/aiController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/', getDoctors);
router.get('/alerts', requireAuth, requireRole('doctor', 'admin'), getDoctorAlerts);
router.get('/patients-needing-attention', requireAuth, requireRole('doctor', 'admin'), getDoctorAlerts);
router.post('/alerts/:id/resolve', requireAuth, requireRole('doctor', 'admin'), resolveDoctorAlert);
router.post('/alerts/:id/snooze', requireAuth, requireRole('doctor', 'admin'), snoozeDoctorAlert);
router.post('/alerts/:id/send-reminder', requireAuth, requireRole('doctor', 'admin'), sendPatientReminderAlert);

// Schedule & Leaves (PRD F2)
router.post('/schedule', requireAuth, requireRole('doctor', 'admin'), saveDoctorSchedule);
router.put('/schedule', requireAuth, requireRole('doctor', 'admin'), saveDoctorSchedule);
router.post('/:id/schedule', requireAuth, requireRole('doctor', 'admin'), saveDoctorSchedule);
router.put('/:id/schedule', requireAuth, requireRole('doctor', 'admin'), saveDoctorSchedule);

router.get('/leaves', requireAuth, requireRole('doctor', 'admin'), getLeaves);
router.post('/leaves', requireAuth, requireRole('doctor', 'admin'), adminCreateLeave);
router.delete('/leaves/:id', requireAuth, requireRole('doctor', 'admin'), adminDeleteLeave);

// Pre-consultation summary endpoint (PRD F15)
router.get('/appointments/:id/summary', requireAuth, requireRole('doctor', 'admin'), getAppointmentPreConsultationSummary);

router.get('/:id', getDoctorById);

export default router;

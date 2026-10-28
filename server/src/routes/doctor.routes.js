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
  getLeaves,
  getDoctorDashboardSummary,
  getDoctorLeaveImpact,
  doctorSearchPatients,
  doctorGetMyPatients,
  doctorGetSharedPatients,
  doctorCheckPatientAccess
} from '../controllers/doctorController.js';
import { adminCreateLeave, adminDeleteLeave } from '../controllers/slotController.js';
import {
  getPreConsultationSummary,
  postSummaryCorrection,
  postDoctorPreNote,
  postChangeComplexity
} from '../controllers/doctorSummaryController.js';
import {
  getDoctorPrescriptionHelpers,
  getDoctorTemplates,
  saveDoctorTemplate
} from '../controllers/prescriptionController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Doctor Dashboard & Workspaces (Task A)
router.get('/dashboard-summary', requireAuth, requireRole('doctor', 'admin'), getDoctorDashboardSummary);
router.get('/leaves/impact', requireAuth, requireRole('doctor', 'admin'), getDoctorLeaveImpact);
router.get('/patients/search', requireAuth, requireRole('doctor', 'admin'), doctorSearchPatients);
router.get('/patients/my-patients', requireAuth, requireRole('doctor', 'admin'), doctorGetMyPatients);
router.get('/patients/shared-with-me', requireAuth, requireRole('doctor', 'admin'), doctorGetSharedPatients);
router.get('/patients/:healthId/access-check', requireAuth, requireRole('doctor', 'admin'), doctorCheckPatientAccess);
router.get('/prescription-helpers', requireAuth, requireRole('doctor', 'admin'), getDoctorPrescriptionHelpers);
router.get('/templates', requireAuth, requireRole('doctor', 'admin'), getDoctorTemplates);
router.post('/templates', requireAuth, requireRole('doctor', 'admin'), saveDoctorTemplate);

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

// Pre-consultation summary endpoints (PRD Section F15)
router.get('/appointments/:appointmentId/pre-consultation-summary', requireAuth, requireRole('doctor', 'admin'), getPreConsultationSummary);
router.get('/appointments/:id/summary', requireAuth, requireRole('doctor', 'admin'), getPreConsultationSummary);
router.post('/appointments/:appointmentId/pre-consultation-summary/correct', requireAuth, requireRole('doctor', 'admin'), postSummaryCorrection);
router.post('/appointments/:id/correct-summary', requireAuth, requireRole('doctor', 'admin'), postSummaryCorrection);
router.post('/appointments/:appointmentId/pre-consultation-summary/note', requireAuth, requireRole('doctor', 'admin'), postDoctorPreNote);
router.post('/appointments/:id/add-note', requireAuth, requireRole('doctor', 'admin'), postDoctorPreNote);
router.post('/appointments/:appointmentId/complexity', requireAuth, requireRole('doctor', 'admin'), postChangeComplexity);

router.get('/:id', getDoctorById);

export default router;

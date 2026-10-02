import express from 'express';
import {
  createMedicalRecord,
  getPatientMedicalHistory,
  getMyMedicalHistory,
  getVitalsTrend,
  shareAccess,
  revokeAccess,
  exportMedicalHistoryPdf
} from '../controllers/medicalController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/', requireAuth, requireRole('doctor', 'admin'), createMedicalRecord);
router.get('/my-history', requireAuth, getMyMedicalHistory);
router.get('/patient/:patientHealthId', requireAuth, getPatientMedicalHistory);
router.get('/patient/:patientHealthId/vitals-trend', requireAuth, getVitalsTrend);
router.get('/patient/:patientHealthId/pdf', requireAuth, exportMedicalHistoryPdf);
router.post('/share', requireAuth, shareAccess);
router.post('/revoke', requireAuth, revokeAccess);

export default router;

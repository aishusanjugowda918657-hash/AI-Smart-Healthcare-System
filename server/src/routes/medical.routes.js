import express from 'express';
import {
  createMedicalRecord,
  getPatientMedicalHistory,
  getMyMedicalHistory
} from '../controllers/medicalController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/', requireAuth, requireRole('doctor', 'admin'), createMedicalRecord);
router.get('/my-history', requireAuth, getMyMedicalHistory);
router.get('/patient/:patientHealthId', requireAuth, getPatientMedicalHistory);

export default router;

import express from 'express';
import {
  createDigitalPrescription,
  getMyPrescriptions,
  getPrescriptionsByHealthId
} from '../controllers/prescriptionController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/', requireAuth, requireRole('doctor', 'admin'), createDigitalPrescription);
router.get('/my-prescriptions', requireAuth, getMyPrescriptions);
router.get('/patient/:patientHealthId', requireAuth, requireRole('doctor', 'admin'), getPrescriptionsByHealthId);

export default router;

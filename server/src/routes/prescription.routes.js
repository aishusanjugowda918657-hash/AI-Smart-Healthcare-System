import express from 'express';
import {
  searchMedicines,
  checkPrescriptionSafety,
  createDigitalPrescription,
  updateDigitalPrescription,
  stopPrescriptionItem,
  getMyPrescriptions,
  getPrescriptionsByHealthId,
  getRepeatLastPrescription,
  exportPrescriptionPdf,
  verifyPrescription,
  dispensePrescription,
  getDoctorTemplates,
  saveDoctorTemplate,
  getDoctorFavourites,
  saveDoctorFavourites
} from '../controllers/prescriptionController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/medicines/search', requireAuth, searchMedicines);
router.post('/check-safety', requireAuth, checkPrescriptionSafety);

router.get('/templates', requireAuth, requireRole('doctor', 'admin'), getDoctorTemplates);
router.post('/templates', requireAuth, requireRole('doctor', 'admin'), saveDoctorTemplate);

router.get('/favourites', requireAuth, requireRole('doctor', 'admin'), getDoctorFavourites);
router.post('/favourites', requireAuth, requireRole('doctor', 'admin'), saveDoctorFavourites);

router.post('/', requireAuth, requireRole('doctor', 'admin'), createDigitalPrescription);
router.put('/:id', requireAuth, requireRole('doctor', 'admin'), updateDigitalPrescription);
router.post('/:id/stop-item', requireAuth, requireRole('doctor', 'admin'), stopPrescriptionItem);

router.get('/my-prescriptions', requireAuth, getMyPrescriptions);
router.get('/patient/:patientHealthId', requireAuth, getPrescriptionsByHealthId);
router.get('/patient/:patientHealthId/last', requireAuth, getRepeatLastPrescription);
router.get('/:id/pdf', requireAuth, exportPrescriptionPdf);

router.get('/verify/:code', requireAuth, verifyPrescription);
router.post('/:id/dispense', requireAuth, requireRole('pharmacist', 'admin', 'doctor'), dispensePrescription);

export default router;

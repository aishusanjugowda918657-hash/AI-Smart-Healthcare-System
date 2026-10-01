import express from 'express';
import {
  getDoctors,
  saveDoctorSchedule,
  getDoctorAvailableSlots
} from '../controllers/doctorController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/', getDoctors);
router.post('/schedule', requireAuth, requireRole('doctor', 'admin'), saveDoctorSchedule);
router.get('/:doctorUid/available-slots', getDoctorAvailableSlots);

export default router;

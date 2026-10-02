import express from 'express';
import {
  getDoctors,
  getDoctorById,
  saveDoctorSchedule,
  getDepartments,
  createDepartment
} from '../controllers/doctorController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/', getDoctors);
router.get('/:id', getDoctorById);
router.put('/:id/schedule', requireAuth, requireRole('doctor', 'admin'), saveDoctorSchedule);

export default router;

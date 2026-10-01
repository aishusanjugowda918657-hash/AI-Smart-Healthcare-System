import express from 'express';
import {
  createFollowUp,
  getDoctorUpcomingFollowUps,
  getPatientUpcomingFollowUps
} from '../controllers/followupController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/', requireAuth, requireRole('doctor', 'admin'), createFollowUp);
router.get('/doctor-upcoming', requireAuth, requireRole('doctor', 'admin'), getDoctorUpcomingFollowUps);
router.get('/patient-upcoming', requireAuth, getPatientUpcomingFollowUps);

export default router;

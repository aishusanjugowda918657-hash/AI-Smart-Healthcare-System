import express from 'express';
import {
  createFollowUp,
  handleFollowUpAction,
  getDoctorUpcomingFollowUps,
  getPatientUpcomingFollowUps,
  getFollowUpsList
} from '../controllers/followupController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/', requireAuth, getFollowUpsList);
router.post('/', requireAuth, requireRole('doctor', 'admin'), createFollowUp);
router.patch('/:id', requireAuth, handleFollowUpAction);
router.post('/:id/action', requireAuth, handleFollowUpAction);
router.get('/doctor-upcoming', requireAuth, requireRole('doctor', 'admin'), getDoctorUpcomingFollowUps);
router.get('/patient-upcoming', requireAuth, getPatientUpcomingFollowUps);

export default router;

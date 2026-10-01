import express from 'express';
import {
  checkinAndGenerateToken,
  getDoctorQueue,
  callNextPatient,
  completeCurrentConsultation,
  getWaitingTimeEstimate,
  getMyQueueStatus
} from '../controllers/tokenController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/checkin', requireAuth, checkinAndGenerateToken);
router.get('/my-queue-status', requireAuth, getMyQueueStatus);
router.get('/queue/:doctorUid', requireAuth, getDoctorQueue);
router.get('/waiting-time', requireAuth, getWaitingTimeEstimate);
router.post('/call-next', requireAuth, requireRole('doctor', 'admin'), callNextPatient);
router.post('/complete-current', requireAuth, requireRole('doctor', 'admin'), completeCurrentConsultation);
router.post('/complete', requireAuth, requireRole('doctor', 'admin'), completeCurrentConsultation);

export default router;

import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';
import {
  getDoctorQueueToday,
  callNextPatient,
  callSpecificToken,
  holdToken,
  finishConsultation,
  extendConsultation,
  undoExtendConsultation,
  startBreak,
  endBreak,
  doctorLateStart,
  markProcedure,
  markEmergency,
  setLeaveHomeParams,
  toggleEarlyOptIn,
  getPublicDisplayBoard,
  getDoctorWaitPrediction
} from '../controllers/queueController.js';

const router = express.Router();

// Doctor Queue & Controls
router.get('/doctor/:doctorId/today', requireAuth, getDoctorQueueToday);
router.get('/doctor/:doctorId/wait-prediction', getDoctorWaitPrediction);
router.post('/call-next', requireAuth, requireRole('doctor', 'admin'), callNextPatient);
router.post('/call/:id', requireAuth, requireRole('doctor', 'admin'), callSpecificToken);
router.post('/hold/:id', requireAuth, holdToken);
router.post('/finish', requireAuth, finishConsultation);
router.post('/extend', requireAuth, requireRole('doctor', 'admin'), extendConsultation);
router.post('/undo-extend', requireAuth, requireRole('doctor', 'admin'), undoExtendConsultation);
router.post('/break', requireAuth, requireRole('doctor', 'admin'), startBreak);
router.post('/end-break', requireAuth, requireRole('doctor', 'admin'), endBreak);
router.post('/late-start', requireAuth, requireRole('doctor', 'admin'), doctorLateStart);
router.post('/procedure', requireAuth, markProcedure);
router.post('/emergency', requireAuth, requireRole('doctor', 'nurse', 'admin'), markEmergency);

// Patient Controls
router.post('/appointments/:id/leave-home', requireAuth, setLeaveHomeParams);
router.post('/appointments/:id/early-optin', requireAuth, toggleEarlyOptIn);

// Public Display Board
router.get('/:departmentId', getPublicDisplayBoard);

export default router;

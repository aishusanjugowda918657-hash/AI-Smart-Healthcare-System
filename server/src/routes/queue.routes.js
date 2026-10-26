import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';
import {
  getDoctorQueueReadOnly,
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
  toggleEarlyOptIn,
  getPublicDisplayBoard,
  getDoctorWaitPrediction,
  startConsultation,
  endDoctorSession,
  getReceptionQueueOverview
} from '../controllers/queueController.js';

const router = express.Router();

// Reception Queue Overview
router.get('/reception-overview', requireAuth, requireRole('reception', 'nurse', 'doctor', 'admin'), getReceptionQueueOverview);

// Doctor Queue & Controls
router.get('/doctor/:doctorId/readonly', requireAuth, getDoctorQueueReadOnly);
router.get('/doctor/:doctorId/today/readonly', requireAuth, getDoctorQueueReadOnly);
router.get('/doctor/:doctorId/today', requireAuth, getDoctorQueueToday);
router.get('/doctor/:doctorId/wait-prediction', getDoctorWaitPrediction);
router.post('/call-next', requireAuth, requireRole('doctor', 'admin'), callNextPatient);
router.post('/call/:id', requireAuth, requireRole('doctor', 'admin'), callSpecificToken);
router.post('/start-consultation', requireAuth, requireRole('doctor', 'admin'), startConsultation);
router.post('/start/:id', requireAuth, requireRole('doctor', 'admin'), startConsultation);
router.post('/doctor/:doctorId/end-session', requireAuth, requireRole('doctor', 'admin'), endDoctorSession);
router.post('/end-session', requireAuth, requireRole('doctor', 'admin'), endDoctorSession);
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
router.post('/appointments/:id/early-optin', requireAuth, toggleEarlyOptIn);

// Public Display Board
router.get('/:departmentId', getPublicDisplayBoard);

export default router;

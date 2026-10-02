import express from 'express';
import {
  bookAppointment,
  getMyAppointments,
  getDoctorTodayAppointments,
  updateAppointmentStatus,
  cancelAppointment,
  triggerNoShowScheduler
} from '../controllers/appointmentController.js';
import { createAppointment, overrideClinicalLevel } from '../controllers/bookingController.js';
import {
  confirmAppointment,
  cancelAppointment as cancelAppointmentF5,
  undoCancelAppointment,
  restoreAppointment,
  rescheduleAppointment,
  onTheWay,
  nearby,
  rejoinQueue,
  lateSwap
} from '../controllers/appointmentLifecycleController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/', requireAuth, createAppointment);
router.post('/book', requireAuth, bookAppointment);
router.get('/', requireAuth, getMyAppointments);
router.get('/my-appointments', requireAuth, getMyAppointments);
router.get('/doctor-today', requireAuth, requireRole('doctor', 'admin'), getDoctorTodayAppointments);
router.post('/:id/level', requireAuth, requireRole('doctor', 'nurse', 'admin'), overrideClinicalLevel);

// Lifecycle transition endpoints (PRD F5)
router.post('/:id/confirm', requireAuth, confirmAppointment);
router.post('/:id/cancel', requireAuth, cancelAppointmentF5);
router.post('/:id/undo-cancel', requireAuth, undoCancelAppointment);
router.post('/:id/restore', requireAuth, requireRole('reception', 'nurse', 'doctor', 'admin'), restoreAppointment);
router.post('/:id/reschedule', requireAuth, rescheduleAppointment);
router.post('/:id/on-the-way', requireAuth, onTheWay);
router.post('/:id/nearby', requireAuth, nearby);
router.post('/:id/rejoin', requireAuth, rejoinQueue);
router.post('/:id/late-swap', requireAuth, lateSwap);

router.patch('/:id/status', requireAuth, updateAppointmentStatus);
router.patch('/:id/cancel', requireAuth, cancelAppointment);
router.post('/run-no-show-check', triggerNoShowScheduler);

export default router;

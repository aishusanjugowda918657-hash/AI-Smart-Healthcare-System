import express from 'express';
import {
  bookAppointment,
  getMyAppointments,
  getDoctorTodayAppointments,
  updateAppointmentStatus,
  cancelAppointment,
  triggerNoShowScheduler
} from '../controllers/appointmentController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/book', requireAuth, bookAppointment);
router.get('/my-appointments', requireAuth, getMyAppointments);
router.get('/doctor-today', requireAuth, requireRole('doctor', 'admin'), getDoctorTodayAppointments);
router.patch('/:id/status', requireAuth, updateAppointmentStatus);
router.patch('/:id/cancel', requireAuth, cancelAppointment);
router.post('/run-no-show-check', triggerNoShowScheduler);

export default router;

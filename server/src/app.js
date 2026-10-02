import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import env from './config/env.js';
import flags from './config/flags.js';
import requestIdMiddleware from './middleware/requestId.js';
import { apiRateLimiter, aiRateLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import { formatSuccessResponse, formatErrorResponse } from './utils/errors.js';
import { requireAuth } from './middleware/authMiddleware.js';
import { requireRole } from './middleware/roleMiddleware.js';
import { staffPatientLookup, acceptCaregiverInvite } from './controllers/patientController.js';

import authRoutes from './routes/auth.routes.js';
import patientRoutes from './routes/patient.routes.js';
import doctorRoutes from './routes/doctor.routes.js';
import departmentRoutes from './routes/department.routes.js';
import appointmentRoutes from './routes/appointment.routes.js';
import tokenRoutes from './routes/token.routes.js';
import medicalRoutes from './routes/medical.routes.js';
import prescriptionRoutes from './routes/prescription.routes.js';
import reminderRoutes from './routes/reminder.routes.js';
import followupRoutes from './routes/followup.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import aiRoutes from './routes/ai.routes.js';
import adminRoutes from './routes/admin.routes.js';
import patientAgentRoutes from './routes/patientAgent.routes.js';
import slotRoutes from './routes/slot.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import checkinRoutes from './routes/checkin.routes.js';

const app = express();

// Global Middlewares
app.use(helmet());
app.use(cors({
  origin: env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(requestIdMiddleware);

// Standard Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json(formatSuccessResponse({
    status: 'online',
    system: 'AI-Based Smart Healthcare System',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    flags: {
      ai: flags.ai,
      push: flags.push,
      scheduler: flags.scheduler
    }
  }));
});

// Protected Internal Tick Endpoint
app.post('/api/internal/tick', (req, res) => {
  const secretHeader = req.headers['x-tick-secret'];
  if (secretHeader !== env.INTERNAL_TICK_SECRET) {
    return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Invalid internal tick secret'));
  }

  return res.status(200).json(formatSuccessResponse({
    ticked: true,
    at: new Date().toISOString()
  }));
});

// Staff Lookup & Invites Endpoints (PRD F1)
app.get('/api/staff/patients/lookup', requireAuth, requireRole('doctor', 'nurse', 'reception', 'admin'), staffPatientLookup);
app.post('/api/invites/:healthId/accept', requireAuth, acceptCaregiverInvite);

// Rate limiting
app.use('/api/', apiRateLimiter);
app.use('/api/ai', aiRateLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/medical-records', medicalRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient-agent', patientAgentRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/triage', bookingRoutes);
app.use('/api/checkin', checkinRoutes);

// Error handling middleware
app.use(errorHandler);

export default app;

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
import { registerDeviceToken, removeDeviceToken } from './controllers/notificationController.js';
import { runSchedulerJobs } from './jobs/scheduler.js';
import { isEmulator, getActiveProjectId } from './config/firebase.js';
import { getScheduleMetadata } from './config/operatingSchedule.js';

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
import queueRoutes from './routes/queue.routes.js';
import reportRoutes from './routes/report.routes.js';
import visitRoutes from './routes/visit.routes.js';

const app = express();

// Global Middlewares
app.use(helmet());

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = (env.CLIENT_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const isDev = env.NODE_ENV === 'development';
    if (allowedOrigins.includes(origin) || (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
      return callback(null, origin);
    }
    return callback(null, false);
  },
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-request-id',
    'x-demo-uid',
    'x-demo-email',
    'x-demo-role',
    'x-tick-secret'
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
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

// Environment Guard Endpoint (REQ 5)
app.get('/api/health/env', (req, res) => {
  const projectId = getActiveProjectId();
  res.status(200).json(formatSuccessResponse({
    projectId,
    isEmulator: !!isEmulator,
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST || null,
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST || null,
    schedule: getScheduleMetadata()
  }));
});

// Hospital Operating Schedule Endpoint
app.get('/api/config/schedule', (req, res) => {
  res.status(200).json(formatSuccessResponse(getScheduleMetadata()));
});

// Protected Internal Tick Endpoint (PRD Section 7, 3.5)
// Runs all scheduler jobs once — safe for external pingers (cron-job.org)
app.post('/api/internal/tick', async (req, res) => {
  const isRealEnvironment = process.env.NODE_ENV === 'production' || !process.env.FIRESTORE_EMULATOR_HOST;
  const configuredSecret = env.INTERNAL_TICK_SECRET ? String(env.INTERNAL_TICK_SECRET).trim() : '';
  const isDefaultSecret = !configuredSecret || ['dev_tick_secret', 'change_me_in_production', 'default'].includes(configuredSecret);

  if (isRealEnvironment && isDefaultSecret) {
    return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Internal tick endpoint disabled: production tick secret is not configured.'));
  }

  const secretHeader = req.headers['x-tick-secret'];
  if (!secretHeader || !configuredSecret || secretHeader !== configuredSecret) {
    return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Invalid internal tick secret'));
  }

  try {
    const includeDaily = req.query.includeDaily === 'true' || req.query.scope === 'all';
    const results = await runSchedulerJobs({ includeDaily });
    return res.status(200).json(formatSuccessResponse({
      ticked: true,
      at: new Date().toISOString(),
      results
    }));
  } catch (err) {
    // Never crash — log and respond
    console.error('❌ Internal tick error:', err.message);
    return res.status(200).json(formatSuccessResponse({ ticked: true, at: new Date().toISOString(), error: err.message }));
  }
});

// Staff Lookup & Invites Endpoints (PRD F1)
app.get('/api/staff/patients/lookup', requireAuth, requireRole('doctor', 'nurse', 'reception', 'admin'), staffPatientLookup);
app.post('/api/invites/:healthId/accept', requireAuth, acceptCaregiverInvite);

// Device token management (PRD F8 — client registers FCM token after permission granted)
app.post('/api/me/devices', requireAuth, registerDeviceToken);
app.delete('/api/me/devices', requireAuth, removeDeviceToken);

// Rate limiting
app.use('/api/', apiRateLimiter);
app.use('/api/ai', aiRateLimiter);

import waitlistRoutes from './routes/waitlist.routes.js';
import offerRoutes from './routes/offer.routes.js';

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/medical-records', medicalRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/prescriptions', prescriptionRoutes);
app.use('/api/medicines', prescriptionRoutes);
app.use('/medicines', prescriptionRoutes);
app.use('/api/verify', prescriptionRoutes);
app.use('/verify', prescriptionRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/reminders', reminderRoutes);
app.use('/api/followups', followupRoutes);
app.use('/followups', followupRoutes);

import {
  getDoctorAlerts,
  resolveDoctorAlert,
  snoozeDoctorAlert,
  sendPatientReminderAlert
} from './controllers/doctorController.js';

app.get('/api/alerts', requireAuth, requireRole('doctor', 'admin', 'nurse'), getDoctorAlerts);
app.get('/alerts', requireAuth, requireRole('doctor', 'admin', 'nurse'), getDoctorAlerts);
app.post('/api/alerts/:id/resolve', requireAuth, requireRole('doctor', 'admin'), resolveDoctorAlert);
app.post('/alerts/:id/resolve', requireAuth, requireRole('doctor', 'admin'), resolveDoctorAlert);
app.post('/api/alerts/:id/snooze', requireAuth, requireRole('doctor', 'admin'), snoozeDoctorAlert);
app.post('/alerts/:id/snooze', requireAuth, requireRole('doctor', 'admin'), snoozeDoctorAlert);
app.post('/api/alerts/:id/send-reminder', requireAuth, requireRole('doctor', 'admin'), sendPatientReminderAlert);
app.post('/alerts/:id/send-reminder', requireAuth, requireRole('doctor', 'admin'), sendPatientReminderAlert);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient-agent', patientAgentRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/triage', bookingRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/display', queueRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/offers', offerRoutes);

// Error handling middleware
app.use(errorHandler);

export default app;

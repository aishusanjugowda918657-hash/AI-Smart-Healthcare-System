/**
 * Notification Routes (PRD F8)
 * GET    /api/notifications          → list (paginated)
 * PATCH  /api/notifications/:id/read → mark one read
 * POST   /api/notifications/read-all → mark all read
 *
 * Device token routes (wired via auth routes in app.js):
 * POST   /api/me/devices    → register FCM token
 * DELETE /api/me/devices    → remove FCM token
 */

import express from 'express';
import {
  getNotifications,
  markRead,
  markAllRead,
  markDisplayed
} from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// All notification endpoints require authentication
router.get('/', requireAuth, getNotifications);
router.patch('/:id/read', requireAuth, markRead);
router.patch('/:id/displayed', requireAuth, markDisplayed);
router.post('/read-all', requireAuth, markAllRead);

// Legacy route: backward-compat (Phase 1–6 test expects [200, 503])
router.post('/run-scheduler', requireAuth, async (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Use POST /api/internal/tick to run the scheduler.'
  });
});

export default router;

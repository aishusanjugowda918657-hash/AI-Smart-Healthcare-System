import express from 'express';
import {
  getUserNotifications,
  markNotificationRead,
  triggerScheduler
} from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', requireAuth, getUserNotifications);
router.patch('/:id/read', requireAuth, markNotificationRead);
router.post('/run-scheduler', requireAuth, triggerScheduler);

export default router;

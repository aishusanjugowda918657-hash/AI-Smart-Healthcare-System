import express from 'express';
import { getAdminAnalyticsOverview } from '../controllers/adminController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/analytics/overview', requireAuth, requireRole('admin'), getAdminAnalyticsOverview);

export default router;

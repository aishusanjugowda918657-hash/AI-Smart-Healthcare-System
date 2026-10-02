import express from 'express';
import { getAdminAnalyticsOverview, setUserRole } from '../controllers/adminController.js';
import { adminMergePatients } from '../controllers/patientController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/analytics/overview', requireAuth, requireRole('admin'), getAdminAnalyticsOverview);
router.post('/users/:uid/role', requireAuth, requireRole('admin'), setUserRole);
router.post('/patients/merge', requireAuth, requireRole('admin'), adminMergePatients);

export default router;

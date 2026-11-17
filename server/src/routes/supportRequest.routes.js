import express from 'express';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';
import {
  createSupportRequest,
  getSupportRequests,
  updateSupportRequestStatus
} from '../controllers/supportRequestController.js';

const router = express.Router();

// Patient-only creation; Reception-side inbox and status controls.
router.post('/', requireAuth, requireRole('patient'), createSupportRequest);
router.get('/', requireAuth, requireRole('reception', 'nurse', 'admin'), getSupportRequests);
router.patch('/:id/status', requireAuth, requireRole('reception', 'nurse', 'admin'), updateSupportRequestStatus);

export default router;

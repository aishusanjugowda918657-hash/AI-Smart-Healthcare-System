import express from 'express';
import {
  createVisit,
  updateVisit,
  getVisitById,
  flagVisit,
  addVisitNote,
  toggleVisitRestricted
} from '../controllers/visitController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Visit Lifecycle & Clinical Records (PRD 4.2 / F9)
router.post('/', requireAuth, requireRole('doctor', 'admin'), createVisit);
router.get('/:id', requireAuth, getVisitById);
router.put('/:id', requireAuth, requireRole('doctor', 'admin'), updateVisit);
router.post('/:id/flag', requireAuth, flagVisit);
router.post('/:id/notes', requireAuth, requireRole('doctor', 'admin'), addVisitNote);
router.patch('/:id/restricted', requireAuth, requireRole('doctor', 'admin'), toggleVisitRestricted);

export default router;

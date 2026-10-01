import express from 'express';
import {
  createOrUpdatePatientProfile,
  getMyPatientProfile,
  getPatientByHealthId,
  addFamilyMember,
  getFamilyMembers,
  deleteFamilyMember
} from '../controllers/patientController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/profile', requireAuth, createOrUpdatePatientProfile);
router.get('/me', requireAuth, getMyPatientProfile);
router.post('/family', requireAuth, addFamilyMember);
router.get('/family', requireAuth, getFamilyMembers);
router.delete('/family/:id', requireAuth, deleteFamilyMember);
router.get(
  '/by-health-id/:healthId',
  requireAuth,
  requireRole('doctor', 'admin'),
  getPatientByHealthId
);

export default router;


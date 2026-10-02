import express from 'express';
import {
  createOrUpdatePatientProfile,
  getMyPatientProfile,
  getPatientByHealthId,
  addFamilyMember,
  getFamilyMembers,
  updateFamilyMember,
  deleteFamilyMember,
  createTemporaryPatient,
  convertTemporaryPatient,
  addCaregiver,
  acceptCaregiverInvite,
  updateCaregiver,
  removeCaregiver,
  getHealthIdCard,
  refreshHealthIdQr,
  staffPatientLookup,
  getPatientActivityHistory
} from '../controllers/patientController.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { requireRole } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/profile', requireAuth, createOrUpdatePatientProfile);
router.get('/me', requireAuth, getMyPatientProfile);

// Family & Caregivers
router.get('/family', requireAuth, getFamilyMembers);
router.post('/family', requireAuth, addFamilyMember);
router.patch('/family/:healthId', requireAuth, updateFamilyMember);
router.delete('/family/:healthId', requireAuth, deleteFamilyMember);

// Temporary Patients
router.post('/temporary', requireAuth, createTemporaryPatient);
router.post('/:healthId/convert', requireAuth, convertTemporaryPatient);

// Caregiver Management
router.post('/:healthId/caregivers', requireAuth, addCaregiver);
router.patch('/:healthId/caregivers/:caregiverUid', requireAuth, updateCaregiver);
router.delete('/:healthId/caregivers/:caregiverUid', requireAuth, removeCaregiver);

// Health ID Card & Activity
router.get('/:healthId/card', requireAuth, getHealthIdCard);
router.post('/:healthId/refresh-qr', requireAuth, refreshHealthIdQr);
router.get('/:healthId/activity', requireAuth, getPatientActivityHistory);

// Lookup (Staff)
router.get('/by-health-id/:healthId', requireAuth, requireRole('doctor', 'admin'), getPatientByHealthId);

export default router;

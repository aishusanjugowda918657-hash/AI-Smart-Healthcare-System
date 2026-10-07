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

import {
  getPatientHistory,
  getPatientVitalsTrend,
  sharePatientHistory,
  revokePatientShare,
  getActivePatientShares,
  getPatientAccessLog,
  exportMedicalHistoryPdf,
  addPatientAllergy,
  addPatientCondition,
  confirmPatientAllergy,
  confirmPatientCondition
} from '../controllers/medicalController.js';

const router = express.Router();

router.post('/profile', requireAuth, createOrUpdatePatientProfile);
router.get('/me', requireAuth, getMyPatientProfile);

// Task B: Medical History & Longitudinal Records (PRD 4.2 / F9 / Section 8)
router.get('/:healthId/history', requireAuth, getPatientHistory);
router.get('/:healthId/history.pdf', requireAuth, exportMedicalHistoryPdf);
router.get('/:healthId/vitals', requireAuth, getPatientVitalsTrend);
router.get('/:healthId/access-log', requireAuth, getPatientAccessLog);
router.post('/:healthId/share', requireAuth, sharePatientHistory);
router.delete('/:healthId/share/:shareId', requireAuth, revokePatientShare);
router.get('/:healthId/shares', requireAuth, getActivePatientShares);
router.post('/:healthId/allergies', requireAuth, addPatientAllergy);
router.post('/:healthId/conditions', requireAuth, addPatientCondition);
router.post('/:healthId/confirm-allergy', requireAuth, confirmPatientAllergy);
router.post('/:healthId/confirm-condition', requireAuth, confirmPatientCondition);

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
router.post('/:healthId/caregivers/accept', requireAuth, acceptCaregiverInvite);
router.post('/:healthId/accept-caregiver', requireAuth, acceptCaregiverInvite);
router.patch('/:healthId/caregivers/:caregiverUid', requireAuth, updateCaregiver);
router.delete('/:healthId/caregivers/:caregiverUid', requireAuth, removeCaregiver);

// Health ID Card & Activity
router.get('/:healthId/card', requireAuth, getHealthIdCard);
router.post('/:healthId/refresh-qr', requireAuth, refreshHealthIdQr);
router.get('/:healthId/activity', requireAuth, getPatientActivityHistory);

// Lookup (Staff)
router.get('/search', requireAuth, requireRole('doctor', 'admin', 'reception', 'nurse'), staffPatientLookup);
router.get('/by-health-id/:healthId', requireAuth, requireRole('doctor', 'admin'), getPatientByHealthId);

export default router;

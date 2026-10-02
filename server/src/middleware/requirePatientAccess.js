import { getDb } from '../config/firebase.js';
import { formatErrorResponse } from '../utils/errors.js';

/**
 * Require Patient Access Control Middleware
 * Enforces ownership, guardian, and active caregiver permissions per PRD Section 6 F1
 */
export const requirePatientAccess = (permission = 'viewRecords') => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.uid) {
        return res.status(401).json(formatErrorResponse('UNAUTHORIZED', 'Authentication required.'));
      }

      const healthId = req.params.healthId || req.body.patientHealthId || req.query.healthId;
      if (!healthId) {
        return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Patient Health ID is required for access check.'));
      }

      const db = getDb();
      if (!db) {
        // Test/mock mode fallback
        return next();
      }

      const patientSnap = await db.collection('patients').doc(healthId).get();
      if (!patientSnap.exists) {
        return res.status(404).json(formatErrorResponse('NOT_FOUND', `Patient record for Health ID '${healthId}' not found.`));
      }

      const patientData = patientSnap.data();
      const currentUid = req.user.uid;

      // 1. Direct Owner has full access
      if (patientData.ownerUid === currentUid) {
        req.patient = patientData;
        return next();
      }

      // 2. Check Caregiver / Guardian Access List
      const accessList = patientData.accessList || {};
      const userAccess = accessList[currentUid];

      if (!userAccess) {
        return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. You do not have access to this patient record.'));
      }

      if (userAccess.status !== 'active') {
        return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Access pending. Caregiver invitation has not been accepted.'));
      }

      if (userAccess.role === 'guardian') {
        req.patient = patientData;
        return next();
      }

      if (userAccess.permissions && userAccess.permissions[permission] === true) {
        req.patient = patientData;
        return next();
      }

      return res.status(403).json(formatErrorResponse('FORBIDDEN', `Forbidden. Caregiver missing '${permission}' permission.`));
    } catch (error) {
      next(error);
    }
  };
};

export default requirePatientAccess;

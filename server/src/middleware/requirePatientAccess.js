import { formatErrorResponse } from '../utils/errors.js';

/**
 * Patient Access Control Middleware Stub
 * Verifies if req.user is owner, guardian, or permitted caregiver
 * Will be completed in Phase 2 as per PRD Section 3.2 & F1
 */
export const requirePatientAccess = (permission = 'viewRecords') => {
  return (req, res, next) => {
    // Stub implementation: allows request to pass if user exists
    if (!req.user || !req.user.uid) {
      return res.status(401).json(formatErrorResponse('UNAUTHORIZED', 'Authentication required for patient access.'));
    }
    next();
  };
};

export default requirePatientAccess;

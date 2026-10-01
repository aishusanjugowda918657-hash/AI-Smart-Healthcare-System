import { formatErrorResponse } from '../utils/errors.js';

export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', 'Forbidden. User identity or role missing.'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json(formatErrorResponse('FORBIDDEN', `Forbidden. Role '${req.user.role}' is not authorized to access this resource. Allowed: [${allowedRoles.join(', ')}]`));
    }

    next();
  };
};

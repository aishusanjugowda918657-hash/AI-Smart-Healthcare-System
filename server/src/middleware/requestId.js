/**
 * Request ID Middleware
 * Attaches a unique request ID to every incoming request
 * Defined as per PRD Section 3.2
 */

import crypto from 'crypto';

export const requestIdMiddleware = (req, res, next) => {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = reqId;
  res.setHeader('x-request-id', reqId);
  next();
};

export default requestIdMiddleware;

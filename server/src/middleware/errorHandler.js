import { formatErrorResponse } from '../utils/errors.js';

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || (res.statusCode && res.statusCode !== 200 ? res.statusCode : 500);
  const errorCode = err.code || (statusCode === 400 ? 'VALIDATION_ERROR' : statusCode === 401 ? 'UNAUTHORIZED' : statusCode === 403 ? 'FORBIDDEN' : statusCode === 404 ? 'NOT_FOUND' : statusCode === 409 ? 'SLOT_TAKEN' : 'INTERNAL_ERROR');

  console.error(`[Error] [ReqID: ${req.requestId || 'n/a'}] [Code: ${errorCode}]`, err.message);

  res.status(statusCode).json(formatErrorResponse(
    errorCode,
    err.message || 'An unexpected server error occurred',
    err.details || {}
  ));
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default errorHandler;

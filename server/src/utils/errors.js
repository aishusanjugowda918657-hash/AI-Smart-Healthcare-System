/**
 * Custom Application Error Class & Error Envelopes
 * Standard error response per PRD Section 3.2 with backward compatibility for existing tests
 */

export class AppError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const ErrorCodes = Object.freeze({
  SLOT_TAKEN: 'SLOT_TAKEN',
  DISCLAIMER_REQUIRED: 'DISCLAIMER_REQUIRED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
});

export const formatErrorResponse = (code, message, details = {}) => ({
  success: false,
  code: code || ErrorCodes.INTERNAL_ERROR,
  message: message || 'An error occurred',
  ...details,
  error: {
    code: code || ErrorCodes.INTERNAL_ERROR,
    message: message || 'An unexpected error occurred',
    details,
    ...details
  }
});

export const formatSuccessResponse = (data = {}) => {
  const resObj = {
    success: true,
    data
  };
  if (data && typeof data === 'object' && data.status) {
    resObj.status = data.status;
  }
  return resObj;
};

import { formatErrorResponse } from '../utils/errors.js';

/**
 * Zod Validation Middleware
 * Validates req.body, req.query, and req.params against provided Zod schemas
 * Defined as per PRD Section 3.2
 */
export const validate = (schemas = {}) => {
  return async (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      next();
    } catch (error) {
      if (error.name === 'ZodError') {
        const details = {};
        error.errors.forEach((err) => {
          const key = err.path.join('.') || 'payload';
          details[key] = err.message;
        });
        return res.status(400).json(formatErrorResponse('VALIDATION_ERROR', 'Validation Error: Invalid input parameters', details));
      }
      next(error);
    }
  };
};

export default validate;

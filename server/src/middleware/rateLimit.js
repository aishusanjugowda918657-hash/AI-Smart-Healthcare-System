/**
 * Rate Limiting Middleware
 * Protects AI and public endpoints from abuse
 * Defined as per PRD Section 3.2 & 8.4
 */

import rateLimit from 'express-rate-limit';
import { formatErrorResponse } from '../utils/errors.js';

export const aiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(formatErrorResponse('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded for AI endpoints. Maximum 10 requests per minute allowed.'));
  }
});

export const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(formatErrorResponse('RATE_LIMIT_EXCEEDED', 'Too many requests. Please try again later.'));
  }
});

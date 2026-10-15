import rateLimit, { type Options } from 'express-rate-limit';
import { rateLimitConfig } from '../config/rateLimit';

const limitedResponse = {
  success: false,
  error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
};

const createLimiter = (options: Partial<Options>) =>
  rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: limitedResponse,
    ...options,
  });

export const apiLimiter = createLimiter({
  windowMs: rateLimitConfig.api.windowMs,
  limit: rateLimitConfig.api.max,
});

// Used by login, register and password reset routes (added in the auth step).
export const authLimiter = createLimiter({
  windowMs: rateLimitConfig.auth.windowMs,
  limit: rateLimitConfig.auth.max,
  skipSuccessfulRequests: true,
});
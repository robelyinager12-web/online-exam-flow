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

// Login, refresh, verify and reset: only failed requests count.
export const authLimiter = createLimiter({
  windowMs: rateLimitConfig.auth.windowMs,
  limit: rateLimitConfig.auth.max,
  skipSuccessfulRequests: true,
});

// Register, forgot password, resend verification: these "succeed" by design, so all requests count.
export const accountActionLimiter = createLimiter({
  windowMs: rateLimitConfig.accountActions.windowMs,
  limit: rateLimitConfig.accountActions.max,
});
import { env } from './env';

export const rateLimitConfig = {
  // General API limit, per IP.
  api: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
  // Login, register, password reset: strict, to slow down brute force attacks.
  auth: { windowMs: 15 * 60 * 1000, max: 10 },
} as const;
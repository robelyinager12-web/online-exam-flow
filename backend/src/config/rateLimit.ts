import { env } from './env';

export const rateLimitConfig = {
  // General API limit, per IP.
  api: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
  // Failed logins, refreshes and token submissions, per IP. Single accounts are protected
  // by the lockout (5 failures), so this stays generous for classrooms sharing one IP.
  auth: { windowMs: 15 * 60 * 1000, max: 100 },
  // Register, forgot password and resend verification: every request counts.
  accountActions: { windowMs: 60 * 60 * 1000, max: 30 },
} as const;
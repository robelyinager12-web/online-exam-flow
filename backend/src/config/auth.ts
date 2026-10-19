import { env } from './env';

export const authConfig = {
  accessCookie: 'ef_access',
  refreshCookie: 'ef_refresh',
  // The refresh cookie is only ever sent to the auth endpoints.
  refreshCookiePath: '/api/v1/auth',
  accessTtlSeconds: env.ACCESS_TOKEN_TTL_MINUTES * 60,
  refreshTtlSeconds: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  maxFailedLogins: 5,
  lockMinutes: 15,
  verifyTokenTtlMs: 24 * 60 * 60 * 1000,
  resetTokenTtlMs: 60 * 60 * 1000,
  // Minimum gap between two emails of the same type to the same user (prevents email bombing).
    // Invitation links (admin-created accounts) stay valid longer than reset links.
  inviteTokenTtlMs: 72 * 60 * 60 * 1000,
  emailThrottleMs: 60 * 1000,
  // A refresh token that was rotated this recently is treated as a harmless race
  // (two tabs refreshing at once), not as token theft.
  refreshReuseGraceSeconds: 10,
  jwtIssuer: 'examflow',
  jwtAudience: 'examflow-web',
} as const;
import type { RequestHandler } from 'express';
import { authConfig } from '../config/auth';
import { AppError } from '../lib/appError';
import { verifyAccessToken } from '../lib/jwt';

// Accepts the access token from the httpOnly cookie (browser) or an Authorization header (API clients).
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token: string | undefined =
    req.cookies?.[authConfig.accessCookie] ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

  if (!token) {
    return next(AppError.unauthorized());
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      institutionId: payload.institutionId,
      sessionId: payload.sid,
    };
    return next();
  } catch (error) {
    return next(error);
  }
};
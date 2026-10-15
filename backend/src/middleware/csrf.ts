import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError } from '../lib/appError';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSRF defence for cookie-based authentication, on top of SameSite cookies:
//  1. A browser always sends an Origin header on cross-site state-changing requests,
//     and it must be one of our allowed frontends.
//  2. Bodies must be JSON (or multipart for file uploads). The content types an HTML form
//     can send without a CORS preflight (urlencoded, text/plain) are rejected.
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  if (origin && !env.CORS_ORIGINS.includes(origin)) {
    return next(AppError.forbidden('Origin not allowed'));
  }

  const hasBody =
    Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !req.is(['application/json', 'multipart/form-data'])) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
  }

  return next();
};
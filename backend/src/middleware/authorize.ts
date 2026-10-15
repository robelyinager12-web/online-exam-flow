import type { RequestHandler } from 'express';
import type { RoleName } from '../config/roles';
import { AppError } from '../lib/appError';

// Role-based access control. Roles are listed explicitly on every route, with no hidden bypass.
// Always place after `authenticate`.
export const authorize =
  (...allowedRoles: RoleName[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized());
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(AppError.forbidden());
    }
    return next();
  };